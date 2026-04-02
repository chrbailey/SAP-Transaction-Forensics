/**
 * Tools 24-26: Reality Gap Analysis + Finding Management MCP Tools
 *
 * Three tools that expose three-way gap analysis (reference vs documented vs
 * actual), finding lifecycle management, and cross-source finding summaries.
 */

import { z } from 'zod';
import type {
  WorkflowRule,
  ActualEvent,
  GapFinding,
  GapDetectionConfig,
  GapDetectionResult,
  GapSeverity,
} from '../reality-gap/types.js';

// ============================================================================
// Finding lifecycle types
// ============================================================================

export type FindingState =
  | 'DETECTED'
  | 'TRIAGED'
  | 'INVESTIGATING'
  | 'CONFIRMED'
  | 'REMEDIATION'
  | 'RESOLVED'
  | 'FALSE_POSITIVE'
  | 'ACCEPTED_RISK';

export type FindingSource = 'contradiction' | 'reality_gap' | 'conformance' | 'fi_co_anomaly';

export interface ManagedFinding {
  id: string;
  source: FindingSource;
  state: FindingState;
  severity: GapSeverity;
  title: string;
  description: string;
  riskScore: number; // 0.0–1.0
  assignee?: string | undefined;
  createdAt: string;
  updatedAt: string;
  stateHistory: Array<{ from: FindingState; to: FindingState; at: string; by: string }>;
  relatedFindingIds: string[];
  metadata: Record<string, unknown>;
}

export interface FindingSummary {
  totalFindings: number;
  byState: Record<FindingState, number>;
  bySource: Record<FindingSource, number>;
  bySeverity: Record<GapSeverity, number>;
  averageRiskScore: number;
}

// ============================================================================
// Valid state transitions
// ============================================================================

const VALID_TRANSITIONS: Record<FindingState, FindingState[]> = {
  DETECTED: ['TRIAGED', 'FALSE_POSITIVE'],
  TRIAGED: ['INVESTIGATING', 'FALSE_POSITIVE', 'ACCEPTED_RISK'],
  INVESTIGATING: ['CONFIRMED', 'FALSE_POSITIVE', 'ACCEPTED_RISK'],
  CONFIRMED: ['REMEDIATION', 'ACCEPTED_RISK'],
  REMEDIATION: ['RESOLVED'],
  RESOLVED: [],
  FALSE_POSITIVE: [],
  ACCEPTED_RISK: [],
};

// ============================================================================
// Reality Gap Engine interface (for dependency injection)
// ============================================================================

export interface RealityGapEngine {
  analyze(
    rules: WorkflowRule[],
    events: ActualEvent[],
    config?: Partial<GapDetectionConfig>,
    referenceModelId?: string
  ): GapDetectionResult;
}

// ============================================================================
// Finding Store interface (for dependency injection)
// ============================================================================

export interface FindingStore {
  create(finding: ManagedFinding): ManagedFinding;
  get(id: string): ManagedFinding | undefined;
  query(
    filter: Partial<{
      state: FindingState;
      source: FindingSource;
      severity: GapSeverity;
      assignee: string;
    }>
  ): ManagedFinding[];
  update(id: string, updates: Partial<ManagedFinding>): ManagedFinding | undefined;
  all(): ManagedFinding[];
}

// ============================================================================
// Dependency injection interface
// ============================================================================

export interface RealityGapToolDeps {
  engine?: RealityGapEngine;
  findingStore?: FindingStore;
}

// ============================================================================
// Tool 24: analyze_reality_gaps
// ============================================================================

const WorkflowRuleSchema = z.object({
  id: z.string(),
  sourceDocument: z.string(),
  section: z.string(),
  ruleText: z.string(),
  systemScope: z.union([z.enum(['SAP', 'NetSuite', 'Salesforce']), z.literal('cross-system')]),
  ruleType: z.enum([
    'approval_threshold',
    'sod_constraint',
    'sequence_requirement',
    'timing_sla',
    'field_validation',
    'routing_rule',
  ]),
  parameters: z.record(z.union([z.string(), z.number()])),
  extractionPathId: z.string().optional(),
  active: z.boolean(),
});

const ActualEventSchema = z.object({
  caseId: z.string(),
  activityName: z.string(),
  timestamp: z.string(),
  userId: z.string(),
  systemType: z.enum(['SAP', 'NetSuite', 'Salesforce']),
  tableName: z.string(),
  recordId: z.string(),
  extractionId: z.string().optional(),
});

export const AnalyzeRealityGapsSchema = z.object({
  reference_model_id: z.string().optional(),
  rules: z.array(WorkflowRuleSchema).min(1, 'At least one rule is required'),
  events: z.array(ActualEventSchema).min(1, 'At least one event is required'),
  config: z
    .object({
      minFrequency: z.number().optional(),
      minMateriality: z.number().optional(),
      lookbackDays: z.number().optional(),
      includeDesignGaps: z.boolean().optional(),
      includeComplianceGaps: z.boolean().optional(),
      includeShadowGaps: z.boolean().optional(),
    })
    .optional(),
});

export type AnalyzeRealityGapsInput = z.infer<typeof AnalyzeRealityGapsSchema>;

export const analyzeRealityGapsTool = {
  name: 'analyze_reality_gaps',
  description:
    'Run three-way gap analysis comparing reference process models, documented business rules, and actual event logs. Detects design gaps (reference vs documented), compliance gaps (documented vs actual), and shadow processes (undocumented activities).',
  inputSchema: {
    type: 'object' as const,
    properties: {
      reference_model_id: {
        type: 'string',
        description:
          'Reference process model ID (e.g., "o2c-detailed"). If omitted, uses default model.',
      },
      rules: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            sourceDocument: { type: 'string' },
            section: { type: 'string' },
            ruleText: { type: 'string' },
            systemScope: {
              type: 'string',
              enum: ['SAP', 'NetSuite', 'Salesforce', 'cross-system'],
            },
            ruleType: {
              type: 'string',
              enum: [
                'approval_threshold',
                'sod_constraint',
                'sequence_requirement',
                'timing_sla',
                'field_validation',
                'routing_rule',
              ],
            },
            parameters: { type: 'object', description: 'Key-value pairs for rule parameters' },
            extractionPathId: { type: 'string' },
            active: { type: 'boolean' },
          },
          required: [
            'id',
            'sourceDocument',
            'section',
            'ruleText',
            'systemScope',
            'ruleType',
            'parameters',
            'active',
          ],
        },
        description: 'Array of documented business rules from SOPs',
      },
      events: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            caseId: { type: 'string' },
            activityName: { type: 'string' },
            timestamp: { type: 'string' },
            userId: { type: 'string' },
            systemType: { type: 'string', enum: ['SAP', 'NetSuite', 'Salesforce'] },
            tableName: { type: 'string' },
            recordId: { type: 'string' },
            extractionId: { type: 'string' },
          },
          required: [
            'caseId',
            'activityName',
            'timestamp',
            'userId',
            'systemType',
            'tableName',
            'recordId',
          ],
        },
        description: 'Array of actual events from the event log',
      },
      config: {
        type: 'object',
        properties: {
          minFrequency: {
            type: 'number',
            description: 'Minimum occurrences to report (default: 1)',
          },
          minMateriality: {
            type: 'number',
            description: 'Minimum materiality score (default: 0.0)',
          },
          lookbackDays: { type: 'number', description: 'How far back to analyze (default: 365)' },
          includeDesignGaps: {
            type: 'boolean',
            description: 'Include design gaps (default: true)',
          },
          includeComplianceGaps: {
            type: 'boolean',
            description: 'Include compliance gaps (default: true)',
          },
          includeShadowGaps: {
            type: 'boolean',
            description: 'Include shadow process gaps (default: true)',
          },
        },
        description: 'Override gap detection configuration',
      },
    },
    required: ['rules', 'events'],
  },
};

export async function executeAnalyzeRealityGaps(
  deps: RealityGapToolDeps,
  rawInput: unknown
): Promise<unknown> {
  const input = AnalyzeRealityGapsSchema.parse(rawInput);

  if (!deps.engine) {
    throw new Error('Reality gap engine not configured');
  }

  const rules = input.rules as unknown as WorkflowRule[];
  const events = input.events as unknown as ActualEvent[];
  const config = input.config as Partial<GapDetectionConfig> | undefined;

  const result = deps.engine.analyze(rules, events, config, input.reference_model_id);

  const allGaps = [...result.designGaps, ...result.complianceGaps, ...result.shadowGaps];

  return {
    designGaps: result.designGaps,
    complianceGaps: result.complianceGaps,
    shadowGaps: result.shadowGaps,
    totalCasesAnalyzed: result.totalCasesAnalyzed,
    totalEventsAnalyzed: result.totalEventsAnalyzed,
    duration: result.duration,
    summary: {
      totalGaps: allGaps.length,
      designCount: result.designGaps.length,
      complianceCount: result.complianceGaps.length,
      shadowCount: result.shadowGaps.length,
      highestSeverity: getHighestSeverity(allGaps),
    },
  };
}

function getHighestSeverity(gaps: GapFinding[]): GapSeverity | null {
  const order: GapSeverity[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'];
  for (const sev of order) {
    if (gaps.some(g => g.severity === sev)) return sev;
  }
  return null;
}

// ============================================================================
// Tool 25: manage_finding
// ============================================================================

export const ManageFindingSchema = z.object({
  action: z.enum(['create', 'transition', 'query', 'get']),
  finding_id: z.string().optional(),
  params: z
    .object({
      // create params
      source: z.enum(['contradiction', 'reality_gap', 'conformance', 'fi_co_anomaly']).optional(),
      severity: z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO']).optional(),
      title: z.string().optional(),
      description: z.string().optional(),
      riskScore: z.number().optional(),
      assignee: z.string().optional(),
      relatedFindingIds: z.array(z.string()).optional(),
      metadata: z.record(z.unknown()).optional(),
      // transition params
      to_state: z
        .enum([
          'DETECTED',
          'TRIAGED',
          'INVESTIGATING',
          'CONFIRMED',
          'REMEDIATION',
          'RESOLVED',
          'FALSE_POSITIVE',
          'ACCEPTED_RISK',
        ])
        .optional(),
      transitioned_by: z.string().optional(),
      // query params
      state: z
        .enum([
          'DETECTED',
          'TRIAGED',
          'INVESTIGATING',
          'CONFIRMED',
          'REMEDIATION',
          'RESOLVED',
          'FALSE_POSITIVE',
          'ACCEPTED_RISK',
        ])
        .optional(),
    })
    .optional(),
});

export type ManageFindingInput = z.infer<typeof ManageFindingSchema>;

export const manageFindingTool = {
  name: 'manage_finding',
  description:
    'Manage finding lifecycle \u2014 create, transition state, assign, or query findings. Findings are tracked from DETECTED through TRIAGED, INVESTIGATING, CONFIRMED, REMEDIATION to RESOLVED (or FALSE_POSITIVE/ACCEPTED_RISK).',
  inputSchema: {
    type: 'object' as const,
    properties: {
      action: {
        type: 'string',
        enum: ['create', 'transition', 'query', 'get'],
        description: 'Action to perform',
      },
      finding_id: {
        type: 'string',
        description: 'Finding ID (required for transition and get)',
      },
      params: {
        type: 'object',
        properties: {
          source: {
            type: 'string',
            enum: ['contradiction', 'reality_gap', 'conformance', 'fi_co_anomaly'],
            description: 'Finding source (for create)',
          },
          severity: {
            type: 'string',
            enum: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'],
            description: 'Finding severity (for create)',
          },
          title: { type: 'string', description: 'Finding title (for create)' },
          description: { type: 'string', description: 'Finding description (for create)' },
          riskScore: { type: 'number', description: 'Risk score 0.0-1.0 (for create)' },
          assignee: { type: 'string', description: 'Assignee (for create or query)' },
          relatedFindingIds: {
            type: 'array',
            items: { type: 'string' },
            description: 'Related findings (for create)',
          },
          metadata: { type: 'object', description: 'Additional metadata (for create)' },
          to_state: {
            type: 'string',
            enum: [
              'DETECTED',
              'TRIAGED',
              'INVESTIGATING',
              'CONFIRMED',
              'REMEDIATION',
              'RESOLVED',
              'FALSE_POSITIVE',
              'ACCEPTED_RISK',
            ],
            description: 'Target state (for transition)',
          },
          transitioned_by: {
            type: 'string',
            description: 'Who performed the transition (for transition)',
          },
          state: {
            type: 'string',
            enum: [
              'DETECTED',
              'TRIAGED',
              'INVESTIGATING',
              'CONFIRMED',
              'REMEDIATION',
              'RESOLVED',
              'FALSE_POSITIVE',
              'ACCEPTED_RISK',
            ],
            description: 'Filter by state (for query)',
          },
        },
        description: 'Action-specific parameters',
      },
    },
    required: ['action'],
  },
};

export async function executeManageFinding(
  deps: RealityGapToolDeps,
  rawInput: unknown
): Promise<unknown> {
  const input = ManageFindingSchema.parse(rawInput);

  if (!deps.findingStore) {
    throw new Error('Finding store not configured');
  }

  switch (input.action) {
    case 'create': {
      const params = input.params ?? {};
      const now = new Date().toISOString();
      const id = input.finding_id ?? `MF-${Date.now()}`;

      const finding: ManagedFinding = {
        id,
        source: (params.source ?? 'reality_gap') as FindingSource,
        state: 'DETECTED',
        severity: (params.severity ?? 'MEDIUM') as GapSeverity,
        title: params.title ?? 'Untitled finding',
        description: params.description ?? '',
        riskScore: params.riskScore ?? 0.5,
        assignee: params.assignee,
        createdAt: now,
        updatedAt: now,
        stateHistory: [],
        relatedFindingIds: params.relatedFindingIds ?? [],
        metadata: (params.metadata ?? {}) as Record<string, unknown>,
      };

      return deps.findingStore.create(finding);
    }

    case 'transition': {
      if (!input.finding_id) {
        return { error: 'finding_id is required for transition action' };
      }
      const params = input.params ?? {};
      const toState = params.to_state as FindingState | undefined;
      if (!toState) {
        return { error: 'params.to_state is required for transition action' };
      }

      const existing = deps.findingStore.get(input.finding_id);
      if (!existing) {
        return { error: `Finding not found: ${input.finding_id}` };
      }

      const allowed = VALID_TRANSITIONS[existing.state];
      if (!allowed || !allowed.includes(toState)) {
        return {
          error: `Invalid transition from ${existing.state} to ${toState}`,
          allowed_transitions: allowed ?? [],
        };
      }

      const now = new Date().toISOString();
      const historyEntry = {
        from: existing.state,
        to: toState,
        at: now,
        by: (params.transitioned_by as string | undefined) ?? 'system',
      };

      const updated = deps.findingStore.update(input.finding_id, {
        state: toState,
        updatedAt: now,
        stateHistory: [...existing.stateHistory, historyEntry],
      });

      return updated;
    }

    case 'query': {
      const params = input.params ?? {};
      const filter: Partial<{
        state: FindingState;
        source: FindingSource;
        severity: GapSeverity;
        assignee: string;
      }> = {};
      if (params.state) filter.state = params.state as FindingState;
      if (params.source) filter.source = params.source as FindingSource;
      if (params.severity) filter.severity = params.severity as GapSeverity;
      if (params.assignee) filter.assignee = params.assignee;

      return deps.findingStore.query(filter);
    }

    case 'get': {
      if (!input.finding_id) {
        return { error: 'finding_id is required for get action' };
      }
      const finding = deps.findingStore.get(input.finding_id);
      if (!finding) {
        return { error: `Finding not found: ${input.finding_id}` };
      }
      return finding;
    }

    default:
      return { error: `Unknown action: ${String(input.action)}` };
  }
}

// ============================================================================
// Tool 26: get_finding_summary
// ============================================================================

export const GetFindingSummarySchema = z.object({}).optional();

export const getFindingSummaryTool = {
  name: 'get_finding_summary',
  description:
    'Get a summary of all findings across all detection sources \u2014 contradictions, reality gaps, conformance issues, and FI/CO anomalies. Shows counts by state, source, severity, and average risk scores.',
  inputSchema: {
    type: 'object' as const,
    properties: {},
    required: [],
  },
};

export async function executeGetFindingSummary(
  deps: RealityGapToolDeps,
  _rawInput: unknown
): Promise<unknown> {
  if (!deps.findingStore) {
    throw new Error('Finding store not configured');
  }

  const all = deps.findingStore.all();

  const byState: Record<FindingState, number> = {
    DETECTED: 0,
    TRIAGED: 0,
    INVESTIGATING: 0,
    CONFIRMED: 0,
    REMEDIATION: 0,
    RESOLVED: 0,
    FALSE_POSITIVE: 0,
    ACCEPTED_RISK: 0,
  };

  const bySource: Record<FindingSource, number> = {
    contradiction: 0,
    reality_gap: 0,
    conformance: 0,
    fi_co_anomaly: 0,
  };

  const bySeverity: Record<GapSeverity, number> = {
    CRITICAL: 0,
    HIGH: 0,
    MEDIUM: 0,
    LOW: 0,
    INFO: 0,
  };

  let totalRisk = 0;

  for (const f of all) {
    byState[f.state]++;
    bySource[f.source]++;
    bySeverity[f.severity]++;
    totalRisk += f.riskScore;
  }

  const summary: FindingSummary = {
    totalFindings: all.length,
    byState,
    bySource,
    bySeverity,
    averageRiskScore: all.length > 0 ? totalRisk / all.length : 0,
  };

  return summary;
}

// ============================================================================
// Factory: create all three tools with injected dependencies
// ============================================================================

export function createRealityGapTools(deps: RealityGapToolDeps) {
  return {
    analyzeRealityGaps: {
      tool: analyzeRealityGapsTool,
      handler: (rawInput: unknown) => executeAnalyzeRealityGaps(deps, rawInput),
    },
    manageFinding: {
      tool: manageFindingTool,
      handler: (rawInput: unknown) => executeManageFinding(deps, rawInput),
    },
    getFindingSummary: {
      tool: getFindingSummaryTool,
      handler: (rawInput: unknown) => executeGetFindingSummary(deps, rawInput),
    },
  };
}
