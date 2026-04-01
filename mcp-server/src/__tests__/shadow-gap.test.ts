/**
 * Tests for ShadowGapDetector
 *
 * Covers shadow-process detection: activities in the actual event log
 * that have no counterpart in reference models or documented rules.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';

import {
  ShadowGapDetector,
  _resetGapIdCounter,
} from '../reality-gap/shadow-gap.js';

import type {
  ReferenceStep,
  WorkflowRule,
  ActualEvent,
} from '../reality-gap/types.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

type SystemType = 'SAP' | 'NetSuite' | 'Salesforce';

function makeStep(overrides: Partial<ReferenceStep> = {}): ReferenceStep {
  return {
    modelId: 'o2c-detailed',
    stepIndex: 1,
    activityName: 'Create Order',
    sapTcode: 'VA01',
    expectedNext: ['Approve Order'],
    required: true,
    ...overrides,
  };
}

function makeRule(overrides: Partial<WorkflowRule> = {}): WorkflowRule {
  return {
    id: 'rule-1',
    sourceDocument: 'SOP-AP-001 v3.2',
    section: 'Section 4.2',
    ruleText: 'Approval required above 50k',
    systemScope: 'SAP' as SystemType,
    ruleType: 'approval_threshold',
    parameters: { activityName: 'Approve Order', threshold: 50000 },
    active: true,
    ...overrides,
  };
}

function makeEvent(overrides: Partial<ActualEvent> = {}): ActualEvent {
  return {
    caseId: 'case-001',
    activityName: 'Create Order',
    timestamp: '2025-06-15T10:30:00Z',
    userId: 'USER01',
    systemType: 'SAP' as SystemType,
    tableName: 'VBAK',
    recordId: 'rec-001',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ShadowGapDetector', () => {
  let detector: ShadowGapDetector;

  beforeEach(() => {
    detector = new ShadowGapDetector();
    _resetGapIdCounter();
  });

  // 1. Detects activity not in reference or documented
  it('detects activity not in reference or documented rules', () => {
    const steps = [makeStep({ activityName: 'Create Order' })];
    const rules = [makeRule({ parameters: { activityName: 'Approve Order' } })];
    const events = [makeEvent({ activityName: 'Manual Override' })];

    const findings = detector.detectGaps(steps, rules, events);

    expect(findings.length).toBeGreaterThanOrEqual(1);
    expect(findings.some((f) => f.title.includes('Manual Override'))).toBe(true);
  });

  // 2. Returns empty when all activities are known
  it('returns empty when all activities are known', () => {
    const steps = [makeStep({ activityName: 'Create Order' })];
    const rules = [makeRule({ parameters: { activityName: 'Approve Order' } })];
    const events = [
      makeEvent({ activityName: 'Create Order' }),
      makeEvent({ activityName: 'Approve Order' }),
    ];

    const findings = detector.detectGaps(steps, rules, events);

    expect(findings).toHaveLength(0);
  });

  // 3. Fuzzy matching: "Create Order" matches "create_order" (normalized)
  it('fuzzy matches "Create Order" against "create_order" via normalization', () => {
    const steps = [makeStep({ activityName: 'create_order' })];
    const rules: WorkflowRule[] = [];
    const events = [makeEvent({ activityName: 'Create Order' })];

    const findings = detector.detectGaps(steps, rules, events);

    expect(findings).toHaveLength(0);
  });

  // 4. Detects high-privilege shadow (ADMIN user)
  it('detects high-privilege shadow for ADMIN user', () => {
    const steps = [makeStep({ activityName: 'Create Order' })];
    const rules: WorkflowRule[] = [];
    const events = [
      makeEvent({
        activityName: 'Backdoor Entry',
        userId: 'ADMIN',
        timestamp: '2025-06-15T10:00:00Z',
      }),
    ];

    const findings = detector.detectGaps(steps, rules, events);

    expect(findings.length).toBeGreaterThanOrEqual(1);
    const highPriv = findings.find((f) => f.title.includes('High-privilege'));
    expect(highPriv).toBeDefined();
    expect(highPriv!.severity).toBe('HIGH');
  });

  // 5. Detects after-hours shadow (10pm activity)
  it('detects after-hours shadow for 10pm activity', () => {
    const steps = [makeStep({ activityName: 'Create Order' })];
    const rules: WorkflowRule[] = [];
    const events = [
      makeEvent({
        activityName: 'Late Night Edit',
        userId: 'USER01',
        timestamp: '2025-06-15T22:00:00Z',
      }),
    ];

    const findings = detector.detectGaps(steps, rules, events);

    expect(findings.length).toBeGreaterThanOrEqual(1);
    const afterHrs = findings.find((f) => f.title.includes('After-hours'));
    expect(afterHrs).toBeDefined();
    expect(afterHrs!.severity).toBe('HIGH');
  });

  // 6. High volume shadow = MEDIUM severity
  it('assigns MEDIUM severity for high-volume shadow (>10 occurrences)', () => {
    const steps = [makeStep({ activityName: 'Create Order' })];
    const rules: WorkflowRule[] = [];
    const events = Array.from({ length: 15 }, (_, i) =>
      makeEvent({
        activityName: 'Bulk Upload',
        caseId: `case-${i}`,
        timestamp: '2025-06-15T10:00:00Z',
        userId: 'USER01',
      }),
    );

    const findings = detector.detectGaps(steps, rules, events);

    const bulkFinding = findings.find((f) => f.title.includes('Bulk Upload'));
    expect(bulkFinding).toBeDefined();
    expect(bulkFinding!.severity).toBe('MEDIUM');
    expect(bulkFinding!.frequency).toBe(15);
  });

  // 7. Single occurrence = INFO severity
  it('assigns INFO severity for single occurrence', () => {
    const steps = [makeStep({ activityName: 'Create Order' })];
    const rules: WorkflowRule[] = [];
    const events = [
      makeEvent({
        activityName: 'One Time Fix',
        userId: 'USER01',
        timestamp: '2025-06-15T10:00:00Z',
      }),
    ];

    const findings = detector.detectGaps(steps, rules, events);

    const oneTime = findings.find((f) => f.title.includes('One Time Fix'));
    expect(oneTime).toBeDefined();
    expect(oneTime!.severity).toBe('INFO');
  });

  // 8. GapFinding has gapType='shadow'
  it('all findings have gapType="shadow"', () => {
    const steps = [makeStep({ activityName: 'Create Order' })];
    const rules: WorkflowRule[] = [];
    const events = [
      makeEvent({ activityName: 'Unknown Activity A' }),
      makeEvent({ activityName: 'Unknown Activity B' }),
    ];

    const findings = detector.detectGaps(steps, rules, events);

    expect(findings.length).toBeGreaterThanOrEqual(1);
    for (const f of findings) {
      expect(f.gapType).toBe('shadow');
    }
  });

  // 9. Multiple shadow activities detected in one run
  it('detects multiple distinct shadow activities', () => {
    const steps = [makeStep({ activityName: 'Create Order' })];
    const rules: WorkflowRule[] = [];
    const events = [
      makeEvent({ activityName: 'Shadow Alpha' }),
      makeEvent({ activityName: 'Shadow Beta' }),
      makeEvent({ activityName: 'Shadow Gamma' }),
    ];

    const findings = detector.detectGaps(steps, rules, events);

    const titles = findings.map((f) => f.title);
    expect(titles.some((t) => t.includes('Shadow Alpha'))).toBe(true);
    expect(titles.some((t) => t.includes('Shadow Beta'))).toBe(true);
    expect(titles.some((t) => t.includes('Shadow Gamma'))).toBe(true);
  });

  // 10. Activities matching reference steps are NOT flagged
  it('does not flag activities that match reference steps', () => {
    const steps = [
      makeStep({ activityName: 'Create Order' }),
      makeStep({ activityName: 'Ship Goods', stepIndex: 2 }),
    ];
    const rules: WorkflowRule[] = [];
    const events = [
      makeEvent({ activityName: 'Create Order' }),
      makeEvent({ activityName: 'Ship Goods' }),
    ];

    const findings = detector.detectGaps(steps, rules, events);

    expect(findings).toHaveLength(0);
  });

  // 11. Activities matching documented rules are NOT flagged
  it('does not flag activities that match documented rules', () => {
    const steps: ReferenceStep[] = [];
    const rules = [
      makeRule({ parameters: { activityName: 'Three-Way Match' } }),
      makeRule({ id: 'rule-2', parameters: { activityName: 'Post Invoice' } }),
    ];
    const events = [
      makeEvent({ activityName: 'Three-Way Match' }),
      makeEvent({ activityName: 'Post Invoice' }),
    ];

    const findings = detector.detectGaps(steps, rules, events);

    expect(findings).toHaveLength(0);
  });

  // 12. normalizeActivity handles various formats
  it('normalizeActivity handles various formats', () => {
    expect(detector.normalizeActivity('Create Order')).toBe('create_order');
    expect(detector.normalizeActivity('create_order')).toBe('create_order');
    expect(detector.normalizeActivity('CREATE-ORDER')).toBe('create_order');
    expect(detector.normalizeActivity('create.order')).toBe('create_order');
    expect(detector.normalizeActivity('  Create   Order  ')).toBe('create_order');
    expect(detector.normalizeActivity('SHIP_GOODS')).toBe('ship_goods');
    expect(detector.normalizeActivity('three-way-match')).toBe('three_way_match');
  });
});
