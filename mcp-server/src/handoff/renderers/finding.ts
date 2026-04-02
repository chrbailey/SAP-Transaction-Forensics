/**
 * Finding Renderer
 *
 * Renders contradiction findings and FI/CO anomalies as Markdown for the
 * auditor handoff packet. Produces RenderedFinding objects that include
 * the Markdown text plus evidence files (left CSV, right CSV, meta JSON).
 */

import type { RenderedFinding, EvidenceFile } from '../types.js';

// ---------------------------------------------------------------------------
// Local type definitions
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

// ---------------------------------------------------------------------------
// Markdown escaping
// ---------------------------------------------------------------------------

/**
 * Escape characters that have special meaning in Markdown tables and
 * inline formatting. Pipes break table layout, backticks break inline
 * code spans, and angle brackets can be interpreted as HTML.
 */
function escapeMarkdown(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/`/g, '\\`')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ---------------------------------------------------------------------------
// CSV helpers
// ---------------------------------------------------------------------------

function csvEscape(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function buildCsvRow(fields: Record<string, string>): string {
  const headers = Object.keys(fields);
  const values = Object.values(fields);
  const headerLine = headers.map(csvEscape).join(',');
  const valueLine = values.map(csvEscape).join(',');
  return `${headerLine}\n${valueLine}\n`;
}

// ---------------------------------------------------------------------------
// FindingRenderer
// ---------------------------------------------------------------------------

export class FindingRenderer {
  /**
   * Render a contradiction finding as Markdown with evidence files.
   */
  renderContradiction(finding: ContradictionFinding): RenderedFinding {
    const esc = escapeMarkdown;
    const lines: string[] = [];

    // Header
    lines.push(`## F-${esc(finding.id)}: ${esc(finding.title)}`);
    lines.push('');
    lines.push(
      `**Severity:** ${esc(finding.severity)} | ` +
        `**Risk Score:** ${finding.riskScore}/100 | ` +
        `**Type:** ${esc(finding.type)}`
    );
    lines.push('');

    // Evidence table
    lines.push('### Evidence');
    lines.push('');
    lines.push('| Side | System | Table | Record | Field | Value |');
    lines.push('|------|--------|-------|--------|-------|-------|');
    lines.push(
      `| Left | ${esc(finding.leftSystem)} | ${esc(finding.leftTable)} | ` +
        `${esc(finding.leftRecordId)} | ${esc(finding.leftField)} | ${esc(finding.leftValue)} |`
    );
    lines.push(
      `| Right | ${esc(finding.rightSystem)} | ${esc(finding.rightTable)} | ` +
        `${esc(finding.rightRecordId)} | ${esc(finding.rightField)} | ${esc(finding.rightValue)} |`
    );
    lines.push('');

    // Scoring details table
    lines.push('### Scoring Details');
    lines.push('');
    const detailKeys = Object.keys(finding.scoringDetails);
    if (detailKeys.length > 0) {
      lines.push('| Metric | Value |');
      lines.push('|--------|-------|');
      for (const key of detailKeys) {
        const val = finding.scoringDetails[key];
        if (val !== undefined) {
          lines.push(`| ${esc(key)} | ${val} |`);
        }
      }
    } else {
      lines.push('No scoring details available.');
    }
    lines.push('');

    // Status
    lines.push('### Status');
    lines.push('');
    lines.push(`**Detection Date:** ${esc(finding.detectedAt)}`);
    lines.push(`**Resolution:** ${esc(finding.resolutionStatus)}`);
    lines.push(`**Reviewer Notes:** ${esc(finding.reviewerNotes || 'None')}`);

    const markdown = lines.join('\n');

    // Evidence files
    const evidenceFiles = this.buildEvidenceFiles(finding);

    return {
      id: finding.id,
      title: finding.title,
      severity: finding.severity,
      riskScore: finding.riskScore,
      markdown,
      evidenceFiles,
    };
  }

  /**
   * Render an FI/CO anomaly as Markdown.
   */
  renderAnomaly(anomaly: {
    type: string;
    severity: string;
    details: Record<string, unknown>;
    riskScore: number;
  }): RenderedFinding {
    const esc = escapeMarkdown;
    const lines: string[] = [];

    const id = `FICO-${Date.now()}`;

    lines.push(`## ${esc(id)}: FI/CO Anomaly — ${esc(anomaly.type)}`);
    lines.push('');
    lines.push(
      `**Severity:** ${esc(anomaly.severity)} | ` +
        `**Risk Score:** ${anomaly.riskScore}/100 | ` +
        `**Type:** FI/CO ${esc(anomaly.type)}`
    );
    lines.push('');

    // Details table
    lines.push('### Details');
    lines.push('');
    const detailKeys = Object.keys(anomaly.details);
    if (detailKeys.length > 0) {
      lines.push('| Field | Value |');
      lines.push('|-------|-------|');
      for (const key of detailKeys) {
        const val = anomaly.details[key];
        lines.push(`| ${esc(key)} | ${esc(String(val))} |`);
      }
    } else {
      lines.push('No details available.');
    }

    const markdown = lines.join('\n');

    return {
      id,
      title: `FI/CO Anomaly — ${anomaly.type}`,
      severity: anomaly.severity,
      riskScore: anomaly.riskScore,
      markdown,
      evidenceFiles: [],
    };
  }

  /**
   * Render a batch of findings sorted by risk score descending.
   */
  renderAll(findings: ContradictionFinding[]): RenderedFinding[] {
    const sorted = [...findings].sort((a, b) => b.riskScore - a.riskScore);
    return sorted.map(f => this.renderContradiction(f));
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private buildEvidenceFiles(finding: ContradictionFinding): EvidenceFile[] {
    // Left-side CSV
    const leftCsv: EvidenceFile = {
      filename: `F-${finding.id}-left.csv`,
      content: buildCsvRow({
        system: finding.leftSystem,
        table: finding.leftTable,
        recordId: finding.leftRecordId,
        field: finding.leftField,
        value: finding.leftValue,
        extractionId: finding.leftExtractionId,
      }),
      mimeType: 'text/csv',
      extractionId: finding.leftExtractionId,
    };

    // Right-side CSV
    const rightCsv: EvidenceFile = {
      filename: `F-${finding.id}-right.csv`,
      content: buildCsvRow({
        system: finding.rightSystem,
        table: finding.rightTable,
        recordId: finding.rightRecordId,
        field: finding.rightField,
        value: finding.rightValue,
        extractionId: finding.rightExtractionId,
      }),
      mimeType: 'text/csv',
      extractionId: finding.rightExtractionId,
    };

    // Meta JSON
    const meta = {
      findingId: finding.id,
      leftExtractionId: finding.leftExtractionId,
      rightExtractionId: finding.rightExtractionId,
      queryHashes: {
        left: hashString(`${finding.leftSystem}:${finding.leftTable}:${finding.leftRecordId}`),
        right: hashString(`${finding.rightSystem}:${finding.rightTable}:${finding.rightRecordId}`),
      },
      timestamps: {
        detectedAt: finding.detectedAt,
        renderedAt: new Date().toISOString(),
      },
    };

    const metaJson: EvidenceFile = {
      filename: `F-${finding.id}-meta.json`,
      content: JSON.stringify(meta, null, 2),
      mimeType: 'application/json',
    };

    return [leftCsv, rightCsv, metaJson];
  }
}

// ---------------------------------------------------------------------------
// Simple string hash (deterministic, not cryptographic)
// ---------------------------------------------------------------------------

function hashString(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0;
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
}
