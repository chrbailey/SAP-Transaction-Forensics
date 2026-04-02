/**
 * Tests for ComplianceGapDetector
 *
 * Covers: sequence violations, timing SLA breaches, approval bypasses,
 * full compliance, grouping, mixed cases, frequency counts, scoring
 * thresholds, gap metadata, and edge cases.
 */

import { ComplianceGapDetector } from '../reality-gap/compliance-gap.js';
import type { WorkflowRule, ActualEvent, GapFinding } from '../reality-gap/compliance-gap.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** ISO timestamp helper — returns a date N days from a base */
function daysFromNow(daysOffset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysOffset);
  return d.toISOString();
}

/** Build events for a single case */
function makeEvents(
  caseId: string,
  steps: Array<{ activity: string; daysOffset: number; amount?: number }>
): ActualEvent[] {
  return steps.map(s => ({
    caseId,
    activity: s.activity,
    timestamp: daysFromNow(s.daysOffset),
    amount: s.amount,
  }));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ComplianceGapDetector', () => {
  let detector: ComplianceGapDetector;

  beforeEach(() => {
    detector = new ComplianceGapDetector();
  });

  // 1. Detects sequence violation (B before A)
  it('detects sequence violation when B occurs before A', () => {
    const rules: WorkflowRule[] = [
      {
        ruleId: 'SEQ-001',
        description: 'Create PO before Goods Receipt',
        ruleType: 'sequence',
        activities: ['Create PO', 'Goods Receipt'],
        materiality: 0.8,
      },
    ];

    // Goods Receipt happens before Create PO
    const events: ActualEvent[] = [
      { caseId: 'C1', activity: 'Goods Receipt', timestamp: daysFromNow(-5) },
      { caseId: 'C1', activity: 'Create PO', timestamp: daysFromNow(-3) },
    ];

    const findings = detector.detectGaps(rules, events);

    expect(findings).toHaveLength(1);
    expect(findings[0]!.ruleId).toBe('SEQ-001');
    expect(findings[0]!.violationType).toBe('sequence');
    expect(findings[0]!.caseIds).toContain('C1');
  });

  // 2. Detects timing SLA breach (>5 day rule, 8 day actual)
  it('detects timing SLA breach when actual exceeds limit', () => {
    const rules: WorkflowRule[] = [
      {
        ruleId: 'SLA-001',
        description: 'Invoice within 5 days of delivery',
        ruleType: 'timing',
        activities: ['Delivery', 'Invoice'],
        maxDays: 5,
        materiality: 0.7,
      },
    ];

    const events: ActualEvent[] = [
      { caseId: 'C1', activity: 'Delivery', timestamp: daysFromNow(-10) },
      { caseId: 'C1', activity: 'Invoice', timestamp: daysFromNow(-2) },
    ];

    const findings = detector.detectGaps(rules, events);

    expect(findings).toHaveLength(1);
    expect(findings[0]!.ruleId).toBe('SLA-001');
    expect(findings[0]!.violationType).toBe('timing');
    expect(findings[0]!.description).toMatch(/SLA breach/);
  });

  // 3. Detects approval bypass (amount > threshold, no approval event)
  it('detects approval bypass when amount exceeds threshold', () => {
    const rules: WorkflowRule[] = [
      {
        ruleId: 'APR-001',
        description: 'Manager approval for PO > 10000',
        ruleType: 'approval',
        activities: ['Create PO', 'Manager Approval'],
        approvalThreshold: 10_000,
        materiality: 0.9,
      },
    ];

    const events: ActualEvent[] = [
      {
        caseId: 'C1',
        activity: 'Create PO',
        timestamp: daysFromNow(-3),
        amount: 25_000,
      },
      { caseId: 'C1', activity: 'Goods Receipt', timestamp: daysFromNow(-1) },
    ];

    const findings = detector.detectGaps(rules, events);

    expect(findings).toHaveLength(1);
    expect(findings[0]!.ruleId).toBe('APR-001');
    expect(findings[0]!.violationType).toBe('approval');
    expect(findings[0]!.description).toMatch(/bypass/i);
  });

  // 4. Returns empty when all rules followed
  it('returns empty findings when all rules are followed', () => {
    const rules: WorkflowRule[] = [
      {
        ruleId: 'SEQ-001',
        description: 'Create PO before Goods Receipt',
        ruleType: 'sequence',
        activities: ['Create PO', 'Goods Receipt'],
        materiality: 0.8,
      },
      {
        ruleId: 'SLA-001',
        description: 'Invoice within 5 days of delivery',
        ruleType: 'timing',
        activities: ['Delivery', 'Invoice'],
        maxDays: 5,
        materiality: 0.7,
      },
    ];

    const events: ActualEvent[] = [
      { caseId: 'C1', activity: 'Create PO', timestamp: daysFromNow(-10) },
      { caseId: 'C1', activity: 'Goods Receipt', timestamp: daysFromNow(-8) },
      { caseId: 'C1', activity: 'Delivery', timestamp: daysFromNow(-6) },
      { caseId: 'C1', activity: 'Invoice', timestamp: daysFromNow(-3) },
    ];

    const findings = detector.detectGaps(rules, events);

    expect(findings).toHaveLength(0);
  });

  // 5. Groups events by caseId correctly
  it('groups events by caseId correctly', () => {
    const rules: WorkflowRule[] = [
      {
        ruleId: 'SEQ-001',
        description: 'A before B',
        ruleType: 'sequence',
        activities: ['A', 'B'],
        materiality: 0.5,
      },
    ];

    // Case C1: correct order. Case C2: wrong order.
    const events: ActualEvent[] = [
      { caseId: 'C1', activity: 'A', timestamp: daysFromNow(-5) },
      { caseId: 'C1', activity: 'B', timestamp: daysFromNow(-3) },
      { caseId: 'C2', activity: 'B', timestamp: daysFromNow(-5) },
      { caseId: 'C2', activity: 'A', timestamp: daysFromNow(-3) },
    ];

    const findings = detector.detectGaps(rules, events);

    expect(findings).toHaveLength(1);
    expect(findings[0]!.caseIds).toEqual(['C2']);
    expect(findings[0]!.frequency).toBe(1);
  });

  // 6. Handles multiple cases with mixed compliance
  it('handles multiple cases with mixed compliance', () => {
    const rules: WorkflowRule[] = [
      {
        ruleId: 'SLA-001',
        description: 'Process within 3 days',
        ruleType: 'timing',
        activities: ['Start', 'Complete'],
        maxDays: 3,
        materiality: 0.6,
      },
    ];

    // C1: 2 days (OK), C2: 5 days (violation), C3: 1 day (OK), C4: 4 days (violation)
    const events: ActualEvent[] = [
      ...makeEvents('C1', [
        { activity: 'Start', daysOffset: -10 },
        { activity: 'Complete', daysOffset: -8 },
      ]),
      ...makeEvents('C2', [
        { activity: 'Start', daysOffset: -10 },
        { activity: 'Complete', daysOffset: -5 },
      ]),
      ...makeEvents('C3', [
        { activity: 'Start', daysOffset: -10 },
        { activity: 'Complete', daysOffset: -9 },
      ]),
      ...makeEvents('C4', [
        { activity: 'Start', daysOffset: -10 },
        { activity: 'Complete', daysOffset: -6 },
      ]),
    ];

    const findings = detector.detectGaps(rules, events);

    expect(findings).toHaveLength(1);
    expect(findings[0]!.frequency).toBe(2);
    expect(findings[0]!.caseIds).toContain('C2');
    expect(findings[0]!.caseIds).toContain('C4');
    expect(findings[0]!.caseIds).not.toContain('C1');
    expect(findings[0]!.caseIds).not.toContain('C3');
  });

  // 7. Frequency counted correctly across cases
  it('counts frequency correctly across many violating cases', () => {
    const rules: WorkflowRule[] = [
      {
        ruleId: 'SEQ-001',
        description: 'X before Y',
        ruleType: 'sequence',
        activities: ['X', 'Y'],
        materiality: 0.5,
      },
    ];

    // 5 cases all violating (Y before X)
    const events: ActualEvent[] = [];
    for (let i = 1; i <= 5; i++) {
      events.push(
        { caseId: `C${i}`, activity: 'Y', timestamp: daysFromNow(-10) },
        { caseId: `C${i}`, activity: 'X', timestamp: daysFromNow(-5) }
      );
    }

    const findings = detector.detectGaps(rules, events);

    expect(findings).toHaveLength(1);
    expect(findings[0]!.frequency).toBe(5);
    expect(findings[0]!.caseIds).toHaveLength(5);
  });

  // 8. Scoring: high frequency + high materiality + recent = CRITICAL
  it('scores CRITICAL for high frequency + high materiality + recent', () => {
    const rules: WorkflowRule[] = [
      {
        ruleId: 'SEQ-001',
        description: 'A before B',
        ruleType: 'sequence',
        activities: ['A', 'B'],
        materiality: 1.0,
      },
    ];

    // 15 cases (frequency > 10 normalizes to 1.0), all very recent
    const events: ActualEvent[] = [];
    for (let i = 1; i <= 15; i++) {
      events.push(
        { caseId: `C${i}`, activity: 'B', timestamp: daysFromNow(-2) },
        { caseId: `C${i}`, activity: 'A', timestamp: daysFromNow(-1) }
      );
    }

    const findings = detector.detectGaps(rules, events);

    expect(findings).toHaveLength(1);
    expect(findings[0]!.severity).toBe('CRITICAL');
    expect(findings[0]!.score).toBeGreaterThan(0.8);
  });

  // 9. Scoring: low frequency + low materiality + old = INFO
  it('scores INFO for low frequency + low materiality + old events', () => {
    const rules: WorkflowRule[] = [
      {
        ruleId: 'SEQ-001',
        description: 'A before B',
        ruleType: 'sequence',
        activities: ['A', 'B'],
        materiality: 0.1,
      },
    ];

    // 1 case, happened 300 days ago
    const events: ActualEvent[] = [
      { caseId: 'C1', activity: 'B', timestamp: daysFromNow(-300) },
      { caseId: 'C1', activity: 'A', timestamp: daysFromNow(-299) },
    ];

    const findings = detector.detectGaps(rules, events);

    expect(findings).toHaveLength(1);
    expect(findings[0]!.severity).toBe('INFO');
    expect(findings[0]!.score).toBeLessThanOrEqual(0.2);
  });

  // 10. GapFinding has gapType='compliance' and expectedSource='documented'
  it('sets gapType to compliance and expectedSource to documented', () => {
    const rules: WorkflowRule[] = [
      {
        ruleId: 'SEQ-001',
        description: 'A before B',
        ruleType: 'sequence',
        activities: ['A', 'B'],
        materiality: 0.5,
      },
    ];

    const events: ActualEvent[] = [
      { caseId: 'C1', activity: 'B', timestamp: daysFromNow(-5) },
      { caseId: 'C1', activity: 'A', timestamp: daysFromNow(-3) },
    ];

    const findings = detector.detectGaps(rules, events);

    expect(findings).toHaveLength(1);
    expect(findings[0]!.gapType).toBe('compliance');
    expect(findings[0]!.expectedSource).toBe('documented');
  });

  // 11. Events without matching rules are ignored
  it('ignores events that have no matching rule activities', () => {
    const rules: WorkflowRule[] = [
      {
        ruleId: 'SEQ-001',
        description: 'A before B',
        ruleType: 'sequence',
        activities: ['A', 'B'],
        materiality: 0.5,
      },
    ];

    // Events reference activities X, Y, Z — none match the rule
    const events: ActualEvent[] = [
      { caseId: 'C1', activity: 'X', timestamp: daysFromNow(-5) },
      { caseId: 'C1', activity: 'Y', timestamp: daysFromNow(-4) },
      { caseId: 'C1', activity: 'Z', timestamp: daysFromNow(-3) },
    ];

    const findings = detector.detectGaps(rules, events);

    expect(findings).toHaveLength(0);
  });

  // 12. Rules with no matching events produce no findings
  it('produces no findings when no events exist', () => {
    const rules: WorkflowRule[] = [
      {
        ruleId: 'SEQ-001',
        description: 'A before B',
        ruleType: 'sequence',
        activities: ['A', 'B'],
        materiality: 0.8,
      },
      {
        ruleId: 'SLA-001',
        description: 'Fast processing',
        ruleType: 'timing',
        activities: ['Start', 'End'],
        maxDays: 3,
        materiality: 0.7,
      },
      {
        ruleId: 'APR-001',
        description: 'Approval needed',
        ruleType: 'approval',
        activities: ['Purchase', 'Approve'],
        approvalThreshold: 5_000,
        materiality: 0.9,
      },
    ];

    const events: ActualEvent[] = [];

    const findings = detector.detectGaps(rules, events);

    expect(findings).toHaveLength(0);
  });

  // 13. Approval rule: amount below threshold produces no finding
  it('does not flag approval when amount is below threshold', () => {
    const rules: WorkflowRule[] = [
      {
        ruleId: 'APR-001',
        description: 'Manager approval for PO > 10000',
        ruleType: 'approval',
        activities: ['Create PO', 'Manager Approval'],
        approvalThreshold: 10_000,
        materiality: 0.9,
      },
    ];

    const events: ActualEvent[] = [
      {
        caseId: 'C1',
        activity: 'Create PO',
        timestamp: daysFromNow(-3),
        amount: 5_000,
      },
    ];

    const findings = detector.detectGaps(rules, events);

    expect(findings).toHaveLength(0);
  });

  // 14. Multiple rules can each produce separate findings
  it('produces separate findings for different violated rules', () => {
    const rules: WorkflowRule[] = [
      {
        ruleId: 'SEQ-001',
        description: 'A before B',
        ruleType: 'sequence',
        activities: ['A', 'B'],
        materiality: 0.5,
      },
      {
        ruleId: 'SLA-001',
        description: 'Start to End within 2 days',
        ruleType: 'timing',
        activities: ['Start', 'End'],
        maxDays: 2,
        materiality: 0.6,
      },
    ];

    const events: ActualEvent[] = [
      // Sequence violation
      { caseId: 'C1', activity: 'B', timestamp: daysFromNow(-10) },
      { caseId: 'C1', activity: 'A', timestamp: daysFromNow(-8) },
      // Timing violation
      { caseId: 'C1', activity: 'Start', timestamp: daysFromNow(-10) },
      { caseId: 'C1', activity: 'End', timestamp: daysFromNow(-3) },
    ];

    const findings = detector.detectGaps(rules, events);

    expect(findings).toHaveLength(2);
    const ruleIds = findings.map(f => f.ruleId);
    expect(ruleIds).toContain('SEQ-001');
    expect(ruleIds).toContain('SLA-001');
  });
});
