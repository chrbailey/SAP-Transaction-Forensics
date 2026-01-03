/**
 * Tests for SALT Adapter Schema Mapper
 *
 * Tests the mapping from SALT dataset fields to our internal SAP types.
 * Note: Full adapter tests require the SALT dataset to be downloaded.
 */

import { describe, it, expect } from '@jest/globals';

import {
  mapSaltToSalesDocHeader,
  mapSaltToSalesDocItem,
  mapSaltToCustomerStub,
  generateDocFlowFromSalt,
  calculateSaltStats,
  type SaltSalesDocument,
  type SaltSalesDocumentItem,
  type SaltCustomer,
  type SaltAddress,
} from '../adapters/salt/schema-mapper.js';

describe('SALT Schema Mapper', () => {
  describe('mapSaltToSalesDocHeader', () => {
    it('should map SALT sales document to SalesDocHeader', () => {
      const saltDoc: SaltSalesDocument = {
        SALESDOCUMENT: '12345',
        SALESDOCUMENTTYPE: 'OR',
        SALESORGANIZATION: '1000',
        DISTRIBUTIONCHANNEL: '10',
        DIVISION: '00',
        SOLDTOPARTY: '100001',
        CREATIONDATE: '2024-01-15',
        CREATEDBYUSER: 'TESTUSER',
        TRANSACTIONCURRENCY: 'USD',
        REQUESTEDDELIVERYDATE: '2024-01-20',
      };

      const result = mapSaltToSalesDocHeader(saltDoc);

      expect(result.VBELN).toBe('0000012345');
      expect(result.AUART).toBe('OR');
      expect(result.VKORG).toBe('1000');
      expect(result.VTWEG).toBe('10');
      expect(result.SPART).toBe('00');
      expect(result.KUNNR).toBe('0000100001');
      expect(result.ERNAM).toBe('TESTUSER');
      expect(result.WAERK).toBe('USD');
      expect(result.VDATU).toBe('20240120');
    });

    it('should pad document number to 10 characters', () => {
      const saltDoc: SaltSalesDocument = {
        SALESDOCUMENT: '1',
      };

      const result = mapSaltToSalesDocHeader(saltDoc);
      expect(result.VBELN).toBe('0000000001');
    });

    it('should handle missing fields with defaults', () => {
      const saltDoc: SaltSalesDocument = {};

      const result = mapSaltToSalesDocHeader(saltDoc);

      expect(result.VBELN).toBe('0000000000');
      expect(result.AUART).toBe('OR');
      expect(result.ERNAM).toBe('UNKNOWN');
      expect(result.WAERK).toBe('USD');
    });

    it('should format date from YYYY-MM-DD to YYYYMMDD', () => {
      const saltDoc: SaltSalesDocument = {
        CREATIONDATE: '2024-03-15',
      };

      const result = mapSaltToSalesDocHeader(saltDoc);
      expect(result.ERDAT).toBe('20240315');
    });

    it('should handle already formatted dates', () => {
      const saltDoc: SaltSalesDocument = {
        CREATIONDATE: '20240315',
      };

      const result = mapSaltToSalesDocHeader(saltDoc);
      expect(result.ERDAT).toBe('20240315');
    });
  });

  describe('mapSaltToSalesDocItem', () => {
    it('should map SALT sales document item to SalesDocItem', () => {
      const saltItem: SaltSalesDocumentItem = {
        SALESDOCUMENT: '12345',
        SALESDOCUMENTITEM: '10',
        MATERIAL: 'MAT001',
        PLANT: '1000',
        REQUESTEDQUANTITY: 100,
        REQUESTEDQUANTITYUNIT: 'EA',
        NETAMOUNT: 5000,
        TRANSACTIONCURRENCY: 'EUR',
        ITEMCATEGORY: 'TAN',
      };

      const result = mapSaltToSalesDocItem(saltItem);

      expect(result.VBELN).toBe('0000012345');
      expect(result.POSNR).toBe('000010');
      expect(result.MATNR).toBe('MAT001');
      expect(result.WERKS).toBe('1000');
      expect(result.KWMENG).toBe(100);
      expect(result.VRKME).toBe('EA');
      expect(result.NETWR).toBe(5000);
      expect(result.WAERK).toBe('EUR');
      expect(result.PSTYV).toBe('TAN');
    });

    it('should pad item number to 6 characters', () => {
      const saltItem: SaltSalesDocumentItem = {
        SALESDOCUMENTITEM: '1',
      };

      const result = mapSaltToSalesDocItem(saltItem);
      expect(result.POSNR).toBe('000001');
    });

    it('should handle missing quantity with 0', () => {
      const saltItem: SaltSalesDocumentItem = {};

      const result = mapSaltToSalesDocItem(saltItem);
      expect(result.KWMENG).toBe(0);
      expect(result.NETWR).toBe(0);
    });
  });

  describe('mapSaltToCustomerStub', () => {
    it('should map SALT customer to MasterStub', () => {
      const saltCustomer: SaltCustomer = {
        CUSTOMER: '100001',
        CUSTOMERNAME: 'Test Customer',
        CUSTOMERACCOUNTGROUP: 'SOLD',
        COUNTRY: 'US',
        REGION: 'CA',
        INDUSTRY: 'TECH',
        CREATIONDATE: '2023-01-01',
      };

      const result = mapSaltToCustomerStub(saltCustomer);

      expect(result.ENTITY_TYPE).toBe('customer');
      expect(result.ID).toBe('0000100001');
      expect(result.REGION).toBe('CA');
      expect(result.INDUSTRY).toBe('TECH');
      expect(result.CATEGORY).toBe('SOLD');
      expect(result.KTOKD).toBe('SOLD');
    });

    it('should use country as region fallback', () => {
      const saltCustomer: SaltCustomer = {
        CUSTOMER: '100001',
        COUNTRY: 'DE',
      };

      const result = mapSaltToCustomerStub(saltCustomer);
      expect(result.REGION).toBe('DE');
    });
  });

  describe('generateDocFlowFromSalt', () => {
    it('should generate self-referencing doc flows for sales orders', () => {
      const salesDocs: SaltSalesDocument[] = [
        { SALESDOCUMENT: '12345', CREATIONDATE: '2024-01-15' },
        { SALESDOCUMENT: '12346', CREATIONDATE: '2024-01-16' },
      ];

      const result = generateDocFlowFromSalt(salesDocs, []);

      expect(result).toHaveLength(2);
      const first = result[0]!;
      expect(first.preceding_doc).toBe('0000012345');
      expect(first.subsequent_doc).toBe('0000012345');
      expect(first.preceding_category).toBe('C');
      expect(first.subsequent_category).toBe('C');
    });

    it('should handle empty input', () => {
      const result = generateDocFlowFromSalt([], []);
      expect(result).toHaveLength(0);
    });
  });

  describe('calculateSaltStats', () => {
    it('should calculate dataset statistics', () => {
      const salesDocs: SaltSalesDocument[] = [
        { SALESDOCUMENT: '1', SALESORGANIZATION: '1000', CREATIONDATE: '2024-01-01' },
        { SALESDOCUMENT: '2', SALESORGANIZATION: '1000', CREATIONDATE: '2024-01-15' },
        { SALESDOCUMENT: '3', SALESORGANIZATION: '2000', CREATIONDATE: '2024-01-10' },
      ];

      const items: SaltSalesDocumentItem[] = [
        { SALESDOCUMENT: '1', PLANT: 'P100' },
        { SALESDOCUMENT: '2', PLANT: 'P100' },
        { SALESDOCUMENT: '3', PLANT: 'P200' },
      ];

      const customers: SaltCustomer[] = [{ CUSTOMER: '100001' }, { CUSTOMER: '100002' }];

      const addresses: SaltAddress[] = [{ ADDRESSID: 'A1' }];

      const result = calculateSaltStats(salesDocs, items, customers, addresses);

      expect(result.salesDocuments).toBe(3);
      expect(result.salesDocumentItems).toBe(3);
      expect(result.customers).toBe(2);
      expect(result.addresses).toBe(1);
      expect(result.uniqueSalesOrgs).toBe(2);
      expect(result.uniquePlants).toBe(2);
      expect(result.dateRange.earliest).toBe('2024-01-01');
      expect(result.dateRange.latest).toBe('2024-01-15');
    });

    it('should handle empty data', () => {
      const result = calculateSaltStats([], [], [], []);

      expect(result.salesDocuments).toBe(0);
      expect(result.uniqueSalesOrgs).toBe(0);
      expect(result.dateRange.earliest).toBe('N/A');
      expect(result.dateRange.latest).toBe('N/A');
    });
  });
});

describe('SALT Adapter', () => {
  // Note: These tests require the SALT dataset to be downloaded
  // They are skipped by default and can be enabled when testing locally

  describe('SaltAdapter (requires data)', () => {
    it.skip('should initialize with downloaded data', async () => {
      // This test requires: python scripts/download-salt.py
      const { SaltAdapter } = await import('../adapters/salt/index.js');
      const adapter = new SaltAdapter();

      await adapter.initialize();
      expect(adapter.isReady()).toBe(true);

      const stats = adapter.getStats();
      expect(stats).not.toBeNull();
      expect(stats!.salesDocuments).toBeGreaterThan(0);

      await adapter.shutdown();
    });

    it.skip('should return sales document headers', async () => {
      const { SaltAdapter } = await import('../adapters/salt/index.js');
      const adapter = new SaltAdapter();
      await adapter.initialize();

      const docNumbers = adapter.getAllSalesDocNumbers();
      expect(docNumbers.length).toBeGreaterThan(0);

      const firstDoc = docNumbers[0]!;
      const header = await adapter.getSalesDocHeader({ vbeln: firstDoc });
      expect(header).not.toBeNull();
      expect(header!.VBELN).toBe(firstDoc);

      await adapter.shutdown();
    });

    it.skip('should return sales document items', async () => {
      const { SaltAdapter } = await import('../adapters/salt/index.js');
      const adapter = new SaltAdapter();
      await adapter.initialize();

      const docNumbers = adapter.getAllSalesDocNumbers();
      const firstDoc = docNumbers[0]!;
      const items = await adapter.getSalesDocItems({ vbeln: firstDoc });

      expect(Array.isArray(items)).toBe(true);

      await adapter.shutdown();
    });

    it.skip('should search documents', async () => {
      const { SaltAdapter } = await import('../adapters/salt/index.js');
      const adapter = new SaltAdapter();
      await adapter.initialize();

      const results = await adapter.searchDocText({
        pattern: '.*',
        limit: 10,
      });

      expect(results.length).toBeLessThanOrEqual(10);

      await adapter.shutdown();
    });
  });
});
