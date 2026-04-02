/**
 * Compliance Gap Detector
 *
 * Detects gaps between documented business rules (what people SHOULD do)
 * and actual event logs (what people ACTUALLY do).  Finds rule violations,
 * timing SLA breaches, approval bypasses, and sequence violations.
 */

// ---------------------------------------------------------------------------
// Type definitions (local to reality-gap subsystem)
// ---------------------------------------------------------------------------

export type GapSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';

export type RuleType = 'sequence' | 'timing' | 'approval';

export interface WorkflowRule {
  /** Unique identifier for the rule */
  ruleId: string;
  /** Human-readable description */
  description: string;
  /** Type of check to perform */
  ruleType: RuleType;
  /**
   * For sequence rules: ordered list of activity names (A must come before B).
   * For timing rules: [startActivity, endActivity].
   * For approval rules: [triggerActivity, approvalActivity].
   */
  activities: string[];
  /** For timing rules: maximum allowed days between start and end */
  maxDays?: number;
  /** For approval rules: monetary threshold above which approval is required */
  approvalThreshold?: number;
  /** Materiality weight 0-1 (how important is this rule) */
  materiality: number;
}

export interface ActualEvent {
  /** Identifier linking the event to a process instance */
  caseId: string;
  /** Activity / step name */
  activity: string;
  /** ISO-8601 timestamp */
  timestamp: string;
  /** Optional monetary amount associated with the event */
  amount?: number;
  /** Arbitrary attributes */
  attributes?: Record<string, unknown>;
}

export interface GapFinding {
  /** Which rule was violated */
  ruleId: string;
  /** Case(s) that violated */
  caseIds: string[];
  /** Always 'compliance' for this detector */
  gapType: 'compliance';
  /** Where the expected behaviour comes from */
  expectedSource: 'documented';
  /** Specific sub-type of the gap */
  violationType: RuleType;
  /** Human-readable explanation */
  description: string;
  /** Computed severity */
  severity: GapSeverity;
  /** Raw numeric score (0-1) */
  score: number;
  /** How many cases exhibited this violation */
  frequency: number;
  /** When the most recent violation occurred (ISO-8601) */
  lastOccurrence: string;
}

// ---------------------------------------------------------------------------
// ComplianceGapDetector
// ---------------------------------------------------------------------------

export class ComplianceGapDetector {
  /**
   * Compare documented rules against actual events.
   *
   * Finds: rule violations (rule says X, events show Y),
   * timing SLA breaches (rule says <N days, actual >N days),
   * approval bypasses (rule requires approval, no approval event),
   * sequence violations (rule says A before B, events show B before A).
   */
  detectGaps(rules: WorkflowRule[], actualEvents: ActualEvent[]): GapFinding[] {
    const caseMap = this.groupByCase(actualEvents);
    const findings: GapFinding[] = [];

    for (const rule of rules) {
      const violatingCases: string[] = [];
      let latestTimestamp = '';
      let firstViolationDescription = '';

      for (const [caseId, events] of caseMap) {
        let violation: GapFinding | null = null;

        switch (rule.ruleType) {
          case 'sequence':
            violation = this.checkSequenceRule(rule, events);
            break;
          case 'timing':
            violation = this.checkTimingRule(rule, events);
            break;
          case 'approval':
            violation = this.checkApprovalRule(rule, events);
            break;
        }

        if (violation !== null) {
          violatingCases.push(caseId);
          if (firstViolationDescription === '') {
            firstViolationDescription = violation.description;
          }
          if (violation.lastOccurrence > latestTimestamp) {
            latestTimestamp = violation.lastOccurrence;
          }
        }
      }

      if (violatingCases.length > 0) {
        const now = new Date();
        const daysSinceLast =
          latestTimestamp !== ''
            ? (now.getTime() - new Date(latestTimestamp).getTime()) / (1000 * 60 * 60 * 24)
            : Infinity;

        const lookbackDays = 365;
        const recency = Math.max(0, Math.min(1, 1.0 - daysSinceLast / lookbackDays));
        const severity = this.scoreGap(violatingCases.length, rule.materiality, recency);

        const frequencyNormalized = Math.min(violatingCases.length / 10, 1.0);
        const rawScore = frequencyNormalized * rule.materiality * recency;

        findings.push({
          ruleId: rule.ruleId,
          caseIds: violatingCases,
          gapType: 'compliance',
          expectedSource: 'documented',
          violationType: rule.ruleType,
          description: firstViolationDescription,
          severity: severity.level,
          score: rawScore,
          frequency: violatingCases.length,
          lastOccurrence: latestTimestamp,
        });
      }
    }

    return findings;
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /** Group events by case ID for process analysis */
  private groupByCase(events: ActualEvent[]): Map<string, ActualEvent[]> {
    const map = new Map<string, ActualEvent[]>();
    for (const event of events) {
      const existing = map.get(event.caseId);
      if (existing !== undefined) {
        existing.push(event);
      } else {
        map.set(event.caseId, [event]);
      }
    }
    // Sort each case's events chronologically
    for (const caseEvents of map.values()) {
      caseEvents.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    }
    return map;
  }

  /** Check a sequence rule against actual case events */
  private checkSequenceRule(rule: WorkflowRule, caseEvents: ActualEvent[]): GapFinding | null {
    if (rule.activities.length < 2) return null;

    // Find the indices of the first occurrence of each required activity
    const indices: number[] = [];
    for (const activity of rule.activities) {
      const idx = caseEvents.findIndex(e => e.activity === activity);
      if (idx === -1) {
        // Activity not found in this case — cannot assess sequence
        return null;
      }
      indices.push(idx);
    }

    // Check that indices are strictly ascending (correct order)
    for (let i = 1; i < indices.length; i++) {
      if (indices[i]! <= indices[i - 1]!) {
        // Out of order — violation
        const lastEvent = caseEvents[caseEvents.length - 1]!;
        return {
          ruleId: rule.ruleId,
          caseIds: [caseEvents[0]!.caseId],
          gapType: 'compliance',
          expectedSource: 'documented',
          violationType: 'sequence',
          description: `Sequence violation: expected ${rule.activities.join(' → ')}`,
          severity: 'MEDIUM',
          score: 0,
          frequency: 1,
          lastOccurrence: lastEvent.timestamp,
        };
      }
    }

    return null;
  }

  /** Check a timing SLA rule against actual case events */
  private checkTimingRule(rule: WorkflowRule, caseEvents: ActualEvent[]): GapFinding | null {
    if (rule.activities.length < 2 || rule.maxDays === undefined) return null;

    const startActivity = rule.activities[0]!;
    const endActivity = rule.activities[1]!;

    const startEvent = caseEvents.find(e => e.activity === startActivity);
    const endEvent = caseEvents.find(e => e.activity === endActivity);

    if (startEvent === undefined || endEvent === undefined) return null;

    const startMs = new Date(startEvent.timestamp).getTime();
    const endMs = new Date(endEvent.timestamp).getTime();
    const actualDays = (endMs - startMs) / (1000 * 60 * 60 * 24);

    if (actualDays > rule.maxDays) {
      return {
        ruleId: rule.ruleId,
        caseIds: [caseEvents[0]!.caseId],
        gapType: 'compliance',
        expectedSource: 'documented',
        violationType: 'timing',
        description: `SLA breach: ${actualDays.toFixed(1)} days vs ${rule.maxDays} day limit`,
        severity: 'MEDIUM',
        score: 0,
        frequency: 1,
        lastOccurrence: endEvent.timestamp,
      };
    }

    return null;
  }

  /** Check an approval threshold rule against actual events */
  private checkApprovalRule(rule: WorkflowRule, caseEvents: ActualEvent[]): GapFinding | null {
    if (rule.activities.length < 2 || rule.approvalThreshold === undefined) return null;

    const triggerActivity = rule.activities[0]!;
    const approvalActivity = rule.activities[1]!;

    const triggerEvent = caseEvents.find(e => e.activity === triggerActivity);

    if (triggerEvent === undefined) return null;

    // Only check if amount exceeds threshold
    if (triggerEvent.amount === undefined || triggerEvent.amount <= rule.approvalThreshold) {
      return null;
    }

    // Amount exceeds threshold — check for approval event
    const hasApproval = caseEvents.some(e => e.activity === approvalActivity);

    if (!hasApproval) {
      return {
        ruleId: rule.ruleId,
        caseIds: [caseEvents[0]!.caseId],
        gapType: 'compliance',
        expectedSource: 'documented',
        violationType: 'approval',
        description: `Approval bypass: amount ${triggerEvent.amount} exceeds threshold ${rule.approvalThreshold} with no "${approvalActivity}" event`,
        severity: 'MEDIUM',
        score: 0,
        frequency: 1,
        lastOccurrence: triggerEvent.timestamp,
      };
    }

    return null;
  }

  /**
   * Score gap severity: frequency x materiality x recency.
   *
   * - frequency_normalized = min(frequency / 10, 1.0)
   * - recency = 1.0 - (days_since_last / lookback_days), clamped 0-1
   * - score = frequency_normalized * materiality * recency
   * - CRITICAL if score > 0.8, HIGH > 0.6, MEDIUM > 0.4, LOW > 0.2, else INFO
   */
  private scoreGap(
    frequency: number,
    materiality: number,
    recency: number
  ): { level: GapSeverity; score: number } {
    const frequencyNormalized = Math.min(frequency / 10, 1.0);
    const score = frequencyNormalized * materiality * recency;

    let level: GapSeverity;
    if (score > 0.8) {
      level = 'CRITICAL';
    } else if (score > 0.6) {
      level = 'HIGH';
    } else if (score > 0.4) {
      level = 'MEDIUM';
    } else if (score > 0.2) {
      level = 'LOW';
    } else {
      level = 'INFO';
    }

    return { level, score };
  }
}
