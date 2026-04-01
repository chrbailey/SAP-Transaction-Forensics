/**
 * Provenance Graph Type Definitions
 *
 * Types for the field-level provenance system that traces every finding
 * back to specific system/table/record/field/value/timestamp tuples.
 */

export type SystemType = 'SAP' | 'NetSuite' | 'Salesforce';
export type EvidenceRole = 'primary' | 'corroborating' | 'contradicting';

/** A single field-level extraction record with full provenance */
export interface ExtractionRecord {
  id: string;
  adapterId: string;
  systemType: SystemType;
  tableName: string;
  recordId: string;
  fieldName: string;
  rawValue: string;
  normalizedValue: string;
  extractionTimestamp: string;  // ISO 8601
  queryHash: string;            // SHA-256 of the extraction query
  replayHash: string;           // SHA-256 of the result set
  extractionPathId: string;     // FK to extraction registry
  extractionPathVersion: string;
}

/** Links a finding to its supporting extraction evidence */
export interface FindingEvidence {
  findingId: string;
  extractionId: string;
  role: EvidenceRole;
  addedAt: string;  // ISO 8601
}

/** A node in the provenance DAG */
export interface ProvenanceNode {
  type: 'finding' | 'evidence' | 'extraction';
  id: string;
  data: Record<string, unknown>;
  children: ProvenanceNode[];
}

/** Complete provenance DAG for a finding */
export interface ProvenanceDAG {
  rootFindingId: string;
  nodes: ProvenanceNode[];
  generatedAt: string;
  replayable: boolean;  // true if all extraction replay hashes can be verified
}

/** Summary stats for a provenance chain */
export interface ProvenanceSummary {
  findingId: string;
  extractionCount: number;
  systemsCovered: SystemType[];
  tablesCovered: string[];
  oldestExtraction: string;
  newestExtraction: string;
  allReplayable: boolean;
}
