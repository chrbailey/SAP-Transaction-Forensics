/**
 * Finding Lifecycle Manager
 *
 * Manages the lifecycle of unified findings from detection through resolution.
 * Enforces valid state transitions, tracks deduplication keys, and provides
 * query and summary capabilities.
 */

import { randomUUID } from 'node:crypto';
import {
  VALID_TRANSITIONS,
  TERMINAL_STATES,
} from './types.js';
import type {
  FindingState,
  FindingSource,
  FindingSeverity,
  UnifiedFinding,
  StateTransition,
  FindingKey,
} from './types.js';

/** Serialise a FindingKey to a stable string for dedup lookups */
function keyToString(key: FindingKey): string {
  return [
    key.source,
    key.systemLeft ?? '',
    key.tableLeft ?? '',
    key.recordLeft ?? '',
    key.systemRight ?? '',
    key.tableRight ?? '',
    key.recordRight ?? '',
  ].join('|');
}

export class FindingLifecycleManager {
  private findings: Map<string, UnifiedFinding> = new Map();
  private dedupKeys: Map<string, string> = new Map(); // serialised key -> findingId

  // ------------------------------------------------------------------
  // Creation
  // ------------------------------------------------------------------

  /** Create a new finding from a detection source */
  createFinding(params: {
    source: FindingSource;
    sourceId: string;
    title: string;
    description: string;
    severity: FindingSeverity;
    riskScore: number;
    systemsCovered: string[];
    tablesCovered: string[];
    extractionIds: string[];
  }): UnifiedFinding {
    const now = new Date().toISOString();
    const finding: UnifiedFinding = {
      id: randomUUID(),
      source: params.source,
      sourceId: params.sourceId,
      state: 'DETECTED',
      title: params.title,
      description: params.description,
      severity: params.severity,
      riskScore: params.riskScore,
      systemsCovered: params.systemsCovered,
      tablesCovered: params.tablesCovered,
      extractionIds: params.extractionIds,
      detectedAt: now,
      lastTransitionAt: now,
      transitions: [],
    };
    this.findings.set(finding.id, finding);
    return finding;
  }

  // ------------------------------------------------------------------
  // Transitions
  // ------------------------------------------------------------------

  /** Check if a transition is valid */
  isValidTransition(fromState: FindingState, toState: FindingState): boolean {
    const allowed = VALID_TRANSITIONS[fromState];
    return allowed.includes(toState);
  }

  /** Transition a finding to a new state */
  transition(
    findingId: string,
    toState: FindingState,
    by: string,
    notes: string,
    evidence?: string,
  ): UnifiedFinding {
    const finding = this.findings.get(findingId);
    if (!finding) {
      throw new Error(`Finding not found: ${findingId}`);
    }
    if (!this.isValidTransition(finding.state, toState)) {
      throw new Error(
        `Invalid transition from ${finding.state} to ${toState}`,
      );
    }

    const now = new Date().toISOString();
    const record: StateTransition = {
      fromState: finding.state,
      toState,
      transitionedAt: now,
      transitionedBy: by,
      evidence,
      notes,
    };

    finding.transitions.push(record);
    finding.state = toState;
    finding.lastTransitionAt = now;

    if (TERMINAL_STATES.includes(toState)) {
      finding.resolvedAt = now;
    }

    return finding;
  }

  // ------------------------------------------------------------------
  // Queries
  // ------------------------------------------------------------------

  /** Get a finding by ID */
  get(id: string): UnifiedFinding | undefined {
    return this.findings.get(id);
  }

  /** Query findings by state, source, severity, or minRiskScore */
  query(filter?: {
    state?: FindingState;
    source?: FindingSource;
    severity?: FindingSeverity;
    minRiskScore?: number;
  }): UnifiedFinding[] {
    let results = Array.from(this.findings.values());

    if (filter?.state !== undefined) {
      results = results.filter((f) => f.state === filter.state);
    }
    if (filter?.source !== undefined) {
      results = results.filter((f) => f.source === filter.source);
    }
    if (filter?.severity !== undefined) {
      results = results.filter((f) => f.severity === filter.severity);
    }
    if (filter?.minRiskScore !== undefined) {
      results = results.filter((f) => f.riskScore >= filter.minRiskScore!);
    }

    return results;
  }

  /** Get all findings in terminal states */
  getResolved(): UnifiedFinding[] {
    return Array.from(this.findings.values()).filter((f) =>
      TERMINAL_STATES.includes(f.state),
    );
  }

  /** Get all findings needing attention (non-terminal) */
  getActive(): UnifiedFinding[] {
    return Array.from(this.findings.values()).filter(
      (f) => !TERMINAL_STATES.includes(f.state),
    );
  }

  // ------------------------------------------------------------------
  // Deduplication
  // ------------------------------------------------------------------

  /** Check for duplicate finding */
  isDuplicate(key: FindingKey): boolean {
    return this.dedupKeys.has(keyToString(key));
  }

  /** Register a dedup key */
  registerKey(findingId: string, key: FindingKey): void {
    this.dedupKeys.set(keyToString(key), findingId);
  }

  // ------------------------------------------------------------------
  // Summary
  // ------------------------------------------------------------------

  /** Get lifecycle summary */
  getSummary(): {
    total: number;
    byState: Record<FindingState, number>;
    bySource: Record<FindingSource, number>;
    avgRiskScore: number;
    avgTimeToTriage: number; // ms from DETECTED to TRIAGED
  } {
    const all = Array.from(this.findings.values());

    const byState: Record<FindingState, number> = {
      DETECTED: 0,
      TRIAGED: 0,
      INVESTIGATING: 0,
      CONFIRMED: 0,
      REMEDIATION: 0,
      RESOLVED: 0,
      FALSE_POSITIVE: 0,
      ACCEPTED_RISK: 0,
    };
    const bySource: Record<FindingSource, number> = {
      contradiction: 0,
      reality_gap: 0,
      conformance: 0,
      fi_co_anomaly: 0,
    };

    let riskSum = 0;
    let triageDurationsSum = 0;
    let triageCount = 0;

    for (const f of all) {
      byState[f.state]++;
      bySource[f.source]++;
      riskSum += f.riskScore;

      // Find the first DETECTED -> TRIAGED transition
      const triageTx = f.transitions.find(
        (t) => t.fromState === 'DETECTED' && t.toState === 'TRIAGED',
      );
      if (triageTx) {
        const detected = new Date(f.detectedAt).getTime();
        const triaged = new Date(triageTx.transitionedAt).getTime();
        triageDurationsSum += triaged - detected;
        triageCount++;
      }
    }

    return {
      total: all.length,
      byState,
      bySource,
      avgRiskScore: all.length > 0 ? riskSum / all.length : 0,
      avgTimeToTriage: triageCount > 0 ? triageDurationsSum / triageCount : 0,
    };
  }
}
