/**
 * Provenance DAG Export
 *
 * Exports provenance chains as structured data for inclusion in
 * reviewer handoff packets. Supports three formats:
 *   - DAG (JSON tree): finding → evidence roles → extraction records
 *   - Flat (tabular): one row per extraction, suitable for CSV
 *   - Markdown: human-readable table for review documents
 */

import type { EvidenceRole, ProvenanceDAG, ProvenanceNode } from './types.js';
import type { ProvenanceQuery } from './query.js';

export class ProvenanceExporter {
  constructor(private query: ProvenanceQuery) {}

  /**
   * Export the full provenance DAG for a finding as a JSON tree.
   * Structure: finding (root) → evidence nodes (by role) → extraction leaves.
   */
  exportDAG(findingId: string): ProvenanceDAG {
    const chain = this.query.getEvidenceChain(findingId);
    const summary = this.query.getSummary(findingId);

    const evidenceNodes: ProvenanceNode[] = [];

    for (const role of ['primary', 'corroborating', 'contradicting'] as const) {
      const extractions = chain[role];
      if (extractions.length === 0) continue;

      const extractionNodes: ProvenanceNode[] = extractions.map(ext => ({
        type: 'extraction' as const,
        id: ext.id,
        data: {
          adapterId: ext.adapterId,
          systemType: ext.systemType,
          tableName: ext.tableName,
          recordId: ext.recordId,
          fieldName: ext.fieldName,
          rawValue: ext.rawValue,
          normalizedValue: ext.normalizedValue,
          extractionTimestamp: ext.extractionTimestamp,
          queryHash: ext.queryHash,
          replayHash: ext.replayHash,
        },
        children: [],
      }));

      evidenceNodes.push({
        type: 'evidence',
        id: `${findingId}:${role}`,
        data: { role, count: extractions.length },
        children: extractionNodes,
      });
    }

    const rootNode: ProvenanceNode = {
      type: 'finding',
      id: findingId,
      data: {
        extractionCount: summary.extractionCount,
        systemsCovered: summary.systemsCovered,
        tablesCovered: summary.tablesCovered,
      },
      children: evidenceNodes,
    };

    return {
      rootFindingId: findingId,
      nodes: [rootNode],
      generatedAt: new Date().toISOString(),
      replayable: summary.allReplayable,
    };
  }

  /**
   * Export as a flat list suitable for CSV or tabular display.
   * One row per extraction, with the evidence role inlined.
   */
  exportFlat(findingId: string): Array<{
    findingId: string;
    role: EvidenceRole;
    extractionId: string;
    systemType: string;
    tableName: string;
    recordId: string;
    fieldName: string;
    rawValue: string;
    extractedAt: string;
    queryHash: string;
    replayHash: string;
  }> {
    const chain = this.query.getEvidenceChain(findingId);
    const rows: Array<{
      findingId: string;
      role: EvidenceRole;
      extractionId: string;
      systemType: string;
      tableName: string;
      recordId: string;
      fieldName: string;
      rawValue: string;
      extractedAt: string;
      queryHash: string;
      replayHash: string;
    }> = [];

    for (const role of ['primary', 'corroborating', 'contradicting'] as const) {
      for (const ext of chain[role]) {
        rows.push({
          findingId,
          role,
          extractionId: ext.id,
          systemType: ext.systemType,
          tableName: ext.tableName,
          recordId: ext.recordId,
          fieldName: ext.fieldName,
          rawValue: ext.rawValue,
          extractedAt: ext.extractionTimestamp,
          queryHash: ext.queryHash,
          replayHash: ext.replayHash,
        });
      }
    }

    return rows;
  }

  /**
   * Export as a Markdown table for human review.
   * Includes a header row and one data row per extraction.
   */
  exportMarkdown(findingId: string): string {
    const rows = this.exportFlat(findingId);

    const header = '| Role | System | Table | Record | Field | Value | Extracted At | Query Hash |';
    const separator =
      '|------|--------|-------|--------|-------|-------|--------------|------------|';

    if (rows.length === 0) {
      return `# Provenance: ${findingId}\n\nNo evidence found.\n`;
    }

    const dataRows = rows.map(
      r =>
        `| ${r.role} | ${r.systemType} | ${r.tableName} | ${r.recordId} | ${r.fieldName} | ${r.rawValue} | ${r.extractedAt} | ${r.queryHash.slice(0, 8)}... |`
    );

    return [`# Provenance: ${findingId}`, '', header, separator, ...dataRows, ''].join('\n');
  }
}
