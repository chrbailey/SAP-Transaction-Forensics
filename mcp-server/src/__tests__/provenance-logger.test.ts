/**
 * Tests for ProvenanceLogger middleware
 *
 * Verifies that wrapping an IDataAdapter transparently intercepts every call
 * and persists field-level ExtractionRecords to a provenance store.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { ProvenanceLogger } from '../provenance/logger.js';
import type { ProvenanceStore } from '../provenance/logger.js';
import type { IDataAdapter } from '../adapters/adapter-interface.js';
import type { ExtractionRecord } from '../provenance/types.js';
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
// Mocks
// ---------------------------------------------------------------------------

/** In-memory provenance store that collects all inserted records. */
function createMockStore(): ProvenanceStore & { records: ExtractionRecord[] } {
  const records: ExtractionRecord[] = [];
  return {
    records,
    insertExtraction(record: ExtractionRecord) {
      records.push(record);
    },
    insertBatchExtractions(batch: ExtractionRecord[]) {
      records.push(...batch);
    },
  };
}

/** Tracks which adapter methods were called and with what args. */
interface CallLog {
  method: string;
  params: unknown;
}

function createMockAdapter(): IDataAdapter & { calls: CallLog[] } {
  const calls: CallLog[] = [];

  const sampleHeader: SalesDocHeader = {
    VBELN: '0000012345',
    AUART: 'OR',
    VKORG: '1000',
    VTWEG: '10',
    SPART: '00',
    KUNNR: '0000100001',
    AUDAT: '20240115',
    ERNAM: 'TESTUSER',
    ERDAT: '20240115',
    ERZET: '120000',
  };

  const sampleItem: SalesDocItem = {
    VBELN: '0000012345',
    POSNR: '000010',
    MATNR: 'MAT001',
    WERKS: '1000',
    KWMENG: 100,
    VRKME: 'EA',
    NETWR: 5000,
    WAERK: 'USD',
    PSTYV: 'TAN',
  };

  const sampleDocFlow: DocFlowResult = {
    root_document: '0000012345',
    flow: [
      {
        doc_type: 'Sales Order',
        doc_number: '0000012345',
        doc_category: 'C',
        created_date: '20240115',
        created_time: '120000',
        items: [{ item_number: '000010' }],
      },
    ],
  };

  const sampleDocText: DocTextResult = {
    header_texts: [
      { text_id: '0001', lang: 'EN', text: 'Test header text' },
    ],
    item_texts: [
      { item_number: '000010', text_id: '0001', lang: 'EN', text: 'Test item text' },
    ],
  };

  const sampleSearchResult: SearchResult[] = [
    {
      doc_type: 'sales',
      doc_key: '0000012345',
      snippet: 'matching text here',
      match_score: 0.95,
      dates: { created: '20240115' },
      org_keys: { VKORG: '1000' },
    },
  ];

  const sampleDeliveryTiming: DeliveryTimingResult = {
    delivery_number: '0080012345',
    header_timing: {
      requested_date: '20240120',
      actual_gi_date: '20240121',
    },
    item_timing: [
      { item_number: '000010', material: 'MAT001' },
    ],
  };

  const sampleInvoiceTiming: InvoiceTimingResult = {
    invoice_number: '0090012345',
    billing_date: '20240125',
    created_date: '20240125',
    created_time: '140000',
    linked_deliveries: ['0080012345'],
    linked_orders: ['0000012345'],
  };

  const sampleMasterStub: MasterStub = {
    ENTITY_TYPE: 'customer',
    ID: '0000100001',
    REGION: 'US',
    INDUSTRY: 'TECH',
  };

  let initialized = false;

  return {
    calls,
    name: 'test-adapter',

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
      return sampleSearchResult;
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
      return [sampleItem];
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

describe('ProvenanceLogger', () => {
  let store: ReturnType<typeof createMockStore>;
  let adapter: ReturnType<typeof createMockAdapter>;
  let logger: ProvenanceLogger;
  let wrapped: IDataAdapter;

  beforeEach(() => {
    store = createMockStore();
    adapter = createMockAdapter();
    logger = new ProvenanceLogger(store, 'test-adapter-001', 'SAP');
    wrapped = logger.wrapAdapter(adapter);
  });

  // -------------------------------------------------------------------------
  // 1. Interface preservation
  // -------------------------------------------------------------------------

  describe('interface preservation', () => {
    it('should return an object with all IDataAdapter methods', () => {
      expect(typeof wrapped.searchDocText).toBe('function');
      expect(typeof wrapped.getDocText).toBe('function');
      expect(typeof wrapped.getDocFlow).toBe('function');
      expect(typeof wrapped.getSalesDocHeader).toBe('function');
      expect(typeof wrapped.getSalesDocItems).toBe('function');
      expect(typeof wrapped.getDeliveryTiming).toBe('function');
      expect(typeof wrapped.getInvoiceTiming).toBe('function');
      expect(typeof wrapped.getMasterStub).toBe('function');
      expect(typeof wrapped.initialize).toBe('function');
      expect(typeof wrapped.shutdown).toBe('function');
      expect(typeof wrapped.isReady).toBe('function');
    });

    it('should preserve the adapter name property', () => {
      expect(wrapped.name).toBe('test-adapter');
    });
  });

  // -------------------------------------------------------------------------
  // 2. Pass-through behavior
  // -------------------------------------------------------------------------

  describe('pass-through behavior', () => {
    it('should delegate initialize to the underlying adapter', async () => {
      await wrapped.initialize();
      expect(adapter.calls).toContainEqual({ method: 'initialize', params: undefined });
    });

    it('should delegate shutdown to the underlying adapter', async () => {
      await wrapped.shutdown();
      expect(adapter.calls).toContainEqual({ method: 'shutdown', params: undefined });
    });

    it('should delegate isReady to the underlying adapter', () => {
      expect(wrapped.isReady()).toBe(false);
    });

    it('should call the underlying adapter for data methods', async () => {
      const result = await wrapped.getSalesDocHeader({ vbeln: '0000012345' });
      expect(result).not.toBeNull();
      expect(result!.VBELN).toBe('0000012345');
      expect(adapter.calls).toContainEqual({
        method: 'getSalesDocHeader',
        params: { vbeln: '0000012345' },
      });
    });

    it('should return the same result as the underlying adapter', async () => {
      const directResult = await adapter.getSalesDocItems({ vbeln: '0000012345' });
      // Reset call log but store still records
      store.records.length = 0;
      const wrappedResult = await wrapped.getSalesDocItems({ vbeln: '0000012345' });
      expect(wrappedResult).toEqual(directResult);
    });
  });

  // -------------------------------------------------------------------------
  // 3. ExtractionRecord creation
  // -------------------------------------------------------------------------

  describe('extraction record creation', () => {
    it('should create ExtractionRecords in the store on data calls', async () => {
      expect(store.records).toHaveLength(0);
      await wrapped.getSalesDocHeader({ vbeln: '0000012345' });
      expect(store.records.length).toBeGreaterThan(0);
    });

    it('should NOT create records for initialize/shutdown/isReady', async () => {
      await wrapped.initialize();
      await wrapped.shutdown();
      wrapped.isReady();
      expect(store.records).toHaveLength(0);
    });

    it('should not create records when result is null', async () => {
      // Create an adapter that returns null
      const nullAdapter = createMockAdapter();
      nullAdapter.getSalesDocHeader = async () => {
        nullAdapter.calls.push({ method: 'getSalesDocHeader', params: {} });
        return null;
      };
      const nullWrapped = logger.wrapAdapter(nullAdapter);
      await nullWrapped.getSalesDocHeader({ vbeln: 'NONEXISTENT' });
      expect(store.records).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // 4. Record field correctness
  // -------------------------------------------------------------------------

  describe('record field correctness', () => {
    it('should set systemType correctly on all records', async () => {
      await wrapped.getSalesDocHeader({ vbeln: '0000012345' });
      for (const rec of store.records) {
        expect(rec.systemType).toBe('SAP');
      }
    });

    it('should set adapterId correctly on all records', async () => {
      await wrapped.getSalesDocHeader({ vbeln: '0000012345' });
      for (const rec of store.records) {
        expect(rec.adapterId).toBe('test-adapter-001');
      }
    });

    it('should set tableName to VBAK for getSalesDocHeader', async () => {
      await wrapped.getSalesDocHeader({ vbeln: '0000012345' });
      for (const rec of store.records) {
        expect(rec.tableName).toBe('VBAK');
      }
    });

    it('should set tableName to VBAP for getSalesDocItems', async () => {
      await wrapped.getSalesDocItems({ vbeln: '0000012345' });
      for (const rec of store.records) {
        expect(rec.tableName).toBe('VBAP');
      }
    });

    it('should set tableName to VBFA for getDocFlow', async () => {
      await wrapped.getDocFlow({ vbeln: '0000012345' });
      for (const rec of store.records) {
        expect(rec.tableName).toBe('VBFA');
      }
    });

    it('should set recordId from the method parameters', async () => {
      await wrapped.getSalesDocHeader({ vbeln: '0000012345' });
      for (const rec of store.records) {
        expect(rec.recordId).toBe('0000012345');
      }
    });

    it('should set extractionPathId based on adapterId', async () => {
      await wrapped.getSalesDocHeader({ vbeln: '0000012345' });
      for (const rec of store.records) {
        expect(rec.extractionPathId).toBe('adapter:test-adapter-001');
      }
    });

    it('should generate unique IDs for each record', async () => {
      await wrapped.getSalesDocHeader({ vbeln: '0000012345' });
      const ids = store.records.map(r => r.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
    });

    it('should set extractionTimestamp as ISO 8601', async () => {
      await wrapped.getSalesDocHeader({ vbeln: '0000012345' });
      for (const rec of store.records) {
        expect(() => new Date(rec.extractionTimestamp)).not.toThrow();
        expect(rec.extractionTimestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      }
    });
  });

  // -------------------------------------------------------------------------
  // 5. Field-level flattening
  // -------------------------------------------------------------------------

  describe('field-level flattening', () => {
    it('should create one record per non-null field for getSalesDocHeader', async () => {
      await wrapped.getSalesDocHeader({ vbeln: '0000012345' });

      // The sample header has 10 fields (no optional ones set)
      // VBELN, AUART, VKORG, VTWEG, SPART, KUNNR, AUDAT, ERNAM, ERDAT, ERZET
      const fieldNames = store.records.map(r => r.fieldName);
      expect(fieldNames).toContain('VBELN');
      expect(fieldNames).toContain('AUART');
      expect(fieldNames).toContain('VKORG');
      expect(fieldNames).toContain('ERNAM');
      expect(fieldNames).toContain('ERDAT');
      expect(store.records).toHaveLength(10);
    });

    it('should set rawValue to the string representation of each field', async () => {
      await wrapped.getSalesDocHeader({ vbeln: '0000012345' });
      const vbelnRecord = store.records.find(r => r.fieldName === 'VBELN');
      expect(vbelnRecord).toBeDefined();
      expect(vbelnRecord!.rawValue).toBe('0000012345');
    });

    it('should set normalizedValue to uppercase trimmed rawValue', async () => {
      await wrapped.getSalesDocHeader({ vbeln: '0000012345' });
      const auartRecord = store.records.find(r => r.fieldName === 'AUART');
      expect(auartRecord).toBeDefined();
      expect(auartRecord!.normalizedValue).toBe('OR');
    });

    it('should flatten array results into per-row per-field records', async () => {
      await wrapped.getSalesDocItems({ vbeln: '0000012345' });
      // SalesDocItem has 9 non-optional fields
      const fieldNames = store.records.map(r => r.fieldName);
      expect(fieldNames).toContain('VBELN');
      expect(fieldNames).toContain('POSNR');
      expect(fieldNames).toContain('MATNR');
      expect(fieldNames).toContain('KWMENG');
    });

    it('should flatten nested objects with dotted field names', async () => {
      await wrapped.getDeliveryTiming({ vbeln: '0080012345' });
      const fieldNames = store.records.map(r => r.fieldName);
      expect(fieldNames).toContain('delivery_number');
      expect(fieldNames).toContain('header_timing.requested_date');
      expect(fieldNames).toContain('header_timing.actual_gi_date');
    });

    it('should flatten nested arrays with indexed dotted names', async () => {
      await wrapped.getDocFlow({ vbeln: '0000012345' });
      const fieldNames = store.records.map(r => r.fieldName);
      expect(fieldNames).toContain('root_document');
      // flow.0.doc_type, flow.0.doc_number, etc.
      expect(fieldNames).toContain('flow.0.doc_type');
      expect(fieldNames).toContain('flow.0.doc_number');
      expect(fieldNames).toContain('flow.0.items.0.item_number');
    });

    it('should handle searchDocText array results', async () => {
      await wrapped.searchDocText({ pattern: 'test' });
      expect(store.records.length).toBeGreaterThan(0);
      const fieldNames = store.records.map(r => r.fieldName);
      expect(fieldNames).toContain('doc_type');
      expect(fieldNames).toContain('doc_key');
      expect(fieldNames).toContain('match_score');
    });

    it('should handle InvoiceTiming with string arrays', async () => {
      await wrapped.getInvoiceTiming({ vbeln: '0090012345' });
      const fieldNames = store.records.map(r => r.fieldName);
      expect(fieldNames).toContain('invoice_number');
      expect(fieldNames).toContain('billing_date');
      // linked_deliveries and linked_orders are string arrays
      expect(fieldNames).toContain('linked_deliveries.0');
      expect(fieldNames).toContain('linked_orders.0');
    });

    it('should handle getMasterStub', async () => {
      await wrapped.getMasterStub({ entity_type: 'customer', id: '0000100001' });
      const fieldNames = store.records.map(r => r.fieldName);
      expect(fieldNames).toContain('ENTITY_TYPE');
      expect(fieldNames).toContain('ID');
      expect(fieldNames).toContain('REGION');
      expect(fieldNames).toContain('INDUSTRY');
      expect(store.records).toHaveLength(4);
    });

    it('should convert numeric field values to strings', async () => {
      await wrapped.getSalesDocItems({ vbeln: '0000012345' });
      const kwmengRecord = store.records.find(r => r.fieldName === 'KWMENG');
      expect(kwmengRecord).toBeDefined();
      expect(kwmengRecord!.rawValue).toBe('100');
    });
  });

  // -------------------------------------------------------------------------
  // 6. Query hash determinism
  // -------------------------------------------------------------------------

  describe('query hash determinism', () => {
    it('should produce the same queryHash for identical method+params', async () => {
      await wrapped.getSalesDocHeader({ vbeln: '0000012345' });
      const hashes1 = store.records.map(r => r.queryHash);

      store.records.length = 0;
      await wrapped.getSalesDocHeader({ vbeln: '0000012345' });
      const hashes2 = store.records.map(r => r.queryHash);

      // All records from the same call share one queryHash
      expect(new Set(hashes1).size).toBe(1);
      expect(new Set(hashes2).size).toBe(1);
      expect(hashes1[0]).toBe(hashes2[0]);
    });

    it('should produce different queryHash for different params', async () => {
      await wrapped.getSalesDocHeader({ vbeln: '0000012345' });
      const hash1 = store.records[0]!.queryHash;

      store.records.length = 0;
      await wrapped.getSalesDocHeader({ vbeln: '9999999999' });
      const hash2 = store.records[0]!.queryHash;

      expect(hash1).not.toBe(hash2);
    });

    it('should produce a SHA-256 hex string (64 chars)', async () => {
      await wrapped.getSalesDocHeader({ vbeln: '0000012345' });
      const hash = store.records[0]!.queryHash;
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  // -------------------------------------------------------------------------
  // 7. Replay hash
  // -------------------------------------------------------------------------

  describe('replay hash', () => {
    it('should set replayHash on all records from one call', async () => {
      await wrapped.getSalesDocHeader({ vbeln: '0000012345' });
      const hashes = new Set(store.records.map(r => r.replayHash));
      // All records from the same call share one replayHash
      expect(hashes.size).toBe(1);
    });

    it('should produce a SHA-256 hex string', async () => {
      await wrapped.getSalesDocHeader({ vbeln: '0000012345' });
      const hash = store.records[0]!.replayHash;
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  // -------------------------------------------------------------------------
  // 8. Different system types
  // -------------------------------------------------------------------------

  describe('different system types', () => {
    it('should support Salesforce system type', async () => {
      const sfLogger = new ProvenanceLogger(store, 'sfdc-001', 'Salesforce');
      const sfWrapped = sfLogger.wrapAdapter(adapter);
      await sfWrapped.getSalesDocHeader({ vbeln: '0000012345' });
      for (const rec of store.records) {
        expect(rec.systemType).toBe('Salesforce');
        expect(rec.adapterId).toBe('sfdc-001');
      }
    });
  });

  // -------------------------------------------------------------------------
  // 9. All 8 data methods produce records
  // -------------------------------------------------------------------------

  describe('all data methods produce records', () => {
    const methods: Array<{ name: string; call: (w: IDataAdapter) => Promise<unknown> }> = [
      { name: 'searchDocText', call: w => w.searchDocText({ pattern: 'test' }) },
      { name: 'getDocText', call: w => w.getDocText({ doc_type: 'sales', doc_key: '12345' }) },
      { name: 'getDocFlow', call: w => w.getDocFlow({ vbeln: '12345' }) },
      { name: 'getSalesDocHeader', call: w => w.getSalesDocHeader({ vbeln: '12345' }) },
      { name: 'getSalesDocItems', call: w => w.getSalesDocItems({ vbeln: '12345' }) },
      { name: 'getDeliveryTiming', call: w => w.getDeliveryTiming({ vbeln: '12345' }) },
      { name: 'getInvoiceTiming', call: w => w.getInvoiceTiming({ vbeln: '12345' }) },
      { name: 'getMasterStub', call: w => w.getMasterStub({ entity_type: 'customer', id: '12345' }) },
    ];

    for (const { name, call } of methods) {
      it(`should produce records for ${name}`, async () => {
        store.records.length = 0;
        await call(wrapped);
        expect(store.records.length).toBeGreaterThan(0);
      });
    }
  });
});
