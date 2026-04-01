/**
 * Tests for SAP O2C Extraction Paths
 *
 * Validates the five deterministic extraction path definitions for the
 * SAP Order-to-Cash process: order header, order items, document flow,
 * delivery timing, and invoice timing.
 */

import { SAP_O2C_PATHS } from '../extraction-registry/sap/o2c.js';
import type { ExtractionPath } from '../extraction-registry/types.js';

// Helper: find a path by ID suffix
function findPath(suffix: string): ExtractionPath {
  const path = SAP_O2C_PATHS.find(p => p.id === `sap.o2c.${suffix}`);
  if (!path) throw new Error(`Path sap.o2c.${suffix} not found`);
  return path;
}

// Helper: extract field names from a SELECT clause (handles aliases like L.ERDAT AS LIKP_ERDAT)
function extractSelectFields(query: string): string[] {
  const selectMatch = query.match(/SELECT\s+(.+?)\s+FROM/i);
  if (!selectMatch) return [];
  const selectClause = selectMatch[1]!;
  return selectClause.split(',').map(part => {
    const trimmed = part.trim();
    // Handle "X AS Y" aliases — the expected field name is Y
    const asMatch = trimmed.match(/\bAS\s+(\w+)$/i);
    if (asMatch) return asMatch[1]!;
    // Handle "T.FIELD" table-qualified names — the expected field name is FIELD
    const dotMatch = trimmed.match(/\.(\w+)$/);
    if (dotMatch) return dotMatch[1]!;
    // Plain field name
    return trimmed;
  });
}

// ============================================================================
// Structural tests — apply to all 5 paths
// ============================================================================

describe('SAP O2C Extraction Paths — structural', () => {
  test('exports exactly 5 paths', () => {
    expect(SAP_O2C_PATHS).toHaveLength(5);
  });

  test('all paths have valid IDs starting with sap.o2c.', () => {
    for (const path of SAP_O2C_PATHS) {
      expect(path.id).toMatch(/^sap\.o2c\./);
    }
  });

  test('all paths have version 1.0', () => {
    for (const path of SAP_O2C_PATHS) {
      expect(path.version).toBe('1.0');
    }
  });

  test('all paths have systemType SAP and domain o2c', () => {
    for (const path of SAP_O2C_PATHS) {
      expect(path.systemType).toBe('SAP');
      expect(path.domain).toBe('o2c');
    }
  });

  test('all paths have queryType sql', () => {
    for (const path of SAP_O2C_PATHS) {
      expect(path.queryType).toBe('sql');
    }
  });

  test('all paths have non-empty query strings', () => {
    for (const path of SAP_O2C_PATHS) {
      expect(path.query.length).toBeGreaterThan(0);
      expect(path.query).toMatch(/^SELECT/i);
    }
  });

  test('all paths have at least one required parameter', () => {
    for (const path of SAP_O2C_PATHS) {
      const requiredParams = path.parameters.filter(p => p.required);
      expect(requiredParams.length).toBeGreaterThanOrEqual(1);
    }
  });

  test('all paths have non-empty expectedFields', () => {
    for (const path of SAP_O2C_PATHS) {
      expect(path.expectedFields.length).toBeGreaterThan(0);
    }
  });

  test('all paths have a name and description', () => {
    for (const path of SAP_O2C_PATHS) {
      expect(path.name.length).toBeGreaterThan(0);
      expect(path.description.length).toBeGreaterThan(0);
    }
  });
});

// ============================================================================
// Query content — each path references the correct SAP tables
// ============================================================================

describe('SAP O2C Extraction Paths — query content', () => {
  test('order-header query references VBAK', () => {
    const path = findPath('order-header');
    expect(path.query).toContain('VBAK');
  });

  test('order-items query references VBAP', () => {
    const path = findPath('order-items');
    expect(path.query).toContain('VBAP');
  });

  test('document-flow query references VBFA', () => {
    const path = findPath('document-flow');
    expect(path.query).toContain('VBFA');
  });

  test('delivery-timing query references LIKP and LIPS', () => {
    const path = findPath('delivery-timing');
    expect(path.query).toContain('LIKP');
    expect(path.query).toContain('LIPS');
  });

  test('invoice-timing query references VBRK and VBRP', () => {
    const path = findPath('invoice-timing');
    expect(path.query).toContain('VBRK');
    expect(path.query).toContain('VBRP');
  });
});

// ============================================================================
// Expected fields match SELECT clause
// ============================================================================

describe('SAP O2C Extraction Paths — field alignment', () => {
  test.each([
    'order-header',
    'order-items',
    'document-flow',
    'delivery-timing',
    'invoice-timing',
  ])('%s: expectedFields match SELECT clause fields', (suffix) => {
    const path = findPath(suffix);
    const selectFields = extractSelectFields(path.query);
    const expectedFieldNames = path.expectedFields.map(f => f.name);

    // Every SELECT field should have a matching expectedField
    for (const field of selectFields) {
      expect(expectedFieldNames).toContain(field);
    }
    // And every expectedField should appear in SELECT
    for (const fieldName of expectedFieldNames) {
      expect(selectFields).toContain(fieldName);
    }
  });
});

// ============================================================================
// Field type correctness
// ============================================================================

describe('SAP O2C Extraction Paths — field types', () => {
  test('amount fields (NETWR, RFWRT, ITEM_NETWR) have type amount', () => {
    const amountFieldNames = ['NETWR', 'RFWRT', 'ITEM_NETWR'];
    for (const path of SAP_O2C_PATHS) {
      for (const field of path.expectedFields) {
        if (amountFieldNames.includes(field.name)) {
          expect(field.type).toBe('amount');
        }
      }
    }
  });

  test('date fields (ERDAT, FKDAT, LFDAT, WADAT, WADAT_IST, LIKP_ERDAT, VBRK_ERDAT) have type date', () => {
    const dateFieldNames = [
      'ERDAT', 'FKDAT', 'LFDAT', 'WADAT', 'WADAT_IST',
      'LIKP_ERDAT', 'VBRK_ERDAT',
    ];
    for (const path of SAP_O2C_PATHS) {
      for (const field of path.expectedFields) {
        if (dateFieldNames.includes(field.name)) {
          expect(field.type).toBe('date');
        }
      }
    }
  });

  test('quantity fields (KWMENG, RFMNG, LFIMG, FKIMG) have type number', () => {
    const numberFieldNames = ['KWMENG', 'RFMNG', 'LFIMG', 'FKIMG'];
    for (const path of SAP_O2C_PATHS) {
      for (const field of path.expectedFields) {
        if (numberFieldNames.includes(field.name)) {
          expect(field.type).toBe('number');
        }
      }
    }
  });

  test('all field types are valid', () => {
    const validTypes = ['string', 'number', 'date', 'amount', 'boolean'];
    for (const path of SAP_O2C_PATHS) {
      for (const field of path.expectedFields) {
        expect(validTypes).toContain(field.type);
      }
    }
  });
});

// ============================================================================
// SAP field name mapping
// ============================================================================

describe('SAP O2C Extraction Paths — SAP field names', () => {
  test('all expectedFields have sapFieldName set', () => {
    for (const path of SAP_O2C_PATHS) {
      for (const field of path.expectedFields) {
        expect(field.sapFieldName).toBeDefined();
        expect(field.sapFieldName!.length).toBeGreaterThan(0);
      }
    }
  });

  test('VBTYP_N description includes document category codes', () => {
    const path = findPath('document-flow');
    const vbtypField = path.expectedFields.find(f => f.name === 'VBTYP_N');
    expect(vbtypField).toBeDefined();
    expect(vbtypField!.description).toContain('C=Order');
    expect(vbtypField!.description).toContain('J=Delivery');
    expect(vbtypField!.description).toContain('M=Invoice');
  });
});
