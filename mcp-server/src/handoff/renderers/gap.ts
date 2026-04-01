/**
 * Gap Renderer
 *
 * Renders reality-gap findings as Markdown for the auditor handoff packet.
 * Groups gaps by type (design, compliance, shadow) with section headers
 * and per-finding detail blocks.
 */

import type { RenderedFinding } from '../types.js';

// ---------------------------------------------------------------------------
// Local types (mirrors reality-gap/types but kept local to renderer)
// ---------------------------------------------------------------------------

export type GapType = 'design' | 'compliance' | 'shadow';
export type GapSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';

export interface GapFinding {
  id: string;
  gapType: GapType;
  severity: GapSeverity;
  confidence: number;
  title: string;
  description: string;
  expectedSource: 'reference' | 'documented';
  expectedRule?: string;
  expectedBehavior: string;
  actualBehavior: string;
  actualEvents: string[];
  frequency: number;
  materiality: number;
  recency: number;
  detectedAt: string;
  systemScope: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SEVERITY_ORDER: Record<GapSeverity, number> = {
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
  INFO: 4,
};

const SECTION_HEADERS: Record<GapType, { title: string; blurb: string }> = {
  design: {
    title: 'Design Gaps (Reference vs Documented)',
    blurb: 'These represent deviations from best practice in the client\'s documented processes.',
  },
  compliance: {
    title: 'Compliance Gaps (Documented vs Actual)',
    blurb: 'These represent deviations between the client\'s documented processes and actual execution.',
  },
  shadow: {
    title: 'Shadow Gaps (Undocumented Activity)',
    blurb: 'These represent activity observed in the system that has no corresponding documentation or reference model.',
  },
};

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

export class GapRenderer {
  /** Render a single gap finding as Markdown */
  renderGap(gap: GapFinding): RenderedFinding {
    const lines: string[] = [
      `## G-${gap.id}: ${gap.title}`,
      '',
      `**Gap Type:** ${gap.gapType} | **Severity:** ${gap.severity} | **Confidence:** ${gap.confidence}`,
      '',
      '### Expected vs Actual',
      '',
      `- **Expected (${gap.expectedSource}):** ${gap.expectedBehavior}`,
      `- **Actual:** ${gap.actualBehavior}`,
      `- **Rule/Model:** ${gap.expectedRule ?? 'N/A'}`,
      '',
      '### Impact',
      '',
      `- **Frequency:** ${gap.frequency} occurrences`,
      `- **Materiality:** ${gap.materiality}/1.0`,
      `- **Recency:** ${gap.recency}/1.0`,
      `- **Affected Cases:** ${gap.actualEvents.length}`,
      '',
      '### System Scope',
      '',
      gap.systemScope,
    ];

    const markdown = lines.join('\n');

    return {
      id: gap.id,
      title: gap.title,
      severity: gap.severity,
      riskScore: this.computeRiskScore(gap),
      markdown,
      evidenceFiles: [],
    };
  }

  /** Render all gaps grouped by type (design, compliance, shadow) */
  renderAllGrouped(gaps: GapFinding[]): {
    designSection: string;
    complianceSection: string;
    shadowSection: string;
    renderedFindings: RenderedFinding[];
  } {
    const byType: Record<GapType, GapFinding[]> = {
      design: [],
      compliance: [],
      shadow: [],
    };

    for (const gap of gaps) {
      byType[gap.gapType].push(gap);
    }

    // Render each gap and collect results
    const allRendered: RenderedFinding[] = [];
    const sectionMarkdowns: Record<GapType, string> = {
      design: '',
      compliance: '',
      shadow: '',
    };

    for (const gapType of ['design', 'compliance', 'shadow'] as GapType[]) {
      const groupGaps = byType[gapType];
      const header = SECTION_HEADERS[gapType];

      if (groupGaps.length === 0) {
        sectionMarkdowns[gapType] = '';
        continue;
      }

      // Sort by severity within each group
      const sorted = [...groupGaps].sort(
        (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
      );

      const rendered = sorted.map((g) => this.renderGap(g));
      allRendered.push(...rendered);

      const sectionLines: string[] = [
        `# ${header.title}`,
        '',
        `${sorted.length} gaps detected. ${header.blurb}`,
        '',
        ...rendered.map((r) => r.markdown),
      ];

      sectionMarkdowns[gapType] = sectionLines.join('\n');
    }

    // Sort all rendered findings by severity
    allRendered.sort(
      (a, b) => severityRank(a.severity) - severityRank(b.severity),
    );

    return {
      designSection: sectionMarkdowns.design,
      complianceSection: sectionMarkdowns.compliance,
      shadowSection: sectionMarkdowns.shadow,
      renderedFindings: allRendered,
    };
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  private computeRiskScore(gap: GapFinding): number {
    const sevWeight = 1 - SEVERITY_ORDER[gap.severity] / 4; // CRITICAL=1, INFO=0
    return Math.round(
      (sevWeight * 0.4 + gap.materiality * 0.3 + gap.recency * 0.2 + gap.confidence * 0.1) * 100,
    );
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function severityRank(severity: string): number {
  return SEVERITY_ORDER[severity as GapSeverity] ?? 999;
}
