/**
 * Schema Validator Type Definitions
 *
 * Types for validating client SAP/ERP schemas against reference (IDES)
 * definitions and extraction path requirements. Enables detection of
 * customizations (Z-tables, custom fields) and schema drift.
 */

import type { SystemType } from '../provenance/types.js';

/** Validation levels from strict to lenient */
export type ValidationLevel = 'structure' | 'type' | 'format';

/** Validation result for a single field */
export interface FieldValidation {
  tableName: string;
  fieldName: string;
  level: ValidationLevel;
  exists: boolean;
  expectedType: string;
  actualType: string | null;
  typeMatch: boolean;
  sampleValues: string[];       // first 5 non-null values
  validatedAt: string;          // ISO 8601
}

/** Validation result for a table */
export interface TableValidation {
  tableName: string;
  exists: boolean;
  fieldCount: number;
  expectedFieldCount: number;
  missingFields: string[];
  extraFields: string[];        // fields in client but not in reference
  fieldValidations: FieldValidation[];
  validatedAt: string;
}

/** Validation result for an extraction path */
export interface PathValidation {
  pathId: string;
  pathVersion: string;
  systemType: SystemType;
  valid: boolean;               // all required tables/fields exist
  errors: string[];             // critical issues (missing tables/fields)
  warnings: string[];           // non-critical (type mismatches, extra fields)
  tableValidations: TableValidation[];
  validatedAt: string;
}

/** Client schema definition — what actually exists in this client's instance */
export interface ClientSchema {
  clientId: string;
  systemType: SystemType;
  tables: Map<string, ClientTable>;
  extractedAt: string;
}

/** A table in the client's schema */
export interface ClientTable {
  name: string;
  fields: Map<string, ClientField>;
  recordCount?: number;         // approximate row count if available
}

/** A field in the client's table */
export interface ClientField {
  name: string;
  dataType: string;             // e.g., 'CHAR', 'NUMC', 'DATS', 'DEC', 'VARCHAR2'
  length?: number;
  decimals?: number;
  description?: string;
}

/** Reference schema entry (from IDES dump) */
export interface ReferenceTable {
  name: string;
  description: string;
  fields: ReferenceField[];
}

export interface ReferenceField {
  name: string;
  dataType: string;
  length: number;
  decimals: number;
  description: string;
}
