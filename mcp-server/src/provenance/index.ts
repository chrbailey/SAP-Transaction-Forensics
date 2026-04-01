/**
 * Provenance Graph — Public API
 *
 * Traces every forensic finding back to specific
 * system/table/record/field/value/timestamp tuples.
 */

// Types
export type {
  SystemType,
  EvidenceRole,
  ExtractionRecord,
  FindingEvidence,
  ProvenanceNode,
  ProvenanceDAG,
  ProvenanceSummary,
} from './types.js';

// Database
export { ProvenanceDB } from './schema.js';

// Hashing
export {
  computeQueryHash,
  computeReplayHash,
  computeFieldHash,
  verifyReplayHash,
} from './replay.js';

// Logger middleware
export { ProvenanceLogger } from './logger.js';

// Query API
export { ProvenanceQuery } from './query.js';
export type { ProvenanceReader } from './query.js';

// Export
export { ProvenanceExporter } from './export.js';
