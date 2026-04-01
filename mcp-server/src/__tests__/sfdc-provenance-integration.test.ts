/**
 * SFDC Provenance Integration Tests
 *
 * Verifies that the createSFDCAdapterWithProvenance factory correctly wires
 * the ProvenanceLogger into an SFDC adapter, producing field-level extraction
 * records with systemType='Salesforce' and adapterId='sfdc'.
 *
 * Uses a mock SFDC adapter (implementing IDataAdapter) with hardcoded return
 * values -- no file I/O or real synthetic data needed.
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { existsSync, mkdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createSFDCAdapterWithProvenance } from '../adapters/sfdc/with-provenance.js';
import type { ProvenanceDB } from '../provenance/schema.js';
import type { IDataAdapter } from '../adapters/adapter-interface.js';
import type {
  SearchDocTextParams,
  SearchResult,
  DocTextParams,
  DocTextResult,
  DocFlowParams,
  DocFlowResult,
  SalesDocHeaderParams,
  SalesDocHeader,
  SalesDocItemsParams,
  SalesDocItem,
  DeliveryTimingParams,
  DeliveryTimingResult,
  InvoiceTimingParams,
  InvoiceTimingResult,
  MasterStubParams,
  MasterStub,
} from '../types/index.js';

// ---------------------------------------------------------------------------
// Mock SFDC Adapter
// ---------------------------------------------------------------------------

interface CallLog {
  method: string;
  params: unknown;
}

function createMockSFDCAdapter(): IDataAdapter & { calls: CallLog[] } {
  const calls: CallLog[] = [];

  // SFDC-flavored data: Salesforce field names mapped to SAP-style output
  const sampleHeader: SalesDocHeader = {
    VBELN: 'OPP-001   ',
    AUART: 'ZNEW',
    VKORG: 'SFDC',
    VTWEG: '00',
    SPART: '00',
    KUNNR: 'ACC-001   ',
    AUDAT: '20250315',
    ERNAM: 'USR-001',
    ERDAT: '20250101',
    ERZET: '100000',
  };

  const sampleItems: SalesDocItem[] = [
    {
      VBELN: 'OPP-001   ',
      POSNR: '000001',
      MATNR: 'PROD-001          ',
      WERKS: 'SFDC',
      KWMENG: 10,
      VRKME: 'EA',
      NETWR: 50000,
      WAERK: 'USD',
      PSTYV: 'TAN',
    },
    {
      VBELN: 'OPP-001   ',
      POSNR: '000002',
      MATNR: 'PROD-002          ',
      WERKS: 'SFDC',
      KWMENG: 5,
      VRKME: 'EA',
      NETWR: 25000,
      WAERK: 'USD',
      PSTYV: 'TAN',
    },
  ];

  const sampleDocFlow: DocFlowResult = {
    root_document: 'OPP-001   ',
    flow: [
      {
        doc_type: 'Opportunity',
        doc_number: 'OPP-001   ',
        doc_category: 'C',
        created_date: '20250101',
        created_time: '100000',
        items: [{ item_number: '000001' }],
      },
    ],
  };

  const sampleDocText: DocTextResult = {
    header_texts: [
      { text_id: 'ACT-001', lang: 'EN', text: 'Initial discovery call with prospect' },
    ],
    item_texts: [
      { item_number: '000001', text_id: 'ACT-002', lang: 'EN', text: 'Follow-up email sent' },
    ],
  };

  const sampleSearchResults: SearchResult[] = [
    {
      doc_type: 'sales',
      doc_key: 'OPP-001   ',
      snippet: '...discovery call with prospect about enterprise licensing...',
      match_score: 0.85,
      dates: { created: '20250101' },
      org_keys: { VKORG: 'SFDC', VTWEG: '00', SPART: '00' },
    },
  ];

  const sampleDeliveryTiming: DeliveryTimingResult = {
    delivery_number: 'OPP-001   ',
    header_timing: {
      requested_date: '20250315',
      planned_gi_date: '20250315',
      actual_gi_date: '20250315',
    },
    item_timing: [
      {
        item_number: '000001',
        material: 'PROD-001          ',
        requested_date: '20250315',
        confirmed_date: '20250315',
        actual_date: '20250315',
      },
    ],
  };

  const sampleInvoiceTiming: InvoiceTimingResult = {
    invoice_number: 'OPP-001   ',
    billing_date: '20250315',
    created_date: '20250101',
    created_time: '100000',
    linked_deliveries: [],
    linked_orders: ['OPP-001   '],
  };

  const sampleMasterStub: MasterStub = {
    ENTITY_TYPE: 'customer',
    ID: 'ACC-001   ',
    REGION: 'US',
    INDUSTRY: 'Technology',
  };

  let initialized = false;

  return {
    calls,
    name: 'sfdc',

    async initialize() {
      calls.push({ method: 'initialize', params: undefined });
      initialized = true;
    },

    async shutdown() {
      calls.push({ method: 'shutdown', params: undefined });
      initialized = false;
    },

    isReady() {
      return initialized;
    },

    async searchDocText(params: SearchDocTextParams): Promise<SearchResult[]> {
      calls.push({ method: 'searchDocText', params });
      return sampleSearchResults;
    },

    async getDocText(params: DocTextParams): Promise<DocTextResult> {
      calls.push({ method: 'getDocText', params });
      return sampleDocText;
    },

    async getDocFlow(params: DocFlowParams): Promise<DocFlowResult> {
      calls.push({ method: 'getDocFlow', params });
      return sampleDocFlow;
    },

    async getSalesDocHeader(params: SalesDocHeaderParams): Promise<SalesDocHeader | null> {
      calls.push({ method: 'getSalesDocHeader', params });
      return sampleHeader;
    },

    async getSalesDocItems(params: SalesDocItemsParams): Promise<SalesDocItem[]> {
      calls.push({ method: 'getSalesDocItems', params });
      return sampleItems;
    },

    async getDeliveryTiming(params: DeliveryTimingParams): Promise<DeliveryTimingResult | null> {
      calls.push({ method: 'getDeliveryTiming', params });
      return sampleDeliveryTiming;
    },

    async getInvoiceTiming(params: InvoiceTimingParams): Promise<InvoiceTimingResult | null> {
      calls.push({ method: 'getInvoiceTiming', params });
      return sampleInvoiceTiming;
    },

    async getMasterStub(params: MasterStubParams): Promise<MasterStub | null> {
      calls.push({ method: 'getMasterStub', params });
      return sampleMasterStub;
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SFDC Provenance Integration', () => {
  let mockAdapter: ReturnType<typeof createMockSFDCAdapter>;
  let wrapped: IDataAdapter;
  let provenanceDb: ProvenanceDB;
  let dbPath: string;

  beforeEach(() => {
    mockAdapter = createMockSFDCAdapter();
    const testDir = join(tmpdir(), 'sfdc-prov-test');
    if (!existsSync(testDir)) {
      mkdirSync(testDir, { recursive: true });
    }
    dbPath = join(testDir, `test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
    const result = createSFDCAdapterWithProvenance(mockAdapter, dbPath);
    wrapped = result.adapter;
    provenanceDb = result.provenanceDb;
  });

  afterEach(() => {
    provenanceDb.close();
    try {
      unlinkSync(dbPath);
    } catch {
      // ignore cleanup errors
    }
  });

  // -------------------------------------------------------------------------
  // 1. Wrapped adapter returns same results as underlying adapter
  // -------------------------------------------------------------------------

  describe('result passthrough', () => {
    it('should return the same getSalesDocHeader result', async () => {
      const directResult = await mockAdapter.getSalesDocHeader({ vbeln: 'OPP-001' });
      const wrappedResult = await wrapped.getSalesDocHeader({ vbeln: 'OPP-001' });
      expect(wrappedResult).toEqual(directResult);
    });

    it('should return the same getSalesDocItems result', async () => {
      const directResult = await mockAdapter.getSalesDocItems({ vbeln: 'OPP-001' });
      const wrappedResult = await wrapped.getSalesDocItems({ vbeln: 'OPP-001' });
      expect(wrappedResult).toEqual(directResult);
    });

    it('should return the same getDocFlow result', async () => {
      const directResult = await mockAdapter.getDocFlow({ vbeln: 'OPP-001' });
      const wrappedResult = await wrapped.getDocFlow({ vbeln: 'OPP-001' });
      expect(wrappedResult).toEqual(directResult);
    });

    it('should return the same searchDocText result', async () => {
      const directResult = await mockAdapter.searchDocText({ pattern: 'discovery' });
      const wrappedResult = await wrapped.searchDocText({ pattern: 'discovery' });
      expect(wrappedResult).toEqual(directResult);
    });

    it('should return the same getDocText result', async () => {
      const directResult = await mockAdapter.getDocText({ doc_type: 'sales', doc_key: 'OPP-001' });
      const wrappedResult = await wrapped.getDocText({ doc_type: 'sales', doc_key: 'OPP-001' });
      expect(wrappedResult).toEqual(directResult);
    });

    it('should return the same getDeliveryTiming result', async () => {
      const directResult = await mockAdapter.getDeliveryTiming({ vbeln: 'OPP-001' });
      const wrappedResult = await wrapped.getDeliveryTiming({ vbeln: 'OPP-001' });
      expect(wrappedResult).toEqual(directResult);
    });

    it('should return the same getInvoiceTiming result', async () => {
      const directResult = await mockAdapter.getInvoiceTiming({ vbeln: 'OPP-001' });
      const wrappedResult = await wrapped.getInvoiceTiming({ vbeln: 'OPP-001' });
      expect(wrappedResult).toEqual(directResult);
    });

    it('should return the same getMasterStub result', async () => {
      const directResult = await mockAdapter.getMasterStub({ entity_type: 'customer', id: 'ACC-001' });
      const wrappedResult = await wrapped.getMasterStub({ entity_type: 'customer', id: 'ACC-001' });
      expect(wrappedResult).toEqual(directResult);
    });
  });

  // -------------------------------------------------------------------------
  // 2. Provenance records created with correct systemType and adapterId
  // -------------------------------------------------------------------------

  describe('provenance record metadata', () => {
    it('should set systemType to Salesforce on all records', async () => {
      await wrapped.getSalesDocHeader({ vbeln: 'OPP-001' });
      const records = provenanceDb.getExtractionsByTable('Salesforce', 'VBAK');
      expect(records.length).toBeGreaterThan(0);
      for (const rec of records) {
        expect(rec.systemType).toBe('Salesforce');
      }
    });

    it('should set adapterId to sfdc on all records', async () => {
      await wrapped.getSalesDocHeader({ vbeln: 'OPP-001' });
      const records = provenanceDb.getExtractionsByPath('adapter:sfdc');
      expect(records.length).toBeGreaterThan(0);
      for (const rec of records) {
        expect(rec.adapterId).toBe('sfdc');
      }
    });

    it('should set extractionPathId to adapter:sfdc', async () => {
      await wrapped.getSalesDocItems({ vbeln: 'OPP-001' });
      const records = provenanceDb.getExtractionsByPath('adapter:sfdc');
      expect(records.length).toBeGreaterThan(0);
      for (const rec of records) {
        expect(rec.extractionPathId).toBe('adapter:sfdc');
      }
    });

    it('should persist records to the real SQLite database', async () => {
      const statsBefore = provenanceDb.getStats();
      expect(statsBefore.totalExtractions).toBe(0);

      await wrapped.getSalesDocHeader({ vbeln: 'OPP-001' });

      const statsAfter = provenanceDb.getStats();
      expect(statsAfter.totalExtractions).toBeGreaterThan(0);
      expect(statsAfter.systemCounts['Salesforce']).toBeGreaterThan(0);
    });
  });

  // -------------------------------------------------------------------------
  // 3. Field-level records for SFDC-specific fields
  // -------------------------------------------------------------------------

  describe('SFDC field-level records', () => {
    it('should create field records for SFDC opportunity header fields', async () => {
      await wrapped.getSalesDocHeader({ vbeln: 'OPP-001' });
      const records = provenanceDb.getExtractionsByTable('Salesforce', 'VBAK');
      const fieldNames = records.map(r => r.fieldName);

      // SAP-mapped field names from the SFDC adapter output
      expect(fieldNames).toContain('VBELN');
      expect(fieldNames).toContain('AUART');
      expect(fieldNames).toContain('VKORG');
      expect(fieldNames).toContain('KUNNR');
      expect(fieldNames).toContain('AUDAT');
    });

    it('should create field records for SFDC line items', async () => {
      await wrapped.getSalesDocItems({ vbeln: 'OPP-001' });
      const records = provenanceDb.getExtractionsByTable('Salesforce', 'VBAP');
      const fieldNames = records.map(r => r.fieldName);

      expect(fieldNames).toContain('VBELN');
      expect(fieldNames).toContain('POSNR');
      expect(fieldNames).toContain('MATNR');
      expect(fieldNames).toContain('KWMENG');
      expect(fieldNames).toContain('NETWR');
      expect(fieldNames).toContain('WAERK');
    });

    it('should flatten two line items into separate field records', async () => {
      await wrapped.getSalesDocItems({ vbeln: 'OPP-001' });
      const records = provenanceDb.getExtractionsByTable('Salesforce', 'VBAP');
      // Two items with 9 fields each = 18 records
      expect(records).toHaveLength(18);
    });

    it('should create field records for SFDC doc flow stage history', async () => {
      await wrapped.getDocFlow({ vbeln: 'OPP-001' });
      const records = provenanceDb.getExtractionsByTable('Salesforce', 'VBFA');
      const fieldNames = records.map(r => r.fieldName);

      expect(fieldNames).toContain('root_document');
      expect(fieldNames).toContain('flow.0.doc_type');
      expect(fieldNames).toContain('flow.0.doc_number');
    });

    it('should create field records for SFDC search results', async () => {
      await wrapped.searchDocText({ pattern: 'discovery' });
      const records = provenanceDb.getExtractionsByTable('Salesforce', 'STXH');
      const fieldNames = records.map(r => r.fieldName);

      expect(fieldNames).toContain('doc_type');
      expect(fieldNames).toContain('doc_key');
      expect(fieldNames).toContain('snippet');
      expect(fieldNames).toContain('match_score');
    });

    it('should create field records for SFDC master stub', async () => {
      await wrapped.getMasterStub({ entity_type: 'customer', id: 'ACC-001' });
      const records = provenanceDb.getExtractionsByTable('Salesforce', 'KNA1');
      const fieldNames = records.map(r => r.fieldName);

      expect(fieldNames).toContain('ENTITY_TYPE');
      expect(fieldNames).toContain('ID');
      expect(fieldNames).toContain('REGION');
      expect(fieldNames).toContain('INDUSTRY');
      expect(records).toHaveLength(4);
    });

    it('should store raw SFDC field values correctly', async () => {
      await wrapped.getSalesDocHeader({ vbeln: 'OPP-001' });
      const records = provenanceDb.getExtractionsByTable('Salesforce', 'VBAK');
      const auartRecord = records.find(r => r.fieldName === 'AUART');
      expect(auartRecord).toBeDefined();
      expect(auartRecord!.rawValue).toBe('ZNEW');
    });
  });

  // -------------------------------------------------------------------------
  // 4. Replay hash is deterministic
  // -------------------------------------------------------------------------

  describe('replay hash determinism', () => {
    it('should produce deterministic replay hash for identical results', async () => {
      await wrapped.getSalesDocHeader({ vbeln: 'OPP-001' });
      const records1 = provenanceDb.getExtractionsByTable('Salesforce', 'VBAK');
      const replayHash1 = records1[0]!.replayHash;

      // Call again -- same adapter returns same data
      await wrapped.getSalesDocHeader({ vbeln: 'OPP-001' });
      const records2 = provenanceDb.getExtractionsByTable('Salesforce', 'VBAK');
      // Second batch starts after first batch
      const replayHash2 = records2[records1.length]!.replayHash;

      expect(replayHash1).toBe(replayHash2);
    });

    it('should produce a SHA-256 hex string (64 chars)', async () => {
      await wrapped.getSalesDocHeader({ vbeln: 'OPP-001' });
      const records = provenanceDb.getExtractionsByTable('Salesforce', 'VBAK');
      expect(records[0]!.replayHash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('should share the same replay hash across all records from one call', async () => {
      await wrapped.getSalesDocHeader({ vbeln: 'OPP-001' });
      const records = provenanceDb.getExtractionsByTable('Salesforce', 'VBAK');
      const hashes = new Set(records.map(r => r.replayHash));
      expect(hashes.size).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // 5. Different params produce different query hashes
  // -------------------------------------------------------------------------

  describe('query hash variation', () => {
    it('should produce different query hashes for different vbeln params', async () => {
      await wrapped.getSalesDocHeader({ vbeln: 'OPP-001' });
      const records1 = provenanceDb.getExtractionsByTable('Salesforce', 'VBAK');
      const queryHash1 = records1[0]!.queryHash;

      await wrapped.getSalesDocHeader({ vbeln: 'OPP-999' });
      const allRecords = provenanceDb.getExtractionsByTable('Salesforce', 'VBAK');
      // Second call's records are appended after first call's
      const queryHash2 = allRecords[records1.length]!.queryHash;

      expect(queryHash1).not.toBe(queryHash2);
    });

    it('should produce different query hashes for different methods', async () => {
      await wrapped.getSalesDocHeader({ vbeln: 'OPP-001' });
      const headerRecords = provenanceDb.getExtractionsByTable('Salesforce', 'VBAK');
      const headerHash = headerRecords[0]!.queryHash;

      await wrapped.getSalesDocItems({ vbeln: 'OPP-001' });
      const itemRecords = provenanceDb.getExtractionsByTable('Salesforce', 'VBAP');
      const itemHash = itemRecords[0]!.queryHash;

      expect(headerHash).not.toBe(itemHash);
    });

    it('should produce the same query hash for identical params across calls', async () => {
      await wrapped.getSalesDocHeader({ vbeln: 'OPP-001' });
      const records1 = provenanceDb.getExtractionsByTable('Salesforce', 'VBAK');
      const queryHash1 = records1[0]!.queryHash;

      await wrapped.getSalesDocHeader({ vbeln: 'OPP-001' });
      const allRecords = provenanceDb.getExtractionsByTable('Salesforce', 'VBAK');
      const queryHash2 = allRecords[records1.length]!.queryHash;

      expect(queryHash1).toBe(queryHash2);
    });

    it('should produce SHA-256 hex strings for query hashes', async () => {
      await wrapped.getSalesDocHeader({ vbeln: 'OPP-001' });
      const records = provenanceDb.getExtractionsByTable('Salesforce', 'VBAK');
      expect(records[0]!.queryHash).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  // -------------------------------------------------------------------------
  // 6. Initialize and shutdown pass through the wrapper
  // -------------------------------------------------------------------------

  describe('lifecycle passthrough', () => {
    it('should call initialize on the underlying adapter', async () => {
      await wrapped.initialize();
      expect(mockAdapter.calls).toContainEqual({ method: 'initialize', params: undefined });
    });

    it('should call shutdown on the underlying adapter', async () => {
      await wrapped.shutdown();
      expect(mockAdapter.calls).toContainEqual({ method: 'shutdown', params: undefined });
    });

    it('should delegate isReady to the underlying adapter', () => {
      expect(wrapped.isReady()).toBe(false);
    });

    it('should reflect initialization state through the wrapper', async () => {
      expect(wrapped.isReady()).toBe(false);
      await wrapped.initialize();
      expect(wrapped.isReady()).toBe(true);
      await wrapped.shutdown();
      expect(wrapped.isReady()).toBe(false);
    });

    it('should NOT create provenance records for initialize/shutdown', async () => {
      await wrapped.initialize();
      await wrapped.shutdown();
      const stats = provenanceDb.getStats();
      expect(stats.totalExtractions).toBe(0);
    });

    it('should preserve the adapter name', () => {
      expect(wrapped.name).toBe('sfdc');
    });
  });
});
