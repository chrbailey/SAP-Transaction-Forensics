/**
 * Summary Generator
 *
 * Generates the executive summary page for auditor handoff packets.
 * Produces structured Markdown with key metrics, risk narrative,
 * and systems-analyzed tables.
 */

import type { HandoffConfig } from '../types.js';

export interface SummaryParams {
  config: HandoffConfig;
  contradictionCount: number;
  gapCount: number;
  criticalCount: number;
  highCount: number;
  mediumCount: number;
  systemsCovered: string[];
  tablesCovered: string[];
  totalExtractions: number;
  overallRiskScore: number;
}

export class SummaryGenerator {
  /** Generate the executive summary page */
  generateSummary(params: SummaryParams): string {
    const {
      config,
      contradictionCount,
      gapCount,
      criticalCount,
      highCount,
      mediumCount,
      systemsCovered,
      tablesCovered,
      totalExtractions,
      overallRiskScore,
    } = params;

    const generatedAt = new Date().toISOString().split('T')[0]!;

    const lines: string[] = [];

    // Header
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

    // Executive Summary
    lines.push('## Executive Summary');
    lines.push('');
    lines.push(
      `This assessment analyzed ${totalExtractions} extraction records across ` +
      `${systemsCovered.length} systems (${systemsCovered.join(', ')}), ` +
      `covering ${tablesCovered.length} database tables.`
    );
    lines.push('');

    // Key Metrics
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

    // Risk Assessment
    lines.push('### Risk Assessment');
    lines.push('');
    lines.push(this.getRiskNarrative(overallRiskScore, criticalCount, highCount));
    lines.push('');

    // Systems Analyzed
    lines.push('### Systems Analyzed');
    lines.push('');
    lines.push('| System | Tables |');
    lines.push('|--------|--------|');
    for (const system of systemsCovered) {
      const systemTables = tablesCovered.filter(t => this.tableMatchesSystem(t, system));
      const tableList = systemTables.length > 0 ? systemTables.join(', ') : 'N/A';
      lines.push(`| ${system} | ${tableList} |`);
    }
    lines.push('');

    return lines.join('\n');
  }

  /** Determine risk narrative based on overall score and finding counts */
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
      'The overall risk assessment indicates low risk, routine findings. ' +
      `With a risk score of ${overallRiskScore}/100, the assessment found no significant ` +
      'issues requiring urgent attention. Standard monitoring should continue.'
    );
  }

  /** Heuristic to match a table name to a system */
  private tableMatchesSystem(table: string, system: string): boolean {
    const sapTables = ['EKKO', 'EKPO', 'BKPF', 'BSEG', 'VBAK', 'VBAP', 'LIKP', 'LIPS', 'RBKP', 'RSEG', 'CDHDR', 'CDPOS'];
    const sfTables = ['Opportunity', 'Account', 'Contact', 'Lead', 'Case', 'Task', 'Event'];
    const nsTables = ['Transaction', 'Journal', 'Customer', 'Vendor', 'Item'];

    const upper = system.toUpperCase();
    if (upper === 'SAP') return sapTables.includes(table);
    if (upper === 'SALESFORCE') return sfTables.includes(table);
    if (upper === 'NETSUITE') return nsTables.includes(table);

    // Fallback: no match
    return false;
  }
}
