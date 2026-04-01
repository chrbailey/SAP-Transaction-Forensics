/**
 * Handoff Packet Type Definitions
 *
 * Types for the auditor handoff packet system that packages findings,
 * evidence, provenance, and reproduction instructions into a structured
 * deliverable for external reviewers.
 */

import type { SystemType } from '../provenance/types.js';

/** Configuration for packet generation */
export interface HandoffConfig {
  engagementId: string;
  clientName: string;
  preparedBy: string;
  dateRange: { from: string; to: string };
  systemsAccessed: SystemType[];
  scope: string;                // e.g., "FY2025 Q1-Q3 O2C Process Audit"
  includeReproduction: boolean;
  includeChecklist: boolean;
  outputDir: string;
}

/** A rendered finding for the packet */
export interface RenderedFinding {
  id: string;
  title: string;
  severity: string;
  riskScore: number;
  markdown: string;             // Full Markdown rendering of the finding
  evidenceFiles: EvidenceFile[];
}

/** A file to include in the evidence directory */
export interface EvidenceFile {
  filename: string;
  content: string;              // CSV, JSON, or text content
  mimeType: 'text/csv' | 'application/json' | 'text/plain' | 'text/markdown';
  extractionId?: string;        // FK to provenance
}

/** Extraction manifest entry for independent reproduction */
export interface ManifestEntry {
  extractionPathId: string;
  extractionPathVersion: string;
  parameters: Record<string, string>;
  queryHash: string;
  replayHash: string;
  extractedAt: string;
  rowCount: number;
}

/** The complete extraction manifest */
export interface ExtractionManifest {
  engagementId: string;
  generatedAt: string;
  entries: ManifestEntry[];
  totalExtractions: number;
  totalRows: number;
  systems: SystemType[];
}

/** Reviewer checklist item */
export interface ChecklistItem {
  id: string;
  category: 'data_quality' | 'completeness' | 'methodology' | 'findings' | 'remediation';
  text: string;
  required: boolean;
  checked: boolean;
  notes: string;
}

/** The complete reviewer checklist */
export interface ReviewerChecklist {
  engagementId: string;
  reviewerName: string;
  generatedAt: string;
  items: ChecklistItem[];
  completedCount: number;
  totalCount: number;
}

/** The full handoff packet structure */
export interface HandoffPacket {
  config: HandoffConfig;
  summary: string;              // Executive summary markdown
  findings: RenderedFinding[];
  contradictions: RenderedFinding[];
  realityGaps: RenderedFinding[];
  manifest: ExtractionManifest;
  checklist: ReviewerChecklist;
  provenanceGraph: string;      // JSON DAG
  generatedAt: string;
}
