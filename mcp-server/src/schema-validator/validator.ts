/**
 * Schema Validator
 *
 * Validates client ERP schemas against IDES reference definitions and
 * extraction path requirements. Detects customizations (Z-tables, custom
 * fields), type mismatches, and missing structures before extraction runs.
 */

import type { ExtractionPath } from '../extraction-registry/types.js';
import type {
  ClientSchema,
  FieldValidation,
  PathValidation,
  ReferenceTable,
  TableValidation,
} from './types.js';

/** Type compatibility categories */
const TYPE_CATEGORIES: Record<string, string> = {
  // String types
  CHAR: 'string',
  VARCHAR: 'string',
  VARCHAR2: 'string',
  NVARCHAR: 'string',
  STRING: 'string',
  SSTRING: 'string',
  // Number types
  NUMC: 'number',
  INT: 'number',
  INTEGER: 'number',
  INT4: 'number',
  // Date types
  DATS: 'date',
  DATE: 'date',
  DATETIME: 'date',
  TIMS: 'date',
  TIMESTAMP: 'date',
  // Amount types
  DEC: 'amount',
  DECIMAL: 'amount',
  CURR: 'amount',
  QUAN: 'amount',
  FLTP: 'amount',
};

export class SchemaValidator {
  private referenceSchema: Map<string, ReferenceTable>;

  constructor(referenceSchema: Map<string, ReferenceTable>) {
    this.referenceSchema = referenceSchema;
  }

  /** Validate a single extraction path against a client schema */
  validatePath(
    pathId: string,
    path: ExtractionPath,
    clientSchema: ClientSchema,
  ): PathValidation {
    const now = new Date().toISOString();
    const errors: string[] = [];
    const warnings: string[] = [];
    const tableValidations: TableValidation[] = [];

    // Group expected fields by table (derived from sapFieldName or field name patterns)
    const tableFields = this.groupFieldsByTable(path);

    for (const [tableName, fieldNames] of tableFields) {
      const clientTable = clientSchema.tables.get(tableName);
      const refTable = this.referenceSchema.get(tableName);

      if (!clientTable) {
        errors.push(`Table '${tableName}' not found in client schema`);
        tableValidations.push({
          tableName,
          exists: false,
          fieldCount: 0,
          expectedFieldCount: fieldNames.length,
          missingFields: fieldNames,
          extraFields: [],
          fieldValidations: [],
          validatedAt: now,
        });
        continue;
      }

      const fieldValidations: FieldValidation[] = [];
      const missingFields: string[] = [];
      const clientFieldNames = [...clientTable.fields.keys()];
      const extraFields = clientFieldNames.filter(f => !fieldNames.includes(f));

      for (const fieldName of fieldNames) {
        const clientField = clientTable.fields.get(fieldName);
        const refField = refTable?.fields.find(f => f.name === fieldName);
        const expectedType = refField?.dataType ?? 'unknown';

        if (!clientField) {
          missingFields.push(fieldName);
          errors.push(`Field '${tableName}.${fieldName}' not found in client schema`);
          fieldValidations.push({
            tableName,
            fieldName,
            level: 'structure',
            exists: false,
            expectedType,
            actualType: null,
            typeMatch: false,
            sampleValues: [],
            validatedAt: now,
          });
          continue;
        }

        const typeCompat = this.checkTypeCompatibility(expectedType, clientField.dataType);

        if (!typeCompat.compatible && expectedType !== 'unknown') {
          warnings.push(
            `Type mismatch on '${tableName}.${fieldName}': expected '${expectedType}', got '${clientField.dataType}'`,
          );
        }

        fieldValidations.push({
          tableName,
          fieldName,
          level: expectedType === 'unknown' ? 'structure' : 'type',
          exists: true,
          expectedType,
          actualType: clientField.dataType,
          typeMatch: expectedType === 'unknown' || typeCompat.compatible,
          sampleValues: [],
          validatedAt: now,
        });
      }

      if (extraFields.length > 0) {
        warnings.push(
          `Table '${tableName}' has ${String(extraFields.length)} extra field(s): ${extraFields.join(', ')}`,
        );
      }

      tableValidations.push({
        tableName,
        exists: true,
        fieldCount: clientTable.fields.size,
        expectedFieldCount: fieldNames.length,
        missingFields,
        extraFields,
        fieldValidations,
        validatedAt: now,
      });
    }

    return {
      pathId,
      pathVersion: path.version,
      systemType: path.systemType,
      valid: errors.length === 0,
      errors,
      warnings,
      tableValidations,
      validatedAt: now,
    };
  }

  /** Validate all paths in a registry against a client schema */
  validateRegistry(
    registry: ExtractionPath[],
    clientSchema: ClientSchema,
  ): {
    validPaths: PathValidation[];
    invalidPaths: PathValidation[];
    summary: { total: number; valid: number; invalid: number; warnings: number };
  } {
    const validPaths: PathValidation[] = [];
    const invalidPaths: PathValidation[] = [];
    let warningCount = 0;

    for (const path of registry) {
      const validation = this.validatePath(path.id, path, clientSchema);
      if (validation.valid) {
        validPaths.push(validation);
      } else {
        invalidPaths.push(validation);
      }
      warningCount += validation.warnings.length;
    }

    return {
      validPaths,
      invalidPaths,
      summary: {
        total: registry.length,
        valid: validPaths.length,
        invalid: invalidPaths.length,
        warnings: warningCount,
      },
    };
  }

  /** Compare client schema against IDES reference to identify customizations */
  detectCustomizations(clientSchema: ClientSchema): {
    customTables: string[];
    customFields: Array<{ table: string; field: string }>;
    missingStandardTables: string[];
    missingStandardFields: Array<{ table: string; field: string }>;
  } {
    const customTables: string[] = [];
    const customFields: Array<{ table: string; field: string }> = [];
    const missingStandardTables: string[] = [];
    const missingStandardFields: Array<{ table: string; field: string }> = [];

    // Find custom tables (Z-tables or not in reference)
    for (const [tableName, clientTable] of clientSchema.tables) {
      if (!this.referenceSchema.has(tableName)) {
        customTables.push(tableName);
        continue;
      }

      // Check for custom fields in standard tables
      const refTable = this.referenceSchema.get(tableName)!;
      const refFieldNames = new Set(refTable.fields.map(f => f.name));

      for (const fieldName of clientTable.fields.keys()) {
        if (!refFieldNames.has(fieldName)) {
          customFields.push({ table: tableName, field: fieldName });
        }
      }
    }

    // Find missing standard tables and fields
    for (const [refTableName, refTable] of this.referenceSchema) {
      const clientTable = clientSchema.tables.get(refTableName);
      if (!clientTable) {
        missingStandardTables.push(refTableName);
        continue;
      }

      for (const refField of refTable.fields) {
        if (!clientTable.fields.has(refField.name)) {
          missingStandardFields.push({ table: refTableName, field: refField.name });
        }
      }
    }

    return {
      customTables,
      customFields,
      missingStandardTables,
      missingStandardFields,
    };
  }

  /** Quick check: does a specific table.field exist in the client schema? */
  fieldExists(
    clientSchema: ClientSchema,
    tableName: string,
    fieldName: string,
  ): boolean {
    const table = clientSchema.tables.get(tableName);
    if (!table) return false;
    return table.fields.has(fieldName);
  }

  /** Get type compatibility between reference and client */
  checkTypeCompatibility(
    referenceType: string,
    clientType: string,
  ): { compatible: boolean; reason?: string } {
    const refUpper = referenceType.toUpperCase();
    const clientUpper = clientType.toUpperCase();

    // Exact match is always compatible
    if (refUpper === clientUpper) {
      return { compatible: true };
    }

    const refCategory = TYPE_CATEGORIES[refUpper];
    const clientCategory = TYPE_CATEGORIES[clientUpper];

    // Unknown types — can't determine compatibility
    if (refCategory === undefined || clientCategory === undefined) {
      return {
        compatible: false,
        reason: `Unknown type(s): reference='${referenceType}', client='${clientType}'`,
      };
    }

    // Same category = compatible
    if (refCategory === clientCategory) {
      return { compatible: true };
    }

    // Different category = incompatible
    return {
      compatible: false,
      reason: `Type category mismatch: '${referenceType}' is ${refCategory}, '${clientType}' is ${clientCategory}`,
    };
  }

  /**
   * Group extraction path expected fields by table name.
   * Uses sapFieldName (TABLE-FIELD format) or falls back to the path's
   * query text to determine table membership.
   */
  private groupFieldsByTable(path: ExtractionPath): Map<string, string[]> {
    const tableFields = new Map<string, string[]>();

    for (const field of path.expectedFields) {
      // Try SAP field name format: TABLE~FIELD or TABLE-FIELD
      const sapName = field.sapFieldName ?? '';
      const sepIdx = Math.max(sapName.indexOf('~'), sapName.indexOf('-'));

      let tableName: string;
      let fieldName: string;

      if (sepIdx > 0) {
        tableName = sapName.substring(0, sepIdx);
        fieldName = sapName.substring(sepIdx + 1);
      } else {
        // Fall back: extract table name from path ID (e.g., 'sap.o2c.order-header' -> use query)
        tableName = this.inferTableFromPath(path);
        fieldName = field.sapFieldName ?? field.name;
      }

      const existing = tableFields.get(tableName);
      if (existing) {
        existing.push(fieldName);
      } else {
        tableFields.set(tableName, [fieldName]);
      }
    }

    return tableFields;
  }

  /** Infer primary table name from extraction path metadata */
  private inferTableFromPath(path: ExtractionPath): string {
    // Try to extract table name from SQL query (FROM clause)
    const fromMatch = /\bFROM\s+(\w+)/i.exec(path.query);
    if (fromMatch?.[1]) {
      return fromMatch[1];
    }

    // Last resort: use the path ID's last segment uppercased
    const segments = path.id.split('.');
    return (segments[segments.length - 1] ?? path.id).toUpperCase().replace(/-/g, '_');
  }
}
