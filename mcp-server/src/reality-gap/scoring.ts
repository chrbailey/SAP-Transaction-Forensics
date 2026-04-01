/**
 * Gap Risk Scoring Module
 *
 * Scoring formulas and aggregation for reality-gap findings.
 * Computes risk scores based on gap type, severity, confidence,
 * materiality, frequency, and recency, then aggregates across
 * finding sets for summary reporting.
 */

// ---------------------------------------------------------------------------
// Local type definitions
// ---------------------------------------------------------------------------

type GapType = 'design' | 'compliance' | 'shadow';
type GapSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';

interface GapFinding {
  id: string;
  gapType: GapType;
  severity: GapSeverity;
  confidence: number;
  title: string;
  description: string;
  expectedSource: string;
  expectedBehavior: string;
  actualBehavior: string;
  actualEvents: string[];
  frequency: number;
  materiality: number;
  recency: number;
  detectedAt: string;
  systemScope: string;
}

export type { GapType, GapSeverity, GapFinding };

// ---------------------------------------------------------------------------
// Weight tables
// ---------------------------------------------------------------------------

/** Gap type weights — compliance gaps are more actionable than design gaps */
export const GAP_TYPE_WEIGHTS: Record<GapType, number> = {
  compliance: 1.0,     // people violating their own rules = highest priority
  shadow: 0.8,         // undocumented processes = high risk
  design: 0.6,         // process design issues = important but less urgent
};

/** Severity weights */
export const GAP_SEVERITY_WEIGHTS: Record<GapSeverity, number> = {
  CRITICAL: 1.0,
  HIGH: 0.75,
  MEDIUM: 0.5,
  LOW: 0.25,
  INFO: 0.1,
};

// ---------------------------------------------------------------------------
// Scoring functions
// ---------------------------------------------------------------------------

/**
 * Compute risk score for a gap finding (0-100).
 *
 * Formula:
 *   gapTypeWeight × severityWeight × confidence
 *     × (0.4 × materiality + 0.3 × frequency_norm + 0.3 × recency)
 *     × 100
 *
 * Where frequency_norm = min(frequency / 10, 1.0).
 * Result is clamped to 0-100.
 */
export function computeGapRiskScore(gap: GapFinding): number {
  const typeWeight = GAP_TYPE_WEIGHTS[gap.gapType];
  const severityWeight = GAP_SEVERITY_WEIGHTS[gap.severity];
  const frequencyNorm = Math.min(gap.frequency / 10, 1.0);
  const composite = 0.4 * gap.materiality + 0.3 * frequencyNorm + 0.3 * gap.recency;
  const raw = typeWeight * severityWeight * gap.confidence * composite * 100;
  return Math.min(100, Math.max(0, raw));
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

export interface AggregateGapRisk {
  overallScore: number;
  maxScore: number;
  byType: Record<GapType, { count: number; avgScore: number }>;
  bySeverity: Record<GapSeverity, number>;
  topFindings: Array<{ id: string; title: string; score: number }>;
}

/**
 * Compute aggregate gap risk across a set of findings.
 */
export function computeAggregateGapRisk(gaps: GapFinding[]): AggregateGapRisk {
  const emptyByType: Record<GapType, { count: number; avgScore: number }> = {
    design: { count: 0, avgScore: 0 },
    compliance: { count: 0, avgScore: 0 },
    shadow: { count: 0, avgScore: 0 },
  };

  const emptyBySeverity: Record<GapSeverity, number> = {
    CRITICAL: 0,
    HIGH: 0,
    MEDIUM: 0,
    LOW: 0,
    INFO: 0,
  };

  if (gaps.length === 0) {
    return {
      overallScore: 0,
      maxScore: 0,
      byType: emptyByType,
      bySeverity: emptyBySeverity,
      topFindings: [],
    };
  }

  // Accumulators for byType
  const typeAccum: Record<GapType, { total: number; count: number }> = {
    design: { total: 0, count: 0 },
    compliance: { total: 0, count: 0 },
    shadow: { total: 0, count: 0 },
  };

  const bySeverity: Record<GapSeverity, number> = { ...emptyBySeverity };

  let scoreSum = 0;
  let maxScore = 0;
  const scored: Array<{ id: string; title: string; score: number }> = [];

  for (const gap of gaps) {
    const score = computeGapRiskScore(gap);
    scoreSum += score;
    if (score > maxScore) {
      maxScore = score;
    }

    bySeverity[gap.severity]++;

    typeAccum[gap.gapType].total += score;
    typeAccum[gap.gapType].count += 1;

    scored.push({ id: gap.id, title: gap.title, score });
  }

  // Build byType
  const byType: Record<GapType, { count: number; avgScore: number }> = {
    design: { count: 0, avgScore: 0 },
    compliance: { count: 0, avgScore: 0 },
    shadow: { count: 0, avgScore: 0 },
  };
  for (const gapType of ['design', 'compliance', 'shadow'] as GapType[]) {
    const acc = typeAccum[gapType];
    byType[gapType] = {
      count: acc.count,
      avgScore: acc.count > 0 ? acc.total / acc.count : 0,
    };
  }

  // Top findings — sorted by score descending, limited to 5
  scored.sort((a, b) => b.score - a.score);
  const topFindings = scored.slice(0, 5);

  return {
    overallScore: scoreSum / gaps.length,
    maxScore,
    byType,
    bySeverity,
    topFindings,
  };
}

// ---------------------------------------------------------------------------
// Sorting
// ---------------------------------------------------------------------------

/**
 * Sort gaps by risk score descending.
 */
export function sortGapsByRisk(gaps: GapFinding[]): GapFinding[] {
  return [...gaps].sort((a, b) => computeGapRiskScore(b) - computeGapRiskScore(a));
}

// ---------------------------------------------------------------------------
// Markdown summary
// ---------------------------------------------------------------------------

/**
 * Generate gap risk summary as Markdown.
 */
export function generateGapRiskSummary(gaps: GapFinding[]): string {
  const agg = computeAggregateGapRisk(gaps);
  const lines: string[] = [];

  lines.push('## Gap Risk Summary');
  lines.push('');
  lines.push(`**Overall Score:** ${agg.overallScore.toFixed(1)}`);
  lines.push(`**Max Score:** ${agg.maxScore.toFixed(1)}`);
  lines.push(`**Total Findings:** ${gaps.length}`);
  lines.push('');

  // Severity breakdown
  lines.push(
    `${agg.bySeverity.CRITICAL} critical, ${agg.bySeverity.HIGH} high, ` +
    `${agg.bySeverity.MEDIUM} medium, ${agg.bySeverity.LOW} low, ${agg.bySeverity.INFO} info`,
  );
  lines.push('');

  // Type table
  lines.push('| Gap Type | Count | Avg Score | Max Score |');
  lines.push('|----------|-------|-----------|-----------|');

  for (const gapType of ['compliance', 'shadow', 'design'] as GapType[]) {
    const stats = agg.byType[gapType];
    // Compute max score for this type
    const typeGaps = gaps.filter((g) => g.gapType === gapType);
    const typeMax = typeGaps.reduce(
      (max, g) => Math.max(max, computeGapRiskScore(g)),
      0,
    );
    lines.push(
      `| ${gapType} | ${stats.count} | ${stats.avgScore.toFixed(1)} | ${typeMax.toFixed(1)} |`,
    );
  }

  lines.push('');

  // Top 5 findings
  const sorted = sortGapsByRisk(gaps);
  const top5 = sorted.slice(0, 5);

  if (top5.length > 0) {
    lines.push('### Top Findings');
    lines.push('');
    for (let i = 0; i < top5.length; i++) {
      const f = top5[i]!;
      const score = computeGapRiskScore(f);
      lines.push(`${i + 1}. **${f.severity}** (${score.toFixed(1)}) — ${f.title}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}
