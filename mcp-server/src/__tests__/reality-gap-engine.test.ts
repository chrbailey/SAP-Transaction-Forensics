/**
 * Tests for RealityGapEngine
 *
 * Covers: full three-way analysis, individual detector methods,
 * filtering, sorting, config toggling, counts, and timing.
 */

import { RealityGapEngine } from '../reality-gap/engine.js';
import type {
  ActualEvent,
  GapDetectionResult,
  GapFinding,
  ReferenceStep,
  WorkflowRule,
} from '../reality-gap/types.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeReferenceStep(overrides: Partial<ReferenceStep> = {}): ReferenceStep {
  return {
    modelId: 'o2c-detailed',
    stepIndex: 1,
    activityName: 'Create Sales Order',
    expectedNext: ['Check Credit'],
    required: true,
    ...overrides,
  };
}

function makeRule(overrides: Partial<WorkflowRule> = {}): WorkflowRule {
  return {
    id: 'RULE-001',
    sourceDocument: 'SOP-AP-001 v3.2',
    section: 'Section 4.2 - Approval Thresholds',
    ruleText: 'Approval required for purchase orders above threshold',
    systemScope: 'SAP',
    ruleType: 'approval_threshold',
    parameters: { threshold: 50000, currency: 'USD' },
    active: true,
    ...overrides,
  };
}

function makeEvent(overrides: Partial<ActualEvent> = {}): ActualEvent {
  return {
    caseId: 'CASE-001',
    activityName: 'Create Purchase Order',
    timestamp: '2025-06-15T10:00:00Z',
    userId: 'USER-01',
    systemType: 'SAP',
    tableName: 'EKKO',
    recordId: 'REC-001',
    ...overrides,
  };
}

/** Reference steps with one undocumented required step */
function fixtureRefSteps(): ReferenceStep[] {
  return [
    makeReferenceStep({ activityName: 'Create Sales Order', stepIndex: 1 }),
    makeReferenceStep({ activityName: 'Check Credit', stepIndex: 2 }),
    makeReferenceStep({ activityName: 'Ship Goods', stepIndex: 3 }),
  ];
}

/** Rules that cover only some reference steps */
function fixtureRules(): WorkflowRule[] {
  return [
    makeRule({
      id: 'RULE-001',
      ruleText: 'Create Sales Order must be logged',
      ruleType: 'sequence_requirement',
      parameters: {},
    }),
    makeRule({
      id: 'RULE-002',
      ruleText: 'Approval required for amounts above threshold',
      ruleType: 'approval_threshold',
      parameters: { threshold: 50000 },
    }),
  ];
}

/** Events with one shadow activity */
function fixtureEvents(): ActualEvent[] {
  return [
    makeEvent({ caseId: 'CASE-001', activityName: 'Create Sales Order' }),
    makeEvent({ caseId: 'CASE-001', activityName: 'Manual Override', recordId: 'REC-002' }),
    makeEvent({ caseId: 'CASE-002', activityName: 'Create Sales Order', recordId: 'REC-003' }),
    makeEvent({ caseId: 'CASE-002', activityName: 'Manual Override', recordId: 'REC-004' }),
    makeEvent({ caseId: 'CASE-003', activityName: 'Manual Override', recordId: 'REC-005' }),
  ];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RealityGapEngine', () => {
  let engine: RealityGapEngine;

  beforeEach(() => {
    engine = new RealityGapEngine();
  });

  // 1. analyze runs all three detectors
  test('analyze runs all three detectors', () => {
    const result = engine.analyze(fixtureRefSteps(), fixtureRules(), fixtureEvents());

    // Should have findings from design, compliance, and shadow
    expect(result.designGaps).toBeDefined();
    expect(result.complianceGaps).toBeDefined();
    expect(result.shadowGaps).toBeDefined();

    // We expect at least one design gap (undocumented steps), one compliance
    // gap (approval threshold), and one shadow gap (Manual Override)
    expect(result.designGaps.length).toBeGreaterThan(0);
    expect(result.complianceGaps.length).toBeGreaterThan(0);
    expect(result.shadowGaps.length).toBeGreaterThan(0);
  });

  // 2. analyze returns GapDetectionResult with all three gap arrays
  test('analyze returns GapDetectionResult with all expected fields', () => {
    const result = engine.analyze(fixtureRefSteps(), fixtureRules(), fixtureEvents());

    expect(result).toHaveProperty('designGaps');
    expect(result).toHaveProperty('complianceGaps');
    expect(result).toHaveProperty('shadowGaps');
    expect(result).toHaveProperty('totalCasesAnalyzed');
    expect(result).toHaveProperty('totalEventsAnalyzed');
    expect(result).toHaveProperty('duration');

    expect(Array.isArray(result.designGaps)).toBe(true);
    expect(Array.isArray(result.complianceGaps)).toBe(true);
    expect(Array.isArray(result.shadowGaps)).toBe(true);
  });

  // 3. analyze respects config.includeDesignGaps=false
  test('analyze skips design gaps when includeDesignGaps=false', () => {
    engine.updateConfig({ includeDesignGaps: false });
    const result = engine.analyze(fixtureRefSteps(), fixtureRules(), fixtureEvents());

    expect(result.designGaps).toHaveLength(0);
    expect(result.complianceGaps.length).toBeGreaterThan(0);
    expect(result.shadowGaps.length).toBeGreaterThan(0);
  });

  // 4. analyze respects config.includeComplianceGaps=false
  test('analyze skips compliance gaps when includeComplianceGaps=false', () => {
    engine.updateConfig({ includeComplianceGaps: false });
    const result = engine.analyze(fixtureRefSteps(), fixtureRules(), fixtureEvents());

    expect(result.complianceGaps).toHaveLength(0);
    expect(result.designGaps.length).toBeGreaterThan(0);
    expect(result.shadowGaps.length).toBeGreaterThan(0);
  });

  // 5. analyze respects config.includeShadowGaps=false
  test('analyze skips shadow gaps when includeShadowGaps=false', () => {
    engine.updateConfig({ includeShadowGaps: false });
    const result = engine.analyze(fixtureRefSteps(), fixtureRules(), fixtureEvents());

    expect(result.shadowGaps).toHaveLength(0);
    expect(result.designGaps.length).toBeGreaterThan(0);
    expect(result.complianceGaps.length).toBeGreaterThan(0);
  });

  // 6. filterFindings removes below minFrequency
  test('filterFindings removes findings below minFrequency', () => {
    engine.updateConfig({ minFrequency: 3 });
    const result = engine.analyze(fixtureRefSteps(), fixtureRules(), fixtureEvents());

    // Design gaps have frequency=1, should be filtered out
    expect(result.designGaps).toHaveLength(0);

    // Shadow gap for "Manual Override" has frequency=3, should survive
    const shadowManual = result.shadowGaps.filter(g => g.title.includes('Manual Override'));
    expect(shadowManual.length).toBeGreaterThanOrEqual(1);
  });

  // 7. filterFindings removes below minMateriality
  test('filterFindings removes findings below minMateriality', () => {
    engine.updateConfig({ minMateriality: 0.75 });
    const result = engine.analyze(fixtureRefSteps(), fixtureRules(), fixtureEvents());

    // All findings with materiality < 0.75 should be gone
    const allFindings = [...result.designGaps, ...result.complianceGaps, ...result.shadowGaps];
    for (const f of allFindings) {
      expect(f.materiality).toBeGreaterThanOrEqual(0.75);
    }
  });

  // 8. sortFindings orders by composite score descending
  test('sortFindings orders by composite score descending', () => {
    const result = engine.analyze(fixtureRefSteps(), fixtureRules(), fixtureEvents());

    function compositeScore(f: GapFinding): number {
      const severityWeight: Record<string, number> = {
        CRITICAL: 1.0,
        HIGH: 0.8,
        MEDIUM: 0.5,
        LOW: 0.3,
        INFO: 0.1,
      };
      return (severityWeight[f.severity] ?? 0) * f.materiality * Math.log2(f.frequency + 1);
    }

    // Check each gap array is sorted descending by composite score
    for (const gaps of [result.designGaps, result.complianceGaps, result.shadowGaps]) {
      for (let i = 1; i < gaps.length; i++) {
        const prev = gaps[i - 1]!;
        const curr = gaps[i]!;
        expect(compositeScore(prev)).toBeGreaterThanOrEqual(compositeScore(curr));
      }
    }
  });

  // 9. analyzeDesignGaps runs only design detector
  test('analyzeDesignGaps returns only design-type findings', () => {
    const findings = engine.analyzeDesignGaps(fixtureRefSteps(), fixtureRules());

    expect(findings.length).toBeGreaterThan(0);
    for (const f of findings) {
      expect(f.gapType).toBe('design');
    }
  });

  // 10. analyzeComplianceGaps runs only compliance detector
  test('analyzeComplianceGaps returns only compliance-type findings', () => {
    const findings = engine.analyzeComplianceGaps(fixtureRules(), fixtureEvents());

    expect(findings.length).toBeGreaterThan(0);
    for (const f of findings) {
      expect(f.gapType).toBe('compliance');
    }
  });

  // 11. analyzeShadowGaps runs only shadow detector
  test('analyzeShadowGaps returns only shadow-type findings', () => {
    const findings = engine.analyzeShadowGaps(fixtureRefSteps(), fixtureRules(), fixtureEvents());

    expect(findings.length).toBeGreaterThan(0);
    for (const f of findings) {
      expect(f.gapType).toBe('shadow');
    }
  });

  // 12. totalCasesAnalyzed counted from unique caseIds
  test('totalCasesAnalyzed reflects unique case IDs', () => {
    const events = fixtureEvents(); // CASE-001, CASE-002, CASE-003
    const result = engine.analyze(fixtureRefSteps(), fixtureRules(), events);

    expect(result.totalCasesAnalyzed).toBe(3);
  });

  // 13. totalEventsAnalyzed counted correctly
  test('totalEventsAnalyzed reflects total event count', () => {
    const events = fixtureEvents(); // 5 events
    const result = engine.analyze(fixtureRefSteps(), fixtureRules(), events);

    expect(result.totalEventsAnalyzed).toBe(5);
  });

  // 14. duration is a positive number
  test('duration is a positive number', () => {
    const result = engine.analyze(fixtureRefSteps(), fixtureRules(), fixtureEvents());

    expect(typeof result.duration).toBe('number');
    expect(result.duration).toBeGreaterThanOrEqual(0);
  });

  // 15. updateConfig changes behavior
  test('updateConfig changes filtering behavior', () => {
    // First run: default config — design gaps should appear
    const before = engine.analyze(fixtureRefSteps(), fixtureRules(), fixtureEvents());
    expect(before.designGaps.length).toBeGreaterThan(0);

    // After config update: disable design gaps
    engine.updateConfig({ includeDesignGaps: false });
    const after = engine.analyze(fixtureRefSteps(), fixtureRules(), fixtureEvents());
    expect(after.designGaps).toHaveLength(0);
  });
});
