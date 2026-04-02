/**
 * Tools 22-23: Contradiction Detection + Schema Validation MCP Tools
 *
 * Two tools that expose contradiction detection and schema validation
 * to agents for cross-system analysis and extraction safety checks.
 */

import { z } from 'zod';
import type { ContradictionEngine } from '../contradiction/engine.js';
import type { ExtractionRegistry } from '../extraction-registry/index.js';
import type {
  ComparisonPair,
  ComparisonResult,
  ContradictionType,
  Severity,
} from '../contradiction/types.js';
import type {
  ClientSchema,
  PathValidation,
} from '../schema-validator/types.js';

// ============================================================================
// Schema Validator interface (defined here until class exists)
// ============================================================================

export interface SchemaValidator {
  validatePath(
    pathId: string,
    clientSchema: ClientSchema,
  ): PathValidation;
  validateAllPaths(
    clientSchema: ClientSchema,
  ): PathValidation[];
  analyzeCustomizations(
    clientSchema: ClientSchema,
  ): CustomizationReport;
}

export interface CustomizationReport {
  zTables: string[];
  zFields: Array<{ table: string; field: string }>;
  customNamespaces: string[];
  totalCustomizations: number;
}

// ============================================================================
// Dependency injection interface
// ============================================================================

export interface ContradictionToolDeps {
  engine?: ContradictionEngine;
  validator?: SchemaValidator;
  registry?: ExtractionRegistry;
}

// ============================================================================
// Shared constants
// ============================================================================

const CONTRADICTION_TYPES: ContradictionType[] = [
  'AMOUNT_DIVERGENCE',
  'DATE_CONFLICT',
  'STATUS_INCOMPATIBLE',
  'ENTITY_MISMATCH',
  'QUANTITY_DIVERGENCE',
  'APPROVAL_BYPASS',
  'TEMPORAL_IMPOSSIBILITY',
  'DUPLICATE_REFERENCE',
  'ORPHAN_RECORD',
  'RETROACTIVE_CHANGE',
  'SOD_VIOLATION',
  'SCHEMA_GHOST',
];

const SEVERITY_LEVELS: Severity[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'];

const SEVERITY_RANK: Record<Severity, number> = {
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
  INFO: 4,
};

// ============================================================================
// Tool 22: detect_contradictions
// ============================================================================

const ComparisonPairSchema = z.object({
  left: z.object({
    system: z.string(),
    table: z.string(),
    recordId: z.string(),
    fields: z.record(z.string()),
    extractionId: z.string(),
  }),
  right: z.object({
    system: z.string(),
    table: z.string(),
    recordId: z.string(),
    fields: z.record(z.string()),
    extractionId: z.string(),
  }),
});

export const DetectContradictionsSchema = z.object({
  pairs: z.array(ComparisonPairSchema).min(1, 'At least one pair is required'),
  types: z.array(z.enum([
    'AMOUNT_DIVERGENCE', 'DATE_CONFLICT', 'STATUS_INCOMPATIBLE',
    'ENTITY_MISMATCH', 'QUANTITY_DIVERGENCE', 'APPROVAL_BYPASS',
    'TEMPORAL_IMPOSSIBILITY', 'DUPLICATE_REFERENCE', 'ORPHAN_RECORD',
    'RETROACTIVE_CHANGE', 'SOD_VIOLATION', 'SCHEMA_GHOST',
  ])).optional(),
  config: z.object({
    amountDivergencePercent: z.number().optional(),
    amountDivergenceMinAbsolute: z.number().optional(),
    dateConflictDays: z.number().optional(),
    dateConflictHighDays: z.number().optional(),
    approvalThreshold: z.number().optional(),
    stalePeriodDays: z.number().optional(),
    retroactiveDays: z.number().optional(),
  }).optional(),
  min_severity: z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO']).default('LOW'),
});

export type DetectContradictionsInput = z.infer<typeof DetectContradictionsSchema>;

export const detectContradictionsTool = {
  name: 'detect_contradictions',
  description:
    'Run cross-system contradiction detection on matched record pairs. Analyzes 12 types of contradictions including amount divergence, temporal impossibility, status incompatibility, approval bypass, and SoD violations. Returns typed findings with severity scores and field-level evidence.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      pairs: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            left: {
              type: 'object',
              properties: {
                system: { type: 'string', description: 'Source system (SAP, NetSuite, Salesforce)' },
                table: { type: 'string', description: 'Table name' },
                recordId: { type: 'string', description: 'Record identifier' },
                fields: { type: 'object', description: 'Field name/value pairs' },
                extractionId: { type: 'string', description: 'Provenance extraction ID' },
              },
              required: ['system', 'table', 'recordId', 'fields', 'extractionId'],
            },
            right: {
              type: 'object',
              properties: {
                system: { type: 'string', description: 'Target system (SAP, NetSuite, Salesforce)' },
                table: { type: 'string', description: 'Table name' },
                recordId: { type: 'string', description: 'Record identifier' },
                fields: { type: 'object', description: 'Field name/value pairs' },
                extractionId: { type: 'string', description: 'Provenance extraction ID' },
              },
              required: ['system', 'table', 'recordId', 'fields', 'extractionId'],
            },
          },
          required: ['left', 'right'],
        },
        description: 'Array of comparison pairs with left/right records',
      },
      types: {
        type: 'array',
        items: {
          type: 'string',
          enum: CONTRADICTION_TYPES,
        },
        description: 'Contradiction types to check (default: all 12)',
      },
      config: {
        type: 'object',
        properties: {
          amountDivergencePercent: { type: 'number', description: 'Amount divergence threshold (default 0.05 = 5%)' },
          amountDivergenceMinAbsolute: { type: 'number', description: 'Minimum absolute difference to flag' },
          dateConflictDays: { type: 'number', description: 'Date conflict threshold in days' },
          dateConflictHighDays: { type: 'number', description: 'High-severity date conflict threshold' },
          approvalThreshold: { type: 'number', description: 'Approval bypass amount threshold' },
          stalePeriodDays: { type: 'number', description: 'Stale period in days' },
          retroactiveDays: { type: 'number', description: 'Retroactive change threshold in days' },
        },
        description: 'Override detection thresholds',
      },
      min_severity: {
        type: 'string',
        enum: SEVERITY_LEVELS,
        description: 'Minimum severity to include (default: LOW)',
      },
    },
    required: ['pairs'],
  },
};

export async function executeDetectContradictions(
  deps: ContradictionToolDeps,
  rawInput: unknown,
): Promise<unknown> {
  const input = DetectContradictionsSchema.parse(rawInput);

  if (!deps.engine) {
    throw new Error('Contradiction engine not configured');
  }

  // Apply config overrides if provided
  if (input.config) {
    deps.engine.updateConfig(input.config as Record<string, number>);
  }

  // Cast pairs to the engine's expected type
  const pairs = input.pairs as unknown as ComparisonPair[];

  // Run analysis — type-filtered or all
  let result: ComparisonResult;
  if (input.types && input.types.length > 0) {
    result = deps.engine.analyzeWithTypes(pairs, input.types as ContradictionType[]);
  } else {
    result = deps.engine.analyzeAll(pairs);
  }

  // Filter by min_severity
  const minRank = SEVERITY_RANK[input.min_severity];
  const filtered = result.contradictions.filter(
    (c) => SEVERITY_RANK[c.severity] <= minRank,
  );

  // Build risk summary
  const riskSummary = buildRiskSummary(filtered);

  return {
    contradictions: filtered,
    recordsCompared: result.recordsCompared,
    comparisonsRun: result.comparisonsRun,
    duration: result.duration,
    riskSummary,
  };
}

function buildRiskSummary(
  contradictions: Array<{ severity: Severity; type: ContradictionType }>,
): {
  totalFindings: number;
  bySeverity: Record<Severity, number>;
  byType: Record<string, number>;
  highestSeverity: Severity | null;
} {
  const bySeverity: Record<Severity, number> = {
    CRITICAL: 0,
    HIGH: 0,
    MEDIUM: 0,
    LOW: 0,
    INFO: 0,
  };
  const byType: Record<string, number> = {};

  for (const c of contradictions) {
    bySeverity[c.severity]++;
    byType[c.type] = (byType[c.type] ?? 0) + 1;
  }

  let highestSeverity: Severity | null = null;
  for (const sev of SEVERITY_LEVELS) {
    if (bySeverity[sev] > 0) {
      highestSeverity = sev;
      break;
    }
  }

  return {
    totalFindings: contradictions.length,
    bySeverity,
    byType,
    highestSeverity,
  };
}

// ============================================================================
// Tool 23: validate_schema
// ============================================================================

export const ValidateSchemaSchema = z.object({
  client_schema: z.object({
    clientId: z.string(),
    systemType: z.string(),
    tables: z.record(z.object({
      name: z.string(),
      fields: z.record(z.object({
        name: z.string(),
        dataType: z.string(),
        length: z.number().optional(),
        decimals: z.number().optional(),
        description: z.string().optional(),
      })),
      recordCount: z.number().optional(),
    })),
    extractedAt: z.string(),
  }),
  path_ids: z.array(z.string()).optional(),
  include_customizations: z.boolean().default(true),
});

export type ValidateSchemaInput = z.infer<typeof ValidateSchemaSchema>;

export const validateSchemaTool = {
  name: 'validate_schema',
  description:
    'Validate extraction paths against a client\'s actual schema before running queries. Checks that all referenced tables and fields exist, types are compatible, and identifies client customizations (Z-tables, custom fields). Run this before any extraction to prevent schema ghost findings.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      client_schema: {
        type: 'object',
        properties: {
          clientId: { type: 'string', description: 'Client identifier' },
          systemType: { type: 'string', description: 'System type (SAP, NetSuite, Salesforce)' },
          tables: {
            type: 'object',
            description: 'Table definitions with fields',
          },
          extractedAt: { type: 'string', description: 'ISO 8601 extraction timestamp' },
        },
        required: ['clientId', 'systemType', 'tables', 'extractedAt'],
        description: 'Client schema with tables, fields, types',
      },
      path_ids: {
        type: 'array',
        items: { type: 'string' },
        description: 'Specific extraction path IDs to validate (default: all registered paths)',
      },
      include_customizations: {
        type: 'boolean',
        description: 'Include customization analysis (default: true)',
      },
    },
    required: ['client_schema'],
  },
};

export async function executeValidateSchema(
  deps: ContradictionToolDeps,
  rawInput: unknown,
): Promise<unknown> {
  const input = ValidateSchemaSchema.parse(rawInput);

  if (!deps.validator) {
    throw new Error('Schema validator not configured');
  }

  // Convert plain object tables to Map-based ClientSchema
  const clientSchema = toClientSchema(input.client_schema);

  let validations: PathValidation[];

  if (input.path_ids && input.path_ids.length > 0) {
    // Validate specific paths
    validations = input.path_ids.map((pathId) =>
      deps.validator!.validatePath(pathId, clientSchema),
    );
  } else {
    // Validate all registered paths
    validations = deps.validator.validateAllPaths(clientSchema);
  }

  // Build summary
  const validCount = validations.filter((v) => v.valid).length;
  const invalidCount = validations.filter((v) => !v.valid).length;
  const totalErrors = validations.reduce((sum, v) => sum + v.errors.length, 0);
  const totalWarnings = validations.reduce((sum, v) => sum + v.warnings.length, 0);

  const result: Record<string, unknown> = {
    validations,
    summary: {
      totalPaths: validations.length,
      validCount,
      invalidCount,
      totalErrors,
      totalWarnings,
    },
  };

  // Include customization analysis if requested
  if (input.include_customizations) {
    result['customizations'] = deps.validator.analyzeCustomizations(clientSchema);
  }

  return result;
}

/** Convert plain-object schema (from JSON input) to Map-based ClientSchema */
function toClientSchema(input: ValidateSchemaInput['client_schema']): ClientSchema {
  const tables = new Map<string, { name: string; fields: Map<string, { name: string; dataType: string; length?: number; decimals?: number; description?: string }>; recordCount?: number }>();

  for (const [tableName, tableData] of Object.entries(input.tables)) {
    const fields = new Map<string, { name: string; dataType: string; length?: number; decimals?: number; description?: string }>();
    for (const [fieldName, fieldData] of Object.entries(tableData.fields)) {
      fields.set(fieldName, { name: fieldData.name, dataType: fieldData.dataType, ...(fieldData.length !== null && fieldData.length !== undefined ? { length: fieldData.length } : {}), ...(fieldData.decimals !== null && fieldData.decimals !== undefined ? { decimals: fieldData.decimals } : {}), ...(fieldData.description !== null && fieldData.description !== undefined ? { description: fieldData.description } : {}) });
    }
    tables.set(tableName, {
      name: tableData.name,
      fields,
      ...(tableData.recordCount !== undefined ? { recordCount: tableData.recordCount } : {}),
    });
  }

  return {
    clientId: input.clientId,
    systemType: input.systemType as ClientSchema['systemType'],
    tables,
    extractedAt: input.extractedAt,
  };
}

// ============================================================================
// Factory: create both tools with injected dependencies
// ============================================================================

export function createContradictionTools(deps: ContradictionToolDeps) {
  return {
    detectContradictions: {
      tool: detectContradictionsTool,
      handler: (rawInput: unknown) => executeDetectContradictions(deps, rawInput),
    },
    validateSchema: {
      tool: validateSchemaTool,
      handler: (rawInput: unknown) => executeValidateSchema(deps, rawInput),
    },
  };
}
