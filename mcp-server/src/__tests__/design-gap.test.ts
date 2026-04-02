/**
 * Tests for DesignGapDetector
 *
 * Covers: missing required steps, fully-documented processes, weakened
 * approval thresholds, missing SoD constraints, extra documented steps,
 * multiple-gap scenarios, severity correctness, and gapType/expectedSource.
 */

import {
  DesignGapDetector,
  resetIdCounter,
  type GapFinding,
  type ReferenceStep,
  type WorkflowRule,
} from '../reality-gap/design-gap.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeStep(overrides: Partial<ReferenceStep> = {}): ReferenceStep {
  return {
    modelId: 'p2p-simple',
    stepIndex: 1,
    activityName: 'Purchase Order Created',
    expectedNext: ['Goods Receipt'],
    required: true,
    ...overrides,
  };
}

function makeRule(overrides: Partial<WorkflowRule> = {}): WorkflowRule {
  return {
    id: 'WR-001',
    sourceDocument: 'SOP-100',
    section: '3.1',
    ruleText: 'Purchase Order Created',
    systemScope: 'SAP',
    ruleType: 'step',
    parameters: {},
    active: true,
    ...overrides,
  };
}

/** A minimal P2P-style reference with 4 steps. */
function p2pReferenceSteps(): ReferenceStep[] {
  return [
    makeStep({
      stepIndex: 1,
      activityName: 'Purchase Order Created',
      expectedNext: ['Goods Receipt'],
    }),
    makeStep({ stepIndex: 2, activityName: 'Goods Receipt', expectedNext: ['Invoice Receipt'] }),
    makeStep({ stepIndex: 3, activityName: 'Invoice Receipt', expectedNext: ['Invoice Cleared'] }),
    makeStep({ stepIndex: 4, activityName: 'Invoice Cleared', expectedNext: [] }),
  ];
}

/** Documented rules that fully cover the 4-step P2P reference. */
function fullyDocumentedRules(): WorkflowRule[] {
  return [
    makeRule({ id: 'WR-001', ruleText: 'Purchase Order Created' }),
    makeRule({ id: 'WR-002', ruleText: 'Goods Receipt' }),
    makeRule({ id: 'WR-003', ruleText: 'Invoice Receipt' }),
    makeRule({ id: 'WR-004', ruleText: 'Invoice Cleared' }),
  ];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

let detector: DesignGapDetector;

beforeEach(() => {
  resetIdCounter();
  detector = new DesignGapDetector();
});

describe('DesignGapDetector', () => {
  // 1. Detects missing required step from reference
  it('detects a missing required step', () => {
    const steps = p2pReferenceSteps();
    // Document only 3 of 4 steps — omit "Goods Receipt"
    const rules = fullyDocumentedRules().filter(r => r.ruleText !== 'Goods Receipt');

    const gaps = detector.detectGaps(steps, rules);

    const missing = gaps.find(
      g => g.title.includes('Goods Receipt') && g.title.startsWith('Missing')
    );
    expect(missing).toBeDefined();
    expect(missing!.severity).toBe('HIGH');
    expect(missing!.gapType).toBe('design');
  });

  // 2. Returns empty for fully documented process
  it('returns no missing-step gaps when process is fully documented', () => {
    const steps = p2pReferenceSteps();
    const rules = fullyDocumentedRules();

    const gaps = detector.detectGaps(steps, rules);

    // Filter to only missing-step findings
    const missingStepGaps = gaps.filter(
      g => g.title.startsWith('Missing required step') || g.title.startsWith('Missing step')
    );
    expect(missingStepGaps).toHaveLength(0);
  });

  // 3. Detects weakened approval threshold
  it('detects weakened approval threshold', () => {
    const steps: ReferenceStep[] = [
      makeStep({
        stepIndex: 1,
        activityName: 'Purchase Order Created',
        required: true,
      }),
      makeStep({
        stepIndex: 2,
        activityName: 'Approval Complete',
        required: false,
      }),
    ];

    const rules: WorkflowRule[] = [
      makeRule({ id: 'WR-001', ruleText: 'Purchase Order Created' }),
      makeRule({
        id: 'WR-010',
        ruleType: 'approval',
        ruleText: 'Approval Complete',
        parameters: {
          threshold: 50000,
          referenceThreshold: 10000,
        },
      }),
    ];

    const gaps = detector.detectGaps(steps, rules);

    const threshold = gaps.find(g => g.title.includes('Weakened approval'));
    expect(threshold).toBeDefined();
    expect(threshold!.severity).toBe('MEDIUM');
    expect(threshold!.description).toContain('50000');
    expect(threshold!.description).toContain('10000');
  });

  // 4. Detects missing SoD constraint
  it('detects missing SoD constraint', () => {
    const steps: ReferenceStep[] = [
      makeStep({ stepIndex: 1, activityName: 'Create Purchase Order' }),
      makeStep({ stepIndex: 2, activityName: 'Approve Purchase Order' }),
    ];

    // No SoD rules at all
    const rules: WorkflowRule[] = [
      makeRule({ id: 'WR-001', ruleText: 'Create Purchase Order' }),
      makeRule({ id: 'WR-002', ruleText: 'Approve Purchase Order', ruleType: 'approval' }),
    ];

    const gaps = detector.detectGaps(steps, rules);

    const sod = gaps.find(g => g.title.includes('Missing SoD'));
    expect(sod).toBeDefined();
    expect(sod!.severity).toBe('HIGH');
    expect(sod!.description).toContain('segregation of duties');
  });

  // 5. Extra documented steps flagged as LOW
  it('flags extra documented steps as LOW severity', () => {
    const steps = p2pReferenceSteps();
    const rules = [
      ...fullyDocumentedRules(),
      makeRule({
        id: 'WR-EXTRA',
        ruleType: 'step',
        ruleText: 'Manager Sign-Off',
      }),
    ];

    const gaps = detector.detectGaps(steps, rules);

    const extra = gaps.find(g => g.title.includes('Extra documented step'));
    expect(extra).toBeDefined();
    expect(extra!.severity).toBe('LOW');
    expect(extra!.title).toContain('Manager Sign-Off');
  });

  // 6. Multiple gaps from one comparison
  it('returns multiple gaps when several issues exist', () => {
    const steps: ReferenceStep[] = [
      makeStep({ stepIndex: 1, activityName: 'Create Invoice' }),
      makeStep({ stepIndex: 2, activityName: 'Approve Invoice' }),
      makeStep({ stepIndex: 3, activityName: 'Clear Invoice' }),
    ];

    // Only document step 1 — missing step 2 & 3, plus no SoD
    const rules: WorkflowRule[] = [makeRule({ id: 'WR-001', ruleText: 'Create Invoice' })];

    const gaps = detector.detectGaps(steps, rules);

    // At least 2 missing-step + SoD gaps
    expect(gaps.length).toBeGreaterThanOrEqual(2);

    const missingGaps = gaps.filter(g => g.title.startsWith('Missing'));
    expect(missingGaps.length).toBeGreaterThanOrEqual(2);
  });

  // 7. Severity correct for each gap type
  it('assigns correct severity per gap type', () => {
    const steps: ReferenceStep[] = [
      makeStep({ stepIndex: 1, activityName: 'Create Purchase Order', required: true }),
      makeStep({ stepIndex: 2, activityName: 'Approve Purchase Order', required: false }),
    ];

    // No rules at all — triggers missing steps + SoD
    const rules: WorkflowRule[] = [];

    const gaps = detector.detectGaps(steps, rules);

    // Required missing step => HIGH
    const requiredMissing = gaps.find(
      g => g.title.includes('Create Purchase Order') && g.title.startsWith('Missing required')
    );
    expect(requiredMissing).toBeDefined();
    expect(requiredMissing!.severity).toBe('HIGH');

    // Non-required missing step => LOW
    const optionalMissing = gaps.find(
      g => g.title.includes('Approve Purchase Order') && g.title.startsWith('Missing step')
    );
    expect(optionalMissing).toBeDefined();
    expect(optionalMissing!.severity).toBe('LOW');

    // SoD => HIGH
    const sodGap = gaps.find(g => g.title.includes('Missing SoD'));
    expect(sodGap).toBeDefined();
    expect(sodGap!.severity).toBe('HIGH');
  });

  // 8. GapFinding has gapType='design' and expectedSource='reference'
  it('all findings have gapType "design" and expectedSource "reference"', () => {
    const steps = p2pReferenceSteps();
    // Remove one rule to produce at least one gap
    const rules = fullyDocumentedRules().slice(0, 2);

    const gaps = detector.detectGaps(steps, rules);
    expect(gaps.length).toBeGreaterThan(0);

    for (const g of gaps) {
      expect(g.gapType).toBe('design');
      expect(g.expectedSource).toBe('reference');
    }
  });

  // 9. Sequence deviation detected
  it('detects sequence deviation when docs reverse reference order', () => {
    const steps: ReferenceStep[] = [
      makeStep({ stepIndex: 1, activityName: 'Goods Receipt' }),
      makeStep({ stepIndex: 2, activityName: 'Invoice Receipt' }),
    ];

    const rules: WorkflowRule[] = [
      makeRule({ id: 'WR-001', ruleText: 'Goods Receipt' }),
      makeRule({ id: 'WR-002', ruleText: 'Invoice Receipt' }),
      makeRule({
        id: 'WR-SEQ',
        ruleType: 'sequence',
        ruleText: 'Invoice before Goods',
        parameters: { from: 'Invoice Receipt', to: 'Goods Receipt' },
      }),
    ];

    const gaps = detector.detectGaps(steps, rules);

    const seqGap = gaps.find(g => g.title.includes('Sequence deviation'));
    expect(seqGap).toBeDefined();
    expect(seqGap!.severity).toBe('MEDIUM');
  });

  // 10. Inactive rules are ignored
  it('ignores inactive workflow rules', () => {
    const steps = p2pReferenceSteps();
    // All rules inactive
    const rules = fullyDocumentedRules().map(r => ({ ...r, active: false }));

    const gaps = detector.detectGaps(steps, rules);

    // All steps should show as missing (4 missing steps + possible SoD gaps)
    const missingStepGaps = gaps.filter(
      g => g.title.startsWith('Missing') && !g.title.includes('SoD')
    );
    expect(missingStepGaps.length).toBe(4);
  });

  // 11. SoD gap not raised when SoD rule exists
  it('does not flag SoD when documented SoD rule covers the pair', () => {
    const steps: ReferenceStep[] = [
      makeStep({ stepIndex: 1, activityName: 'Create Purchase Order' }),
      makeStep({ stepIndex: 2, activityName: 'Approve Purchase Order' }),
    ];

    const rules: WorkflowRule[] = [
      makeRule({ id: 'WR-001', ruleText: 'Create Purchase Order' }),
      makeRule({ id: 'WR-002', ruleText: 'Approve Purchase Order', ruleType: 'approval' }),
      makeRule({
        id: 'WR-SOD',
        ruleType: 'sod',
        ruleText: 'Create Purchase Order / Approve Purchase Order segregation',
        parameters: {
          stepA: 'Create Purchase Order',
          stepB: 'Approve Purchase Order',
        },
      }),
    ];

    const gaps = detector.detectGaps(steps, rules);

    const sodGap = gaps.find(g => g.title.includes('Missing SoD'));
    expect(sodGap).toBeUndefined();
  });

  // 12. Each finding gets a unique ID
  it('assigns unique IDs to each finding', () => {
    const steps: ReferenceStep[] = [
      makeStep({ stepIndex: 1, activityName: 'Create Invoice' }),
      makeStep({ stepIndex: 2, activityName: 'Approve Invoice' }),
      makeStep({ stepIndex: 3, activityName: 'Post Invoice' }),
    ];

    const rules: WorkflowRule[] = [];

    const gaps = detector.detectGaps(steps, rules);
    const ids = gaps.map(g => g.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });
});
