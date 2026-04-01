/**
 * Schema Validator Tests
 *
 * Validates the SchemaValidator against mock IDES reference schemas
 * and client schemas with VBAK (Sales Order Header) and BKPF
 * (Accounting Document Header) tables.
 */

import type { ExtractionPath } from '../extraction-registry/types.js';
import type {
  ClientField,
  ClientSchema,
  ClientTable,
  ReferenceTable,
} from '../schema-validator/types.js';
import { SchemaValidator } from '../schema-validator/validator.js';

// ---------------------------------------------------------------------------
// Test Fixtures
// ---------------------------------------------------------------------------

/** Build a ClientField helper */
function cf(name: string, dataType: string, length?: number): ClientField {
  return { name, dataType, length };
}

/** Build a ClientTable from an array of ClientFields */
function ct(name: string, fields: ClientField[], recordCount?: number): ClientTable {
  const fieldMap = new Map<string, ClientField>();
  for (const f of fields) {
    fieldMap.set(f.name, f);
  }
  return { name, fields: fieldMap, recordCount };
}

/** IDES reference for VBAK (Sales Order Header) */
const REF_VBAK: ReferenceTable = {
  name: 'VBAK',
  description: 'Sales Document: Header Data',
  fields: [
    { name: 'VBELN', dataType: 'CHAR', length: 10, decimals: 0, description: 'Sales Document' },
    { name: 'ERDAT', dataType: 'DATS', length: 8, decimals: 0, description: 'Created On' },
    { name: 'ERNAM', dataType: 'CHAR', length: 12, decimals: 0, description: 'Created By' },
    { name: 'AUART', dataType: 'CHAR', length: 4, decimals: 0, description: 'Sales Doc Type' },
    { name: 'NETWR', dataType: 'CURR', length: 15, decimals: 2, description: 'Net Value' },
    { name: 'WAERK', dataType: 'CHAR', length: 5, decimals: 0, description: 'Currency' },
  ],
};

/** IDES reference for BKPF (Accounting Document Header) */
const REF_BKPF: ReferenceTable = {
  name: 'BKPF',
  description: 'Accounting Document Header',
  fields: [
    { name: 'BUKRS', dataType: 'CHAR', length: 4, decimals: 0, description: 'Company Code' },
    { name: 'BELNR', dataType: 'CHAR', length: 10, decimals: 0, description: 'Document Number' },
    { name: 'GJAHR', dataType: 'NUMC', length: 4, decimals: 0, description: 'Fiscal Year' },
    { name: 'BLDAT', dataType: 'DATS', length: 8, decimals: 0, description: 'Document Date' },
    { name: 'BUDAT', dataType: 'DATS', length: 8, decimals: 0, description: 'Posting Date' },
    { name: 'DMBTR', dataType: 'DEC', length: 13, decimals: 2, description: 'Amount in LC' },
  ],
};

function buildReferenceSchema(): Map<string, ReferenceTable> {
  const map = new Map<string, ReferenceTable>();
  map.set('VBAK', REF_VBAK);
  map.set('BKPF', REF_BKPF);
  return map;
}

/** A complete client schema with both tables present and matching */
function buildFullClientSchema(): ClientSchema {
  const tables = new Map<string, ClientTable>();
  tables.set('VBAK', ct('VBAK', [
    cf('VBELN', 'CHAR', 10),
    cf('ERDAT', 'DATS', 8),
    cf('ERNAM', 'CHAR', 12),
    cf('AUART', 'CHAR', 4),
    cf('NETWR', 'CURR', 15),
    cf('WAERK', 'CHAR', 5),
  ], 50000));
  tables.set('BKPF', ct('BKPF', [
    cf('BUKRS', 'CHAR', 4),
    cf('BELNR', 'CHAR', 10),
    cf('GJAHR', 'NUMC', 4),
    cf('BLDAT', 'DATS', 8),
    cf('BUDAT', 'DATS', 8),
    cf('DMBTR', 'DEC', 13),
  ], 120000));
  return {
    clientId: 'CLIENT-001',
    systemType: 'SAP',
    tables,
    extractedAt: '2026-03-31T00:00:00.000Z',
  };
}

/** Extraction path targeting VBAK fields */
function buildVbakPath(): ExtractionPath {
  return {
    id: 'sap.o2c.order-header',
    version: '1.0.0',
    name: 'Order Header',
    description: 'Sales order header data from VBAK',
    systemType: 'SAP',
    domain: 'o2c',
    queryType: 'sql',
    query: 'SELECT VBELN, ERDAT, ERNAM, AUART, NETWR, WAERK FROM VBAK WHERE ERDAT >= :fromDate',
    parameters: [
      { name: 'fromDate', type: 'date', required: true, description: 'Start date' },
    ],
    expectedFields: [
      { name: 'salesDoc', type: 'string', sapFieldName: 'VBAK-VBELN', description: 'Sales Document' },
      { name: 'createdOn', type: 'date', sapFieldName: 'VBAK-ERDAT', description: 'Created On' },
      { name: 'createdBy', type: 'string', sapFieldName: 'VBAK-ERNAM', description: 'Created By' },
      { name: 'docType', type: 'string', sapFieldName: 'VBAK-AUART', description: 'Doc Type' },
      { name: 'netValue', type: 'amount', sapFieldName: 'VBAK-NETWR', description: 'Net Value' },
      { name: 'currency', type: 'string', sapFieldName: 'VBAK-WAERK', description: 'Currency' },
    ],
  };
}

/** Extraction path targeting BKPF fields */
function buildBkpfPath(): ExtractionPath {
  return {
    id: 'sap.fi.doc-header',
    version: '1.0.0',
    name: 'FI Document Header',
    description: 'Accounting document header from BKPF',
    systemType: 'SAP',
    domain: 'fi-co',
    queryType: 'sql',
    query: 'SELECT BUKRS, BELNR, GJAHR, BLDAT, BUDAT, DMBTR FROM BKPF WHERE BUDAT >= :fromDate',
    parameters: [
      { name: 'fromDate', type: 'date', required: true, description: 'Start date' },
    ],
    expectedFields: [
      { name: 'companyCode', type: 'string', sapFieldName: 'BKPF-BUKRS', description: 'Company Code' },
      { name: 'docNumber', type: 'string', sapFieldName: 'BKPF-BELNR', description: 'Document Number' },
      { name: 'fiscalYear', type: 'number', sapFieldName: 'BKPF-GJAHR', description: 'Fiscal Year' },
      { name: 'docDate', type: 'date', sapFieldName: 'BKPF-BLDAT', description: 'Document Date' },
      { name: 'postDate', type: 'date', sapFieldName: 'BKPF-BUDAT', description: 'Posting Date' },
      { name: 'amount', type: 'amount', sapFieldName: 'BKPF-DMBTR', description: 'Amount' },
    ],
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SchemaValidator', () => {
  let validator: SchemaValidator;

  beforeEach(() => {
    validator = new SchemaValidator(buildReferenceSchema());
  });

  // --- validatePath ---

  describe('validatePath', () => {
    it('returns valid when all tables and fields exist', () => {
      const result = validator.validatePath(
        'sap.o2c.order-header',
        buildVbakPath(),
        buildFullClientSchema(),
      );

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.pathId).toBe('sap.o2c.order-header');
      expect(result.systemType).toBe('SAP');
      expect(result.tableValidations).toHaveLength(1);
      expect(result.tableValidations[0]!.tableName).toBe('VBAK');
      expect(result.tableValidations[0]!.exists).toBe(true);
    });

    it('returns invalid with error when table is missing', () => {
      const schema = buildFullClientSchema();
      schema.tables.delete('VBAK');

      const result = validator.validatePath(
        'sap.o2c.order-header',
        buildVbakPath(),
        schema,
      );

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some(e => e.includes('VBAK') && e.includes('not found'))).toBe(true);
      expect(result.tableValidations[0]!.exists).toBe(false);
    });

    it('returns invalid with error when required field is missing', () => {
      const schema = buildFullClientSchema();
      const vbak = schema.tables.get('VBAK')!;
      vbak.fields.delete('NETWR');

      const result = validator.validatePath(
        'sap.o2c.order-header',
        buildVbakPath(),
        schema,
      );

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('NETWR') && e.includes('not found'))).toBe(true);
      expect(result.tableValidations[0]!.missingFields).toContain('NETWR');
    });

    it('returns warning when type mismatch is detected', () => {
      const schema = buildFullClientSchema();
      // Change NETWR from CURR to CHAR — different category
      const vbak = schema.tables.get('VBAK')!;
      vbak.fields.set('NETWR', cf('NETWR', 'CHAR', 15));

      const result = validator.validatePath(
        'sap.o2c.order-header',
        buildVbakPath(),
        schema,
      );

      // Path is still valid (type mismatch is a warning, not an error)
      expect(result.valid).toBe(true);
      expect(result.warnings.some(w => w.includes('NETWR') && w.includes('Type mismatch'))).toBe(true);

      // Field validation should show typeMatch = false
      const vbakTable = result.tableValidations[0]!;
      const netwrField = vbakTable.fieldValidations.find(fv => fv.fieldName === 'NETWR');
      expect(netwrField).toBeDefined();
      expect(netwrField!.typeMatch).toBe(false);
    });

    it('marks extra client fields as warnings but path remains valid', () => {
      const schema = buildFullClientSchema();
      const vbak = schema.tables.get('VBAK')!;
      vbak.fields.set('ZZCUSTOM', cf('ZZCUSTOM', 'CHAR', 20));

      const result = validator.validatePath(
        'sap.o2c.order-header',
        buildVbakPath(),
        schema,
      );

      expect(result.valid).toBe(true);
      expect(result.warnings.some(w => w.includes('extra field'))).toBe(true);
      expect(result.tableValidations[0]!.extraFields).toContain('ZZCUSTOM');
    });
  });

  // --- validateRegistry ---

  describe('validateRegistry', () => {
    it('separates valid and invalid paths', () => {
      const schema = buildFullClientSchema();
      schema.tables.delete('BKPF'); // BKPF path will fail

      const result = validator.validateRegistry(
        [buildVbakPath(), buildBkpfPath()],
        schema,
      );

      expect(result.validPaths).toHaveLength(1);
      expect(result.invalidPaths).toHaveLength(1);
      expect(result.validPaths[0]!.pathId).toBe('sap.o2c.order-header');
      expect(result.invalidPaths[0]!.pathId).toBe('sap.fi.doc-header');
    });

    it('summary counts are correct', () => {
      const schema = buildFullClientSchema();
      schema.tables.delete('BKPF');

      const result = validator.validateRegistry(
        [buildVbakPath(), buildBkpfPath()],
        schema,
      );

      expect(result.summary.total).toBe(2);
      expect(result.summary.valid).toBe(1);
      expect(result.summary.invalid).toBe(1);
      // VBAK path has 0 warnings, BKPF path has 0 warnings (it's an error, not a warning)
      expect(typeof result.summary.warnings).toBe('number');
    });
  });

  // --- detectCustomizations ---

  describe('detectCustomizations', () => {
    it('finds Z-tables as custom', () => {
      const schema = buildFullClientSchema();
      schema.tables.set('ZTAB_CUSTOM', ct('ZTAB_CUSTOM', [
        cf('FIELD1', 'CHAR', 10),
      ]));

      const result = validator.detectCustomizations(schema);

      expect(result.customTables).toContain('ZTAB_CUSTOM');
    });

    it('finds missing standard tables', () => {
      const schema = buildFullClientSchema();
      schema.tables.delete('BKPF');

      const result = validator.detectCustomizations(schema);

      expect(result.missingStandardTables).toContain('BKPF');
    });

    it('finds custom fields in standard tables', () => {
      const schema = buildFullClientSchema();
      const vbak = schema.tables.get('VBAK')!;
      vbak.fields.set('ZZPARTNER', cf('ZZPARTNER', 'CHAR', 10));

      const result = validator.detectCustomizations(schema);

      expect(result.customFields).toContainEqual({ table: 'VBAK', field: 'ZZPARTNER' });
    });

    it('finds missing standard fields', () => {
      const schema = buildFullClientSchema();
      const vbak = schema.tables.get('VBAK')!;
      vbak.fields.delete('WAERK');

      const result = validator.detectCustomizations(schema);

      expect(result.missingStandardFields).toContainEqual({ table: 'VBAK', field: 'WAERK' });
    });
  });

  // --- fieldExists ---

  describe('fieldExists', () => {
    it('returns true for an existing field', () => {
      const schema = buildFullClientSchema();
      expect(validator.fieldExists(schema, 'VBAK', 'VBELN')).toBe(true);
    });

    it('returns false for a missing field', () => {
      const schema = buildFullClientSchema();
      expect(validator.fieldExists(schema, 'VBAK', 'NONEXISTENT')).toBe(false);
    });

    it('returns false for a missing table', () => {
      const schema = buildFullClientSchema();
      expect(validator.fieldExists(schema, 'KONV', 'KBETR')).toBe(false);
    });
  });

  // --- checkTypeCompatibility ---

  describe('checkTypeCompatibility', () => {
    it('CHAR and VARCHAR are compatible (both string)', () => {
      const result = validator.checkTypeCompatibility('CHAR', 'VARCHAR');
      expect(result.compatible).toBe(true);
    });

    it('DEC and CURR are compatible (both amount)', () => {
      const result = validator.checkTypeCompatibility('DEC', 'CURR');
      expect(result.compatible).toBe(true);
    });

    it('CHAR and DEC are incompatible', () => {
      const result = validator.checkTypeCompatibility('CHAR', 'DEC');
      expect(result.compatible).toBe(false);
      expect(result.reason).toBeDefined();
      expect(result.reason).toContain('string');
      expect(result.reason).toContain('amount');
    });

    it('DATS and DATE are compatible (both date)', () => {
      const result = validator.checkTypeCompatibility('DATS', 'DATE');
      expect(result.compatible).toBe(true);
    });

    it('NUMC and INTEGER are compatible (both number)', () => {
      const result = validator.checkTypeCompatibility('NUMC', 'INTEGER');
      expect(result.compatible).toBe(true);
    });

    it('exact match is always compatible', () => {
      const result = validator.checkTypeCompatibility('CHAR', 'CHAR');
      expect(result.compatible).toBe(true);
    });
  });
});
