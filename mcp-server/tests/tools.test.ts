/**
 * Jest Tests for Transaction Forensics MCP Tools
 *
 * Tests cover:
 * - Tool parameter validation (Zod schemas)
 * - Row limit enforcement
 * - Adapter interface compliance
 * - Policy enforcement
 * - Tool execution with synthetic data
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';

import { SyntheticAdapter } from '../src/adapters/synthetic/index.js';
import { IDataAdapter } from '../src/adapters/adapter-interface.js';
import {
  executeSearchDocText,
  executeGetDocText,
  executeGetDocFlow,
  executeGetSalesDocHeader,
  executeGetSalesDocItems,
  executeGetDeliveryTiming,
  executeGetInvoiceTiming,
  executeGetMasterStub,
  SearchDocTextSchema,
  GetDocTextSchema,
  GetDocFlowSchema,
  GetSalesDocHeaderSchema,
  GetSalesDocItemsSchema,
  GetDeliveryTimingSchema,
  GetInvoiceTimingSchema,
  GetMasterStubSchema,
} from '../src/tools/index.js';
import {
  enforceRowLimit,
  validateSearchPattern,
  validateDateRange,
  PolicyViolationError,
} from '../src/policies/limits.js';

// Document numbers from synthetic data (10-digit format)
const SAMPLE_SALES_ORDER = '0000000001';
const SAMPLE_DELIVERY = '8000000001';
const SAMPLE_INVOICE = '9000000001';
const SAMPLE_CUSTOMER = 'CUST0001';
const SAMPLE_MATERIAL = 'MAT001';

describe('Transaction Forensics MCP Tools', () => {
  let adapter: IDataAdapter;

  beforeAll(async () => {
    adapter = new SyntheticAdapter();
    await adapter.initialize();
  });

  afterAll(async () => {
    await adapter.shutdown();
  });

  // ===========================================================================
  // Parameter Validation Tests (Zod Schemas)
  // ===========================================================================
  describe('Parameter Validation', () => {
    describe('SearchDocTextSchema', () => {
      it('should accept valid parameters', () => {
        const result = SearchDocTextSchema.safeParse({
          pattern: 'rush.*order',
          doc_type: 'sales',
          date_from: '2024-01-01',
          date_to: '2024-12-31',
          limit: 100,
        });
        expect(result.success).toBe(true);
      });

      it('should accept minimal parameters', () => {
        const result = SearchDocTextSchema.safeParse({
          pattern: 'test',
        });
        expect(result.success).toBe(true);
      });

      it('should reject pattern less than 2 characters', () => {
        const result = SearchDocTextSchema.safeParse({
          pattern: 'a',
        });
        expect(result.success).toBe(false);
      });

      it('should reject invalid doc_type', () => {
        const result = SearchDocTextSchema.safeParse({
          pattern: 'test',
          doc_type: 'invalid',
        });
        expect(result.success).toBe(false);
      });

      it('should reject invalid date format', () => {
        const result = SearchDocTextSchema.safeParse({
          pattern: 'test',
          date_from: '01-01-2024', // Wrong format
        });
        expect(result.success).toBe(false);
      });

      it('should reject limit over 200', () => {
        const result = SearchDocTextSchema.safeParse({
          pattern: 'test',
          limit: 500,
        });
        expect(result.success).toBe(false);
      });

      it('should accept org_filters', () => {
        const result = SearchDocTextSchema.safeParse({
          pattern: 'test',
          org_filters: {
            VKORG: '1000',
            VTWEG: '10',
          },
        });
        expect(result.success).toBe(true);
      });
    });

    describe('GetDocTextSchema', () => {
      it('should accept valid parameters', () => {
        const result = GetDocTextSchema.safeParse({
          doc_type: 'sales',
          doc_key: '100000000',
        });
        expect(result.success).toBe(true);
      });

      it('should require doc_type', () => {
        const result = GetDocTextSchema.safeParse({
          doc_key: '100000000',
        });
        expect(result.success).toBe(false);
      });

      it('should require doc_key', () => {
        const result = GetDocTextSchema.safeParse({
          doc_type: 'sales',
        });
        expect(result.success).toBe(false);
      });

      it('should accept all doc types', () => {
        ['sales', 'delivery', 'invoice'].forEach(docType => {
          const result = GetDocTextSchema.safeParse({
            doc_type: docType,
            doc_key: '100000000',
          });
          expect(result.success).toBe(true);
        });
      });
    });

    describe('GetDocFlowSchema', () => {
      it('should accept valid vbeln', () => {
        const result = GetDocFlowSchema.safeParse({
          vbeln: '100000000',
        });
        expect(result.success).toBe(true);
      });

      it('should reject empty vbeln', () => {
        const result = GetDocFlowSchema.safeParse({
          vbeln: '',
        });
        expect(result.success).toBe(false);
      });
    });

    describe('GetSalesDocHeaderSchema', () => {
      it('should accept valid vbeln', () => {
        const result = GetSalesDocHeaderSchema.safeParse({
          vbeln: '100000000',
        });
        expect(result.success).toBe(true);
      });
    });

    describe('GetSalesDocItemsSchema', () => {
      it('should accept valid vbeln', () => {
        const result = GetSalesDocItemsSchema.safeParse({
          vbeln: '100000000',
        });
        expect(result.success).toBe(true);
      });
    });

    describe('GetDeliveryTimingSchema', () => {
      it('should accept valid vbeln', () => {
        const result = GetDeliveryTimingSchema.safeParse({
          vbeln: '800000000',
        });
        expect(result.success).toBe(true);
      });
    });

    describe('GetInvoiceTimingSchema', () => {
      it('should accept valid vbeln', () => {
        const result = GetInvoiceTimingSchema.safeParse({
          vbeln: '900000000',
        });
        expect(result.success).toBe(true);
      });
    });

    describe('GetMasterStubSchema', () => {
      it('should accept valid customer request', () => {
        const result = GetMasterStubSchema.safeParse({
          entity_type: 'customer',
          id: '10000',
          hash_id: true,
        });
        expect(result.success).toBe(true);
      });

      it('should accept valid material request', () => {
        const result = GetMasterStubSchema.safeParse({
          entity_type: 'material',
          id: 'MAT100000',
        });
        expect(result.success).toBe(true);
      });

      it('should accept valid vendor request', () => {
        const result = GetMasterStubSchema.safeParse({
          entity_type: 'vendor',
          id: 'VEND001',
        });
        expect(result.success).toBe(true);
      });

      it('should reject invalid entity_type', () => {
        const result = GetMasterStubSchema.safeParse({
          entity_type: 'employee', // Not allowed
          id: 'EMP001',
        });
        expect(result.success).toBe(false);
      });

      it('should default hash_id to false', () => {
        const result = GetMasterStubSchema.safeParse({
          entity_type: 'customer',
          id: '10000',
        });
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.hash_id).toBe(false);
        }
      });
    });
  });

  // ===========================================================================
  // Row Limit Enforcement Tests
  // ===========================================================================
  describe('Row Limit Enforcement', () => {
    it('should truncate results exceeding limit', () => {
      const largeArray = Array.from({ length: 300 }, (_, i) => ({ id: i }));
      const limited = enforceRowLimit(largeArray, 200);
      expect(limited.length).toBe(200);
    });

    it('should not truncate results within limit', () => {
      const smallArray = Array.from({ length: 50 }, (_, i) => ({ id: i }));
      const limited = enforceRowLimit(smallArray, 200);
      expect(limited.length).toBe(50);
    });

    it('should respect requested limit below max', () => {
      const array = Array.from({ length: 100 }, (_, i) => ({ id: i }));
      const limited = enforceRowLimit(array, 50);
      expect(limited.length).toBe(50);
    });

    it('should enforce max even if higher limit requested', () => {
      const array = Array.from({ length: 500 }, (_, i) => ({ id: i }));
      const limited = enforceRowLimit(array, 300); // Request 300, but max is 200
      expect(limited.length).toBe(200);
    });

    it('should handle empty arrays', () => {
      const limited = enforceRowLimit([], 200);
      expect(limited.length).toBe(0);
    });
  });

  // ===========================================================================
  // Policy Enforcement Tests
  // ===========================================================================
  describe('Policy Enforcement', () => {
    describe('validateSearchPattern', () => {
      it('should reject overly broad patterns', () => {
        expect(() => validateSearchPattern('.*')).toThrow(PolicyViolationError);
        expect(() => validateSearchPattern('.+')).toThrow(PolicyViolationError);
        expect(() => validateSearchPattern('^.*$')).toThrow(PolicyViolationError);
      });

      it('should reject patterns too short', () => {
        expect(() => validateSearchPattern('a')).toThrow(PolicyViolationError);
      });

      it('should reject invalid regex', () => {
        expect(() => validateSearchPattern('[unclosed')).toThrow(PolicyViolationError);
      });

      it('should accept valid patterns', () => {
        expect(() => validateSearchPattern('rush')).not.toThrow();
        expect(() => validateSearchPattern('order.*number')).not.toThrow();
        expect(() => validateSearchPattern('\\d{4}')).not.toThrow();
        expect(() => validateSearchPattern('blocked')).not.toThrow();
      });
    });

    describe('validateDateRange', () => {
      it('should accept valid date range', () => {
        expect(() => validateDateRange('2024-01-01', '2024-06-30')).not.toThrow();
      });

      it('should reject inverted date range', () => {
        expect(() => validateDateRange('2024-12-31', '2024-01-01')).toThrow(PolicyViolationError);
      });

      it('should reject date range exceeding 1 year', () => {
        expect(() => validateDateRange('2022-01-01', '2024-12-31')).toThrow(PolicyViolationError);
      });

      it('should accept missing dates', () => {
        expect(() => validateDateRange()).not.toThrow();
        expect(() => validateDateRange('2024-01-01')).not.toThrow();
        expect(() => validateDateRange(undefined, '2024-12-31')).not.toThrow();
      });
    });
  });

  // ===========================================================================
  // Adapter Interface Compliance Tests
  // ===========================================================================
  describe('Adapter Interface Compliance', () => {
    it('adapter should have all required methods', () => {
      expect(typeof adapter.searchDocText).toBe('function');
      expect(typeof adapter.getDocText).toBe('function');
      expect(typeof adapter.getDocFlow).toBe('function');
      expect(typeof adapter.getSalesDocHeader).toBe('function');
      expect(typeof adapter.getSalesDocItems).toBe('function');
      expect(typeof adapter.getDeliveryTiming).toBe('function');
      expect(typeof adapter.getInvoiceTiming).toBe('function');
      expect(typeof adapter.getMasterStub).toBe('function');
    });

    it('adapter should have name property', () => {
      expect(adapter.name).toBe('synthetic');
    });

    it('adapter should be ready after initialization', () => {
      expect(adapter.isReady()).toBe(true);
    });
  });

  // ===========================================================================
  // Tool Execution Tests with Synthetic Data
  // ===========================================================================
  describe('Tool Execution', () => {
    describe('search_doc_text', () => {
      it('should find documents matching pattern', async () => {
        const results = await executeSearchDocText(adapter, {
          pattern: 'blocked',
          limit: 10,
        });
        expect(Array.isArray(results)).toBe(true);
        // Results depend on synthetic data having texts with "blocked"
        results.forEach(r => {
          expect(r).toHaveProperty('doc_type');
          expect(r).toHaveProperty('doc_key');
          expect(r).toHaveProperty('snippet');
          expect(r).toHaveProperty('match_score');
          expect(r).toHaveProperty('dates');
          expect(r).toHaveProperty('org_keys');
        });
      });

      it('should filter by doc_type', async () => {
        const results = await executeSearchDocText(adapter, {
          pattern: 'blocked',
          doc_type: 'sales',
        });
        results.forEach(r => {
          expect(r.doc_type).toBe('sales');
        });
      });

      it('should respect limit', async () => {
        const results = await executeSearchDocText(adapter, {
          pattern: 'blocked',
          limit: 5,
        });
        expect(results.length).toBeLessThanOrEqual(5);
      });
    });

    describe('get_doc_text', () => {
      it('should retrieve texts for existing document', async () => {
        const result = await executeGetDocText(adapter, {
          doc_type: 'sales',
          doc_key: SAMPLE_SALES_ORDER,
        });
        expect(result).toHaveProperty('header_texts');
        expect(result).toHaveProperty('item_texts');
        expect(Array.isArray(result.header_texts)).toBe(true);
        expect(Array.isArray(result.item_texts)).toBe(true);
      });

      it('should return empty texts for non-existent document', async () => {
        const result = await executeGetDocText(adapter, {
          doc_type: 'sales',
          doc_key: '9999999999',
        });
        expect(result.header_texts.length).toBe(0);
        expect(result.item_texts.length).toBe(0);
      });

      it('text entries should have required fields', async () => {
        // First, find a document with texts
        const result = await executeGetDocText(adapter, {
          doc_type: 'sales',
          doc_key: '0000000002', // This should have texts based on synthetic data
        });

        if (result.header_texts.length > 0) {
          const text = result.header_texts[0];
          expect(text).toHaveProperty('text_id');
          expect(text).toHaveProperty('lang');
          expect(text).toHaveProperty('text');
        }
      });
    });

    describe('get_doc_flow', () => {
      it('should trace document chain', async () => {
        const result = await executeGetDocFlow(adapter, {
          vbeln: SAMPLE_SALES_ORDER,
        });
        expect(result).toHaveProperty('root_document', SAMPLE_SALES_ORDER);
        expect(result).toHaveProperty('flow');
        expect(Array.isArray(result.flow)).toBe(true);
        expect(result.flow.length).toBeGreaterThan(0);
      });

      it('should include document metadata in flow', async () => {
        const result = await executeGetDocFlow(adapter, {
          vbeln: SAMPLE_SALES_ORDER,
        });
        const firstDoc = result.flow[0];
        expect(firstDoc).toHaveProperty('doc_type');
        expect(firstDoc).toHaveProperty('doc_number');
        expect(firstDoc).toHaveProperty('doc_category');
        expect(firstDoc).toHaveProperty('created_date');
        expect(firstDoc).toHaveProperty('created_time');
        expect(firstDoc).toHaveProperty('items');
      });

      it('should include related deliveries and invoices', async () => {
        const result = await executeGetDocFlow(adapter, {
          vbeln: SAMPLE_SALES_ORDER,
        });
        const docTypes = result.flow.map(f => f.doc_type);
        // Check that flow includes more than just the sales order
        expect(result.flow.length).toBeGreaterThan(1);
      });
    });

    describe('get_sales_doc_header', () => {
      it('should retrieve header for existing order', async () => {
        const result = await executeGetSalesDocHeader(adapter, {
          vbeln: SAMPLE_SALES_ORDER,
        });
        expect(result).not.toBeNull();
        expect(result?.VBELN).toBe(SAMPLE_SALES_ORDER);
        expect(result?.VKORG).toBeDefined();
        expect(result?.VTWEG).toBeDefined();
        expect(result?.SPART).toBeDefined();
        expect(result?.KUNNR).toBeDefined();
        expect(result?.ERNAM).toBeDefined();
        expect(result?.ERDAT).toBeDefined();
      });

      it('should return null for non-existent order', async () => {
        const result = await executeGetSalesDocHeader(adapter, {
          vbeln: '9999999999',
        });
        expect(result).toBeNull();
      });

      it('should include financial data', async () => {
        const result = await executeGetSalesDocHeader(adapter, {
          vbeln: SAMPLE_SALES_ORDER,
        });
        expect(result?.NETWR).toBeDefined();
        expect(result?.WAERK).toBeDefined();
      });
    });

    describe('get_sales_doc_items', () => {
      it('should retrieve items for existing order', async () => {
        const results = await executeGetSalesDocItems(adapter, {
          vbeln: SAMPLE_SALES_ORDER,
        });
        expect(Array.isArray(results)).toBe(true);
        expect(results.length).toBeGreaterThan(0);
      });

      it('should include required item fields', async () => {
        const results = await executeGetSalesDocItems(adapter, {
          vbeln: SAMPLE_SALES_ORDER,
        });
        const item = results[0];
        expect(item).toHaveProperty('VBELN');
        expect(item).toHaveProperty('POSNR');
        expect(item).toHaveProperty('MATNR');
        expect(item).toHaveProperty('WERKS');
        expect(item).toHaveProperty('KWMENG');
        expect(item).toHaveProperty('NETWR');
        expect(item).toHaveProperty('WAERK');
      });

      it('should return empty array for non-existent order', async () => {
        const results = await executeGetSalesDocItems(adapter, {
          vbeln: '9999999999',
        });
        expect(results).toEqual([]);
      });
    });

    describe('get_delivery_timing', () => {
      it('should retrieve timing for existing delivery', async () => {
        const result = await executeGetDeliveryTiming(adapter, {
          vbeln: SAMPLE_DELIVERY,
        });
        expect(result).not.toBeNull();
        expect(result?.delivery_number).toBe(SAMPLE_DELIVERY);
        expect(result?.header_timing).toBeDefined();
        expect(result?.item_timing).toBeDefined();
      });

      it('should include timing fields', async () => {
        const result = await executeGetDeliveryTiming(adapter, {
          vbeln: SAMPLE_DELIVERY,
        });
        expect(result?.header_timing).toHaveProperty('planned_gi_date');
        expect(Array.isArray(result?.item_timing)).toBe(true);
      });

      it('should return null for non-existent delivery', async () => {
        const result = await executeGetDeliveryTiming(adapter, {
          vbeln: '8999999999',
        });
        expect(result).toBeNull();
      });
    });

    describe('get_invoice_timing', () => {
      it('should retrieve timing for existing invoice', async () => {
        const result = await executeGetInvoiceTiming(adapter, {
          vbeln: SAMPLE_INVOICE,
        });
        expect(result).not.toBeNull();
        expect(result?.invoice_number).toBe(SAMPLE_INVOICE);
        expect(result?.billing_date).toBeDefined();
        expect(result?.created_date).toBeDefined();
      });

      it('should include linked documents', async () => {
        const result = await executeGetInvoiceTiming(adapter, {
          vbeln: SAMPLE_INVOICE,
        });
        expect(result?.linked_deliveries).toBeDefined();
        expect(result?.linked_orders).toBeDefined();
        expect(Array.isArray(result?.linked_deliveries)).toBe(true);
        expect(Array.isArray(result?.linked_orders)).toBe(true);
      });

      it('should return null for non-existent invoice', async () => {
        const result = await executeGetInvoiceTiming(adapter, {
          vbeln: '9999999999',
        });
        expect(result).toBeNull();
      });
    });

    describe('get_master_stub', () => {
      it('should retrieve customer stub', async () => {
        const result = await executeGetMasterStub(adapter, {
          entity_type: 'customer',
          id: SAMPLE_CUSTOMER,
        });
        expect(result).not.toBeNull();
        expect(result?.ENTITY_TYPE).toBe('customer');
        expect(result?.ID).toBe(SAMPLE_CUSTOMER);
      });

      it('should include safe attributes for customer', async () => {
        const result = await executeGetMasterStub(adapter, {
          entity_type: 'customer',
          id: SAMPLE_CUSTOMER,
        });
        expect(result?.INDUSTRY).toBeDefined();
        expect(result?.REGION).toBeDefined();
        expect(result?.CATEGORY).toBeDefined();
      });

      it('should include hashed ID when requested', async () => {
        const result = await executeGetMasterStub(adapter, {
          entity_type: 'customer',
          id: SAMPLE_CUSTOMER,
          hash_id: true,
        });
        expect(result?.HASHED_ID).toBeDefined();
        expect(result?.HASHED_ID).not.toBe(result?.ID);
        // Hash should be consistent
        const result2 = await executeGetMasterStub(adapter, {
          entity_type: 'customer',
          id: SAMPLE_CUSTOMER,
          hash_id: true,
        });
        expect(result?.HASHED_ID).toBe(result2?.HASHED_ID);
      });

      it('should retrieve material stub', async () => {
        const result = await executeGetMasterStub(adapter, {
          entity_type: 'material',
          id: SAMPLE_MATERIAL,
        });
        expect(result).not.toBeNull();
        expect(result?.ENTITY_TYPE).toBe('material');
        expect(result?.CATEGORY).toBeDefined();
        expect(result?.MATKL).toBeDefined();
      });

      it('should return null for vendor (not in synthetic data)', async () => {
        const result = await executeGetMasterStub(adapter, {
          entity_type: 'vendor',
          id: 'VEND001',
        });
        expect(result).toBeNull();
      });

      it('should return null for non-existent entity', async () => {
        const result = await executeGetMasterStub(adapter, {
          entity_type: 'customer',
          id: 'NONEXISTENT',
        });
        expect(result).toBeNull();
      });
    });
  });
});
