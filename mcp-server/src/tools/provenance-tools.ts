/**
 * Tools 19-21: Provenance + Extraction Registry MCP Tools
 *
 * Three tools that expose the provenance graph and extraction registry
 * to agents for evidence tracing, path discovery, and deterministic
 * extraction execution.
 */

import { z } from 'zod';
import type { ProvenanceQuery } from '../provenance/query.js';
import type { ProvenanceExporter } from '../provenance/export.js';
import type { ExtractionRegistry } from '../extraction-registry/index.js';
import type { ExtractionResult } from '../extraction-registry/types.js';

// ============================================================================
// Dependency injection interface
// ============================================================================

export interface ProvenanceToolDeps {
  provenanceQuery?: ProvenanceQuery;
  provenanceExporter?: ProvenanceExporter;
  registry?: ExtractionRegistry;
  executeExtraction?: (
    pathId: string,
    parameters: Record<string, string>,
  ) => Promise<ExtractionResult>;
}

// ============================================================================
// Tool 19: query_provenance
// ============================================================================

export const QueryProvenanceSchema = z.object({
  finding_id: z.string().min(1, 'finding_id is required'),
  format: z.enum(['dag', 'flat', 'markdown']).default('flat'),
});

export type QueryProvenanceInput = z.infer<typeof QueryProvenanceSchema>;

export const queryProvenanceTool = {
  name: 'query_provenance',
  description: `Trace the complete evidence chain for a finding, showing every extraction record with field-level provenance (system, table, record, field, value, timestamp). Use this to verify the evidence basis for any forensic finding.`,
  inputSchema: {
    type: 'object' as const,
    properties: {
      finding_id: {
        type: 'string',
        description: 'The finding ID to trace',
      },
      format: {
        type: 'string',
        enum: ['dag', 'flat', 'markdown'],
        description: 'Output format (default: flat)',
      },
    },
    required: ['finding_id'],
  },
};

export async function executeQueryProvenance(
  deps: ProvenanceToolDeps,
  rawInput: unknown,
): Promise<unknown> {
  const input = QueryProvenanceSchema.parse(rawInput);

  if (!deps.provenanceExporter) {
    throw new Error('Provenance exporter not configured');
  }

  switch (input.format) {
    case 'dag':
      return deps.provenanceExporter.exportDAG(input.finding_id);
    case 'markdown':
      return deps.provenanceExporter.exportMarkdown(input.finding_id);
    case 'flat':
    default:
      return deps.provenanceExporter.exportFlat(input.finding_id);
  }
}

// ============================================================================
// Tool 20: list_extraction_paths
// ============================================================================

export const ListExtractionPathsSchema = z.object({
  system_type: z.enum(['SAP', 'NetSuite', 'Salesforce']).optional(),
  domain: z.enum(['o2c', 'fi-co', 'p2p', 'user-audit', 'pipeline']).optional(),
});

export type ListExtractionPathsInput = z.infer<typeof ListExtractionPathsSchema>;

export const listExtractionPathsTool = {
  name: 'list_extraction_paths',
  description: `List all available deterministic extraction paths in the registry. Each path is a named, versioned, reproducible query for a specific ERP system and domain.`,
  inputSchema: {
    type: 'object' as const,
    properties: {
      system_type: {
        type: 'string',
        enum: ['SAP', 'NetSuite', 'Salesforce'],
        description: 'Filter by system',
      },
      domain: {
        type: 'string',
        enum: ['o2c', 'fi-co', 'p2p', 'user-audit', 'pipeline'],
        description: 'Filter by domain',
      },
    },
    required: [],
  },
};

export async function executeListExtractionPaths(
  deps: ProvenanceToolDeps,
  rawInput: unknown,
): Promise<unknown> {
  const input = ListExtractionPathsSchema.parse(rawInput);

  if (!deps.registry) {
    throw new Error('Extraction registry not configured');
  }

  const filter: { systemType?: 'SAP' | 'NetSuite' | 'Salesforce'; domain?: 'o2c' | 'fi-co' | 'p2p' | 'user-audit' | 'pipeline' } = {};
  if (input.system_type) {
    filter.systemType = input.system_type;
  }
  if (input.domain) {
    filter.domain = input.domain;
  }

  const paths = deps.registry.list(Object.keys(filter).length > 0 ? filter : undefined);

  return paths.map((p) => ({
    id: p.id,
    version: p.version,
    name: p.name,
    description: p.description,
    systemType: p.systemType,
    domain: p.domain,
    queryType: p.queryType,
    parameterCount: p.parameters.length,
    fieldCount: p.expectedFields.length,
  }));
}

// ============================================================================
// Tool 21: run_extraction
// ============================================================================

export const RunExtractionSchema = z.object({
  path_id: z.string().min(1, 'path_id is required'),
  parameters: z.record(z.string()),
  dry_run: z.boolean().default(false),
});

export type RunExtractionInput = z.infer<typeof RunExtractionSchema>;

export const runExtractionTool = {
  name: 'run_extraction',
  description: `Execute a deterministic extraction path from the registry. The extraction is logged to the provenance graph with full field-level tracking. The result includes a replay hash for independent verification.`,
  inputSchema: {
    type: 'object' as const,
    properties: {
      path_id: {
        type: 'string',
        description: 'Extraction path ID from the registry',
      },
      parameters: {
        type: 'object',
        description: 'Query parameters as key-value pairs',
      },
      dry_run: {
        type: 'boolean',
        description: 'If true, validate parameters and return the query without executing',
      },
    },
    required: ['path_id', 'parameters'],
  },
};

export async function executeRunExtraction(
  deps: ProvenanceToolDeps,
  rawInput: unknown,
): Promise<unknown> {
  const input = RunExtractionSchema.parse(rawInput);

  if (!deps.registry) {
    throw new Error('Extraction registry not configured');
  }

  // Validate the path exists
  const path = deps.registry.get(input.path_id);
  if (!path) {
    return { error: `Unknown extraction path: '${input.path_id}'` };
  }

  // Validate parameters
  const validation = deps.registry.validateParameters(input.path_id, input.parameters);
  if (!validation.valid) {
    return { error: 'Parameter validation failed', details: validation.errors };
  }

  // Dry run: return query and parameter info without executing
  if (input.dry_run) {
    return {
      dry_run: true,
      path_id: path.id,
      version: path.version,
      query: path.query,
      parameters: input.parameters,
      expectedFields: path.expectedFields.map((f) => ({
        name: f.name,
        type: f.type,
        description: f.description,
      })),
    };
  }

  // Execute the extraction
  if (!deps.executeExtraction) {
    throw new Error('Extraction executor not configured');
  }

  const result = await deps.executeExtraction(input.path_id, input.parameters);
  return result;
}

// ============================================================================
// Factory: create all three tools with injected dependencies
// ============================================================================

export function createProvenanceTools(deps: ProvenanceToolDeps) {
  return {
    queryProvenance: {
      tool: queryProvenanceTool,
      handler: (rawInput: unknown) => executeQueryProvenance(deps, rawInput),
    },
    listExtractionPaths: {
      tool: listExtractionPathsTool,
      handler: (rawInput: unknown) => executeListExtractionPaths(deps, rawInput),
    },
    runExtraction: {
      tool: runExtractionTool,
      handler: (rawInput: unknown) => executeRunExtraction(deps, rawInput),
    },
  };
}
