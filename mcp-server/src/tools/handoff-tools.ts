/**
 * Tool 22: Handoff Packet MCP Tool
 *
 * Exposes the handoff packet generator to agents, allowing them to
 * produce self-contained reviewer handoff packets with all findings,
 * evidence, extraction manifests, and reproduction instructions.
 */

import { z } from 'zod';
import type { HandoffPacketGenerator } from '../handoff/index.js';

// ============================================================================
// Dependency injection interface
// ============================================================================

export interface HandoffToolDeps {
  generator?: HandoffPacketGenerator;
}

// ============================================================================
// Tool 22: generate_handoff_packet
// ============================================================================

export const GenerateHandoffPacketSchema = z.object({
  engagement_id: z.string().min(1, 'engagement_id is required'),
  client_name: z.string().min(1, 'client_name is required'),
  scope: z.string().min(1, 'scope is required'),
  date_from: z.string().min(1, 'date_from is required'),
  date_to: z.string().min(1, 'date_to is required'),
  prepared_by: z.string().min(1, 'prepared_by is required'),
  systems: z.array(z.string()).min(1, 'at least one system is required'),
  include_reproduction: z.boolean().default(true),
  include_checklist: z.boolean().default(true),
});

export type GenerateHandoffPacketInput = z.infer<typeof GenerateHandoffPacketSchema>;

export const generateHandoffPacketTool = {
  name: 'generate_handoff_packet',
  description:
    'Generate a self-contained reviewer handoff packet with all findings, evidence, extraction manifests, and reproduction instructions. The packet can be independently verified without model access.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      engagement_id: {
        type: 'string',
        description: 'Unique engagement identifier',
      },
      client_name: {
        type: 'string',
        description: 'Client organization name',
      },
      scope: {
        type: 'string',
        description: 'Audit scope description (e.g., "FY2025 Q1-Q3 O2C Process Audit")',
      },
      date_from: {
        type: 'string',
        description: 'Start of audit period (ISO date, e.g., "2025-01-01")',
      },
      date_to: {
        type: 'string',
        description: 'End of audit period (ISO date, e.g., "2025-09-30")',
      },
      prepared_by: {
        type: 'string',
        description: 'Name of the person preparing the packet',
      },
      systems: {
        type: 'array',
        items: { type: 'string' },
        description: 'Systems accessed during the engagement (e.g., ["SAP", "Salesforce"])',
      },
      include_reproduction: {
        type: 'boolean',
        description: 'Include extraction reproduction instructions (default: true)',
      },
      include_checklist: {
        type: 'boolean',
        description: 'Include reviewer checklist (default: true)',
      },
    },
    required: [
      'engagement_id',
      'client_name',
      'scope',
      'date_from',
      'date_to',
      'prepared_by',
      'systems',
    ],
  },
};

export async function executeGenerateHandoffPacket(
  deps: HandoffToolDeps,
  rawInput: unknown
): Promise<unknown> {
  const input = GenerateHandoffPacketSchema.parse(rawInput);

  if (!deps.generator) {
    throw new Error('Handoff packet generator not configured');
  }

  const packet = await deps.generator.generate({
    engagementId: input.engagement_id,
    clientName: input.client_name,
    scope: input.scope,
    dateRange: { from: input.date_from, to: input.date_to },
    systemsAccessed: input.systems as import('../provenance/types.js').SystemType[],
    preparedBy: input.prepared_by,
    includeReproduction: input.include_reproduction,
    includeChecklist: input.include_checklist,
    outputDir: '',
  });

  // Compute file count and total size from the packet
  let fileCount = 0;
  let totalSize = 0;

  // Summary
  if (packet.summary) {
    fileCount++;
    totalSize += packet.summary.length;
  }

  // Findings evidence files
  for (const finding of packet.findings) {
    fileCount++; // the finding markdown itself
    totalSize += finding.markdown.length;
    for (const ef of finding.evidenceFiles) {
      fileCount++;
      totalSize += ef.content.length;
    }
  }

  // Contradictions evidence files
  for (const c of packet.contradictions) {
    fileCount++;
    totalSize += c.markdown.length;
    for (const ef of c.evidenceFiles) {
      fileCount++;
      totalSize += ef.content.length;
    }
  }

  // Reality gaps evidence files
  for (const g of packet.realityGaps) {
    fileCount++;
    totalSize += g.markdown.length;
    for (const ef of g.evidenceFiles) {
      fileCount++;
      totalSize += ef.content.length;
    }
  }

  // Manifest
  if (packet.manifest) {
    fileCount++;
    totalSize += JSON.stringify(packet.manifest).length;
  }

  // Checklist
  if (packet.checklist) {
    fileCount++;
    totalSize += JSON.stringify(packet.checklist).length;
  }

  // Provenance graph
  if (packet.provenanceGraph) {
    fileCount++;
    totalSize += packet.provenanceGraph.length;
  }

  return {
    engagementId: packet.config.engagementId,
    clientName: packet.config.clientName,
    scope: packet.config.scope,
    dateRange: packet.config.dateRange,
    systems: packet.config.systemsAccessed,
    findingCount: packet.findings.length,
    contradictionCount: packet.contradictions.length,
    realityGapCount: packet.realityGaps.length,
    checklistItems: packet.checklist.totalCount,
    manifestEntries: packet.manifest.totalExtractions,
    generatedAt: packet.generatedAt,
    fileCount,
    totalSize,
  };
}

// ============================================================================
// Factory: create the handoff tool with injected dependencies
// ============================================================================

export function createHandoffTools(deps: HandoffToolDeps) {
  return {
    generateHandoffPacket: {
      tool: generateHandoffPacketTool,
      handler: (rawInput: unknown) => executeGenerateHandoffPacket(deps, rawInput),
    },
  };
}
