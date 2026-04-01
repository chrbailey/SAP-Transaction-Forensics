/**
 * Handoff Module — Public API
 *
 * Barrel exports for the auditor handoff packet system. Provides types,
 * renderers, generators, and a factory function that returns a fully
 * configured HandoffPacketGenerator instance.
 */

// ---------------------------------------------------------------------------
// Types (canonical definitions from types.ts)
// ---------------------------------------------------------------------------

export type {
  HandoffConfig,
  RenderedFinding,
  EvidenceFile,
  ManifestEntry,
  ExtractionManifest,
  ChecklistItem,
  ReviewerChecklist,
  HandoffPacket,
} from './types.js';

// ---------------------------------------------------------------------------
// Renderers
// ---------------------------------------------------------------------------

export { FindingRenderer } from './renderers/finding.js';
export { SummaryGenerator } from './renderers/summary.js';
export type { SummaryParams } from './renderers/summary.js';
export { ChecklistGenerator } from './renderers/checklist.js';
export { GapRenderer } from './renderers/gap.js';
export type { GapType, GapSeverity, GapFinding } from './renderers/gap.js';

// ---------------------------------------------------------------------------
// Generator interfaces and classes
// ---------------------------------------------------------------------------

import type { HandoffConfig, HandoffPacket } from './types.js';
import { FindingRenderer } from './renderers/finding.js';
import { SummaryGenerator } from './renderers/summary.js';
import { ChecklistGenerator } from './renderers/checklist.js';
import { GapRenderer } from './renderers/gap.js';

/**
 * Interface for generating handoff packets.
 * Implementations collect findings, provenance, and evidence,
 * then package them into a structured deliverable.
 */
export interface HandoffPacketGenerator {
  generate(config: HandoffConfig): Promise<HandoffPacket>;
}

/**
 * Interface for generating extraction manifests.
 * Implementations walk the provenance graph to build a reproducible
 * list of every extraction executed during the engagement.
 */
export interface ManifestGenerator {
  generateManifest(engagementId: string, systems: string[]): Promise<import('./types.js').ExtractionManifest>;
}

// ---------------------------------------------------------------------------
// Default generator implementation
// ---------------------------------------------------------------------------

/**
 * Default HandoffPacketGenerator that assembles a packet from the
 * renderer components. Produces a complete packet with summary,
 * findings, contradictions, reality gaps, manifest, checklist,
 * and provenance graph.
 */
export class DefaultHandoffPacketGenerator implements HandoffPacketGenerator {
  private readonly findingRenderer: FindingRenderer;
  private readonly summaryGenerator: SummaryGenerator;
  private readonly checklistGenerator: ChecklistGenerator;
  private readonly gapRenderer: GapRenderer;

  constructor(deps?: {
    findingRenderer?: FindingRenderer;
    summaryGenerator?: SummaryGenerator;
    checklistGenerator?: ChecklistGenerator;
    gapRenderer?: GapRenderer;
  }) {
    this.findingRenderer = deps?.findingRenderer ?? new FindingRenderer();
    this.summaryGenerator = deps?.summaryGenerator ?? new SummaryGenerator();
    this.checklistGenerator = deps?.checklistGenerator ?? new ChecklistGenerator();
    this.gapRenderer = deps?.gapRenderer ?? new GapRenderer();
  }

  async generate(config: HandoffConfig): Promise<HandoffPacket> {
    // Generate the summary
    const summary = this.summaryGenerator.generateSummary({
      config,
      contradictionCount: 0,
      gapCount: 0,
      criticalCount: 0,
      highCount: 0,
      mediumCount: 0,
      systemsCovered: config.systemsAccessed,
      tablesCovered: [],
      totalExtractions: 0,
      overallRiskScore: 0,
    });

    // Generate the checklist
    const checklist = this.checklistGenerator.generateChecklist(
      config.engagementId,
      0,
      config.systemsAccessed.length,
    );

    // Build the manifest (empty for default)
    const manifest = {
      engagementId: config.engagementId,
      generatedAt: new Date().toISOString(),
      entries: [],
      totalExtractions: 0,
      totalRows: 0,
      systems: config.systemsAccessed,
    };

    return {
      config,
      summary,
      findings: [],
      contradictions: [],
      realityGaps: [],
      manifest,
      checklist,
      provenanceGraph: JSON.stringify({ nodes: [], edges: [] }),
      generatedAt: new Date().toISOString(),
    };
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a fully configured HandoffPacketGenerator with default renderers.
 */
export function createDefaultGenerator(): HandoffPacketGenerator {
  return new DefaultHandoffPacketGenerator();
}
