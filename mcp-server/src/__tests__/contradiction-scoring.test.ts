/**
 * Tests for Contradiction Severity Scoring Module
 *
 * Covers: risk scoring formula, aggregate computation, sorting,
 * filtering, Markdown summary generation, and weight tables.
 */

import {
  computeRiskScore,
  computeAggregateRisk,
  sortByRisk,
  filterByMinRisk,
  generateRiskSummary,
  SEVERITY_WEIGHTS,
  TYPE_BASE_WEIGHTS,
} from '../contradiction/scoring.js';
import type {
  ContradictionFinding,
  ContradictionType,
  Severity,
} from '../contradiction/scoring.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFinding(overrides: Partial<ContradictionFinding> = {}): ContradictionFinding {
  return {
    id: `finding-${Math.random().toString(36).slice(2, 10)}`,
    type: 'AMOUNT_DIVERGENCE',
    severity: 'MEDIUM',
    confidence: 0.8,
    scoringDetails: {},
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// computeRiskScore
// ---------------------------------------------------------------------------

describe('computeRiskScore', () => {
  it('CRITICAL severity + high confidence + high type weight = near 100', () => {
    const finding = makeFinding({
      severity: 'CRITICAL',
      type: 'TEMPORAL_IMPOSSIBILITY',
      confidence: 1.0,
    });
    const score = computeRiskScore(finding);
    // 1.0 * 1.0 * 1.0 * 100 = 100
    expect(score).toBe(100);
  });

  it('INFO severity + low confidence = near 0', () => {
    const finding = makeFinding({
      severity: 'INFO',
      type: 'ORPHAN_RECORD',
      confidence: 0.1,
    });
    const score = computeRiskScore(finding);
    // 0.1 * 0.5 * 0.1 * 100 = 0.5
    expect(score).toBeLessThan(1);
    expect(score).toBeGreaterThan(0);
  });

  it('clamped to 0-100', () => {
    // Even with max values, should not exceed 100
    const finding = makeFinding({
      severity: 'CRITICAL',
      type: 'TEMPORAL_IMPOSSIBILITY',
      confidence: 1.5, // deliberately over 1
    });
    const score = computeRiskScore(finding);
    expect(score).toBeLessThanOrEqual(100);

    // Negative confidence should clamp to 0
    const negativeFinding = makeFinding({
      severity: 'CRITICAL',
      type: 'TEMPORAL_IMPOSSIBILITY',
      confidence: -0.5,
    });
    const negScore = computeRiskScore(negativeFinding);
    expect(negScore).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// computeAggregateRisk
// ---------------------------------------------------------------------------

describe('computeAggregateRisk', () => {
  it('correct severity counts', () => {
    const findings = [
      makeFinding({ severity: 'CRITICAL' }),
      makeFinding({ severity: 'CRITICAL' }),
      makeFinding({ severity: 'HIGH' }),
      makeFinding({ severity: 'MEDIUM' }),
      makeFinding({ severity: 'LOW' }),
      makeFinding({ severity: 'INFO' }),
    ];
    const agg = computeAggregateRisk(findings);
    expect(agg.criticalCount).toBe(2);
    expect(agg.highCount).toBe(1);
    expect(agg.mediumCount).toBe(1);
    expect(agg.lowCount).toBe(1);
    expect(agg.infoCount).toBe(1);
  });

  it('byType groups correctly', () => {
    const findings = [
      makeFinding({ type: 'AMOUNT_DIVERGENCE', severity: 'HIGH', confidence: 0.9 }),
      makeFinding({ type: 'AMOUNT_DIVERGENCE', severity: 'MEDIUM', confidence: 0.8 }),
      makeFinding({ type: 'DATE_CONFLICT', severity: 'LOW', confidence: 0.5 }),
    ];
    const agg = computeAggregateRisk(findings);
    expect(Object.keys(agg.byType)).toHaveLength(2);
    expect(agg.byType['AMOUNT_DIVERGENCE']!.count).toBe(2);
    expect(agg.byType['DATE_CONFLICT']!.count).toBe(1);
  });

  it('overallScore is weighted average', () => {
    const findings = [
      makeFinding({ severity: 'CRITICAL', type: 'TEMPORAL_IMPOSSIBILITY', confidence: 1.0 }),
      makeFinding({ severity: 'INFO', type: 'ORPHAN_RECORD', confidence: 0.1 }),
    ];
    const agg = computeAggregateRisk(findings);

    // Manually compute expected: (100 + 0.5) / 2 = 50.25
    const score1 = computeRiskScore(findings[0]!);
    const score2 = computeRiskScore(findings[1]!);
    const expected = (score1 + score2) / 2;
    expect(agg.overallScore).toBeCloseTo(expected, 5);
  });

  it('maxScore is the highest', () => {
    const findings = [
      makeFinding({ severity: 'LOW', type: 'ORPHAN_RECORD', confidence: 0.3 }),
      makeFinding({ severity: 'CRITICAL', type: 'TEMPORAL_IMPOSSIBILITY', confidence: 1.0 }),
      makeFinding({ severity: 'HIGH', type: 'SOD_VIOLATION', confidence: 0.7 }),
    ];
    const agg = computeAggregateRisk(findings);
    // CRITICAL + TEMPORAL_IMPOSSIBILITY + 1.0 = 100
    expect(agg.maxScore).toBe(100);
  });

  it('empty findings returns zeros', () => {
    const agg = computeAggregateRisk([]);
    expect(agg.overallScore).toBe(0);
    expect(agg.maxScore).toBe(0);
    expect(agg.criticalCount).toBe(0);
    expect(agg.highCount).toBe(0);
    expect(agg.mediumCount).toBe(0);
    expect(agg.lowCount).toBe(0);
    expect(agg.infoCount).toBe(0);
    expect(Object.keys(agg.byType)).toHaveLength(0);
    expect(Object.keys(agg.bySystem)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// sortByRisk
// ---------------------------------------------------------------------------

describe('sortByRisk', () => {
  it('highest score first', () => {
    const low = makeFinding({ id: 'low', severity: 'LOW', type: 'ORPHAN_RECORD', confidence: 0.3 });
    const high = makeFinding({ id: 'high', severity: 'CRITICAL', type: 'TEMPORAL_IMPOSSIBILITY', confidence: 1.0 });
    const mid = makeFinding({ id: 'mid', severity: 'MEDIUM', type: 'DATE_CONFLICT', confidence: 0.6 });

    const sorted = sortByRisk([low, high, mid]);
    expect(sorted[0]!.id).toBe('high');
    expect(sorted[2]!.id).toBe('low');
    // Verify descending order
    const scores = sorted.map(computeRiskScore);
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]!).toBeLessThanOrEqual(scores[i - 1]!);
    }
  });
});

// ---------------------------------------------------------------------------
// filterByMinRisk
// ---------------------------------------------------------------------------

describe('filterByMinRisk', () => {
  const findings = [
    makeFinding({ id: 'a', severity: 'CRITICAL', type: 'TEMPORAL_IMPOSSIBILITY', confidence: 1.0 }),
    makeFinding({ id: 'b', severity: 'MEDIUM', type: 'AMOUNT_DIVERGENCE', confidence: 0.5 }),
    makeFinding({ id: 'c', severity: 'INFO', type: 'ORPHAN_RECORD', confidence: 0.2 }),
  ];

  it('excludes below threshold', () => {
    const filtered = filterByMinRisk(findings, 50);
    // CRITICAL = 100, MEDIUM = 0.5*0.75*0.5*100 = 18.75, INFO = 0.1*0.5*0.2*100 = 1.0
    expect(filtered).toHaveLength(1);
    expect(filtered[0]!.id).toBe('a');
  });

  it('empty result when threshold too high', () => {
    const filtered = filterByMinRisk(findings, 101);
    expect(filtered).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// generateRiskSummary
// ---------------------------------------------------------------------------

describe('generateRiskSummary', () => {
  const findings = [
    makeFinding({
      id: 'f1',
      severity: 'CRITICAL',
      type: 'TEMPORAL_IMPOSSIBILITY',
      confidence: 1.0,
      description: 'Impossible time sequence in PO approval',
    }),
    makeFinding({
      id: 'f2',
      severity: 'HIGH',
      type: 'SOD_VIOLATION',
      confidence: 0.9,
      description: 'Same user created and approved invoice',
    }),
    makeFinding({
      id: 'f3',
      severity: 'MEDIUM',
      type: 'AMOUNT_DIVERGENCE',
      confidence: 0.7,
      description: 'PO amount differs from invoice by 15%',
    }),
  ];

  it('contains markdown table', () => {
    const md = generateRiskSummary(findings);
    expect(md).toContain('## Risk Summary');
    expect(md).toContain('| Type | Count | Avg Score | Max Score |');
    expect(md).toContain('|------|-------|-----------|-----------|');
    expect(md).toContain('TEMPORAL_IMPOSSIBILITY');
  });

  it('lists top findings', () => {
    const md = generateRiskSummary(findings);
    expect(md).toContain('### Top Findings');
    expect(md).toContain('Impossible time sequence');
    expect(md).toContain('Same user created and approved');
  });
});

// ---------------------------------------------------------------------------
// Weight table completeness
// ---------------------------------------------------------------------------

describe('TYPE_BASE_WEIGHTS', () => {
  it('TEMPORAL_IMPOSSIBILITY has highest weight', () => {
    const maxWeight = Math.max(...Object.values(TYPE_BASE_WEIGHTS));
    expect(TYPE_BASE_WEIGHTS.TEMPORAL_IMPOSSIBILITY).toBe(maxWeight);
  });

  it('all 12 types have weights', () => {
    const allTypes: ContradictionType[] = [
      'AMOUNT_DIVERGENCE',
      'DATE_CONFLICT',
      'STATUS_INCOMPATIBLE',
      'ENTITY_MISMATCH',
      'QUANTITY_DIVERGENCE',
      'APPROVAL_BYPASS',
      'TEMPORAL_IMPOSSIBILITY',
      'DUPLICATE_REFERENCE',
      'ORPHAN_RECORD',
      'RETROACTIVE_CHANGE',
      'SOD_VIOLATION',
      'SCHEMA_GHOST',
    ];
    expect(Object.keys(TYPE_BASE_WEIGHTS)).toHaveLength(12);
    for (const t of allTypes) {
      expect(TYPE_BASE_WEIGHTS[t]).toBeGreaterThan(0);
      expect(TYPE_BASE_WEIGHTS[t]).toBeLessThanOrEqual(1.0);
    }
  });
});
