/**
 * Tests for Extraction Registry core and metadata utilities
 *
 * Covers: registration, lookup, filtering, parameter validation,
 * path ID/version validation, and summary generation.
 */

import { ExtractionRegistry } from '../extraction-registry/index.js';
import {
  validatePathId,
  validateVersion,
  compareVersions,
  validatePath,
  generateRegistrySummary,
} from '../extraction-registry/metadata.js';
import type { ExtractionPath } from '../extraction-registry/types.js';

// --- Test fixtures ---

function makePath(overrides: Partial<ExtractionPath> = {}): ExtractionPath {
  return {
    id: 'sap.o2c.order-header',
    version: '1.0',
    name: 'SAP Order Header',
    description: 'Extracts sales order header data from VBAK',
    systemType: 'SAP',
    domain: 'o2c',
    queryType: 'sql',
    query: 'SELECT VBELN, ERDAT FROM VBAK WHERE ERDAT BETWEEN ? AND ?',
    parameters: [
      { name: 'date_from', type: 'date', required: true, description: 'Start date' },
      { name: 'date_to', type: 'date', required: true, description: 'End date' },
    ],
    expectedFields: [
      {
        name: 'orderNumber',
        type: 'string',
        sapFieldName: 'VBELN',
        description: 'Sales order number',
      },
      { name: 'createdDate', type: 'date', sapFieldName: 'ERDAT', description: 'Creation date' },
    ],
    ...overrides,
  };
}

function makeSfdcPath(overrides: Partial<ExtractionPath> = {}): ExtractionPath {
  return {
    id: 'sfdc.pipeline.opportunity',
    version: '1.0',
    name: 'Salesforce Opportunity',
    description: 'Extracts opportunity data via SOQL',
    systemType: 'Salesforce',
    domain: 'pipeline',
    queryType: 'soql',
    query: 'SELECT Id, Name, Amount FROM Opportunity',
    parameters: [
      { name: 'date_from', type: 'date', required: false, description: 'Earliest close date' },
    ],
    expectedFields: [
      { name: 'id', type: 'string', sfdcName: 'Id', description: 'Opportunity ID' },
      { name: 'amount', type: 'amount', sfdcName: 'Amount', description: 'Deal amount' },
    ],
    ...overrides,
  };
}

function makeNetsuitePath(overrides: Partial<ExtractionPath> = {}): ExtractionPath {
  return {
    id: 'netsuite.o2c.sales-order',
    version: '2.1',
    name: 'NetSuite Sales Order',
    description: 'Extracts sales orders via saved search',
    systemType: 'NetSuite',
    domain: 'o2c',
    queryType: 'saved-search',
    query: 'customsearch_sales_orders',
    parameters: [],
    expectedFields: [
      {
        name: 'internalId',
        type: 'string',
        netsuiteName: 'internalid',
        description: 'Internal ID',
      },
    ],
    ...overrides,
  };
}

// --- ExtractionRegistry ---

describe('ExtractionRegistry', () => {
  let registry: ExtractionRegistry;

  beforeEach(() => {
    registry = new ExtractionRegistry();
  });

  // 1. register: adds a valid path
  it('should register a valid path', () => {
    const path = makePath();
    registry.register(path);
    expect(registry.size).toBe(1);
    expect(registry.has(path.id)).toBe(true);
  });

  // 2. register: rejects duplicate ID
  it('should reject duplicate path ID', () => {
    const path = makePath();
    registry.register(path);
    expect(() => registry.register(path)).toThrow(/Duplicate path ID/);
  });

  // 3. register: rejects path with no expected fields
  it('should reject path with no expected fields', () => {
    const path = makePath({ expectedFields: [] });
    expect(() => registry.register(path)).toThrow(/at least one expected field/);
  });

  // 4. get: returns registered path
  it('should return a registered path by ID', () => {
    const path = makePath();
    registry.register(path);
    const result = registry.get(path.id);
    expect(result).toBeDefined();
    expect(result!.name).toBe('SAP Order Header');
    expect(result!.systemType).toBe('SAP');
  });

  // 5. get: returns undefined for unknown ID
  it('should return undefined for unknown ID', () => {
    expect(registry.get('nonexistent.path.id')).toBeUndefined();
  });

  // 6. list: returns all paths unfiltered
  it('should list all paths when no filter provided', () => {
    registry.register(makePath());
    registry.register(makeSfdcPath());
    registry.register(makeNetsuitePath());
    const all = registry.list();
    expect(all).toHaveLength(3);
  });

  // 7. list: filters by systemType
  it('should filter by systemType', () => {
    registry.register(makePath());
    registry.register(makeSfdcPath());
    registry.register(makeNetsuitePath());
    const sapOnly = registry.list({ systemType: 'SAP' });
    expect(sapOnly).toHaveLength(1);
    expect(sapOnly[0]!.systemType).toBe('SAP');
  });

  // 8. list: filters by domain
  it('should filter by domain', () => {
    registry.register(makePath());
    registry.register(makeSfdcPath());
    registry.register(makeNetsuitePath());
    const o2cOnly = registry.list({ domain: 'o2c' });
    expect(o2cOnly).toHaveLength(2);
    for (const p of o2cOnly) {
      expect(p.domain).toBe('o2c');
    }
  });

  // 9. list: filters by multiple criteria (AND logic)
  it('should filter by multiple criteria using AND logic', () => {
    registry.register(makePath());
    registry.register(makeSfdcPath());
    registry.register(makeNetsuitePath());
    const result = registry.list({ systemType: 'SAP', domain: 'o2c' });
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe('sap.o2c.order-header');
  });

  // 10. validateParameters: returns valid for correct params
  it('should validate correct parameters as valid', () => {
    registry.register(makePath());
    const result = registry.validateParameters('sap.o2c.order-header', {
      date_from: '2024-01-01',
      date_to: '2024-01-31',
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  // 11. validateParameters: returns errors for missing required params
  it('should return errors for missing required parameters', () => {
    registry.register(makePath());
    const result = registry.validateParameters('sap.o2c.order-header', {
      date_from: '2024-01-01',
      // date_to is missing
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Missing required parameter: date_to');
  });

  // 12. validateParameters: accepts optional params as absent
  it('should accept absent optional parameters', () => {
    registry.register(makeSfdcPath());
    const result = registry.validateParameters('sfdc.pipeline.opportunity', {});
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  // 13. getMetadata: returns correct counts and lists
  it('should return correct metadata', () => {
    registry.register(makePath());
    registry.register(makeSfdcPath());

    const meta = registry.getMetadata();
    expect(meta.pathCount).toBe(2);
    expect(meta.registryVersion).toBe('1.0');
    expect(meta.domains).toContain('o2c');
    expect(meta.domains).toContain('pipeline');
    expect(meta.systems).toContain('SAP');
    expect(meta.systems).toContain('Salesforce');
    expect(meta.lastUpdated).toBeDefined();
  });
});

// --- metadata utilities ---

describe('Metadata utilities', () => {
  // 14. validatePathId: accepts valid IDs, rejects invalid
  describe('validatePathId', () => {
    it('should accept valid path IDs', () => {
      expect(validatePathId('sap.o2c.order-header').valid).toBe(true);
      expect(validatePathId('sfdc.pipeline.opportunity').valid).toBe(true);
      expect(validatePathId('netsuite.fi-co.journal').valid).toBe(true);
    });

    it('should reject IDs with wrong number of segments', () => {
      expect(validatePathId('sap.o2c').valid).toBe(false);
      expect(validatePathId('sap.o2c.order.extra').valid).toBe(false);
      expect(validatePathId('single').valid).toBe(false);
    });

    it('should reject IDs with uppercase', () => {
      expect(validatePathId('SAP.o2c.order').valid).toBe(false);
    });

    it('should reject IDs with numbers in system segment', () => {
      expect(validatePathId('sap1.o2c.order').valid).toBe(false);
    });

    it('should reject empty string', () => {
      expect(validatePathId('').valid).toBe(false);
    });
  });

  // 15. validateVersion: accepts "1.0", rejects "abc"
  describe('validateVersion', () => {
    it('should accept valid versions', () => {
      expect(validateVersion('1.0').valid).toBe(true);
      expect(validateVersion('2.1').valid).toBe(true);
      expect(validateVersion('1.0.0').valid).toBe(true);
      expect(validateVersion('10.20.30').valid).toBe(true);
    });

    it('should reject invalid versions', () => {
      expect(validateVersion('abc').valid).toBe(false);
      expect(validateVersion('1').valid).toBe(false);
      expect(validateVersion('').valid).toBe(false);
      expect(validateVersion('v1.0').valid).toBe(false);
    });
  });

  // 16. compareVersions: correctly orders versions
  describe('compareVersions', () => {
    it('should return 0 for equal versions', () => {
      expect(compareVersions('1.0', '1.0')).toBe(0);
      expect(compareVersions('2.3.4', '2.3.4')).toBe(0);
    });

    it('should return 1 when a > b', () => {
      expect(compareVersions('2.0', '1.0')).toBe(1);
      expect(compareVersions('1.1', '1.0')).toBe(1);
      expect(compareVersions('1.0.1', '1.0.0')).toBe(1);
    });

    it('should return -1 when a < b', () => {
      expect(compareVersions('1.0', '2.0')).toBe(-1);
      expect(compareVersions('1.0', '1.1')).toBe(-1);
      expect(compareVersions('1.0.0', '1.0.1')).toBe(-1);
    });

    it('should handle mixed segment counts', () => {
      expect(compareVersions('1.0', '1.0.0')).toBe(0);
      expect(compareVersions('1.0', '1.0.1')).toBe(-1);
    });
  });

  // 17. validatePath: catches all validation errors
  describe('validatePath', () => {
    it('should accept a fully valid path', () => {
      const result = validatePath(makePath());
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should catch invalid ID', () => {
      const result = validatePath(makePath({ id: 'BAD-ID' }));
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('3 parts'))).toBe(true);
    });

    it('should catch invalid version', () => {
      const result = validatePath(makePath({ version: 'nope' }));
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('major.minor'))).toBe(true);
    });

    it('should catch empty query', () => {
      const result = validatePath(makePath({ query: '' }));
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Query'))).toBe(true);
    });

    it('should catch missing expected fields', () => {
      const result = validatePath(makePath({ expectedFields: [] }));
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('at least one expected field'))).toBe(true);
    });

    it('should catch duplicate parameter names', () => {
      const result = validatePath(
        makePath({
          parameters: [
            { name: 'date_from', type: 'date', required: true, description: 'Start' },
            { name: 'date_from', type: 'date', required: true, description: 'Also start' },
          ],
        })
      );
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Duplicate parameter'))).toBe(true);
    });

    it('should catch duplicate field names', () => {
      const result = validatePath(
        makePath({
          expectedFields: [
            { name: 'orderNumber', type: 'string', description: 'Order num' },
            { name: 'orderNumber', type: 'string', description: 'Dup order num' },
          ],
        })
      );
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Duplicate field'))).toBe(true);
    });

    it('should accumulate multiple errors', () => {
      const result = validatePath(
        makePath({ id: 'BAD', version: 'nope', query: '', expectedFields: [] })
      );
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThanOrEqual(4);
    });
  });

  // 18. generateRegistrySummary: correct aggregation
  describe('generateRegistrySummary', () => {
    it('should aggregate paths correctly', () => {
      const pathWithTest = makePath({
        testData: {
          inputParams: { date_from: '2024-01-01', date_to: '2024-01-31' },
          expectedRowCount: 10,
        },
      });
      const paths = [pathWithTest, makeSfdcPath(), makeNetsuitePath()];
      const summary = generateRegistrySummary(paths);

      expect(summary.totalPaths).toBe(3);
      expect(summary.bySystem['SAP']).toBe(1);
      expect(summary.bySystem['Salesforce']).toBe(1);
      expect(summary.bySystem['NetSuite']).toBe(1);
      expect(summary.byDomain['o2c']).toBe(2);
      expect(summary.byDomain['pipeline']).toBe(1);
      expect(summary.byQueryType['sql']).toBe(1);
      expect(summary.byQueryType['soql']).toBe(1);
      expect(summary.byQueryType['saved-search']).toBe(1);
      expect(summary.withTestData).toBe(1);
    });

    it('should handle empty array', () => {
      const summary = generateRegistrySummary([]);
      expect(summary.totalPaths).toBe(0);
      expect(summary.withTestData).toBe(0);
      expect(Object.keys(summary.bySystem)).toHaveLength(0);
    });
  });
});
