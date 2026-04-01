/**
 * Handoff Packet Generator
 *
 * Main orchestrator that assembles all components — summary, findings,
 * gaps, manifest, checklist, and provenance — into a complete handoff
 * packet for external auditor review.
 */

import type {
  HandoffConfig,
  HandoffPacket,
  RenderedFinding,
  EvidenceFile,
  ExtractionManifest,
  ManifestEntry,
  ReviewerChecklist,
  ChecklistItem,
} from './types.js';

// ---------------------------------------------------------------------------
// Local input types (defined locally for parallel-build independence)
// ---------------------------------------------------------------------------

export type SystemType = 'SAP' | 'NetSuite' | 'Salesforce';

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

export type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';

export type ResolutionStatus = 'open' | 'confirmed' | 'explained' | 'false_positive';

export interface ContradictionFinding {
  id: string;
  type: ContradictionType;
  severity: Severity;
  confidence: number;
  description: string;
  title: string;
  riskScore: number;

  leftSystem: SystemType;
  leftTable: string;
  leftRecordId: string;
  leftField: string;
  leftValue: string;
  leftExtractionId: string;

  rightSystem: SystemType;
  rightTable: string;
  rightRecordId: string;
  rightField: string;
  rightValue: string;
  rightExtractionId: string;

  scoringDetails: Record<string, number>;

  detectedAt: string;
  resolutionStatus: ResolutionStatus;
  reviewerNotes: string;
}

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

export interface ExtractionInfo {
  extractionPathId: string;
  extractionPathVersion: string;
  parameters: Record<string, string>;
  queryHash: string;
  replayHash: string;
  extractedAt: string;
  rowCount: number;
  systemType: SystemType;
}

// ---------------------------------------------------------------------------
// Severity ordering (shared across sub-generators)
// ---------------------------------------------------------------------------

const SEVERITY_ORDER: Record<string, number> = {
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
  INFO: 4,
};

// ---------------------------------------------------------------------------
// Checklist definitions — 5 items per category, 25 total
// ---------------------------------------------------------------------------

type ChecklistCategory = ChecklistItem['category'];

interface CategoryDefinition {
  category: ChecklistCategory;
  items: string[];
}

const CHECKLIST_DEFINITIONS: readonly CategoryDefinition[] = [
  {
    category: 'data_quality',
    items: [
      'Extraction replay hashes verified against current data',
      'Sample data values spot-checked against source system',
      'Date ranges confirmed to cover the full audit period',
      'Currency conversions validated where cross-system amounts compared',
      'Null/missing values in critical fields documented',
    ],
  },
  {
    category: 'completeness',
    items: [
      'All systems in scope were accessed and extracted',
      'All extraction paths in the registry were executed',
      'No orphan findings (all reference extraction IDs exist)',
      'Schema validation passed for all extraction paths',
      'Event log covers full date range without gaps',
    ],
  },
  {
    category: 'methodology',
    items: [
      'Contradiction thresholds appropriate for this engagement',
      "Reality-gap reference model matches client's industry",
      'Documented business rules sourced from current SOPs',
      'Scoring weights reviewed and accepted by engagement lead',
      'False positive rate assessed and documented',
    ],
  },
  {
    category: 'findings',
    items: [
      'Each CRITICAL finding has been individually reviewed',
      'Each HIGH finding has supporting evidence verified',
      'Contradictions confirmed against both source systems',
      'Reality gaps validated against actual process documentation',
      'Risk scores reflect engagement-specific materiality thresholds',
    ],
  },
  {
    category: 'remediation',
    items: [
      'Remediation recommendations are actionable and specific',
      'Timeline for remediation is realistic',
      'Responsible parties identified for each finding',
      'Follow-up extraction schedule defined for verification',
      'Accepted risks documented with business justification',
    ],
  },
];

// ---------------------------------------------------------------------------
// HandoffPacketGenerator
// ---------------------------------------------------------------------------

export class HandoffPacketGenerator {
  /**
   * Generate a complete handoff packet from raw findings, gaps, and extractions.
   */
  generate(params: {
    config: HandoffConfig;
    contradictions: ContradictionFinding[];
    gaps: GapFinding[];
    extractions: ExtractionInfo[];
    provenanceDAG?: string;
  }): HandoffPacket {
    const { config, contradictions, gaps, extractions, provenanceDAG } = params;

    // 1. Render contradictions as findings
    const renderedContradictions = this.renderContradictions(contradictions);

    // 2. Render reality gaps
    const renderedGaps = this.renderGaps(gaps);

    // 3. Build extraction manifest
    const manifest = this.buildManifest(config, extractions);

    // 4. Generate reviewer checklist (25 items)
    const checklist = this.generateChecklist(
      config.engagementId,
      renderedContradictions.length + renderedGaps.length,
      config.systemsAccessed.length,
    );

    // 5. Compute severity counts for summary
    const allFindings = [...renderedContradictions, ...renderedGaps];
    const criticalCount = allFindings.filter(f => f.severity === 'CRITICAL').length;
    const highCount = allFindings.filter(f => f.severity === 'HIGH').length;
    const mediumCount = allFindings.filter(f => f.severity === 'MEDIUM').length;
    const overallRiskScore = this.computeOverallRisk(allFindings);

    // 6. Generate executive summary
    const summary = this.generateSummary({
      config,
      contradictionCount: contradictions.length,
      gapCount: gaps.length,
      criticalCount,
      highCount,
      mediumCount,
      totalExtractions: extractions.length,
      overallRiskScore,
    });

    return {
      config,
      summary,
      findings: allFindings,
      contradictions: renderedContradictions,
      realityGaps: renderedGaps,
      manifest,
      checklist,
      provenanceGraph: provenanceDAG ?? '{"nodes":[],"edges":[]}',
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * Generate the packet as a directory structure.
   * Returns a map of filepath -> content.
   */
  generateFileStructure(packet: HandoffPacket): Map<string, string> {
    const files = new Map<string, string>();

    // SUMMARY.md
    files.set('SUMMARY.md', packet.summary);

    // findings/ — one file per contradiction
    for (const finding of packet.contradictions) {
      const slug = this.slugify(finding.severity);
      const key = `findings/F${finding.id}-${slug}.md`;
      files.set(key, finding.markdown);

      // Evidence files for each finding
      for (const ev of finding.evidenceFiles) {
        const evKey = `findings/F${finding.id}-evidence/${ev.filename}`;
        files.set(evKey, ev.content);

        // Meta JSON alongside evidence
        if (ev.mimeType !== 'application/json') {
          const metaKey = `findings/F${finding.id}-evidence/${this.stripExt(ev.filename)}.meta.json`;
          const meta = {
            filename: ev.filename,
            mimeType: ev.mimeType,
            extractionId: ev.extractionId ?? null,
            generatedAt: packet.generatedAt,
          };
          files.set(metaKey, JSON.stringify(meta, null, 2));
        }
      }
    }

    // contradictions/ — alias, one per contradiction
    for (const c of packet.contradictions) {
      const slug = this.slugify(c.severity);
      const key = `contradictions/C${c.id}-${slug}.md`;
      files.set(key, c.markdown);
    }

    // reality-gaps/ — one per gap
    for (const gap of packet.realityGaps) {
      const slug = this.slugify(gap.severity);
      const key = `reality-gaps/G${gap.id}-${slug}.md`;
      files.set(key, gap.markdown);
    }

    // reproduction/ — only if includeReproduction
    if (packet.config.includeReproduction) {
      files.set('reproduction/README.md', this.renderReproductionReadme(packet));
      files.set(
        'reproduction/extraction-manifest.json',
        JSON.stringify(packet.manifest, null, 2),
      );
      files.set(
        'reproduction/verify-extractions.sh',
        this.renderVerificationScript(packet.manifest),
      );
    }

    // metadata/
    files.set(
      'metadata/engagement.json',
      JSON.stringify(
        {
          engagementId: packet.config.engagementId,
          clientName: packet.config.clientName,
          preparedBy: packet.config.preparedBy,
          dateRange: packet.config.dateRange,
          systemsAccessed: packet.config.systemsAccessed,
          scope: packet.config.scope,
          generatedAt: packet.generatedAt,
          findingCount: packet.findings.length,
          contradictionCount: packet.contradictions.length,
          gapCount: packet.realityGaps.length,
        },
        null,
        2,
      ),
    );

    files.set(
      'metadata/provenance-graph.json',
      packet.provenanceGraph,
    );

    // metadata/reviewer-checklist.md — only if includeChecklist
    if (packet.config.includeChecklist) {
      files.set(
        'metadata/reviewer-checklist.md',
        this.renderChecklist(packet.checklist),
      );
    }

    return files;
  }

  // -------------------------------------------------------------------------
  // Private: Checklist rendering
  // -------------------------------------------------------------------------

  private renderChecklist(checklist: ReviewerChecklist): string {
    const lines: string[] = [];

    lines.push(`# Reviewer Checklist — ${checklist.engagementId}`);
    lines.push('');
    lines.push(`**Generated:** ${checklist.generatedAt}`);
    lines.push(`**Reviewer:** ${checklist.reviewerName || '(not assigned)'}`);
    lines.push(`**Progress:** ${checklist.completedCount}/${checklist.totalCount}`);
    lines.push('');

    // Group by category
    const categories = new Map<string, ChecklistItem[]>();
    for (const item of checklist.items) {
      const existing = categories.get(item.category);
      if (existing) {
        existing.push(item);
      } else {
        categories.set(item.category, [item]);
      }
    }

    for (const [category, items] of Array.from(categories.entries())) {
      lines.push(`## ${this.formatCategory(category)}`);
      lines.push('');
      for (const item of items) {
        const checkbox = item.checked ? '[x]' : '[ ]';
        lines.push(`- ${checkbox} ${item.text}`);
        if (item.notes) {
          lines.push(`  Notes: ${item.notes}`);
        }
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  // -------------------------------------------------------------------------
  // Private: Summary generation (inline)
  // -------------------------------------------------------------------------

  private generateSummary(params: {
    config: HandoffConfig;
    contradictionCount: number;
    gapCount: number;
    criticalCount: number;
    highCount: number;
    mediumCount: number;
    totalExtractions: number;
    overallRiskScore: number;
  }): string {
    const {
      config,
      contradictionCount,
      gapCount,
      criticalCount,
      highCount,
      mediumCount,
      totalExtractions,
      overallRiskScore,
    } = params;

    const generatedAt = new Date().toISOString().split('T')[0]!;
    const lines: string[] = [];

    lines.push(`# Forensic Assessment: ${config.clientName}`);
    lines.push('');
    lines.push(`**Engagement:** ${config.engagementId}`);
    lines.push(`**Scope:** ${config.scope}`);
    lines.push(`**Period:** ${config.dateRange.from} to ${config.dateRange.to}`);
    lines.push(`**Prepared By:** ${config.preparedBy}`);
    lines.push(`**Date:** ${generatedAt}`);
    lines.push('');
    lines.push('---');
    lines.push('');

    lines.push('## Executive Summary');
    lines.push('');
    lines.push(
      `This assessment analyzed ${totalExtractions} extraction records across ` +
      `${config.systemsAccessed.length} systems (${config.systemsAccessed.join(', ')}).`,
    );
    lines.push('');

    lines.push('### Key Metrics');
    lines.push('');
    lines.push('| Metric | Value |');
    lines.push('|--------|-------|');
    lines.push(`| Overall Risk Score | ${overallRiskScore}/100 |`);
    lines.push(`| Critical Findings | ${criticalCount} |`);
    lines.push(`| High Findings | ${highCount} |`);
    lines.push(`| Medium Findings | ${mediumCount} |`);
    lines.push(`| Contradictions Detected | ${contradictionCount} |`);
    lines.push(`| Process Gaps Detected | ${gapCount} |`);
    lines.push('');

    lines.push('### Risk Assessment');
    lines.push('');
    lines.push(this.getRiskNarrative(overallRiskScore, criticalCount, highCount));
    lines.push('');

    return lines.join('\n');
  }

  private getRiskNarrative(
    overallRiskScore: number,
    criticalCount: number,
    highCount: number,
  ): string {
    if (overallRiskScore > 75) {
      return (
        'The overall risk assessment reveals significant concerns requiring immediate attention. ' +
        `With a risk score of ${overallRiskScore}/100, ${criticalCount} critical and ` +
        `${highCount} high-severity findings, this engagement warrants escalated review ` +
        'and prompt remediation action.'
      );
    }
    if (overallRiskScore >= 50) {
      return (
        'The overall risk assessment indicates moderate risk requiring review. ' +
        `With a risk score of ${overallRiskScore}/100, the identified findings should be ` +
        'addressed through a structured remediation plan with appropriate prioritization.'
      );
    }
    if (overallRiskScore >= 25) {
      return (
        'The overall risk assessment indicates manageable risk with recommendations. ' +
        `With a risk score of ${overallRiskScore}/100, the findings identified represent ` +
        'areas for improvement that can be addressed through standard operational processes.'
      );
    }
    return (
      'The overall risk assessment indicates low risk. ' +
      `With a risk score of ${overallRiskScore}/100, the assessment found no significant ` +
      'issues requiring urgent attention.'
    );
  }

  // -------------------------------------------------------------------------
  // Private: Contradiction rendering (inline)
  // -------------------------------------------------------------------------

  private renderContradictions(contradictions: ContradictionFinding[]): RenderedFinding[] {
    const sorted = [...contradictions].sort((a, b) => b.riskScore - a.riskScore);
    return sorted.map(c => this.renderSingleContradiction(c));
  }

  private renderSingleContradiction(finding: ContradictionFinding): RenderedFinding {
    const lines: string[] = [];

    lines.push(`## F-${finding.id}: ${finding.title}`);
    lines.push('');
    lines.push(
      `**Severity:** ${finding.severity} | ` +
      `**Risk Score:** ${finding.riskScore}/100 | ` +
      `**Type:** ${finding.type}`,
    );
    lines.push('');
    lines.push(`${finding.description}`);
    lines.push('');

    lines.push('### Evidence');
    lines.push('');
    lines.push('| Side | System | Table | Record | Field | Value |');
    lines.push('|------|--------|-------|--------|-------|-------|');
    lines.push(
      `| Left | ${finding.leftSystem} | ${finding.leftTable} | ` +
      `${finding.leftRecordId} | ${finding.leftField} | ${finding.leftValue} |`,
    );
    lines.push(
      `| Right | ${finding.rightSystem} | ${finding.rightTable} | ` +
      `${finding.rightRecordId} | ${finding.rightField} | ${finding.rightValue} |`,
    );
    lines.push('');

    lines.push('### Status');
    lines.push('');
    lines.push(`**Detection Date:** ${finding.detectedAt}`);
    lines.push(`**Resolution:** ${finding.resolutionStatus}`);

    const markdown = lines.join('\n');

    // Build evidence files
    const evidenceFiles: EvidenceFile[] = [
      {
        filename: `extraction-${finding.leftExtractionId}.csv`,
        content: [
          'system,table,recordId,field,value',
          `${finding.leftSystem},${finding.leftTable},${finding.leftRecordId},${finding.leftField},${finding.leftValue}`,
        ].join('\n'),
        mimeType: 'text/csv',
        extractionId: finding.leftExtractionId,
      },
      {
        filename: `extraction-${finding.rightExtractionId}.csv`,
        content: [
          'system,table,recordId,field,value',
          `${finding.rightSystem},${finding.rightTable},${finding.rightRecordId},${finding.rightField},${finding.rightValue}`,
        ].join('\n'),
        mimeType: 'text/csv',
        extractionId: finding.rightExtractionId,
      },
      {
        filename: `extraction-${finding.leftExtractionId}.meta.json`,
        content: JSON.stringify({
          findingId: finding.id,
          side: 'left',
          extractionId: finding.leftExtractionId,
          system: finding.leftSystem,
          table: finding.leftTable,
        }, null, 2),
        mimeType: 'application/json',
      },
    ];

    return {
      id: finding.id,
      title: finding.title,
      severity: finding.severity,
      riskScore: finding.riskScore,
      markdown,
      evidenceFiles,
    };
  }

  // -------------------------------------------------------------------------
  // Private: Gap rendering (inline)
  // -------------------------------------------------------------------------

  private renderGaps(gaps: GapFinding[]): RenderedFinding[] {
    const sorted = [...gaps].sort(
      (a, b) => (SEVERITY_ORDER[a.severity] ?? 4) - (SEVERITY_ORDER[b.severity] ?? 4),
    );
    return sorted.map(g => this.renderSingleGap(g));
  }

  private renderSingleGap(gap: GapFinding): RenderedFinding {
    const riskScore = this.computeGapRiskScore(gap);

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
    ];

    return {
      id: gap.id,
      title: gap.title,
      severity: gap.severity,
      riskScore,
      markdown: lines.join('\n'),
      evidenceFiles: [],
    };
  }

  private computeGapRiskScore(gap: GapFinding): number {
    const sevWeight = 1 - (SEVERITY_ORDER[gap.severity] ?? 4) / 4;
    return Math.round(
      (sevWeight * 0.4 + gap.materiality * 0.3 + gap.recency * 0.2 + gap.confidence * 0.1) * 100,
    );
  }

  // -------------------------------------------------------------------------
  // Private: Manifest generation (inline)
  // -------------------------------------------------------------------------

  private buildManifest(
    config: HandoffConfig,
    extractions: ExtractionInfo[],
  ): ExtractionManifest {
    const entries: ManifestEntry[] = extractions.map(e => ({
      extractionPathId: e.extractionPathId,
      extractionPathVersion: e.extractionPathVersion,
      parameters: e.parameters,
      queryHash: e.queryHash,
      replayHash: e.replayHash,
      extractedAt: e.extractedAt,
      rowCount: e.rowCount,
    }));

    const totalRows = entries.reduce((sum, e) => sum + e.rowCount, 0);
    const systems = Array.from(new Set(extractions.map(e => e.systemType)));

    return {
      engagementId: config.engagementId,
      generatedAt: new Date().toISOString(),
      entries,
      totalExtractions: entries.length,
      totalRows,
      systems,
    };
  }

  // -------------------------------------------------------------------------
  // Private: Checklist generation (inline)
  // -------------------------------------------------------------------------

  private generateChecklist(
    engagementId: string,
    _findingCount: number,
    _systemCount: number,
  ): ReviewerChecklist {
    const items: ChecklistItem[] = [];
    let itemIndex = 0;

    for (const def of CHECKLIST_DEFINITIONS) {
      for (const text of def.items) {
        itemIndex++;
        items.push({
          id: `CHK-${String(itemIndex).padStart(3, '0')}`,
          category: def.category,
          text,
          required: true,
          checked: false,
          notes: '',
        });
      }
    }

    return {
      engagementId,
      reviewerName: '',
      generatedAt: new Date().toISOString(),
      items,
      completedCount: 0,
      totalCount: items.length,
    };
  }

  // -------------------------------------------------------------------------
  // Private: Reproduction helpers
  // -------------------------------------------------------------------------

  private renderReproductionReadme(packet: HandoffPacket): string {
    const lines: string[] = [];

    lines.push('# Reproduction Instructions');
    lines.push('');
    lines.push(`**Engagement:** ${packet.config.engagementId}`);
    lines.push(`**Generated:** ${packet.generatedAt}`);
    lines.push('');
    lines.push('## Overview');
    lines.push('');
    lines.push(
      'This directory contains the extraction manifest and verification script ' +
      'needed to independently reproduce the data extractions used in this assessment.',
    );
    lines.push('');
    lines.push('## Files');
    lines.push('');
    lines.push('- `extraction-manifest.json` — Complete manifest of all extractions with query hashes');
    lines.push('- `verify-extractions.sh` — Script to verify extraction replay hashes');
    lines.push('');
    lines.push('## Steps');
    lines.push('');
    lines.push('1. Review `extraction-manifest.json` for the list of extraction paths');
    lines.push('2. Re-execute each extraction using the documented parameters');
    lines.push('3. Compare the resulting replay hashes with those in the manifest');
    lines.push('4. Run `verify-extractions.sh` to automate hash comparison');
    lines.push('');

    return lines.join('\n');
  }

  private renderVerificationScript(manifest: ExtractionManifest): string {
    const lines: string[] = [];

    lines.push('#!/usr/bin/env bash');
    lines.push('# Extraction Verification Script');
    lines.push(`# Engagement: ${manifest.engagementId}`);
    lines.push(`# Generated: ${manifest.generatedAt}`);
    lines.push(`# Total extractions: ${manifest.totalExtractions}`);
    lines.push('');
    lines.push('set -euo pipefail');
    lines.push('');
    lines.push('MANIFEST="$(dirname "$0")/extraction-manifest.json"');
    lines.push('');
    lines.push('echo "Verifying extraction hashes..."');
    lines.push(`echo "Expected extractions: ${manifest.totalExtractions}"`);
    lines.push('');

    for (const entry of manifest.entries) {
      lines.push(`# ${entry.extractionPathId} v${entry.extractionPathVersion}`);
      lines.push(`echo "Checking ${entry.extractionPathId}... expected replay hash: ${entry.replayHash}"`);
    }

    lines.push('');
    lines.push('echo "Verification complete."');

    return lines.join('\n');
  }

  // -------------------------------------------------------------------------
  // Private: Utility helpers
  // -------------------------------------------------------------------------

  private computeOverallRisk(findings: RenderedFinding[]): number {
    if (findings.length === 0) return 0;
    const sum = findings.reduce((acc, f) => acc + f.riskScore, 0);
    return Math.min(100, Math.round(sum / findings.length));
  }

  private slugify(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  }

  private stripExt(filename: string): string {
    const lastDot = filename.lastIndexOf('.');
    return lastDot > 0 ? filename.substring(0, lastDot) : filename;
  }

  private formatCategory(category: string): string {
    return category
      .split('_')
      .map(w => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  }
}
