/**
 * Phase 1 Integration: Provenance + Extraction Registry
 *
 * Capstone test verifying the entire Phase 1 pipeline end-to-end:
 *   registry -> extract -> log -> link -> query -> export -> replay
 *
 * Uses a mock adapter returning realistic SAP VBAK data and an
 * in-memory (:memory:) ProvenanceDB.
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';

import { ProvenanceDB } from '../provenance/schema.js';
import { ProvenanceLogger } from '../provenance/logger.js';
import { ProvenanceQuery } from '../provenance/query.js';
import { ProvenanceExporter } from '../provenance/export.js';
import {
  computeQueryHash,
  computeReplayHash,
  computeFieldHash,
  verifyReplayHash,
} from '../provenance/replay.js';
import { ExtractionRegistry, validatePath } from '../extraction-registry/index.js';
import { SAP_O2C_PATHS } from '../extraction-registry/sap/o2c.js';
import { SAP_FICO_PATHS } from '../extraction-registry/sap/fi-co.js';
import { SAP_P2P_PATHS } from '../extraction-registry/sap/p2p.js';
import { SFDC_PIPELINE_PATHS } from '../extraction-registry/sfdc/pipeline.js';
import { NETSUITE_USER_AUDIT_PATHS } from '../extraction-registry/netsuite/user-audit.js';
import type { IDataAdapter } from '../adapters/adapter-interface.js';
import type { ExtractionRecord } from '../provenance/types.js';
import type {
  SalesDocHeader,
  SalesDocItem,
  DocFlowResult,
  DocTextResult,
  SearchResult,
  DeliveryTimingResult,
  InvoiceTimingResult,
  MasterStub,
} from '../types/index.js';

// ---------------------------------------------------------------------------
// All 19 built-in extraction paths
// ---------------------------------------------------------------------------

const ALL_BUILTIN_PATHS = [
  ...SAP_O2C_PATHS,
  ...SAP_FICO_PATHS,
  ...SAP_P2P_PATHS,
  ...SFDC_PIPELINE_PATHS,
  ...NETSUITE_USER_AUDIT_PATHS,
];

// ---------------------------------------------------------------------------
// Mock adapter returning realistic SAP O2C data
// ---------------------------------------------------------------------------

const MOCK_VBELN = '0000054321';

const mockSalesHeader: SalesDocHeader = {
  VBELN: MOCK_VBELN,
  AUART: 'OR',
  VKORG: '1000',
  VTWEG: '10',
  SPART: '00',
  KUNNR: '0000100042',
  AUDAT: '20260315',
  ERNAM: 'JSMITH',
  ERDAT: '20260315',
  ERZET: '093000',
  NETWR: 125000,
  WAERK: 'USD',
  BSTNK: 'PO-2026-0815',
};

const mockSalesItems: SalesDocItem[] = [
  {
    VBELN: MOCK_VBELN,
    POSNR: '000010',
    MATNR: 'MAT-FG-1001',
    ARKTX: 'Industrial Pump Assembly',
    WERKS: '1100',
    KWMENG: 50,
    VRKME: 'EA',
    NETWR: 75000,
    WAERK: 'USD',
    PSTYV: 'TAN',
  },
  {
    VBELN: MOCK_VBELN,
    POSNR: '000020',
    MATNR: 'MAT-FG-2002',
    ARKTX: 'Pump Gasket Kit',
    WERKS: '1100',
    KWMENG: 200,
    VRKME: 'EA',
    NETWR: 50000,
    WAERK: 'USD',
    PSTYV: 'TAN',
  },
];

const mockDocFlow: DocFlowResult = {
  root_document: MOCK_VBELN,
  flow: [
    {
      doc_type: 'Sales Order',
      doc_number: MOCK_VBELN,
      doc_category: 'C',
      created_date: '20260315',
      created_time: '093000',
      items: [
        { item_number: '000010', quantity: 50 },
        { item_number: '000020', quantity: 200 },
      ],
    },
    {
      doc_type: 'Delivery',
      doc_number: '0080067890',
      doc_category: 'J',
      created_date: '20260320',
      created_time: '140000',
      items: [{ item_number: '000010', ref_doc: MOCK_VBELN, ref_item: '000010', quantity: 50 }],
    },
  ],
};

function createMockAdapter(): IDataAdapter {
  let ready = false;
  return {
    name: 'mock-sap-adapter',

    async initialize() {
      ready = true;
    },
    async shutdown() {
      ready = false;
    },
    isReady() {
      return ready;
    },

    async searchDocText() {
      return [] as SearchResult[];
    },
    async getDocText() {
      return { header_texts: [], item_texts: [] } as DocTextResult;
    },
    async getDocFlow() {
      return mockDocFlow;
    },
    async getSalesDocHeader() {
      return mockSalesHeader;
    },
    async getSalesDocItems() {
      return mockSalesItems;
    },
    async getDeliveryTiming() {
      return null as DeliveryTimingResult | null;
    },
    async getInvoiceTiming() {
      return null as InvoiceTimingResult | null;
    },
    async getMasterStub() {
      return null as MasterStub | null;
    },
  };
}

// ===========================================================================
// Tests
// ===========================================================================

describe('Phase 1 Integration: Provenance + Extraction Registry', () => {
  let db: ProvenanceDB;
  let registry: ExtractionRegistry;

  beforeAll(() => {
    db = new ProvenanceDB(':memory:');
    registry = new ExtractionRegistry();
    registry.registerAll(ALL_BUILTIN_PATHS);
  });

  afterAll(() => {
    db.close();
  });

  // -------------------------------------------------------------------------
  // 1. Extraction Registry
  // -------------------------------------------------------------------------

  describe('Extraction Registry', () => {
    it('loads all 19 built-in extraction paths', () => {
      expect(registry.size).toBe(19);
    });

    it('SAP O2C paths are queryable by domain', () => {
      const o2cPaths = registry.list({ domain: 'o2c' });
      expect(o2cPaths).toHaveLength(5);
      for (const path of o2cPaths) {
        expect(path.domain).toBe('o2c');
        expect(path.systemType).toBe('SAP');
      }
    });

    it('filters by system type correctly', () => {
      const sapPaths = registry.list({ systemType: 'SAP' });
      expect(sapPaths.length).toBe(13); // 5 O2C + 4 FI-CO + 4 P2P

      const sfdcPaths = registry.list({ systemType: 'Salesforce' });
      expect(sfdcPaths).toHaveLength(3);

      const nsPaths = registry.list({ systemType: 'NetSuite' });
      expect(nsPaths).toHaveLength(3);
    });

    it('paths have valid structure (all pass validatePath)', () => {
      for (const path of ALL_BUILTIN_PATHS) {
        const result = validatePath(path);
        expect(result.valid).toBe(true);
        if (!result.valid) {
          // Helps debugging if any fail
          throw new Error(`Path '${path.id}' failed validation: ${result.errors.join(', ')}`);
        }
      }
    });

    it('all paths have unique IDs', () => {
      const ids = ALL_BUILTIN_PATHS.map(p => p.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
    });

    it('registry metadata is correct', () => {
      const meta = registry.getMetadata();
      expect(meta.pathCount).toBe(19);
      expect(meta.domains.sort()).toEqual(['fi-co', 'o2c', 'p2p', 'pipeline', 'user-audit']);
      expect(meta.systems.sort()).toEqual(['NetSuite', 'SAP', 'Salesforce']);
    });

    it('can look up a specific path by ID', () => {
      const path = registry.get('sap.o2c.order-header');
      expect(path).toBeDefined();
      expect(path!.name).toBe('SAP Sales Order Header');
      expect(path!.expectedFields.length).toBeGreaterThan(0);
    });

    it('validates parameters against path definitions', () => {
      const valid = registry.validateParameters('sap.o2c.order-header', { vbeln: '0000000001' });
      expect(valid.valid).toBe(true);

      const missing = registry.validateParameters('sap.o2c.order-header', {});
      expect(missing.valid).toBe(false);
      expect(missing.errors.length).toBeGreaterThan(0);
    });
  });

  // -------------------------------------------------------------------------
  // 2. Provenance Logging
  // -------------------------------------------------------------------------

  describe('Provenance Logging', () => {
    let logger: ProvenanceLogger;
    let wrapped: IDataAdapter;
    let headerRecordIds: string[];

    beforeAll(async () => {
      logger = new ProvenanceLogger(db, 'mock-sap-001', 'SAP');
      const adapter = createMockAdapter();
      wrapped = logger.wrapAdapter(adapter);
      await wrapped.initialize();

      // Execute: get sales doc header (the core extraction)
      await wrapped.getSalesDocHeader({ vbeln: MOCK_VBELN });

      // Capture the IDs for later evidence linking
      const stats = db.getStats();
      expect(stats.totalExtractions).toBeGreaterThan(0);

      const vbakRecords = db.getExtractionsByTable('SAP', 'VBAK');
      headerRecordIds = vbakRecords.map(r => r.id);
    });

    it('ProvenanceLogger wraps an adapter and logs extractions', () => {
      const vbakRecords = db.getExtractionsByTable('SAP', 'VBAK');
      expect(vbakRecords.length).toBeGreaterThan(0);
      for (const r of vbakRecords) {
        expect(r.adapterId).toBe('mock-sap-001');
        expect(r.systemType).toBe('SAP');
        expect(r.tableName).toBe('VBAK');
      }
    });

    it('extraction records have field-level granularity', () => {
      const vbakRecords = db.getExtractionsByTable('SAP', 'VBAK');
      const fieldNames = vbakRecords.map(r => r.fieldName);

      // The mock header has these concrete fields
      expect(fieldNames).toContain('VBELN');
      expect(fieldNames).toContain('AUART');
      expect(fieldNames).toContain('ERDAT');
      expect(fieldNames).toContain('NETWR');
      expect(fieldNames).toContain('WAERK');
      expect(fieldNames).toContain('BSTNK');

      // Verify raw values match the mock data
      const vbelnRec = vbakRecords.find(r => r.fieldName === 'VBELN');
      expect(vbelnRec!.rawValue).toBe(MOCK_VBELN);

      const netwrRec = vbakRecords.find(r => r.fieldName === 'NETWR');
      expect(netwrRec!.rawValue).toBe('125000');
    });

    it('query hash is deterministic for same inputs', () => {
      const vbakRecords = db.getExtractionsByTable('SAP', 'VBAK');
      const queryHashes = new Set(vbakRecords.map(r => r.queryHash));
      // All records from one call share one query hash
      expect(queryHashes.size).toBe(1);

      const hash = [...queryHashes][0]!;
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('replay hash is deterministic for same results', () => {
      const vbakRecords = db.getExtractionsByTable('SAP', 'VBAK');
      const replayHashes = new Set(vbakRecords.map(r => r.replayHash));
      // All records from one call share one replay hash
      expect(replayHashes.size).toBe(1);

      const hash = [...replayHashes][0]!;
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('logs multi-row results (sales doc items)', async () => {
      await wrapped.getSalesDocItems({ vbeln: MOCK_VBELN });
      const vbapRecords = db.getExtractionsByTable('SAP', 'VBAP');
      expect(vbapRecords.length).toBeGreaterThan(0);

      // Two items, each with multiple fields
      const fieldNames = vbapRecords.map(r => r.fieldName);
      expect(fieldNames).toContain('POSNR');
      expect(fieldNames).toContain('MATNR');
      expect(fieldNames).toContain('KWMENG');
    });

    it('logs nested results (doc flow)', async () => {
      await wrapped.getDocFlow({ vbeln: MOCK_VBELN });
      const vbfaRecords = db.getExtractionsByTable('SAP', 'VBFA');
      expect(vbfaRecords.length).toBeGreaterThan(0);

      // Should have dotted field names for nested data
      const fieldNames = vbfaRecords.map(r => r.fieldName);
      expect(fieldNames).toContain('root_document');
      expect(fieldNames).toContain('flow.0.doc_type');
      expect(fieldNames).toContain('flow.0.doc_number');
    });
  });

  // -------------------------------------------------------------------------
  // 3. Evidence Chain
  // -------------------------------------------------------------------------

  describe('Evidence Chain', () => {
    const findingId = 'FINDING-001-revenue-recognition';
    let primaryIds: string[];
    let corroboratingIds: string[];

    beforeAll(async () => {
      // Use existing VBAK records as primary evidence
      const vbakRecords = db.getExtractionsByTable('SAP', 'VBAK');
      primaryIds = vbakRecords.slice(0, 3).map(r => r.id);

      // Use VBAP records as corroborating evidence
      const vbapRecords = db.getExtractionsByTable('SAP', 'VBAP');
      corroboratingIds = vbapRecords.slice(0, 2).map(r => r.id);

      // Link primary evidence
      for (const id of primaryIds) {
        db.linkEvidence(findingId, id, 'primary');
      }
      // Link corroborating evidence
      for (const id of corroboratingIds) {
        db.linkEvidence(findingId, id, 'corroborating');
      }
    });

    it('can link extractions to a finding as primary evidence', () => {
      const results = db.getExtractionsByFinding(findingId);
      const primaries = results.filter(r => r.role === 'primary');
      expect(primaries).toHaveLength(primaryIds.length);
      for (const p of primaries) {
        expect(primaryIds).toContain(p.id);
      }
    });

    it('can link extractions to a finding as corroborating evidence', () => {
      const results = db.getExtractionsByFinding(findingId);
      const corroborating = results.filter(r => r.role === 'corroborating');
      expect(corroborating).toHaveLength(corroboratingIds.length);
      for (const c of corroborating) {
        expect(corroboratingIds).toContain(c.id);
      }
    });

    it('getEvidenceChain returns grouped results', () => {
      const query = new ProvenanceQuery(db);
      const chain = query.getEvidenceChain(findingId);

      expect(chain.primary).toHaveLength(primaryIds.length);
      expect(chain.corroborating).toHaveLength(corroboratingIds.length);
      expect(chain.contradicting).toHaveLength(0);
    });

    it('supports contradicting evidence role', () => {
      const contradictingFinding = 'FINDING-002-contradicting';
      const vbfaRecords = db.getExtractionsByTable('SAP', 'VBFA');
      if (vbfaRecords.length > 0) {
        db.linkEvidence(contradictingFinding, vbfaRecords[0]!.id, 'contradicting');
        const query = new ProvenanceQuery(db);
        const chain = query.getEvidenceChain(contradictingFinding);
        expect(chain.contradicting).toHaveLength(1);
      }
    });
  });

  // -------------------------------------------------------------------------
  // 4. Provenance Query
  // -------------------------------------------------------------------------

  describe('Provenance Query', () => {
    const findingId = 'FINDING-001-revenue-recognition';

    it('getSummary returns correct system and table coverage', () => {
      const query = new ProvenanceQuery(db);
      const summary = query.getSummary(findingId);

      expect(summary.findingId).toBe(findingId);
      expect(summary.extractionCount).toBeGreaterThan(0);
      expect(summary.systemsCovered).toContain('SAP');
      expect(summary.tablesCovered.length).toBeGreaterThan(0);
      expect(summary.oldestExtraction).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(summary.newestExtraction).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('getTableCoverage aggregates across extractions', () => {
      const query = new ProvenanceQuery(db);
      const coverage = query.getTableCoverage(findingId);

      expect(coverage.length).toBeGreaterThan(0);
      for (const entry of coverage) {
        expect(entry.systemType).toBeDefined();
        expect(entry.tableName).toBeDefined();
        expect(entry.recordCount).toBeGreaterThan(0);
      }

      // Should have VBAK entries (primary evidence)
      const vbakEntry = coverage.find(c => c.systemType === 'SAP' && c.tableName === 'VBAK');
      expect(vbakEntry).toBeDefined();
    });

    it('verifyFindingReplayability detects stale data', () => {
      const query = new ProvenanceQuery(db);
      const extractions = db.getExtractionsByFinding(findingId);

      // Build a correct hash map
      const correctHashes = new Map<string, string>();
      for (const ext of extractions) {
        correctHashes.set(ext.queryHash, ext.replayHash);
      }

      // All correct -> all replayable
      const correctResult = query.verifyFindingReplayability(findingId, correctHashes);
      expect(correctResult.allReplayable).toBe(true);
      expect(correctResult.staleExtractions).toHaveLength(0);

      // Tamper with one hash -> should detect stale
      const tamperedHashes = new Map(correctHashes);
      const firstKey = [...tamperedHashes.keys()][0]!;
      tamperedHashes.set(firstKey, 'tampered-hash-value');

      const staleResult = query.verifyFindingReplayability(findingId, tamperedHashes);
      expect(staleResult.allReplayable).toBe(false);
      expect(staleResult.staleExtractions.length).toBeGreaterThan(0);
      expect(staleResult.staleExtractions[0]!.actual).toBe('tampered-hash-value');
    });

    it('returns empty summary for unknown finding', () => {
      const query = new ProvenanceQuery(db);
      const summary = query.getSummary('NONEXISTENT-FINDING');
      expect(summary.extractionCount).toBe(0);
      expect(summary.systemsCovered).toHaveLength(0);
      expect(summary.tablesCovered).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // 5. Export Formats
  // -------------------------------------------------------------------------

  describe('Export Formats', () => {
    const findingId = 'FINDING-001-revenue-recognition';

    it('exportDAG produces valid tree structure', () => {
      const query = new ProvenanceQuery(db);
      const exporter = new ProvenanceExporter(query);
      const dag = exporter.exportDAG(findingId);

      expect(dag.rootFindingId).toBe(findingId);
      expect(dag.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(typeof dag.replayable).toBe('boolean');

      // Root should have one node
      expect(dag.nodes).toHaveLength(1);
      const root = dag.nodes[0]!;
      expect(root.type).toBe('finding');
      expect(root.id).toBe(findingId);

      // Root should have evidence children (at least primary and corroborating)
      expect(root.children.length).toBeGreaterThanOrEqual(2);

      // Each evidence node should have extraction children
      for (const evidenceNode of root.children) {
        expect(evidenceNode.type).toBe('evidence');
        expect(evidenceNode.children.length).toBeGreaterThan(0);

        for (const extractionNode of evidenceNode.children) {
          expect(extractionNode.type).toBe('extraction');
          expect(extractionNode.data).toHaveProperty('systemType');
          expect(extractionNode.data).toHaveProperty('tableName');
          expect(extractionNode.data).toHaveProperty('fieldName');
          expect(extractionNode.data).toHaveProperty('rawValue');
          expect(extractionNode.children).toHaveLength(0);
        }
      }
    });

    it('exportFlat produces one row per extraction', () => {
      const query = new ProvenanceQuery(db);
      const exporter = new ProvenanceExporter(query);
      const rows = exporter.exportFlat(findingId);

      expect(rows.length).toBeGreaterThan(0);

      for (const row of rows) {
        expect(row.findingId).toBe(findingId);
        expect(['primary', 'corroborating', 'contradicting']).toContain(row.role);
        expect(row.extractionId).toBeTruthy();
        expect(row.systemType).toBeTruthy();
        expect(row.tableName).toBeTruthy();
        expect(row.queryHash).toBeTruthy();
        expect(row.replayHash).toBeTruthy();
      }
    });

    it('exportMarkdown produces valid markdown table', () => {
      const query = new ProvenanceQuery(db);
      const exporter = new ProvenanceExporter(query);
      const markdown = exporter.exportMarkdown(findingId);

      expect(markdown).toContain(`# Provenance: ${findingId}`);
      expect(markdown).toContain('| Role |');
      expect(markdown).toContain('|------|');
      expect(markdown).toContain('| primary |');
      expect(markdown).toContain('| corroborating |');
      expect(markdown).toContain('SAP');
      expect(markdown).toContain('VBAK');
    });

    it('exportMarkdown for empty finding says no evidence', () => {
      const query = new ProvenanceQuery(db);
      const exporter = new ProvenanceExporter(query);
      const markdown = exporter.exportMarkdown('NO-SUCH-FINDING');
      expect(markdown).toContain('No evidence found.');
    });
  });

  // -------------------------------------------------------------------------
  // 6. Replay Hash Module (standalone functions)
  // -------------------------------------------------------------------------

  describe('Replay Hash Module', () => {
    it('computeQueryHash is deterministic for same inputs', () => {
      const hash1 = computeQueryHash('sap.o2c.order-header', '1.0', { vbeln: MOCK_VBELN });
      const hash2 = computeQueryHash('sap.o2c.order-header', '1.0', { vbeln: MOCK_VBELN });
      expect(hash1).toBe(hash2);
      expect(hash1).toMatch(/^[0-9a-f]{64}$/);
    });

    it('computeQueryHash differs for different params', () => {
      const hash1 = computeQueryHash('sap.o2c.order-header', '1.0', { vbeln: '0000000001' });
      const hash2 = computeQueryHash('sap.o2c.order-header', '1.0', { vbeln: '0000000002' });
      expect(hash1).not.toBe(hash2);
    });

    it('computeQueryHash is independent of parameter order', () => {
      const hash1 = computeQueryHash('path', '1.0', { a: '1', b: '2', c: '3' });
      const hash2 = computeQueryHash('path', '1.0', { c: '3', a: '1', b: '2' });
      expect(hash1).toBe(hash2);
    });

    it('computeReplayHash is deterministic for same rows', () => {
      const rows = [
        { VBELN: MOCK_VBELN, AUART: 'OR', NETWR: '125000' },
        { VBELN: MOCK_VBELN, AUART: 'OR', NETWR: '125000' },
      ];
      const hash1 = computeReplayHash(rows);
      const hash2 = computeReplayHash(rows);
      expect(hash1).toBe(hash2);
    });

    it('computeReplayHash differs when data changes', () => {
      const rows1 = [{ VBELN: MOCK_VBELN, NETWR: '125000' }];
      const rows2 = [{ VBELN: MOCK_VBELN, NETWR: '130000' }];
      expect(computeReplayHash(rows1)).not.toBe(computeReplayHash(rows2));
    });

    it('verifyReplayHash detects matching hashes', () => {
      const rows = [{ VBELN: MOCK_VBELN, AUART: 'OR' }];
      const expected = computeReplayHash(rows);
      const result = verifyReplayHash(expected, rows);
      expect(result.match).toBe(true);
      expect(result.currentHash).toBe(expected);
    });

    it('verifyReplayHash detects mismatched hashes', () => {
      const rows = [{ VBELN: MOCK_VBELN, AUART: 'OR' }];
      const result = verifyReplayHash('wrong-hash', rows);
      expect(result.match).toBe(false);
      expect(result.currentHash).not.toBe('wrong-hash');
    });

    it('computeFieldHash is deterministic', () => {
      const hash1 = computeFieldHash('SAP', 'VBAK', MOCK_VBELN, 'NETWR', '125000');
      const hash2 = computeFieldHash('SAP', 'VBAK', MOCK_VBELN, 'NETWR', '125000');
      expect(hash1).toBe(hash2);
      expect(hash1).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  // -------------------------------------------------------------------------
  // 7. Full Pipeline: registry -> extract -> log -> link -> query -> export
  // -------------------------------------------------------------------------

  describe('Full Pipeline', () => {
    it('registry -> extract -> log -> link -> query -> export roundtrip', async () => {
      // Fresh DB for this test to isolate the roundtrip
      const pipelineDb = new ProvenanceDB(':memory:');

      try {
        // ---------------------------------------------------------------
        // Step 1: Get extraction path from registry
        // ---------------------------------------------------------------
        const orderHeaderPath = registry.get('sap.o2c.order-header');
        expect(orderHeaderPath).toBeDefined();
        expect(orderHeaderPath!.systemType).toBe('SAP');
        expect(orderHeaderPath!.expectedFields.length).toBeGreaterThanOrEqual(16);

        // Validate the parameters we are about to use
        const paramValidation = registry.validateParameters('sap.o2c.order-header', {
          vbeln: MOCK_VBELN,
        });
        expect(paramValidation.valid).toBe(true);

        // ---------------------------------------------------------------
        // Step 2: Simulate extraction via mock adapter with logger
        // ---------------------------------------------------------------
        const pipelineLogger = new ProvenanceLogger(pipelineDb, 'pipeline-test-adapter', 'SAP');
        const adapter = createMockAdapter();
        const wrappedAdapter = pipelineLogger.wrapAdapter(adapter);
        await wrappedAdapter.initialize();

        // Execute the extraction the path describes
        const headerResult = await wrappedAdapter.getSalesDocHeader({ vbeln: MOCK_VBELN });
        expect(headerResult).not.toBeNull();
        expect(headerResult!.VBELN).toBe(MOCK_VBELN);
        expect(headerResult!.AUART).toBe('OR');
        expect(headerResult!.NETWR).toBe(125000);

        // Also extract items for corroborating evidence
        const itemsResult = await wrappedAdapter.getSalesDocItems({ vbeln: MOCK_VBELN });
        expect(itemsResult).toHaveLength(2);

        // Also extract doc flow
        const flowResult = await wrappedAdapter.getDocFlow({ vbeln: MOCK_VBELN });
        expect(flowResult.root_document).toBe(MOCK_VBELN);

        await wrappedAdapter.shutdown();

        // ---------------------------------------------------------------
        // Step 3: Verify records are in the provenance DB
        // ---------------------------------------------------------------
        const stats = pipelineDb.getStats();
        expect(stats.totalExtractions).toBeGreaterThan(0);
        expect(stats.systemCounts['SAP']).toBe(stats.totalExtractions);

        const vbakRecords = pipelineDb.getExtractionsByTable('SAP', 'VBAK');
        expect(vbakRecords.length).toBeGreaterThan(0);
        const vbapRecords = pipelineDb.getExtractionsByTable('SAP', 'VBAP');
        expect(vbapRecords.length).toBeGreaterThan(0);
        const vbfaRecords = pipelineDb.getExtractionsByTable('SAP', 'VBFA');
        expect(vbfaRecords.length).toBeGreaterThan(0);

        // Verify field-level detail is correct
        const vbelnField = vbakRecords.find(r => r.fieldName === 'VBELN');
        expect(vbelnField).toBeDefined();
        expect(vbelnField!.rawValue).toBe(MOCK_VBELN);

        const netwrField = vbakRecords.find(r => r.fieldName === 'NETWR');
        expect(netwrField).toBeDefined();
        expect(netwrField!.rawValue).toBe('125000');
        expect(netwrField!.normalizedValue).toBe('125000');

        const auartField = vbakRecords.find(r => r.fieldName === 'AUART');
        expect(auartField).toBeDefined();
        expect(auartField!.rawValue).toBe('OR');

        // ---------------------------------------------------------------
        // Step 4: Create a finding and link evidence
        // ---------------------------------------------------------------
        const findingId = 'FINDING-PIPELINE-001-suspicious-order';

        // Primary evidence: VBAK header fields
        for (const rec of vbakRecords) {
          pipelineDb.linkEvidence(findingId, rec.id, 'primary');
        }

        // Corroborating evidence: VBAP item fields
        for (const rec of vbapRecords) {
          pipelineDb.linkEvidence(findingId, rec.id, 'corroborating');
        }

        // ---------------------------------------------------------------
        // Step 5: Query provenance chain
        // ---------------------------------------------------------------
        const query = new ProvenanceQuery(pipelineDb);

        // Evidence chain
        const chain = query.getEvidenceChain(findingId);
        expect(chain.primary).toHaveLength(vbakRecords.length);
        expect(chain.corroborating).toHaveLength(vbapRecords.length);
        expect(chain.contradicting).toHaveLength(0);

        // Summary
        const summary = query.getSummary(findingId);
        expect(summary.findingId).toBe(findingId);
        expect(summary.extractionCount).toBe(vbakRecords.length + vbapRecords.length);
        expect(summary.systemsCovered).toEqual(['SAP']);
        expect(summary.tablesCovered.sort()).toEqual(['VBAK', 'VBAP']);

        // Table coverage
        const coverage = query.getTableCoverage(findingId);
        expect(coverage).toHaveLength(2); // VBAK and VBAP
        const vbakCoverage = coverage.find(c => c.tableName === 'VBAK');
        expect(vbakCoverage).toBeDefined();
        expect(vbakCoverage!.recordCount).toBe(vbakRecords.length);
        const vbapCoverage = coverage.find(c => c.tableName === 'VBAP');
        expect(vbapCoverage).toBeDefined();
        expect(vbapCoverage!.recordCount).toBe(vbapRecords.length);

        // ---------------------------------------------------------------
        // Step 6: Export in all three formats
        // ---------------------------------------------------------------
        const exporter = new ProvenanceExporter(query);

        // DAG
        const dag = exporter.exportDAG(findingId);
        expect(dag.rootFindingId).toBe(findingId);
        expect(dag.nodes).toHaveLength(1);
        const root = dag.nodes[0]!;
        expect(root.type).toBe('finding');
        expect(root.children.length).toBe(2); // primary + corroborating

        const primaryNode = root.children.find(
          n => (n.data as Record<string, unknown>)['role'] === 'primary'
        );
        expect(primaryNode).toBeDefined();
        expect(primaryNode!.children).toHaveLength(vbakRecords.length);

        const corrobNode = root.children.find(
          n => (n.data as Record<string, unknown>)['role'] === 'corroborating'
        );
        expect(corrobNode).toBeDefined();
        expect(corrobNode!.children).toHaveLength(vbapRecords.length);

        // Flat
        const flatRows = exporter.exportFlat(findingId);
        expect(flatRows).toHaveLength(vbakRecords.length + vbapRecords.length);
        for (const row of flatRows) {
          expect(row.findingId).toBe(findingId);
          expect(row.systemType).toBe('SAP');
        }

        // Markdown
        const markdown = exporter.exportMarkdown(findingId);
        expect(markdown).toContain(`# Provenance: ${findingId}`);
        expect(markdown).toContain('| Role |');
        expect(markdown).toContain('|------|');
        // Verify the markdown contains actual SAP table names and field values
        expect(markdown).toContain('VBAK');
        expect(markdown).toContain('VBAP');
        expect(markdown).toContain('primary');
        expect(markdown).toContain('corroborating');
        expect(markdown).toContain(MOCK_VBELN);

        // ---------------------------------------------------------------
        // Step 7: Verify replay hashes
        // ---------------------------------------------------------------
        // All VBAK records from the same getSalesDocHeader call share one
        // query hash and one replay hash
        const queryHashes = new Set(vbakRecords.map(r => r.queryHash));
        expect(queryHashes.size).toBe(1);
        const qh = [...queryHashes][0]!;

        const replayHashes = new Set(vbakRecords.map(r => r.replayHash));
        expect(replayHashes.size).toBe(1);
        const rh = [...replayHashes][0]!;

        // DB-level replay verification
        expect(pipelineDb.verifyReplay(qh, rh)).toBe(true);
        expect(pipelineDb.verifyReplay(qh, 'tampered-hash')).toBe(false);

        // Query-level replayability check
        const allExtractions = pipelineDb.getExtractionsByFinding(findingId);
        const hashMap = new Map<string, string>();
        for (const ext of allExtractions) {
          hashMap.set(ext.queryHash, ext.replayHash);
        }
        const replayResult = query.verifyFindingReplayability(findingId, hashMap);
        expect(replayResult.allReplayable).toBe(true);
        expect(replayResult.staleExtractions).toHaveLength(0);

        // Simulate stale data: modify one replay hash
        const staleMap = new Map(hashMap);
        const staleKey = [...staleMap.keys()][0]!;
        staleMap.set(staleKey, 'data-has-changed');
        const staleResult = query.verifyFindingReplayability(findingId, staleMap);
        expect(staleResult.allReplayable).toBe(false);
        expect(staleResult.staleExtractions.length).toBeGreaterThan(0);

        // ---------------------------------------------------------------
        // Final: verify overall DB stats match expectations
        // ---------------------------------------------------------------
        const finalStats = pipelineDb.getStats();
        expect(finalStats.totalExtractions).toBe(stats.totalExtractions);
        expect(finalStats.totalFindings).toBe(1);
        expect(finalStats.systemCounts).toEqual({ SAP: stats.totalExtractions });
      } finally {
        pipelineDb.close();
      }
    });
  });
});
