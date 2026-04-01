/**
 * Contradiction Engine Type Definitions
 *
 * Complete type system for cross-system and intra-system contradiction
 * detection. Covers a 12-category taxonomy of contradictions, severity
 * scoring, resolution lifecycle, comparison configuration, and the
 * Comparator interface that all detection strategies implement.
 */

import type { SystemType } from '../provenance/types.js';

// ---------------------------------------------------------------------------
// Contradiction taxonomy
// ---------------------------------------------------------------------------

/** 12-category contradiction taxonomy */
export type ContradictionType =
  | 'AMOUNT_DIVERGENCE'        // SAP↔SFDC, SAP↔NetSuite: amounts differ >5%
  | 'DATE_CONFLICT'            // Cross-system: dates logically inconsistent
  | 'STATUS_INCOMPATIBLE'      // Cross-system: statuses can't both be true
  | 'ENTITY_MISMATCH'          // Cross-system: matched entities don't match on key fields
  | 'QUANTITY_DIVERGENCE'      // Intra-system: ordered ≠ delivered ≠ invoiced
  | 'APPROVAL_BYPASS'          // Any: transaction exceeds threshold without approval
  | 'TEMPORAL_IMPOSSIBILITY'   // Any: event B happened before event A (impossible sequence)
  | 'DUPLICATE_REFERENCE'      // Cross-system: two records reference same external ID
  | 'ORPHAN_RECORD'            // Cross-system: record in system A has no counterpart in B
  | 'RETROACTIVE_CHANGE'       // Any: change made to record in a closed period
  | 'SOD_VIOLATION'            // Any: same user performed conflicting actions
  | 'SCHEMA_GHOST';            // Any: referenced field/table doesn't exist in client schema

// ---------------------------------------------------------------------------
// Severity
// ---------------------------------------------------------------------------

/** Severity levels with numeric weight for scoring */
export type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';

export const SEVERITY_WEIGHTS: Record<Severity, number> = {
  CRITICAL: 1.0,
  HIGH: 0.75,
  MEDIUM: 0.5,
  LOW: 0.25,
  INFO: 0.1,
};

// ---------------------------------------------------------------------------
// Resolution lifecycle
// ---------------------------------------------------------------------------

/** Resolution status for findings */
export type ResolutionStatus = 'open' | 'confirmed' | 'explained' | 'false_positive';

// ---------------------------------------------------------------------------
// Core finding
// ---------------------------------------------------------------------------

/** A single contradiction finding with full evidence */
export interface ContradictionFinding {
  id: string;                      // UUID
  type: ContradictionType;
  severity: Severity;
  confidence: number;              // 0.0-1.0
  description: string;             // Human-readable description

  // Evidence from both sides
  leftSystem: SystemType;
  leftTable: string;
  leftRecordId: string;
  leftField: string;
  leftValue: string;
  leftExtractionId: string;        // FK to provenance extraction_records

  rightSystem: SystemType;
  rightTable: string;
  rightRecordId: string;
  rightField: string;
  rightValue: string;
  rightExtractionId: string;       // FK to provenance extraction_records

  // Scoring details
  scoringDetails: Record<string, number>;  // e.g., { percentDivergence: 0.15, absoluteAmount: 50000 }

  // Lifecycle
  detectedAt: string;              // ISO 8601
  resolutionStatus: ResolutionStatus;
  reviewerNotes: string;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Configuration for contradiction detection thresholds */
export interface ContradictionConfig {
  amountDivergencePercent: number;     // default 0.05 (5%)
  amountDivergenceMinAbsolute: number; // minimum absolute difference to flag
  dateConflictDays: number;            // default 30 days
  dateConflictHighDays: number;        // default 60 days
  approvalThreshold: number;           // default 50000
  stalePeriodDays: number;             // default 90
  retroactiveDays: number;             // default 0 (any change in closed period)
}

export const DEFAULT_CONFIG: ContradictionConfig = {
  amountDivergencePercent: 0.05,
  amountDivergenceMinAbsolute: 100,
  dateConflictDays: 30,
  dateConflictHighDays: 60,
  approvalThreshold: 50000,
  stalePeriodDays: 90,
  retroactiveDays: 0,
};

// ---------------------------------------------------------------------------
// Comparison inputs / outputs
// ---------------------------------------------------------------------------

/** Result of a comparison run */
export interface ComparisonResult {
  contradictions: ContradictionFinding[];
  recordsCompared: number;
  comparisonsRun: number;
  duration: number;  // ms
}

/** Input for comparators: a pair of records to compare */
export interface ComparisonPair {
  left: {
    system: SystemType;
    table: string;
    recordId: string;
    fields: Record<string, string>;
    extractionId: string;
  };
  right: {
    system: SystemType;
    table: string;
    recordId: string;
    fields: Record<string, string>;
    extractionId: string;
  };
}

// ---------------------------------------------------------------------------
// Comparator interface
// ---------------------------------------------------------------------------

/** Interface that all comparators must implement */
export interface Comparator {
  readonly type: ContradictionType;
  compare(pair: ComparisonPair, config: ContradictionConfig): ContradictionFinding | null;
}
