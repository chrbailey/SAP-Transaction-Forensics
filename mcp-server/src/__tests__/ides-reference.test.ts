/**
 * IDES Reference Schema Tests
 *
 * Validates the hardcoded IDES reference schema: table counts, field
 * coverage, extraction path alignment, and public API contracts.
 */

import {
  buildIDESReferenceSchema,
  getReferenceTableNames,
  getReferenceFields,
  getReferenceStats,
} from '../schema-validator/ides-reference.js';
import { SAP_O2C_PATHS } from '../extraction-registry/sap/o2c.js';
import { SAP_FICO_PATHS } from '../extraction-registry/sap/fi-co.js';
import { SAP_P2P_PATHS } from '../extraction-registry/sap/p2p.js';
import type { ExtractionPath } from '../extraction-registry/types.js';

// ============================================================================
// Helpers
// ============================================================================

/**
 * Extract the SAP field names that an extraction path queries.
 * Handles table-qualified names (L.ERDAT), aliases (L.ERDAT AS LIKP_ERDAT),
 * and aggregates (SUM(CASE...)). For aliased fields, returns the sapFieldName
 * from the expectedFields list since the alias is just a query rename.
 */
function extractPathFieldNames(path: ExtractionPath): Map<string, string[]> {
  const tableFields = new Map<string, string[]>();

  for (const field of path.expectedFields) {
    const sapField = field.sapFieldName;
    if (!sapField) continue; // computed / aggregate fields

    // Determine which table this field belongs to from the query context
    // We'll collect unique SAP field names grouped by table
    // For now, just collect all sapFieldNames — we'll check per-table below
  }

  return tableFields;
}

/**
 * Given an extraction path, return the set of unique SAP field names
 * that appear in expectedFields.
 */
function getExpectedSapFields(path: ExtractionPath): string[] {
  return path.expectedFields
    .filter(f => f.sapFieldName != null)
    .map(f => f.sapFieldName!)
    .filter((v, i, a) => a.indexOf(v) === i); // unique
}

/**
 * Valid SAP data types from the IDES Data Dictionary
 */
const VALID_DATA_TYPES = new Set([
  'CHAR', 'CLNT', 'CUKY', 'CURR', 'DATS', 'DEC', 'INT4', 'LANG',
  'NUMC', 'QUAN', 'TIMS', 'UNIT', 'ACCP', 'RAW',
]);

// ============================================================================
// 1. Schema Structure
// ============================================================================

describe('IDES Reference Schema — structure', () => {
  const schema = buildIDESReferenceSchema();

  test('buildIDESReferenceSchema returns at least 18 tables', () => {
    expect(schema.size).toBeGreaterThanOrEqual(18);
  });

  test('schema contains exactly 19 tables', () => {
    expect(schema.size).toBe(19);
  });

  test('all expected O2C tables are present', () => {
    const o2c = ['VBAK', 'VBAP', 'VBFA', 'LIKP', 'LIPS', 'VBRK', 'VBRP'];
    for (const table of o2c) {
      expect(schema.has(table)).toBe(true);
    }
  });

  test('all expected FI/CO tables are present', () => {
    const fico = ['BKPF', 'BSEG', 'SKA1'];
    for (const table of fico) {
      expect(schema.has(table)).toBe(true);
    }
  });

  test('all expected P2P tables are present', () => {
    const p2p = ['EKKO', 'EKPO', 'EBAN', 'EKBE', 'RBKP', 'RSEG'];
    for (const table of p2p) {
      expect(schema.has(table)).toBe(true);
    }
  });

  test('all expected master data tables are present', () => {
    const master = ['KNA1', 'LFA1', 'MARA'];
    for (const table of master) {
      expect(schema.has(table)).toBe(true);
    }
  });
});

// ============================================================================
// 2. VBAK field coverage
// ============================================================================

describe('IDES Reference Schema — VBAK fields', () => {
  const schema = buildIDESReferenceSchema();
  const vbak = schema.get('VBAK')!;

  test('VBAK exists and has fields', () => {
    expect(vbak).toBeDefined();
    expect(vbak.fields.length).toBeGreaterThan(0);
  });

  test('VBAK has VBELN field', () => {
    expect(vbak.fields.some(f => f.name === 'VBELN')).toBe(true);
  });

  test('VBAK has AUART field', () => {
    expect(vbak.fields.some(f => f.name === 'AUART')).toBe(true);
  });

  test('VBAK has ERDAT field', () => {
    expect(vbak.fields.some(f => f.name === 'ERDAT')).toBe(true);
  });

  test('VBAK has NETWR field', () => {
    expect(vbak.fields.some(f => f.name === 'NETWR')).toBe(true);
  });

  test('VBAK NETWR is a currency type', () => {
    const netwr = vbak.fields.find(f => f.name === 'NETWR')!;
    expect(netwr.dataType).toBe('CURR');
    expect(netwr.decimals).toBe(2);
  });

  test('VBAK VBELN is CHAR(10)', () => {
    const vbeln = vbak.fields.find(f => f.name === 'VBELN')!;
    expect(vbeln.dataType).toBe('CHAR');
    expect(vbeln.length).toBe(10);
  });
});

// ============================================================================
// 3. BKPF field coverage
// ============================================================================

describe('IDES Reference Schema — BKPF fields', () => {
  const schema = buildIDESReferenceSchema();
  const bkpf = schema.get('BKPF')!;

  test('BKPF exists', () => {
    expect(bkpf).toBeDefined();
  });

  test('BKPF has BUKRS, BELNR, GJAHR, BLART, BUDAT fields', () => {
    const fieldNames = bkpf.fields.map(f => f.name);
    expect(fieldNames).toContain('BUKRS');
    expect(fieldNames).toContain('BELNR');
    expect(fieldNames).toContain('GJAHR');
    expect(fieldNames).toContain('BLART');
    expect(fieldNames).toContain('BUDAT');
  });

  test('BKPF has forensic-critical fields: CPUDT, CPUTM, USNAM, TCODE, STBLG', () => {
    const fieldNames = bkpf.fields.map(f => f.name);
    expect(fieldNames).toContain('CPUDT');
    expect(fieldNames).toContain('CPUTM');
    expect(fieldNames).toContain('USNAM');
    expect(fieldNames).toContain('TCODE');
    expect(fieldNames).toContain('STBLG');
  });
});

// ============================================================================
// 4. EKKO field coverage
// ============================================================================

describe('IDES Reference Schema — EKKO fields', () => {
  const schema = buildIDESReferenceSchema();
  const ekko = schema.get('EKKO')!;

  test('EKKO has EBELN, BUKRS, LIFNR fields', () => {
    const fieldNames = ekko.fields.map(f => f.name);
    expect(fieldNames).toContain('EBELN');
    expect(fieldNames).toContain('BUKRS');
    expect(fieldNames).toContain('LIFNR');
  });

  test('EKKO has procurement-critical fields: EKORG, EKGRP, BSART, WAERS', () => {
    const fieldNames = ekko.fields.map(f => f.name);
    expect(fieldNames).toContain('EKORG');
    expect(fieldNames).toContain('EKGRP');
    expect(fieldNames).toContain('BSART');
    expect(fieldNames).toContain('WAERS');
  });
});

// ============================================================================
// 5. O2C extraction path field coverage
// ============================================================================

describe('IDES Reference Schema — O2C extraction path fields', () => {
  const schema = buildIDESReferenceSchema();

  for (const path of SAP_O2C_PATHS) {
    test(`path "${path.id}" — all SAP fields present in reference`, () => {
      const sapFields = getExpectedSapFields(path);
      const missingFields: string[] = [];

      for (const fieldName of sapFields) {
        // Find this field in any of the O2C tables
        let found = false;
        for (const tableName of ['VBAK', 'VBAP', 'VBFA', 'LIKP', 'LIPS', 'VBRK', 'VBRP']) {
          const table = schema.get(tableName);
          if (table?.fields.some(f => f.name === fieldName)) {
            found = true;
            break;
          }
        }
        if (!found) {
          missingFields.push(fieldName);
        }
      }

      expect(missingFields).toEqual([]);
    });
  }
});

// ============================================================================
// 6. FI/CO extraction path field coverage
// ============================================================================

describe('IDES Reference Schema — FI/CO extraction path fields', () => {
  const schema = buildIDESReferenceSchema();

  for (const path of SAP_FICO_PATHS) {
    test(`path "${path.id}" — all SAP fields present in reference`, () => {
      const sapFields = getExpectedSapFields(path);
      const missingFields: string[] = [];

      for (const fieldName of sapFields) {
        let found = false;
        for (const tableName of ['BKPF', 'BSEG', 'SKA1']) {
          const table = schema.get(tableName);
          if (table?.fields.some(f => f.name === fieldName)) {
            found = true;
            break;
          }
        }
        if (!found) {
          missingFields.push(fieldName);
        }
      }

      expect(missingFields).toEqual([]);
    });
  }
});

// ============================================================================
// 7. P2P extraction path field coverage
// ============================================================================

describe('IDES Reference Schema — P2P extraction path fields', () => {
  const schema = buildIDESReferenceSchema();

  for (const path of SAP_P2P_PATHS) {
    test(`path "${path.id}" — all SAP fields present in reference`, () => {
      const sapFields = getExpectedSapFields(path);
      const missingFields: string[] = [];

      for (const fieldName of sapFields) {
        let found = false;
        for (const tableName of ['EKKO', 'EKPO', 'EBAN', 'EKBE', 'RBKP', 'RSEG']) {
          const table = schema.get(tableName);
          if (table?.fields.some(f => f.name === fieldName)) {
            found = true;
            break;
          }
        }
        if (!found) {
          missingFields.push(fieldName);
        }
      }

      expect(missingFields).toEqual([]);
    });
  }
});

// ============================================================================
// 8. getReferenceTableNames returns sorted list
// ============================================================================

describe('getReferenceTableNames', () => {
  test('returns a sorted array', () => {
    const names = getReferenceTableNames();
    const sorted = [...names].sort();
    expect(names).toEqual(sorted);
  });

  test('contains at least 18 entries', () => {
    const names = getReferenceTableNames();
    expect(names.length).toBeGreaterThanOrEqual(18);
  });

  test('includes key tables', () => {
    const names = getReferenceTableNames();
    expect(names).toContain('VBAK');
    expect(names).toContain('BKPF');
    expect(names).toContain('EKKO');
    expect(names).toContain('KNA1');
  });
});

// ============================================================================
// 9. getReferenceFields returns correct fields for VBAK
// ============================================================================

describe('getReferenceFields', () => {
  test('returns field names for VBAK', () => {
    const fields = getReferenceFields('VBAK');
    expect(fields).toBeDefined();
    expect(fields!.length).toBeGreaterThan(10);
    expect(fields).toContain('VBELN');
    expect(fields).toContain('AUART');
    expect(fields).toContain('NETWR');
    expect(fields).toContain('KUNNR');
  });

  test('returns undefined for unknown table', () => {
    const fields = getReferenceFields('ZFAKE_TABLE');
    expect(fields).toBeUndefined();
  });

  test('returns undefined for empty string', () => {
    const fields = getReferenceFields('');
    expect(fields).toBeUndefined();
  });
});

// ============================================================================
// 10. getReferenceStats
// ============================================================================

describe('getReferenceStats', () => {
  test('returns correct table count', () => {
    const stats = getReferenceStats();
    expect(stats.tableCount).toBe(19);
  });

  test('totalFields is sum of all table field counts', () => {
    const schema = buildIDESReferenceSchema();
    let expectedTotal = 0;
    for (const table of schema.values()) {
      expectedTotal += table.fields.length;
    }

    const stats = getReferenceStats();
    expect(stats.totalFields).toBe(expectedTotal);
  });

  test('totalFields is greater than 200', () => {
    const stats = getReferenceStats();
    expect(stats.totalFields).toBeGreaterThan(200);
  });
});

// ============================================================================
// 11. Every table has a non-empty description
// ============================================================================

describe('IDES Reference Schema — table descriptions', () => {
  const schema = buildIDESReferenceSchema();

  test('each table has a non-empty description', () => {
    for (const [name, table] of schema) {
      expect(table.description.length).toBeGreaterThan(0);
      expect(table.description).not.toBe(name); // description is not just the table name
    }
  });
});

// ============================================================================
// 12. Every field has a valid dataType
// ============================================================================

describe('IDES Reference Schema — field data types', () => {
  const schema = buildIDESReferenceSchema();

  test('each field has a valid SAP dataType', () => {
    const invalidFields: string[] = [];

    for (const [tableName, table] of schema) {
      for (const field of table.fields) {
        if (!VALID_DATA_TYPES.has(field.dataType)) {
          invalidFields.push(`${tableName}.${field.name}: ${field.dataType}`);
        }
      }
    }

    expect(invalidFields).toEqual([]);
  });

  test('each field has length > 0', () => {
    const zeroLengthFields: string[] = [];

    for (const [tableName, table] of schema) {
      for (const field of table.fields) {
        if (field.length <= 0) {
          zeroLengthFields.push(`${tableName}.${field.name}`);
        }
      }
    }

    expect(zeroLengthFields).toEqual([]);
  });

  test('each field has decimals >= 0', () => {
    for (const [, table] of schema) {
      for (const field of table.fields) {
        expect(field.decimals).toBeGreaterThanOrEqual(0);
      }
    }
  });

  test('each field has a non-empty description', () => {
    for (const [, table] of schema) {
      for (const field of table.fields) {
        expect(field.description.length).toBeGreaterThan(0);
      }
    }
  });
});

// ============================================================================
// 13. Cross-check: no duplicate field names within a table
// ============================================================================

describe('IDES Reference Schema — no duplicate fields', () => {
  const schema = buildIDESReferenceSchema();

  test('no table has duplicate field names', () => {
    const duplicates: string[] = [];

    for (const [tableName, table] of schema) {
      const seen = new Set<string>();
      for (const field of table.fields) {
        if (seen.has(field.name)) {
          duplicates.push(`${tableName}.${field.name}`);
        }
        seen.add(field.name);
      }
    }

    expect(duplicates).toEqual([]);
  });
});
