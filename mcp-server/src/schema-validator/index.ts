/**
 * Schema Validator — Public API
 *
 * Barrel exports for the schema validation subsystem. Provides the
 * validator, IDES reference schema builder, and a factory function
 * that returns a pre-loaded validator instance.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type {
  ValidationLevel,
  FieldValidation,
  TableValidation,
  PathValidation,
  ClientSchema,
  ClientTable,
  ClientField,
  ReferenceTable,
  ReferenceField,
} from './types.js';

// ---------------------------------------------------------------------------
// Validator
// ---------------------------------------------------------------------------

export { SchemaValidator } from './validator.js';

// ---------------------------------------------------------------------------
// IDES Reference
// ---------------------------------------------------------------------------

export {
  buildIDESReferenceSchema,
  getReferenceTableNames,
  getReferenceFields,
  getReferenceStats,
} from './ides-reference.js';

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

import { SchemaValidator } from './validator.js';
import { buildIDESReferenceSchema } from './ides-reference.js';

/** Create a validator pre-loaded with the IDES reference schema. */
export function createDefaultValidator(): SchemaValidator {
  return new SchemaValidator(buildIDESReferenceSchema());
}
