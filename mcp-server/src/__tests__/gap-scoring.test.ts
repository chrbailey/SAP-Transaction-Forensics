/**
 * Tests for Gap Risk Scoring Module
 *
 * Covers: risk scoring formula, frequency normalization, aggregate
 * computation, sorting, Markdown summary generation, and weight tables.
 */

import {
  computeGapRiskScore,
  computeAggregateGapRisk,
  sortGapsByRisk,
  generateGapRiskSummary,
  GAP_TYPE_WEIGHTS,
  GAP_SEVERITY_WEIGHTS,
} from '../reality-gap/scoring.js';
import type { GapFinding } from '../reality-gap/scoring.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeGap(overrides: Partial<GapFinding> = {}): GapFinding {
  return {
    id: `gap-${Math.random().toString(36).slice(2, 10)}`,
    gapType: 'compliance',
    severity: 'MEDIUM',
    confidence: 0.8,
    title: 'Test gap finding',
    description: 'A test gap finding for unit tests',
    expectedSource: 'documented',
    expectedBehavior: 'Follow the SOP',
    actualBehavior: 'Skipped the SOP',
    actualEvents: ['evt-1', 'evt-2'],
    frequency: 5,
    materiality: 0.5,
    recency: 0.5,
    detectedAt: '2026-03-31T00:00:00Z',
    systemScope: 'SAP_ECC',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// computeGapRiskScore
// ---------------------------------------------------------------------------

describe('computeGapRiskScore', () => {
  it('compliance + CRITICAL + high materiality = near 100', () => {
    const gap = makeGap({
      gapType: 'compliance',
      severity: 'CRITICAL',
      confidence: 1.0,
      materiality: 1.0,
      frequency: 10,
      recency: 1.0,
    });
    const score = computeGapRiskScore(gap);
    // 1.0 * 1.0 * 1.0 * (0.4*1.0 + 0.3*1.0 + 0.3*1.0) * 100 = 100
    expect(score).toBe(100);
  });

  it('design + INFO + low materiality = near 0', () => {
    const gap = makeGap({
      gapType: 'design',
      severity: 'INFO',
      confidence: 0.1,
      materiality: 0.1,
      frequency: 1,
      recency: 0.1,
    });
    const score = computeGapRiskScore(gap);
    // 0.6 * 0.1 * 0.1 * (0.4*0.1 + 0.3*0.1 + 0.3*0.1) * 100 = 0.06
    expect(score).toBeLessThan(1);
    expect(score).toBeGreaterThanOrEqual(0);
  });

  it('result is clamped to 0-100', () => {
    // Even with all max values, score should not exceed 100
    const gap = makeGap({
      gapType: 'compliance',
      severity: 'CRITICAL',
      confidence: 1.0,
      materiality: 1.0,
      frequency: 100,
      recency: 1.0,
    });
    const score = computeGapRiskScore(gap);
    expect(score).toBeLessThanOrEqual(100);
    expect(score).toBeGreaterThanOrEqual(0);
  });

  it('frequency normalization caps at 1.0', () => {
    const gapLow = makeGap({ frequency: 5 });
    const gapHigh = makeGap({ frequency: 100 });
    const gapAt10 = makeGap({ frequency: 10 });

    const scoreLow = computeGapRiskScore(gapLow);
    const scoreHigh = computeGapRiskScore(gapHigh);
    const scoreAt10 = computeGapRiskScore(gapAt10);

    // freq=100 should equal freq=10 (both normalize to 1.0)
    expect(scoreHigh).toBe(scoreAt10);
    // freq=5 should be lower than freq=10
    expect(scoreLow).toBeLessThan(scoreAt10);
  });
});

// ---------------------------------------------------------------------------
// computeAggregateGapRisk
// ---------------------------------------------------------------------------

describe('computeAggregateGapRisk', () => {
  it('byType groups correctly', () => {
    const gaps = [
      makeGap({ gapType: 'compliance' }),
      makeGap({ gapType: 'compliance' }),
      makeGap({ gapType: 'shadow' }),
      makeGap({ gapType: 'design' }),
    ];
    const agg = computeAggregateGapRisk(gaps);
    expect(agg.byType.compliance.count).toBe(2);
    expect(agg.byType.shadow.count).toBe(1);
    expect(agg.byType.design.count).toBe(1);
  });

  it('bySeverity counts correctly', () => {
    const gaps = [
      makeGap({ severity: 'CRITICAL' }),
      makeGap({ severity: 'CRITICAL' }),
      makeGap({ severity: 'HIGH' }),
      makeGap({ severity: 'LOW' }),
      makeGap({ severity: 'INFO' }),
    ];
    const agg = computeAggregateGapRisk(gaps);
    expect(agg.bySeverity.CRITICAL).toBe(2);
    expect(agg.bySeverity.HIGH).toBe(1);
    expect(agg.bySeverity.MEDIUM).toBe(0);
    expect(agg.bySeverity.LOW).toBe(1);
    expect(agg.bySeverity.INFO).toBe(1);
  });

  it('topFindings limited to 5', () => {
    const gaps = Array.from({ length: 10 }, (_, i) =>
      makeGap({ id: `gap-${i}`, title: `Gap ${i}`, materiality: (i + 1) / 10 }),
    );
    const agg = computeAggregateGapRisk(gaps);
    expect(agg.topFindings).toHaveLength(5);
    // Highest score first
    expect(agg.topFindings[0]!.score).toBeGreaterThanOrEqual(agg.topFindings[4]!.score);
  });

  it('empty gaps returns zeros', () => {
    const agg = computeAggregateGapRisk([]);
    expect(agg.overallScore).toBe(0);
    expect(agg.maxScore).toBe(0);
    expect(agg.byType.compliance.count).toBe(0);
    expect(agg.byType.shadow.count).toBe(0);
    expect(agg.byType.design.count).toBe(0);
    expect(agg.bySeverity.CRITICAL).toBe(0);
    expect(agg.topFindings).toHaveLength(0);
  });

  it('single gap: aggregate matches individual score', () => {
    const gap = makeGap({
      gapType: 'shadow',
      severity: 'HIGH',
      confidence: 0.9,
      materiality: 0.7,
      frequency: 8,
      recency: 0.6,
    });
    const individualScore = computeGapRiskScore(gap);
    const agg = computeAggregateGapRisk([gap]);
    expect(agg.overallScore).toBeCloseTo(individualScore, 10);
    expect(agg.maxScore).toBeCloseTo(individualScore, 10);
    expect(agg.topFindings).toHaveLength(1);
    expect(agg.topFindings[0]!.score).toBeCloseTo(individualScore, 10);
  });
});

// ---------------------------------------------------------------------------
// sortGapsByRisk
// ---------------------------------------------------------------------------

describe('sortGapsByRisk', () => {
  it('highest risk first', () => {
    const low = makeGap({ severity: 'LOW', confidence: 0.2, materiality: 0.1 });
    const high = makeGap({ severity: 'CRITICAL', confidence: 1.0, materiality: 1.0, frequency: 10, recency: 1.0 });
    const mid = makeGap({ severity: 'MEDIUM', confidence: 0.5, materiality: 0.5 });

    const sorted = sortGapsByRisk([low, high, mid]);
    expect(computeGapRiskScore(sorted[0]!)).toBeGreaterThanOrEqual(computeGapRiskScore(sorted[1]!));
    expect(computeGapRiskScore(sorted[1]!)).toBeGreaterThanOrEqual(computeGapRiskScore(sorted[2]!));
  });
});

// ---------------------------------------------------------------------------
// generateGapRiskSummary
// ---------------------------------------------------------------------------

describe('generateGapRiskSummary', () => {
  it('contains markdown table', () => {
    const gaps = [
      makeGap({ gapType: 'compliance', severity: 'HIGH' }),
      makeGap({ gapType: 'design', severity: 'MEDIUM' }),
    ];
    const md = generateGapRiskSummary(gaps);
    expect(md).toContain('| Gap Type |');
    expect(md).toContain('|----------|');
    expect(md).toContain('| compliance |');
    expect(md).toContain('| design |');
    expect(md).toContain('## Gap Risk Summary');
    expect(md).toContain('### Top Findings');
  });
});

// ---------------------------------------------------------------------------
// Weight tables
// ---------------------------------------------------------------------------

describe('GAP_TYPE_WEIGHTS', () => {
  it('compliance is the highest weight', () => {
    expect(GAP_TYPE_WEIGHTS.compliance).toBe(1.0);
    expect(GAP_TYPE_WEIGHTS.compliance).toBeGreaterThan(GAP_TYPE_WEIGHTS.shadow);
    expect(GAP_TYPE_WEIGHTS.shadow).toBeGreaterThan(GAP_TYPE_WEIGHTS.design);
  });
});

describe('GAP_SEVERITY_WEIGHTS', () => {
  it('CRITICAL is highest, INFO is lowest', () => {
    expect(GAP_SEVERITY_WEIGHTS.CRITICAL).toBe(1.0);
    expect(GAP_SEVERITY_WEIGHTS.INFO).toBe(0.1);
    expect(GAP_SEVERITY_WEIGHTS.CRITICAL).toBeGreaterThan(GAP_SEVERITY_WEIGHTS.HIGH);
    expect(GAP_SEVERITY_WEIGHTS.HIGH).toBeGreaterThan(GAP_SEVERITY_WEIGHTS.MEDIUM);
    expect(GAP_SEVERITY_WEIGHTS.MEDIUM).toBeGreaterThan(GAP_SEVERITY_WEIGHTS.LOW);
    expect(GAP_SEVERITY_WEIGHTS.LOW).toBeGreaterThan(GAP_SEVERITY_WEIGHTS.INFO);
  });
});
