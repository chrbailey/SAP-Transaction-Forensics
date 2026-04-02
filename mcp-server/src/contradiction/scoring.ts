/**
 * Severity Scoring Module
 *
 * Scoring formulas and aggregation for contradiction findings.
 * Computes risk scores based on severity, contradiction type, and confidence,
 * then aggregates across finding sets for summary reporting.
 */

// ---------------------------------------------------------------------------
// Local type definitions
// ---------------------------------------------------------------------------

export type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';

export type ContradictionType =
  | 'AMOUNT_DIVERGENCE'
  | 'DATE_CONFLICT'
  | 'STATUS_INCOMPATIBLE'
  | 'ENTITY_MISMATCH'
  | 'QUANTITY_DIVERGENCE'
  | 'APPROVAL_BYPASS'
  | 'TEMPORAL_IMPOSSIBILITY'
  | 'DUPLICATE_REFERENCE'
  | 'ORPHAN_RECORD'
  | 'RETROACTIVE_CHANGE'
  | 'SOD_VIOLATION'
  | 'SCHEMA_GHOST';

export interface ContradictionFinding {
  id: string;
  type: ContradictionType;
  severity: Severity;
  confidence: number;
  scoringDetails: Record<string, number>;
  [key: string]: unknown;
}

export interface AggregateRisk {
  overallScore: number;
  maxScore: number;
  criticalCount: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
  infoCount: number;
  byType: Record<string, { count: number; avgScore: number }>;
  bySystem: Record<string, { count: number; avgScore: number }>;
}

// ---------------------------------------------------------------------------
// Weight tables
// ---------------------------------------------------------------------------

/** Severity weight lookup */
export const SEVERITY_WEIGHTS: Record<Severity, number> = {
  CRITICAL: 1.0,
  HIGH: 0.75,
  MEDIUM: 0.5,
  LOW: 0.25,
  INFO: 0.1,
};

/** Type-specific base weights — some contradiction types are inherently more serious */
export const TYPE_BASE_WEIGHTS: Record<ContradictionType, number> = {
  TEMPORAL_IMPOSSIBILITY: 1.0,
  SCHEMA_GHOST: 1.0,
  SOD_VIOLATION: 0.95,
  APPROVAL_BYPASS: 0.9,
  STATUS_INCOMPATIBLE: 0.85,
  RETROACTIVE_CHANGE: 0.8,
  AMOUNT_DIVERGENCE: 0.75,
  QUANTITY_DIVERGENCE: 0.7,
  DATE_CONFLICT: 0.65,
  DUPLICATE_REFERENCE: 0.6,
  ENTITY_MISMATCH: 0.55,
  ORPHAN_RECORD: 0.5,
};

// ---------------------------------------------------------------------------
// Scoring functions
// ---------------------------------------------------------------------------

/**
 * Compute a composite risk score for a single finding (0-100).
 *
 * Formula: severityWeight * typeBaseWeight * confidence * 100
 * Clamped to 0-100.
 */
export function computeRiskScore(finding: ContradictionFinding): number {
  const severityWeight = SEVERITY_WEIGHTS[finding.severity];
  const typeWeight = TYPE_BASE_WEIGHTS[finding.type];
  const raw = severityWeight * typeWeight * finding.confidence * 100;
  return Math.min(100, Math.max(0, raw));
}

/**
 * Compute aggregate risk score for a set of findings.
 */
export function computeAggregateRisk(findings: ContradictionFinding[]): AggregateRisk {
  if (findings.length === 0) {
    return {
      overallScore: 0,
      maxScore: 0,
      criticalCount: 0,
      highCount: 0,
      mediumCount: 0,
      lowCount: 0,
      infoCount: 0,
      byType: {},
      bySystem: {},
    };
  }

  // Severity counts
  let criticalCount = 0;
  let highCount = 0;
  let mediumCount = 0;
  let lowCount = 0;
  let infoCount = 0;

  // Accumulators for byType and bySystem
  const typeAccum: Record<string, { total: number; count: number }> = {};
  const systemAccum: Record<string, { total: number; count: number }> = {};

  let scoreSum = 0;
  let maxScore = 0;

  for (const finding of findings) {
    const score = computeRiskScore(finding);
    scoreSum += score;
    if (score > maxScore) {
      maxScore = score;
    }

    // Severity counts
    switch (finding.severity) {
      case 'CRITICAL':
        criticalCount++;
        break;
      case 'HIGH':
        highCount++;
        break;
      case 'MEDIUM':
        mediumCount++;
        break;
      case 'LOW':
        lowCount++;
        break;
      case 'INFO':
        infoCount++;
        break;
    }

    // byType accumulation
    const typeKey = finding.type;
    if (typeAccum[typeKey] === undefined) {
      typeAccum[typeKey] = { total: 0, count: 0 };
    }
    typeAccum[typeKey]!.total += score;
    typeAccum[typeKey]!.count += 1;

    // bySystem accumulation — use leftSystem if present, fallback to 'unknown'
    const system = typeof finding['leftSystem'] === 'string' ? finding['leftSystem'] : 'unknown';
    if (systemAccum[system] === undefined) {
      systemAccum[system] = { total: 0, count: 0 };
    }
    systemAccum[system]!.total += score;
    systemAccum[system]!.count += 1;
  }

  // Build byType
  const byType: Record<string, { count: number; avgScore: number }> = {};
  for (const [key, acc] of Object.entries(typeAccum)) {
    byType[key] = {
      count: acc.count,
      avgScore: acc.count > 0 ? acc.total / acc.count : 0,
    };
  }

  // Build bySystem
  const bySystem: Record<string, { count: number; avgScore: number }> = {};
  for (const [key, acc] of Object.entries(systemAccum)) {
    bySystem[key] = {
      count: acc.count,
      avgScore: acc.count > 0 ? acc.total / acc.count : 0,
    };
  }

  return {
    overallScore: scoreSum / findings.length,
    maxScore,
    criticalCount,
    highCount,
    mediumCount,
    lowCount,
    infoCount,
    byType,
    bySystem,
  };
}

/**
 * Sort findings by risk score (highest first).
 */
export function sortByRisk(findings: ContradictionFinding[]): ContradictionFinding[] {
  return [...findings].sort((a, b) => computeRiskScore(b) - computeRiskScore(a));
}

/**
 * Filter findings above a minimum risk threshold.
 */
export function filterByMinRisk(
  findings: ContradictionFinding[],
  minScore: number
): ContradictionFinding[] {
  return findings.filter(f => computeRiskScore(f) >= minScore);
}

/**
 * Generate a risk summary in Markdown format.
 */
export function generateRiskSummary(findings: ContradictionFinding[]): string {
  const agg = computeAggregateRisk(findings);
  const lines: string[] = [];

  lines.push('## Risk Summary');
  lines.push('');

  // Severity breakdown
  lines.push(
    `${agg.criticalCount} critical, ${agg.highCount} high, ` +
      `${agg.mediumCount} medium, ${agg.lowCount} low, ${agg.infoCount} info`
  );
  lines.push('');

  lines.push(`**Overall Score:** ${agg.overallScore.toFixed(1)}`);
  lines.push(`**Max Score:** ${agg.maxScore.toFixed(1)}`);
  lines.push(`**Total Findings:** ${findings.length}`);
  lines.push('');

  // Type table
  if (Object.keys(agg.byType).length > 0) {
    lines.push('| Type | Count | Avg Score | Max Score |');
    lines.push('|------|-------|-----------|-----------|');

    // Sort types by avg score descending
    const typeEntries = Object.entries(agg.byType).sort((a, b) => b[1].avgScore - a[1].avgScore);

    for (const [typeName, stats] of typeEntries) {
      // Compute max score for this type
      const typeFindings = findings.filter(f => f.type === typeName);
      const typeMax = typeFindings.reduce((max, f) => Math.max(max, computeRiskScore(f)), 0);
      lines.push(
        `| ${typeName} | ${stats.count} | ${stats.avgScore.toFixed(1)} | ${typeMax.toFixed(1)} |`
      );
    }

    lines.push('');
  }

  // Top 5 findings
  const sorted = sortByRisk(findings);
  const top5 = sorted.slice(0, 5);

  if (top5.length > 0) {
    lines.push('### Top Findings');
    lines.push('');
    for (let i = 0; i < top5.length; i++) {
      const f = top5[i]!;
      const score = computeRiskScore(f);
      const desc = typeof f['description'] === 'string' ? f['description'] : f.type;
      lines.push(`${i + 1}. **${f.severity}** (${score.toFixed(1)}) — ${desc}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}
