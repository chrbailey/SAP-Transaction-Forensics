// ═══════════════════════════════════════════════════════════════════════════
// CONFORMANCE CHECKING TYPES
// Based on van der Aalst's conformance checking algorithms
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Deviation severity levels
 */
export type DeviationSeverity = 'critical' | 'major' | 'minor';

/**
 * Types of process deviations
 */
export type DeviationType =
  | 'skipped_activity' // Required activity was skipped
  | 'wrong_order' // Activities executed in incorrect sequence
  | 'unexpected_activity' // Activity not in reference model
  | 'missing_activity' // Expected activity not found
  | 'repeated_activity' // Activity executed multiple times
  | 'timing_violation'; // Activity timing outside expected bounds

/**
 * Process types supported
 */
export type ProcessType = 'O2C' | 'P2P';

/**
 * Individual deviation record
 */
export interface Deviation {
  case_id: string;
  deviation_type: DeviationType;
  severity: DeviationSeverity;
  description: string;
  expected: string;
  actual: string;
  activity?: string;
  position?: number;
  timestamp?: string;
}

/**
 * Reference model activity definition
 */
export interface ReferenceActivity {
  /** Activity identifier */
  id: string;
  /** Human-readable name */
  name: string;
  /** Activity is required for conformance */
  required: boolean;
  /** Expected order in sequence (1-based) */
  order: number;
  /** Allowed predecessor activities (for flexible ordering) */
  allowedPredecessors?: string[];
  /** Expected duration range in hours [min, max] */
  expectedDuration?: [number, number];
  /** SAP transaction codes associated with this activity */
  sapTransactions?: string[];
}

/**
 * Reference process model
 */
export interface ReferenceModel {
  /** Model identifier */
  id: string;
  /** Model name */
  name: string;
  /** Model version */
  version: string;
  /** Process type */
  processType: ProcessType;
  /** Description */
  description: string;
  /** Ordered list of activities */
  activities: ReferenceActivity[];
  /** Activity name mappings from raw event names */
  activityMappings: Record<string, string>;
}

/**
 * Case analysis result
 */
export interface CaseAnalysisResult {
  caseId: string;
  conforming: boolean;
  deviations: Deviation[];
  actualSequence: string[];
  expectedSequence: string[];
  fitness: number; // 0-1 score
}

/**
 * Conformance check result
 */
export interface ConformanceResult {
  /** Overall conformance rate as percentage (0-100) */
  conformance_rate: number;
  /** Fitness score (0-1) based on alignment */
  fitness_score: number;
  /** Total number of cases analyzed */
  total_cases: number;
  /** Number of fully conforming cases */
  conforming_cases: number;
  /** Number of cases with deviations */
  non_conforming_cases: number;
  /** Process type analyzed */
  process_type: ProcessType;
  /** Breakdown by severity */
  severity_summary: {
    critical: number;
    major: number;
    minor: number;
  };
  /** Breakdown by deviation type */
  deviation_type_summary: Record<DeviationType, number>;
  /** Individual deviations */
  deviations: Deviation[];
  /** Most common deviations */
  top_deviations: Array<{
    pattern: string;
    count: number;
    severity: DeviationSeverity;
  }>;
  /** Analysis metadata */
  metadata: {
    analyzed_at: string;
    reference_model: string;
    model_version: string;
    filters_applied: Record<string, unknown>;
  };
}
