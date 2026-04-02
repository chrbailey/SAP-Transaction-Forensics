/**
 * Finding Lifecycle Types
 *
 * State machine types and interfaces for the unified finding lifecycle.
 * Findings progress through: DETECTED -> TRIAGED -> INVESTIGATING -> CONFIRMED ->
 * REMEDIATION -> RESOLVED, with escape hatches to FALSE_POSITIVE and ACCEPTED_RISK.
 */

/** Finding lifecycle states */
export type FindingState =
  | 'DETECTED'
  | 'TRIAGED'
  | 'INVESTIGATING'
  | 'CONFIRMED'
  | 'REMEDIATION'
  | 'RESOLVED'
  | 'FALSE_POSITIVE'
  | 'ACCEPTED_RISK';

/** Valid state transitions */
export const VALID_TRANSITIONS: Record<FindingState, FindingState[]> = {
  DETECTED: ['TRIAGED', 'FALSE_POSITIVE'],
  TRIAGED: ['INVESTIGATING', 'FALSE_POSITIVE'],
  INVESTIGATING: ['CONFIRMED', 'FALSE_POSITIVE'],
  CONFIRMED: ['REMEDIATION', 'ACCEPTED_RISK'],
  REMEDIATION: ['RESOLVED'],
  RESOLVED: [], // terminal
  FALSE_POSITIVE: [], // terminal
  ACCEPTED_RISK: [], // terminal
};

/** Terminal states that cannot be transitioned from */
export const TERMINAL_STATES: FindingState[] = ['RESOLVED', 'FALSE_POSITIVE', 'ACCEPTED_RISK'];

export type FindingSource = 'contradiction' | 'reality_gap' | 'conformance' | 'fi_co_anomaly';

export type FindingSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';

/** A unified finding that spans all detection sources */
export interface UnifiedFinding {
  id: string;
  source: FindingSource;
  sourceId: string; // FK to the original finding (contradiction ID, gap ID, etc.)
  state: FindingState;
  title: string;
  description: string;
  severity: FindingSeverity;
  riskScore: number; // 0-100

  assignedTo?: string | undefined;

  // Provenance
  systemsCovered: string[];
  tablesCovered: string[];
  extractionIds: string[]; // FKs to provenance

  // Lifecycle
  detectedAt: string;
  lastTransitionAt: string;
  resolvedAt?: string | undefined;
  transitions: StateTransition[];
}

/** A state transition record */
export interface StateTransition {
  fromState: FindingState;
  toState: FindingState;
  transitionedAt: string;
  transitionedBy: string; // user or 'system'
  evidence?: string | undefined; // FK to extraction or note
  notes: string;
}

/** Deduplication key for findings */
export interface FindingKey {
  source: FindingSource;
  systemLeft?: string;
  tableLeft?: string;
  recordLeft?: string;
  systemRight?: string;
  tableRight?: string;
  recordRight?: string;
}
