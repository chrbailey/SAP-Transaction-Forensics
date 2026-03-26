/**
 * Integration tests for SFDCSyntheticAdapter
 *
 * Loads the actual synthetic data from synthetic-data/sfdc_output/ and verifies
 * all 8 IDataAdapter methods return correct shapes and values.
 */

import { SFDCSyntheticAdapter } from '../index.js';

// Concrete IDs from the synthetic dataset
const OPP_CLOSED_LOST = '006000000000000001'; // stage: Closed Lost, is_closed: true, is_won: false
const OPP_CLOSED_WON = '006000000000000010';  // stage: Closed Won,  is_closed: true, is_won: true
const ACCOUNT_ID = '001000000000000001';
const NONEXISTENT = '999999999999999999';

describe('SFDCSyntheticAdapter', () => {
  let adapter: SFDCSyntheticAdapter;

  beforeAll(async () => {
    adapter = new SFDCSyntheticAdapter();
    await adapter.initialize();
  });

  afterAll(async () => {
    await adapter.shutdown();
  });

  // --------------------------------------------------------------------------
  // Lifecycle
  // --------------------------------------------------------------------------

  it('has name sfdc', () => {
    expect(adapter.name).toBe('sfdc');
  });

  it('is ready after initialize', () => {
    expect(adapter.isReady()).toBe(true);
  });

  // --------------------------------------------------------------------------
  // Tool 4: getSalesDocHeader
  // --------------------------------------------------------------------------

  describe('getSalesDocHeader', () => {
    it('returns header for valid opportunity id', async () => {
      const header = await adapter.getSalesDocHeader({ vbeln: OPP_CLOSED_LOST });
      expect(header).not.toBeNull();
      expect(header!.VBELN).toHaveLength(10);
      expect(header!.VKORG).toBe('SFDC');
      expect(header!.AUDAT).toMatch(/^\d{8}$/);
    });

    it('returns header when queried by padded VBELN', async () => {
      const padded = OPP_CLOSED_LOST.slice(0, 10);
      const header = await adapter.getSalesDocHeader({ vbeln: padded });
      expect(header).not.toBeNull();
    });

    it('returns null for nonexistent id', async () => {
      const header = await adapter.getSalesDocHeader({ vbeln: NONEXISTENT });
      expect(header).toBeNull();
    });
  });

  // --------------------------------------------------------------------------
  // Tool 5: getSalesDocItems
  // --------------------------------------------------------------------------

  describe('getSalesDocItems', () => {
    it('returns items with POSNR and NETWR > 0', async () => {
      const items = await adapter.getSalesDocItems({ vbeln: OPP_CLOSED_LOST });
      expect(items.length).toBeGreaterThan(0);
      for (const item of items) {
        expect(item.POSNR).toHaveLength(6);
        expect(item.NETWR).toBeGreaterThan(0);
        expect(item.VBELN).toHaveLength(10);
        expect(item.MATNR).toHaveLength(18);
      }
    });

    it('returns empty array for nonexistent id', async () => {
      const items = await adapter.getSalesDocItems({ vbeln: NONEXISTENT });
      expect(items).toEqual([]);
    });
  });

  // --------------------------------------------------------------------------
  // Tool 3: getDocFlow
  // --------------------------------------------------------------------------

  describe('getDocFlow', () => {
    it('returns stage history with root_document set', async () => {
      const flow = await adapter.getDocFlow({ vbeln: OPP_CLOSED_LOST });
      expect(flow.root_document).toHaveLength(10);
      expect(flow.flow.length).toBeGreaterThan(0);
    });

    it('flow entries have expected shape', async () => {
      const flow = await adapter.getDocFlow({ vbeln: OPP_CLOSED_LOST });
      const entry = flow.flow[0];
      expect(entry.doc_type).toBe('SFDC_STAGE');
      expect(entry.created_date).toMatch(/^\d{8}$/);
      expect(typeof entry.doc_category).toBe('string');
    });

    it('returns empty flow for nonexistent id', async () => {
      const flow = await adapter.getDocFlow({ vbeln: NONEXISTENT });
      expect(flow.flow).toEqual([]);
    });
  });

  // --------------------------------------------------------------------------
  // Tool 2: getDocText
  // --------------------------------------------------------------------------

  describe('getDocText', () => {
    it('returns defined result with header_texts array', async () => {
      const result = await adapter.getDocText({ doc_type: 'sales', doc_key: OPP_CLOSED_LOST });
      expect(result).toBeDefined();
      expect(Array.isArray(result.header_texts)).toBe(true);
      expect(Array.isArray(result.item_texts)).toBe(true);
    });

    it('header_texts have text_id, lang, and text fields', async () => {
      const result = await adapter.getDocText({ doc_type: 'sales', doc_key: OPP_CLOSED_LOST });
      expect(result.header_texts.length).toBeGreaterThan(0);
      for (const t of result.header_texts) {
        expect(t.text_id).toBeDefined();
        expect(t.lang).toBe('EN');
        expect(typeof t.text).toBe('string');
      }
    });

    it('returns empty texts for nonexistent id', async () => {
      const result = await adapter.getDocText({ doc_type: 'sales', doc_key: NONEXISTENT });
      expect(result.header_texts).toEqual([]);
      expect(result.item_texts).toEqual([]);
    });
  });

  // --------------------------------------------------------------------------
  // Tool 1: searchDocText
  // --------------------------------------------------------------------------

  describe('searchDocText', () => {
    it('finds results matching a common word', async () => {
      const results = await adapter.searchDocText({ pattern: 'meeting', limit: 10 });
      expect(results.length).toBeGreaterThan(0);
    });

    it('respects max_results limit', async () => {
      const results = await adapter.searchDocText({ pattern: '.*', limit: 3 });
      expect(results.length).toBeLessThanOrEqual(3);
    });

    it('returns SearchResult with correct shape', async () => {
      const results = await adapter.searchDocText({ pattern: 'call', limit: 5 });
      expect(results.length).toBeGreaterThan(0);
      const r = results[0];
      expect(r.doc_type).toBe('sales');
      expect(typeof r.doc_key).toBe('string');
      expect(typeof r.snippet).toBe('string');
      expect(typeof r.match_score).toBe('number');
      expect(r.dates.created).toBeDefined();
      expect(r.org_keys.VKORG).toBe('SFDC');
    });

    it('returns empty array for no matches', async () => {
      const results = await adapter.searchDocText({ pattern: 'zzz_no_match_zzz' });
      expect(results).toEqual([]);
    });

    it('throws on invalid regex', async () => {
      await expect(adapter.searchDocText({ pattern: '[invalid' })).rejects.toThrow();
    });
  });

  // --------------------------------------------------------------------------
  // Tool 8: getMasterStub
  // --------------------------------------------------------------------------

  describe('getMasterStub', () => {
    it('returns account data for customer type', async () => {
      const stub = await adapter.getMasterStub({ entity_type: 'customer', id: ACCOUNT_ID });
      expect(stub).not.toBeNull();
      expect(stub!.ENTITY_TYPE).toBe('customer');
      expect(stub!.ID).toBe(ACCOUNT_ID);
      expect(typeof stub!.INDUSTRY).toBe('string');
    });

    it('returns material stub for material type', async () => {
      const stub = await adapter.getMasterStub({ entity_type: 'material', id: '01t000000000000001' });
      expect(stub).not.toBeNull();
      expect(stub!.ENTITY_TYPE).toBe('material');
    });

    it('returns null for vendor type', async () => {
      const stub = await adapter.getMasterStub({ entity_type: 'vendor', id: 'any' });
      expect(stub).toBeNull();
    });

    it('returns null for nonexistent customer', async () => {
      const stub = await adapter.getMasterStub({ entity_type: 'customer', id: NONEXISTENT });
      expect(stub).toBeNull();
    });
  });

  // --------------------------------------------------------------------------
  // Tool 6: getDeliveryTiming
  // --------------------------------------------------------------------------

  describe('getDeliveryTiming', () => {
    it('returns timing for closed opportunity', async () => {
      const timing = await adapter.getDeliveryTiming({ vbeln: OPP_CLOSED_LOST });
      expect(timing).not.toBeNull();
      expect(timing!.delivery_number).toHaveLength(10);
      expect(timing!.header_timing.requested_date).toMatch(/^\d{8}$/);
    });

    it('includes item_timing entries', async () => {
      const timing = await adapter.getDeliveryTiming({ vbeln: OPP_CLOSED_LOST });
      expect(timing).not.toBeNull();
      expect(Array.isArray(timing!.item_timing)).toBe(true);
      expect(timing!.item_timing.length).toBeGreaterThan(0);
    });

    it('returns null for nonexistent id', async () => {
      const timing = await adapter.getDeliveryTiming({ vbeln: NONEXISTENT });
      expect(timing).toBeNull();
    });
  });

  // --------------------------------------------------------------------------
  // Tool 7: getInvoiceTiming
  // --------------------------------------------------------------------------

  describe('getInvoiceTiming', () => {
    it('returns timing for won opportunity', async () => {
      const timing = await adapter.getInvoiceTiming({ vbeln: OPP_CLOSED_WON });
      expect(timing).not.toBeNull();
      expect(timing!.invoice_number).toHaveLength(10);
      expect(timing!.billing_date).toMatch(/^\d{8}$/);
      expect(timing!.created_date).toMatch(/^\d{8}$/);
    });

    it('returns null for closed-lost opportunity', async () => {
      const timing = await adapter.getInvoiceTiming({ vbeln: OPP_CLOSED_LOST });
      expect(timing).toBeNull();
    });

    it('returns null for nonexistent id', async () => {
      const timing = await adapter.getInvoiceTiming({ vbeln: NONEXISTENT });
      expect(timing).toBeNull();
    });
  });
});
