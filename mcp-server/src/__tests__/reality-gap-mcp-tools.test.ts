/**
 * Tests for reality gap analysis + finding management MCP tools
 *
 * Validates tool schemas, handler routing, dependency injection,
 * finding lifecycle transitions, and cross-source summaries.
 */

import { describe, it, expect, jest } from '@jest/globals';
import {
  AnalyzeRealityGapsSchema,
  ManageFindingSchema,
  analyzeRealityGapsTool,
  manageFindingTool,
  getFindingSummaryTool,
  executeAnalyzeRealityGaps,
  executeManageFinding,
  executeGetFindingSummary,
  createRealityGapTools,
} from '../tools/reality-gap-tools.js';
import type {
  RealityGapToolDeps,
  RealityGapEngine,
  FindingStore,
  ManagedFinding,
  FindingState,
  FindingSource,
} from '../tools/reality-gap-tools.js';
import type {
  GapFinding,
  GapDetectionResult,
  GapSeverity,
} from '../reality-gap/types.js';

// ============================================================================
// Mock factories
// ============================================================================

function makeGapFinding(overrides: Partial<GapFinding> = {}): GapFinding {
  return {
    id: 'gap-001',
    gapType: 'compliance',
    severity: 'HIGH',
    confidence: 0.9,
    title: 'Approval bypass',
    description: 'Invoices posted without required approval',
    expectedSource: 'documented',
    expectedRule: 'rule-ap-001',
    expectedBehavior: 'VP approval required for invoices > $50K',
    actualBehavior: 'Posted with manager-level approval only',
    actualEvents: ['SO-100', 'SO-101'],
    frequency: 12,
    materiality: 0.85,
    recency: 0.7,
    detectedAt: '2026-03-31T10:00:00.000Z',
    systemScope: 'SAP',
    ...overrides,
  };
}

function mockEngine(): RealityGapEngine {
  const designGaps = [makeGapFinding({ id: 'DG-001', gapType: 'design', severity: 'MEDIUM' })];
  const complianceGaps = [makeGapFinding({ id: 'CG-001', gapType: 'compliance', severity: 'HIGH' })];
  const shadowGaps = [makeGapFinding({ id: 'SG-001', gapType: 'shadow', severity: 'CRITICAL' })];

  return {
    analyze: jest.fn<RealityGapEngine['analyze']>().mockReturnValue({
      designGaps,
      complianceGaps,
      shadowGaps,
      totalCasesAnalyzed: 100,
      totalEventsAnalyzed: 5000,
      duration: 250,
    }),
  };
}

function makeManagedFinding(overrides: Partial<ManagedFinding> = {}): ManagedFinding {
  return {
    id: 'MF-001',
    source: 'reality_gap',
    state: 'DETECTED',
    severity: 'HIGH',
    title: 'Compliance gap detected',
    description: 'Approval bypass on high-value invoices',
    riskScore: 0.85,
    createdAt: '2026-03-31T10:00:00.000Z',
    updatedAt: '2026-03-31T10:00:00.000Z',
    stateHistory: [],
    relatedFindingIds: [],
    metadata: {},
    ...overrides,
  };
}

function mockFindingStore(): FindingStore {
  const findings = new Map<string, ManagedFinding>();

  // Pre-populate with test data
  const f1 = makeManagedFinding({ id: 'MF-001', source: 'reality_gap', state: 'DETECTED', severity: 'HIGH', riskScore: 0.85 });
  const f2 = makeManagedFinding({ id: 'MF-002', source: 'contradiction', state: 'TRIAGED', severity: 'CRITICAL', riskScore: 0.95 });
  const f3 = makeManagedFinding({ id: 'MF-003', source: 'conformance', state: 'INVESTIGATING', severity: 'MEDIUM', riskScore: 0.6 });
  const f4 = makeManagedFinding({ id: 'MF-004', source: 'fi_co_anomaly', state: 'DETECTED', severity: 'LOW', riskScore: 0.3 });
  findings.set('MF-001', f1);
  findings.set('MF-002', f2);
  findings.set('MF-003', f3);
  findings.set('MF-004', f4);

  return {
    create: jest.fn<FindingStore['create']>().mockImplementation((finding: ManagedFinding) => {
      findings.set(finding.id, finding);
      return finding;
    }),
    get: jest.fn<FindingStore['get']>().mockImplementation((id: string) => {
      return findings.get(id);
    }),
    query: jest.fn<FindingStore['query']>().mockImplementation((filter) => {
      let result = Array.from(findings.values());
      if (filter.state) result = result.filter(f => f.state === filter.state);
      if (filter.source) result = result.filter(f => f.source === filter.source);
      if (filter.severity) result = result.filter(f => f.severity === filter.severity);
      if (filter.assignee) result = result.filter(f => f.assignee === filter.assignee);
      return result;
    }),
    update: jest.fn<FindingStore['update']>().mockImplementation((id: string, updates: Partial<ManagedFinding>) => {
      const existing = findings.get(id);
      if (!existing) return undefined;
      const updated = { ...existing, ...updates };
      findings.set(id, updated);
      return updated;
    }),
    all: jest.fn<FindingStore['all']>().mockImplementation(() => {
      return Array.from(findings.values());
    }),
  };
}

// ============================================================================
// Shared test data
// ============================================================================

const sampleRules = [
  {
    id: 'rule-ap-001',
    sourceDocument: 'SOP-AP-001 v3.2',
    section: 'Section 4.2',
    ruleText: 'VP approval for invoices > $50K',
    systemScope: 'SAP' as const,
    ruleType: 'approval_threshold' as const,
    parameters: { threshold: 50000, currency: 'USD' },
    active: true,
  },
];

const sampleEvents = [
  {
    caseId: 'SO-100',
    activityName: 'Post Invoice',
    timestamp: '2026-03-30T14:00:00.000Z',
    userId: 'JSMITH',
    systemType: 'SAP' as const,
    tableName: 'BKPF',
    recordId: '1000000001',
  },
  {
    caseId: 'SO-100',
    activityName: 'Clear Invoice',
    timestamp: '2026-03-30T15:00:00.000Z',
    userId: 'JSMITH',
    systemType: 'SAP' as const,
    tableName: 'BSEG',
    recordId: '1000000002',
  },
];

// ============================================================================
// Tests: analyze_reality_gaps
// ============================================================================

describe('analyze_reality_gaps', () => {
  it('calls engine.analyze with rules and events', async () => {
    const engine = mockEngine();
    const deps: RealityGapToolDeps = { engine };

    const result = await executeAnalyzeRealityGaps(deps, {
      rules: sampleRules,
      events: sampleEvents,
    });

    expect(engine.analyze).toHaveBeenCalledTimes(1);
    const callArgs = (engine.analyze as jest.Mock).mock.calls[0]!;
    expect(callArgs[0]).toHaveLength(1);  // rules
    expect(callArgs[1]).toHaveLength(2);  // events

    const typed = result as GapDetectionResult & { summary: Record<string, unknown> };
    expect(typed.totalCasesAnalyzed).toBe(100);
    expect(typed.totalEventsAnalyzed).toBe(5000);
    expect(typed.designGaps).toHaveLength(1);
    expect(typed.complianceGaps).toHaveLength(1);
    expect(typed.shadowGaps).toHaveLength(1);
    expect(typed.summary.totalGaps).toBe(3);
    expect(typed.summary.highestSeverity).toBe('CRITICAL');
  });

  it('throws when engine is not configured', async () => {
    const deps: RealityGapToolDeps = {};

    await expect(
      executeAnalyzeRealityGaps(deps, {
        rules: sampleRules,
        events: sampleEvents,
      }),
    ).rejects.toThrow('Reality gap engine not configured');
  });
});

// ============================================================================
// Tests: manage_finding
// ============================================================================

describe('manage_finding', () => {
  it('create action creates a finding', async () => {
    const store = mockFindingStore();
    const deps: RealityGapToolDeps = { findingStore: store };

    const result = await executeManageFinding(deps, {
      action: 'create',
      params: {
        source: 'contradiction',
        severity: 'CRITICAL',
        title: 'Amount mismatch',
        description: 'SAP vs Salesforce divergence',
        riskScore: 0.95,
      },
    });

    expect(store.create).toHaveBeenCalledTimes(1);
    const typed = result as ManagedFinding;
    expect(typed.source).toBe('contradiction');
    expect(typed.severity).toBe('CRITICAL');
    expect(typed.state).toBe('DETECTED');
    expect(typed.title).toBe('Amount mismatch');
    expect(typed.riskScore).toBe(0.95);
  });

  it('transition action transitions state', async () => {
    const store = mockFindingStore();
    const deps: RealityGapToolDeps = { findingStore: store };

    const result = await executeManageFinding(deps, {
      action: 'transition',
      finding_id: 'MF-001',
      params: {
        to_state: 'TRIAGED',
        transitioned_by: 'analyst@acme.com',
      },
    });

    expect(store.get).toHaveBeenCalledWith('MF-001');
    expect(store.update).toHaveBeenCalledTimes(1);
    const typed = result as ManagedFinding;
    expect(typed.state).toBe('TRIAGED');
    expect(typed.stateHistory).toHaveLength(1);
    expect(typed.stateHistory[0]!.from).toBe('DETECTED');
    expect(typed.stateHistory[0]!.to).toBe('TRIAGED');
    expect(typed.stateHistory[0]!.by).toBe('analyst@acme.com');
  });

  it('query action returns filtered findings', async () => {
    const store = mockFindingStore();
    const deps: RealityGapToolDeps = { findingStore: store };

    const result = await executeManageFinding(deps, {
      action: 'query',
      params: { state: 'DETECTED' },
    });

    expect(store.query).toHaveBeenCalledTimes(1);
    const typed = result as ManagedFinding[];
    expect(typed).toHaveLength(2);
    expect(typed.every(f => f.state === 'DETECTED')).toBe(true);
  });

  it('get action returns single finding', async () => {
    const store = mockFindingStore();
    const deps: RealityGapToolDeps = { findingStore: store };

    const result = await executeManageFinding(deps, {
      action: 'get',
      finding_id: 'MF-002',
    });

    expect(store.get).toHaveBeenCalledWith('MF-002');
    const typed = result as ManagedFinding;
    expect(typed.id).toBe('MF-002');
    expect(typed.source).toBe('contradiction');
  });

  it('invalid transition returns error', async () => {
    const store = mockFindingStore();
    const deps: RealityGapToolDeps = { findingStore: store };

    // MF-001 is DETECTED, cannot jump to RESOLVED
    const result = await executeManageFinding(deps, {
      action: 'transition',
      finding_id: 'MF-001',
      params: { to_state: 'RESOLVED' },
    });

    const typed = result as { error: string; allowed_transitions: string[] };
    expect(typed.error).toContain('Invalid transition');
    expect(typed.error).toContain('DETECTED');
    expect(typed.error).toContain('RESOLVED');
    expect(typed.allowed_transitions).toEqual(['TRIAGED', 'FALSE_POSITIVE']);
  });

  it('missing finding_id for transition returns error', async () => {
    const store = mockFindingStore();
    const deps: RealityGapToolDeps = { findingStore: store };

    const result = await executeManageFinding(deps, {
      action: 'transition',
      params: { to_state: 'TRIAGED' },
    });

    const typed = result as { error: string };
    expect(typed.error).toBe('finding_id is required for transition action');
  });

  it('throws when finding store is not configured', async () => {
    const deps: RealityGapToolDeps = {};

    await expect(
      executeManageFinding(deps, { action: 'get', finding_id: 'MF-001' }),
    ).rejects.toThrow('Finding store not configured');
  });
});

// ============================================================================
// Tests: get_finding_summary
// ============================================================================

describe('get_finding_summary', () => {
  it('returns counts by state, source, severity, and average risk', async () => {
    const store = mockFindingStore();
    const deps: RealityGapToolDeps = { findingStore: store };

    const result = await executeGetFindingSummary(deps, {});

    expect(store.all).toHaveBeenCalledTimes(1);

    const typed = result as {
      totalFindings: number;
      byState: Record<FindingState, number>;
      bySource: Record<FindingSource, number>;
      bySeverity: Record<GapSeverity, number>;
      averageRiskScore: number;
    };

    expect(typed.totalFindings).toBe(4);

    // By state
    expect(typed.byState.DETECTED).toBe(2);
    expect(typed.byState.TRIAGED).toBe(1);
    expect(typed.byState.INVESTIGATING).toBe(1);

    // By source
    expect(typed.bySource.reality_gap).toBe(1);
    expect(typed.bySource.contradiction).toBe(1);
    expect(typed.bySource.conformance).toBe(1);
    expect(typed.bySource.fi_co_anomaly).toBe(1);

    // By severity
    expect(typed.bySeverity.CRITICAL).toBe(1);
    expect(typed.bySeverity.HIGH).toBe(1);
    expect(typed.bySeverity.MEDIUM).toBe(1);
    expect(typed.bySeverity.LOW).toBe(1);

    // Average risk: (0.85 + 0.95 + 0.6 + 0.3) / 4 = 0.675
    expect(typed.averageRiskScore).toBeCloseTo(0.675, 2);
  });

  it('throws when finding store is not configured', async () => {
    const deps: RealityGapToolDeps = {};

    await expect(
      executeGetFindingSummary(deps, {}),
    ).rejects.toThrow('Finding store not configured');
  });
});

// ============================================================================
// Tests: Tool schemas have correct required/optional fields
// ============================================================================

describe('tool schemas', () => {
  it('analyze_reality_gaps: rules and events are required, reference_model_id and config are optional', () => {
    expect(analyzeRealityGapsTool.inputSchema.required).toContain('rules');
    expect(analyzeRealityGapsTool.inputSchema.required).toContain('events');
    expect(analyzeRealityGapsTool.inputSchema.required).not.toContain('reference_model_id');
    expect(analyzeRealityGapsTool.inputSchema.required).not.toContain('config');

    // Validates with only required fields
    const result = AnalyzeRealityGapsSchema.parse({
      rules: sampleRules,
      events: sampleEvents,
    });
    expect(result.reference_model_id).toBeUndefined();
    expect(result.config).toBeUndefined();

    // Rejects empty rules
    expect(() => AnalyzeRealityGapsSchema.parse({ rules: [], events: sampleEvents })).toThrow();

    // Rejects empty events
    expect(() => AnalyzeRealityGapsSchema.parse({ rules: sampleRules, events: [] })).toThrow();

    // Rejects missing rules
    expect(() => AnalyzeRealityGapsSchema.parse({ events: sampleEvents })).toThrow();

    // Rejects missing events
    expect(() => AnalyzeRealityGapsSchema.parse({ rules: sampleRules })).toThrow();
  });

  it('manage_finding: action is required, finding_id and params are optional', () => {
    expect(manageFindingTool.inputSchema.required).toContain('action');
    expect(manageFindingTool.inputSchema.required).not.toContain('finding_id');
    expect(manageFindingTool.inputSchema.required).not.toContain('params');

    // Validates with only required field
    const result = ManageFindingSchema.parse({ action: 'query' });
    expect(result.finding_id).toBeUndefined();
    expect(result.params).toBeUndefined();

    // Rejects missing action
    expect(() => ManageFindingSchema.parse({})).toThrow();

    // Rejects invalid action
    expect(() => ManageFindingSchema.parse({ action: 'delete' })).toThrow();
  });

  it('get_finding_summary: no required fields', () => {
    expect(getFindingSummaryTool.inputSchema.required).toEqual([]);
  });
});

// ============================================================================
// Tests: createRealityGapTools factory
// ============================================================================

describe('createRealityGapTools', () => {
  it('returns three tools with tool definitions and handlers', () => {
    const tools = createRealityGapTools({});

    expect(tools.analyzeRealityGaps.tool.name).toBe('analyze_reality_gaps');
    expect(tools.manageFinding.tool.name).toBe('manage_finding');
    expect(tools.getFindingSummary.tool.name).toBe('get_finding_summary');

    expect(typeof tools.analyzeRealityGaps.handler).toBe('function');
    expect(typeof tools.manageFinding.handler).toBe('function');
    expect(typeof tools.getFindingSummary.handler).toBe('function');
  });
});
