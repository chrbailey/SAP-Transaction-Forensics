/**
 * Full Pipeline Integration: Extract → Detect → Package
 *
 * Capstone end-to-end test proving all 7 systems work together on a single
 * forensic engagement.  Follows a realistic SAP O2C order (VBELN 0000054321,
 * NETWR 125000.00) matched against an SFDC Opportunity (Amount 128750.00,
 * 2.9% divergence — borderline) through every phase of the pipeline:
 *
 *   1. Extraction Registry — load all 19 paths, validate coverage
 *   2. Provenance DB + Logger — mock adapter extraction with field-level logging
 *   3. Contradiction Engine — detect amount divergence + temporal impossibility
 *   4. Evidence Chain — link findings to extractions, query provenance DAG
 *   5. Schema Validation — IDES reference validation + missing-field detection
 *   6. Handoff Packet — summary, finding renders, manifest, checklist
 *   7. Independent Verification — replay hash checks
 *
 * Uses realistic SAP field names (VBELN, NETWR, ERDAT, FKDAT, WADAT_IST)
 * and SFDC equivalents (Amount, CloseDate, CreatedDate).
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { createHash } from 'node:crypto';

// ---------------------------------------------------------------------------
// 1. Extraction Registry
// ---------------------------------------------------------------------------

import { ExtractionRegistry } from '../extraction-registry/index.js';
import {
  ALL_EXTRACTION_PATHS,
  createDefaultRegistry,
} from '../extraction-registry/registry.js';

// ---------------------------------------------------------------------------
// 2. Provenance
// ---------------------------------------------------------------------------

import { ProvenanceDB } from '../provenance/schema.js';
import { ProvenanceLogger } from '../provenance/logger.js';
import { ProvenanceQuery } from '../provenance/query.js';
import { ProvenanceExporter } from '../provenance/export.js';
import type { ExtractionRecord } from '../provenance/types.js';

// ---------------------------------------------------------------------------
// 3. Contradiction Engine + Comparators
// ---------------------------------------------------------------------------

import { ContradictionEngine } from '../contradiction/engine.js';
import type {
  ComparisonPair,
  ContradictionFinding as EngineFinding,
} from '../contradiction/engine.js';

import {
  AmountDivergenceComparator,
} from '../contradiction/comparators/amount.js';

import {
  TemporalImpossibilityComparator,
} from '../contradiction/comparators/temporal.js';

// ---------------------------------------------------------------------------
// 4. Scoring
// ---------------------------------------------------------------------------

import {
  computeRiskScore,
  computeAggregateRisk,
  generateRiskSummary,
} from '../contradiction/scoring.js';
import type {
  ContradictionFinding as ScoringFinding,
} from '../contradiction/scoring.js';

// ---------------------------------------------------------------------------
// 5. Schema Validator + IDES Reference
// ---------------------------------------------------------------------------

import {
  SchemaValidator,
  buildIDESReferenceSchema,
  createDefaultValidator,
} from '../schema-validator/index.js';
import type { ClientSchema, ClientTable } from '../schema-validator/types.js';

// ---------------------------------------------------------------------------
// 6. Finding Lifecycle
// ---------------------------------------------------------------------------

import { FindingLifecycleManager } from '../finding-lifecycle/manager.js';

// ---------------------------------------------------------------------------
// 7. Handoff
// ---------------------------------------------------------------------------

import { ManifestGenerator } from '../handoff/manifest.js';
import { SummaryGenerator } from '../handoff/renderers/summary.js';
import { ChecklistGenerator } from '../handoff/renderers/checklist.js';
import { FindingRenderer } from '../handoff/renderers/finding.js';
import type { HandoffConfig } from '../handoff/types.js';

// ===========================================================================
// Constants — realistic SAP O2C data
// ===========================================================================

const VBELN = '0000054321';
const SAP_NETWR = '125000.00';
const SFDC_AMOUNT = '128750.00';        // 2.9% divergence (borderline)
const SAP_ERDAT = '20260115';            // Order created 2026-01-15
const SAP_FKDAT = '20260110';            // Invoice date BEFORE order (impossible!)
const SAP_WADAT_IST = '20260120';        // Delivery 2026-01-20
const SFDC_CLOSE_DATE = '2026-01-10';    // SFDC closed 2026-01-10
const SFDC_CREATED_DATE = '2025-12-01';  // SFDC opp created 2025-12-01
const CLIENT_NAME = 'Meridian Industrial GmbH';
const ENGAGEMENT_ID = 'ENG-2026-Q1-042';

// ===========================================================================
// Mock adapter that returns realistic SAP O2C data
// ===========================================================================

function createMockAdapter() {
  return {
    name: 'integration-test-adapter',
    initialize: async () => {},
    shutdown: async () => {},
    isReady: () => true,

    searchDocText: async () => [],
    getDocText: async () => ({ header_texts: [], item_texts: [] }),

    getDocFlow: async () => ({
      root_document: VBELN,
      flow: [
        {
          doc_type: 'Order',
          doc_number: VBELN,
          doc_category: 'C',
          status: 'completed',
          created_date: '2026-01-15',
          created_time: '091500',
          items: [{ item_number: '000010', quantity: 100 }],
        },
        {
          doc_type: 'Delivery',
          doc_number: '8000012345',
          doc_category: 'J',
          status: 'completed',
          created_date: '2026-01-20',
          created_time: '143000',
          items: [{ item_number: '000010', ref_doc: VBELN, ref_item: '000010', quantity: 100 }],
        },
        {
          doc_type: 'Invoice',
          doc_number: '9000067890',
          doc_category: 'M',
          status: 'posted',
          created_date: '2026-01-10',
          created_time: '161500',
          items: [{ item_number: '000010', ref_doc: '8000012345', ref_item: '000010', quantity: 100 }],
        },
      ],
    }),

    getSalesDocHeader: async () => ({
      VBELN,
      AUART: 'OR',
      VKORG: '1000',
      VTWEG: '10',
      SPART: '00',
      KUNNR: '0000200042',
      AUDAT: SAP_ERDAT,
      ERNAM: 'JMUELLER',
      ERDAT: SAP_ERDAT,
      ERZET: '091500',
      NETWR: 125000.00,
      WAERK: 'EUR',
      BSTNK: 'PO-2026-MER-0815',
    }),

    getSalesDocItems: async () => [
      {
        VBELN,
        POSNR: '000010',
        MATNR: 'MAT-IND-7200',
        ARKTX: 'Industrial Compressor Unit HX-7200',
        WERKS: '1000',
        KWMENG: 5,
        VRKME: 'EA',
        NETWR: 125000.00,
        WAERK: 'EUR',
        PSTYV: 'TAN',
      },
    ],

    getDeliveryTiming: async () => ({
      delivery_number: '8000012345',
      header_timing: {
        requested_date: '2026-01-18',
        planned_gi_date: '2026-01-19',
        actual_gi_date: '2026-01-20',
      },
      item_timing: [
        {
          item_number: '000010',
          material: 'MAT-IND-7200',
          requested_date: '2026-01-18',
          actual_date: '2026-01-20',
        },
      ],
    }),

    getInvoiceTiming: async () => ({
      invoice_number: '9000067890',
      billing_date: SAP_FKDAT,
      posting_date: SAP_FKDAT,
      created_date: '2026-01-10',
      created_time: '161500',
      accounting_doc: '5100000123',
      fiscal_year: '2026',
      linked_deliveries: ['8000012345'],
      linked_orders: [VBELN],
    }),

    getMasterStub: async () => ({
      ENTITY_TYPE: 'customer' as const,
      ID: '0000200042',
      REGION: 'DE',
      INDUSTRY: 'MACH',
      CATEGORY: 'A',
      ERDAT: '20200301',
    }),
  };
}

// ===========================================================================
// Shared state across test steps
// ===========================================================================

let provenanceDb: ProvenanceDB;
let registry: ExtractionRegistry;
let engine: ContradictionEngine;
let findingManager: FindingLifecycleManager;

// Populated during test execution
let sapExtractionIds: string[] = [];
let sfdcExtractionIds: string[] = [];
let contradictionFindings: EngineFinding[] = [];
let aggregateRisk: ReturnType<typeof computeAggregateRisk>;
let queryHash_salesHeader: string;
let replayHash_salesHeader: string;
let handoffManifest: ReturnType<ManifestGenerator['generateManifest']>;

// ===========================================================================
// Tests
// ===========================================================================

describe('Full Pipeline Integration: Extract → Detect → Package', () => {
  beforeAll(() => {
    provenanceDb = new ProvenanceDB(':memory:');
    registry = createDefaultRegistry();
    engine = new ContradictionEngine({
      amountDivergencePercent: 0.02,          // 2% threshold to catch 2.9%
      amountDivergenceMinAbsolute: 100,
      approvalThreshold: 50000,
    });
    engine.registerAll([
      new AmountDivergenceComparator(),
      new TemporalImpossibilityComparator(),
    ]);
    findingManager = new FindingLifecycleManager();
  });

  afterAll(() => {
    provenanceDb.close();
  });

  // -------------------------------------------------------------------------
  // Step 1: Registry + Extraction
  // -------------------------------------------------------------------------

  describe('Step 1: Registry + Extraction', () => {
    it('registry loads all 19 extraction paths', () => {
      expect(registry.size).toBe(19);
    });

    it('paths cover SAP, NetSuite, and Salesforce', () => {
      const meta = registry.getMetadata();
      expect(meta.systems).toEqual(expect.arrayContaining(['SAP', 'NetSuite', 'Salesforce']));
      expect(meta.systems).toHaveLength(3);
    });

    it('each path has valid structure', () => {
      const allPaths = registry.list();
      for (const path of allPaths) {
        expect(path.id).toMatch(/^[a-z]+\.[a-z0-9-]+\.[a-z0-9-]+$/);
        expect(path.version).toMatch(/^\d+\.\d+(\.\d+)?$/);
        expect(path.expectedFields.length).toBeGreaterThan(0);
        expect(path.parameters.length).toBeGreaterThan(0);
      }
    });

    it('SAP O2C paths are complete (5 paths)', () => {
      const o2cPaths = registry.list({ systemType: 'SAP', domain: 'o2c' });
      expect(o2cPaths).toHaveLength(5);
      const ids = o2cPaths.map(p => p.id);
      expect(ids).toContain('sap.o2c.order-header');
      expect(ids).toContain('sap.o2c.order-items');
      expect(ids).toContain('sap.o2c.document-flow');
      expect(ids).toContain('sap.o2c.delivery-timing');
      expect(ids).toContain('sap.o2c.invoice-timing');
    });

    it('registry validates parameters for known paths', () => {
      const result = registry.validateParameters('sap.o2c.order-header', { vbeln: VBELN });
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('registry rejects missing required parameters', () => {
      const result = registry.validateParameters('sap.o2c.order-header', {});
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Missing required parameter: vbeln');
    });
  });

  // -------------------------------------------------------------------------
  // Step 2: Simulated Extraction with Provenance
  // -------------------------------------------------------------------------

  describe('Step 2: Simulated Extraction with Provenance', () => {
    it('mock adapter extraction logs to provenance DB', async () => {
      const adapter = createMockAdapter();
      const logger = new ProvenanceLogger(provenanceDb, 'integration-test-adapter', 'SAP');
      const wrapped = logger.wrapAdapter(adapter);

      // Execute the extraction pipeline through the provenance wrapper
      await wrapped.getSalesDocHeader({ vbeln: VBELN });
      await wrapped.getSalesDocItems({ vbeln: VBELN });
      await wrapped.getDocFlow({ vbeln: VBELN });
      await wrapped.getDeliveryTiming({ vbeln: VBELN });
      await wrapped.getInvoiceTiming({ vbeln: VBELN });

      const stats = provenanceDb.getStats();
      expect(stats.totalExtractions).toBeGreaterThan(0);
      expect(stats.systemCounts['SAP']).toBeGreaterThan(0);
    });

    it('field-level records created for SAP O2C data', () => {
      // Check VBAK extractions (from getSalesDocHeader)
      const vbakRecords = provenanceDb.getExtractionsByTable('SAP', 'VBAK');
      expect(vbakRecords.length).toBeGreaterThan(0);

      // Find the NETWR field record
      const netwrRecord = vbakRecords.find(r => r.fieldName === 'NETWR');
      expect(netwrRecord).toBeDefined();
      expect(netwrRecord!.rawValue).toBe('125000');

      // Store extraction IDs for later steps
      sapExtractionIds = vbakRecords.map(r => r.id);
    });

    it('replay hash is deterministic', async () => {
      // Run the same extraction again through a fresh logger
      const adapter = createMockAdapter();
      const logger2 = new ProvenanceLogger(provenanceDb, 'replay-test-adapter', 'SAP');
      const wrapped2 = logger2.wrapAdapter(adapter);

      await wrapped2.getSalesDocHeader({ vbeln: VBELN });

      // Both runs should produce the same replay hash for the same query
      const records1 = provenanceDb.getExtractionsByTable('SAP', 'VBAK')
        .filter(r => r.adapterId === 'integration-test-adapter');
      const records2 = provenanceDb.getExtractionsByTable('SAP', 'VBAK')
        .filter(r => r.adapterId === 'replay-test-adapter');

      expect(records1.length).toBeGreaterThan(0);
      expect(records2.length).toBeGreaterThan(0);
      expect(records1[0]!.replayHash).toBe(records2[0]!.replayHash);

      // Store for Step 7
      queryHash_salesHeader = records1[0]!.queryHash;
      replayHash_salesHeader = records1[0]!.replayHash;
    });

    it('SFDC extraction records created via direct insert', () => {
      // Simulate SFDC extraction by inserting records directly
      // (as SFDC adapter uses a different pathway)
      const sfdcRecords: ExtractionRecord[] = [
        {
          id: crypto.randomUUID(),
          adapterId: 'sfdc-test-adapter',
          systemType: 'Salesforce',
          tableName: 'Opportunity',
          recordId: '006Dn00000MerInd001',
          fieldName: 'Amount',
          rawValue: SFDC_AMOUNT,
          normalizedValue: SFDC_AMOUNT,
          extractionTimestamp: new Date().toISOString(),
          queryHash: createHash('sha256').update('sfdc:Opportunity:Amount').digest('hex'),
          replayHash: createHash('sha256').update(SFDC_AMOUNT).digest('hex'),
          extractionPathId: 'sfdc.pipeline.opportunities',
          extractionPathVersion: '1.0',
        },
        {
          id: crypto.randomUUID(),
          adapterId: 'sfdc-test-adapter',
          systemType: 'Salesforce',
          tableName: 'Opportunity',
          recordId: '006Dn00000MerInd001',
          fieldName: 'CloseDate',
          rawValue: SFDC_CLOSE_DATE,
          normalizedValue: SFDC_CLOSE_DATE,
          extractionTimestamp: new Date().toISOString(),
          queryHash: createHash('sha256').update('sfdc:Opportunity:CloseDate').digest('hex'),
          replayHash: createHash('sha256').update(SFDC_CLOSE_DATE).digest('hex'),
          extractionPathId: 'sfdc.pipeline.opportunities',
          extractionPathVersion: '1.0',
        },
        {
          id: crypto.randomUUID(),
          adapterId: 'sfdc-test-adapter',
          systemType: 'Salesforce',
          tableName: 'Opportunity',
          recordId: '006Dn00000MerInd001',
          fieldName: 'CreatedDate',
          rawValue: SFDC_CREATED_DATE,
          normalizedValue: SFDC_CREATED_DATE,
          extractionTimestamp: new Date().toISOString(),
          queryHash: createHash('sha256').update('sfdc:Opportunity:CreatedDate').digest('hex'),
          replayHash: createHash('sha256').update(SFDC_CREATED_DATE).digest('hex'),
          extractionPathId: 'sfdc.pipeline.opportunities',
          extractionPathVersion: '1.0',
        },
      ];

      provenanceDb.insertBatchExtractions(sfdcRecords);
      sfdcExtractionIds = sfdcRecords.map(r => r.id);

      const sfdcStored = provenanceDb.getExtractionsByTable('Salesforce', 'Opportunity');
      expect(sfdcStored).toHaveLength(3);
    });
  });

  // -------------------------------------------------------------------------
  // Step 3: Contradiction Detection
  // -------------------------------------------------------------------------

  describe('Step 3: Contradiction Detection', () => {
    it('detects amount divergence between SAP and SFDC', () => {
      const pair: ComparisonPair = {
        left: {
          system: 'SAP',
          table: 'VBAK',
          recordId: VBELN,
          fields: {
            VBELN,
            NETWR: SAP_NETWR,
            WAERK: 'EUR',
            ERDAT: SAP_ERDAT,
          },
          extractionId: sapExtractionIds[0] ?? 'ext-sap-001',
        },
        right: {
          system: 'Salesforce',
          table: 'Opportunity',
          recordId: '006Dn00000MerInd001',
          fields: {
            Amount: SFDC_AMOUNT,
            CurrencyIsoCode: 'USD',
            CloseDate: SFDC_CLOSE_DATE,
            CreatedDate: SFDC_CREATED_DATE,
          },
          extractionId: sfdcExtractionIds[0] ?? 'ext-sfdc-001',
        },
      };

      const result = engine.analyzeAll([pair]);
      const amountFindings = result.contradictions.filter(f => f.type === 'AMOUNT_DIVERGENCE');

      // 2.9% divergence > 2% threshold => should detect
      expect(amountFindings.length).toBeGreaterThanOrEqual(1);

      const finding = amountFindings[0]!;
      expect(finding.leftSystem).toBe('SAP');
      expect(finding.rightSystem).toBe('Salesforce');
      expect(finding.leftField).toBe('NETWR');
      expect(finding.rightField).toBe('Amount');
      expect(finding.scoringDetails['percentDivergence']).toBeCloseTo(0.029, 2);

      contradictionFindings.push(...result.contradictions);
    });

    it('detects temporal impossibility', () => {
      // Invoice date (FKDAT 2026-01-10) BEFORE delivery (WADAT_IST 2026-01-20)
      const temporalPair: ComparisonPair = {
        left: {
          system: 'SAP',
          table: 'VBRK',
          recordId: '9000067890',
          fields: {
            FKDAT: SAP_FKDAT,       // Invoice: 2026-01-10
            ERDAT: SAP_ERDAT,        // Created: 2026-01-15
          },
          extractionId: sapExtractionIds[1] ?? 'ext-sap-invoice-001',
        },
        right: {
          system: 'SAP',
          table: 'LIKP',
          recordId: '8000012345',
          fields: {
            WADAT_IST: SAP_WADAT_IST, // Delivery: 2026-01-20
            LFDAT: '20260118',         // Requested: 2026-01-18
          },
          extractionId: sapExtractionIds[2] ?? 'ext-sap-delivery-001',
        },
      };

      const result = engine.analyzeAll([temporalPair]);
      const temporalFindings = result.contradictions.filter(
        f => f.type === 'TEMPORAL_IMPOSSIBILITY',
      );

      expect(temporalFindings.length).toBeGreaterThanOrEqual(1);
      const finding = temporalFindings[0]!;
      expect(finding.severity).toBe('CRITICAL');
      expect(finding.confidence).toBeGreaterThanOrEqual(0.9);
      expect(finding.description).toMatch(/FKDAT.*WADAT_IST|delivery before invoice/i);

      contradictionFindings.push(...temporalFindings);
    });

    it('risk scoring produces valid 0-100 scores', () => {
      for (const finding of contradictionFindings) {
        const score = computeRiskScore(finding as unknown as ScoringFinding);
        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThanOrEqual(100);
      }
    });

    it('aggregate risk summary generated', () => {
      aggregateRisk = computeAggregateRisk(
        contradictionFindings as unknown as ScoringFinding[],
      );

      expect(aggregateRisk.overallScore).toBeGreaterThan(0);
      expect(aggregateRisk.maxScore).toBeGreaterThan(0);
      expect(aggregateRisk.maxScore).toBeLessThanOrEqual(100);
      // We have at least 1 CRITICAL (temporal impossibility)
      expect(aggregateRisk.criticalCount).toBeGreaterThanOrEqual(1);
      // byType should have entries
      expect(Object.keys(aggregateRisk.byType).length).toBeGreaterThan(0);

      const summary = generateRiskSummary(
        contradictionFindings as unknown as ScoringFinding[],
      );
      expect(summary).toContain('Risk Summary');
      expect(summary).toContain('critical');
    });
  });

  // -------------------------------------------------------------------------
  // Step 4: Evidence Chain
  // -------------------------------------------------------------------------

  describe('Step 4: Evidence Chain', () => {
    const findingId = 'PIPELINE-FINDING-001';

    beforeAll(() => {
      // Link the first SAP extraction to a finding as primary evidence
      if (sapExtractionIds.length > 0) {
        provenanceDb.linkEvidence(findingId, sapExtractionIds[0]!, 'primary');
      }
      // Link an SFDC extraction as contradicting evidence
      if (sfdcExtractionIds.length > 0) {
        provenanceDb.linkEvidence(findingId, sfdcExtractionIds[0]!, 'contradicting');
      }
    });

    it('contradictions reference valid extraction IDs', () => {
      // Verify the extraction IDs we stored actually exist in the DB
      for (const extId of sapExtractionIds.slice(0, 3)) {
        const record = provenanceDb.getExtraction(extId);
        expect(record).not.toBeNull();
        expect(record!.systemType).toBe('SAP');
      }
      for (const extId of sfdcExtractionIds) {
        const record = provenanceDb.getExtraction(extId);
        expect(record).not.toBeNull();
        expect(record!.systemType).toBe('Salesforce');
      }
    });

    it('provenance query returns evidence chain', () => {
      const query = new ProvenanceQuery(provenanceDb);
      const chain = query.getEvidenceChain(findingId);

      expect(chain.primary.length).toBeGreaterThanOrEqual(1);
      expect(chain.contradicting.length).toBeGreaterThanOrEqual(1);

      // Primary evidence is SAP
      expect(chain.primary[0]!.systemType).toBe('SAP');
      // Contradicting evidence is SFDC
      expect(chain.contradicting[0]!.systemType).toBe('Salesforce');
    });

    it('provenance summary covers both systems', () => {
      const query = new ProvenanceQuery(provenanceDb);
      const summary = query.getSummary(findingId);

      expect(summary.extractionCount).toBeGreaterThanOrEqual(2);
      expect(summary.systemsCovered).toContain('SAP');
      expect(summary.systemsCovered).toContain('Salesforce');
      expect(summary.tablesCovered.length).toBeGreaterThanOrEqual(1);
    });

    it('DAG export produces valid tree', () => {
      const query = new ProvenanceQuery(provenanceDb);
      const exporter = new ProvenanceExporter(query);
      const dag = exporter.exportDAG(findingId);

      expect(dag.rootFindingId).toBe(findingId);
      expect(dag.nodes).toHaveLength(1);
      expect(dag.generatedAt).toBeTruthy();

      // Root node is 'finding'
      const root = dag.nodes[0]!;
      expect(root.type).toBe('finding');
      expect(root.id).toBe(findingId);

      // Should have evidence children
      expect(root.children.length).toBeGreaterThanOrEqual(1);

      // Each evidence node should have extraction leaf children
      for (const evidenceNode of root.children) {
        expect(evidenceNode.type).toBe('evidence');
        expect(evidenceNode.children.length).toBeGreaterThanOrEqual(1);
        for (const extractionNode of evidenceNode.children) {
          expect(extractionNode.type).toBe('extraction');
          expect(extractionNode.data['systemType']).toBeDefined();
          expect(extractionNode.data['replayHash']).toBeDefined();
        }
      }
    });

    it('flat export includes both sides', () => {
      const query = new ProvenanceQuery(provenanceDb);
      const exporter = new ProvenanceExporter(query);
      const flat = exporter.exportFlat(findingId);

      expect(flat.length).toBeGreaterThanOrEqual(2);

      const systems = new Set(flat.map(r => r.systemType));
      expect(systems.has('SAP')).toBe(true);
      expect(systems.has('Salesforce')).toBe(true);
    });

    it('markdown export renders table', () => {
      const query = new ProvenanceQuery(provenanceDb);
      const exporter = new ProvenanceExporter(query);
      const md = exporter.exportMarkdown(findingId);

      expect(md).toContain('# Provenance');
      expect(md).toContain('| Role |');
      expect(md).toContain('primary');
      expect(md).toContain('contradicting');
    });
  });

  // -------------------------------------------------------------------------
  // Step 5: Schema Validation
  // -------------------------------------------------------------------------

  describe('Step 5: Schema Validation', () => {
    it('IDES reference validates extraction paths', () => {
      const validator = createDefaultValidator();

      // Build a client schema that matches IDES (happy path)
      const idesRef = buildIDESReferenceSchema();
      const clientTables = new Map<string, ClientTable>();

      for (const [tableName, refTable] of idesRef) {
        const fields = new Map<string, { name: string; dataType: string }>();
        for (const refField of refTable.fields) {
          fields.set(refField.name, {
            name: refField.name,
            dataType: refField.dataType,
          });
        }
        clientTables.set(tableName, { name: tableName, fields });
      }

      const clientSchema: ClientSchema = {
        clientId: 'meridian-ind',
        systemType: 'SAP',
        tables: clientTables,
        extractedAt: new Date().toISOString(),
      };

      const orderHeaderPath = registry.get('sap.o2c.order-header');
      expect(orderHeaderPath).toBeDefined();

      const result = validator.validatePath(
        orderHeaderPath!.id,
        orderHeaderPath!,
        clientSchema,
      );

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('missing field detected in custom schema', () => {
      const validator = createDefaultValidator();

      // Build schema with VBAK missing NETWR
      const clientTables = new Map<string, ClientTable>();
      const vbakFields = new Map<string, { name: string; dataType: string }>();
      vbakFields.set('VBELN', { name: 'VBELN', dataType: 'CHAR' });
      vbakFields.set('AUART', { name: 'AUART', dataType: 'CHAR' });
      vbakFields.set('ERDAT', { name: 'ERDAT', dataType: 'DATS' });
      // Deliberately omit NETWR and several others
      clientTables.set('VBAK', { name: 'VBAK', fields: vbakFields });

      const clientSchema: ClientSchema = {
        clientId: 'incomplete-client',
        systemType: 'SAP',
        tables: clientTables,
        extractedAt: new Date().toISOString(),
      };

      const orderHeaderPath = registry.get('sap.o2c.order-header')!;
      const result = validator.validatePath(
        orderHeaderPath.id,
        orderHeaderPath,
        clientSchema,
      );

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      // Should flag NETWR as missing
      const netwrError = result.errors.find(e => e.includes('NETWR'));
      expect(netwrError).toBeDefined();
    });

    it('IDES reference covers 19 tables', () => {
      const ref = buildIDESReferenceSchema();
      expect(ref.size).toBe(19);
    });
  });

  // -------------------------------------------------------------------------
  // Step 6: Handoff Packet Assembly
  // -------------------------------------------------------------------------

  describe('Step 6: Handoff Packet Assembly', () => {
    const config: HandoffConfig = {
      engagementId: ENGAGEMENT_ID,
      clientName: CLIENT_NAME,
      preparedBy: 'SAP Transaction Forensics Engine',
      dateRange: { from: '2025-12-01', to: '2026-01-31' },
      systemsAccessed: ['SAP', 'Salesforce'],
      scope: 'FY2026 Q1 O2C Process Audit — Cross-System Reconciliation',
      includeReproduction: true,
      includeChecklist: true,
      outputDir: '/tmp/handoff-test',
    };

    let summaryMd: string;
    let renderedFindings: ReturnType<FindingRenderer['renderContradiction']>[];
    let checklist: ReturnType<ChecklistGenerator['generateChecklist']>;

    beforeAll(() => {
      // Generate summary
      const summaryGen = new SummaryGenerator();
      summaryMd = summaryGen.generateSummary({
        config,
        contradictionCount: contradictionFindings.length,
        gapCount: 0,
        criticalCount: aggregateRisk.criticalCount,
        highCount: aggregateRisk.highCount,
        mediumCount: aggregateRisk.mediumCount,
        systemsCovered: ['SAP', 'Salesforce'],
        tablesCovered: ['VBAK', 'VBRK', 'LIKP', 'Opportunity'],
        totalExtractions: provenanceDb.getStats().totalExtractions,
        overallRiskScore: Math.round(aggregateRisk.overallScore),
      });

      // Render findings
      const findingRenderer = new FindingRenderer();
      renderedFindings = contradictionFindings.map(f => {
        const score = computeRiskScore(f as unknown as ScoringFinding);
        return findingRenderer.renderContradiction({
          ...f,
          title: `${f.type}: ${f.leftSystem}.${f.leftTable} vs ${f.rightSystem}.${f.rightTable}`,
          riskScore: Math.round(score),
        });
      });

      // Generate manifest
      const manifestGen = new ManifestGenerator();
      handoffManifest = manifestGen.generateManifest(ENGAGEMENT_ID, [
        {
          extractionPathId: 'sap.o2c.order-header',
          extractionPathVersion: '1.0',
          parameters: { vbeln: VBELN },
          queryHash: queryHash_salesHeader,
          replayHash: replayHash_salesHeader,
          extractedAt: new Date().toISOString(),
          rowCount: 1,
          systemType: 'SAP',
        },
        {
          extractionPathId: 'sfdc.pipeline.opportunities',
          extractionPathVersion: '1.0',
          parameters: { accountId: '001Dn00000MerInd' },
          queryHash: createHash('sha256').update('sfdc:Opportunity:query').digest('hex'),
          replayHash: createHash('sha256').update(SFDC_AMOUNT + SFDC_CLOSE_DATE).digest('hex'),
          extractedAt: new Date().toISOString(),
          rowCount: 1,
          systemType: 'Salesforce',
        },
      ]);

      // Generate checklist
      const checklistGen = new ChecklistGenerator();
      checklist = checklistGen.generateChecklist(
        ENGAGEMENT_ID,
        contradictionFindings.length,
        2,
      );
    });

    it('packet contains executive summary', () => {
      expect(summaryMd).toContain(`# Forensic Assessment: ${CLIENT_NAME}`);
      expect(summaryMd).toContain(ENGAGEMENT_ID);
      expect(summaryMd).toContain('Executive Summary');
      expect(summaryMd).toContain('Key Metrics');
    });

    it('packet contains rendered findings', () => {
      expect(renderedFindings.length).toBeGreaterThanOrEqual(1);
      for (const rf of renderedFindings) {
        expect(rf.id).toBeTruthy();
        expect(rf.markdown).toContain('## F-');
        expect(rf.markdown).toContain('Evidence');
        expect(rf.riskScore).toBeGreaterThan(0);
        expect(rf.evidenceFiles.length).toBeGreaterThanOrEqual(1);
      }
    });

    it('packet contains extraction manifest', () => {
      expect(handoffManifest.engagementId).toBe(ENGAGEMENT_ID);
      expect(handoffManifest.entries).toHaveLength(2);
      expect(handoffManifest.totalExtractions).toBe(2);
      expect(handoffManifest.systems).toContain('SAP');
      expect(handoffManifest.systems).toContain('Salesforce');
    });

    it('manifest entries have replay hashes', () => {
      for (const entry of handoffManifest.entries) {
        expect(entry.replayHash).toMatch(/^[0-9a-f]{64}$/);
        expect(entry.queryHash).toMatch(/^[0-9a-f]{64}$/);
        expect(entry.extractionPathId).toBeTruthy();
        expect(entry.extractionPathVersion).toBeTruthy();
        expect(entry.extractedAt).toBeTruthy();
      }
    });

    it('file structure has all expected paths', () => {
      const manifestGen = new ManifestGenerator();

      // Reproduction readme
      const readme = manifestGen.generateReproductionReadme(handoffManifest);
      expect(readme).toContain('# Extraction Reproduction Guide');
      expect(readme).toContain('sap.o2c.order-header');
      expect(readme).toContain('sfdc.pipeline.opportunities');
      expect(readme).toContain('VERIFIED');

      // Verification script
      const script = manifestGen.generateVerificationScript(handoffManifest);
      expect(script).toContain('#!/usr/bin/env bash');
      expect(script).toContain(ENGAGEMENT_ID);
      expect(script).toContain('PASS');
      expect(script).toContain('FAIL');

      // Manifest JSON
      const jsonStr = manifestGen.generateManifestJSON(handoffManifest);
      const parsed = JSON.parse(jsonStr);
      expect(parsed.engagementId).toBe(ENGAGEMENT_ID);
      expect(parsed.entries).toHaveLength(2);
    });

    it('SUMMARY.md contains client name and risk score', () => {
      expect(summaryMd).toContain(CLIENT_NAME);
      expect(summaryMd).toContain('/100');
      expect(summaryMd).toContain('Risk');
    });

    it('reviewer checklist has 25 items', () => {
      expect(checklist.totalCount).toBe(25);
      expect(checklist.items).toHaveLength(25);
      expect(checklist.engagementId).toBe(ENGAGEMENT_ID);
      expect(checklist.completedCount).toBe(0);

      // Check all 5 categories are represented
      const categories = new Set(checklist.items.map(item => item.category));
      expect(categories.size).toBe(5);
      expect(categories).toContain('data_quality');
      expect(categories).toContain('completeness');
      expect(categories).toContain('methodology');
      expect(categories).toContain('findings');
      expect(categories).toContain('remediation');

      // All items required by default
      expect(checklist.items.every(item => item.required)).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Step 7: Independent Verification
  // -------------------------------------------------------------------------

  describe('Step 7: Independent Verification', () => {
    it('replay hash verification succeeds for unchanged data', () => {
      const verified = provenanceDb.verifyReplay(
        queryHash_salesHeader,
        replayHash_salesHeader,
      );
      expect(verified).toBe(true);
    });

    it('replay hash verification fails for modified data', () => {
      const tamperedHash = createHash('sha256')
        .update('TAMPERED DATA')
        .digest('hex');

      const verified = provenanceDb.verifyReplay(
        queryHash_salesHeader,
        tamperedHash,
      );
      expect(verified).toBe(false);
    });

    it('manifest JSON is valid and parseable', () => {
      const manifestGen = new ManifestGenerator();
      const jsonStr = manifestGen.generateManifestJSON(handoffManifest);
      expect(() => JSON.parse(jsonStr)).not.toThrow();

      const parsed = JSON.parse(jsonStr);
      expect(parsed.entries).toBeInstanceOf(Array);
      expect(parsed.totalExtractions).toBe(parsed.entries.length);

      // Validate manifest
      const validation = manifestGen.validateManifest(parsed);
      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    it('finding lifecycle tracks full state progression', () => {
      // Create a unified finding from the temporal impossibility
      const temporalFinding = contradictionFindings.find(
        f => f.type === 'TEMPORAL_IMPOSSIBILITY',
      );

      if (temporalFinding) {
        const unified = findingManager.createFinding({
          source: 'contradiction',
          sourceId: temporalFinding.id,
          title: 'Invoice before delivery — temporal impossibility',
          description: temporalFinding.description,
          severity: 'CRITICAL',
          riskScore: computeRiskScore(temporalFinding as unknown as ScoringFinding),
          systemsCovered: ['SAP'],
          tablesCovered: ['VBRK', 'LIKP'],
          extractionIds: sapExtractionIds.slice(0, 2),
        });

        expect(unified.state).toBe('DETECTED');

        // Progress through lifecycle
        findingManager.transition(unified.id, 'TRIAGED', 'system', 'Auto-triaged by engine');
        expect(findingManager.get(unified.id)!.state).toBe('TRIAGED');

        findingManager.transition(unified.id, 'INVESTIGATING', 'reviewer', 'Assigned for review');
        expect(findingManager.get(unified.id)!.state).toBe('INVESTIGATING');

        findingManager.transition(unified.id, 'CONFIRMED', 'reviewer', 'Confirmed via SAP GUI');
        expect(findingManager.get(unified.id)!.state).toBe('CONFIRMED');

        // Summary reflects the finding
        const summary = findingManager.getSummary();
        expect(summary.total).toBeGreaterThanOrEqual(1);
        expect(summary.bySource['contradiction']).toBeGreaterThanOrEqual(1);
      }
    });

    it('full pipeline statistics are consistent', () => {
      const dbStats = provenanceDb.getStats();

      // We should have extractions from both SAP and Salesforce
      expect(dbStats.systemCounts['SAP']).toBeGreaterThan(0);
      expect(dbStats.systemCounts['Salesforce']).toBeGreaterThan(0);

      // Total extractions should be the sum
      const totalFromSystems = Object.values(dbStats.systemCounts)
        .reduce((sum, count) => sum + count, 0);
      expect(dbStats.totalExtractions).toBe(totalFromSystems);

      // We linked evidence to at least one finding
      expect(dbStats.totalFindings).toBeGreaterThanOrEqual(1);

      // Registry path count = 19
      expect(registry.size).toBe(19);

      // We detected findings
      expect(contradictionFindings.length).toBeGreaterThanOrEqual(2);
    });
  });
});
