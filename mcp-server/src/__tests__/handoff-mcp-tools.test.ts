/**
 * Tests for handoff packet MCP tool
 *
 * Validates tool schema, handler routing, dependency injection,
 * and default values using a mock HandoffPacketGenerator.
 */

import { describe, it, expect, jest } from '@jest/globals';
import {
  GenerateHandoffPacketSchema,
  generateHandoffPacketTool,
  executeGenerateHandoffPacket,
  createHandoffTools,
} from '../tools/handoff-tools.js';
import type { HandoffToolDeps } from '../tools/handoff-tools.js';
import type { HandoffPacket, HandoffConfig } from '../handoff/types.js';
import type { HandoffPacketGenerator } from '../handoff/index.js';

// ============================================================================
// Mock factory
// ============================================================================

function mockPacket(config: HandoffConfig): HandoffPacket {
  return {
    config,
    summary: '# Executive Summary\n\nTest summary content.',
    findings: [
      {
        id: 'F-001',
        title: 'Amount Divergence',
        severity: 'HIGH',
        riskScore: 78,
        markdown: '## F-001: Amount Divergence\n\nDetails here.',
        evidenceFiles: [
          {
            filename: 'F-001-left.csv',
            content: 'system,table,field\nSAP,VBAK,NETWR',
            mimeType: 'text/csv',
            extractionId: 'E-001',
          },
        ],
      },
    ],
    contradictions: [
      {
        id: 'C-001',
        title: 'Status Mismatch',
        severity: 'MEDIUM',
        riskScore: 55,
        markdown: '## C-001: Status Mismatch\n\nDetails here.',
        evidenceFiles: [],
      },
    ],
    realityGaps: [],
    manifest: {
      engagementId: config.engagementId,
      generatedAt: '2025-06-01T00:00:00.000Z',
      entries: [
        {
          extractionPathId: 'sap.o2c.order-header',
          extractionPathVersion: '1.0.0',
          parameters: { order_number: '0000000100' },
          queryHash: 'abc123',
          replayHash: 'def456',
          extractedAt: '2025-06-01T00:00:00.000Z',
          rowCount: 42,
        },
      ],
      totalExtractions: 1,
      totalRows: 42,
      systems: config.systemsAccessed,
    },
    checklist: {
      engagementId: config.engagementId,
      reviewerName: '',
      generatedAt: '2025-06-01T00:00:00.000Z',
      items: [
        {
          id: 'CHK-001',
          category: 'data_quality',
          text: 'Extraction replay hashes verified',
          required: true,
          checked: false,
          notes: '',
        },
      ],
      completedCount: 0,
      totalCount: 1,
    },
    provenanceGraph: '{"nodes":[],"edges":[]}',
    generatedAt: '2025-06-01T00:00:00.000Z',
  };
}

function mockGenerator(): HandoffPacketGenerator {
  return {
    generate: jest.fn(async (config: HandoffConfig) => mockPacket(config)),
  };
}

// ============================================================================
// Valid input fixture
// ============================================================================

const VALID_INPUT = {
  engagement_id: 'ENG-2025-001',
  client_name: 'Acme Corp',
  scope: 'FY2025 Q1-Q3 O2C Process Audit',
  date_from: '2025-01-01',
  date_to: '2025-09-30',
  prepared_by: 'Jane Analyst',
  systems: ['SAP', 'Salesforce'],
};

// ============================================================================
// Tests: executeGenerateHandoffPacket
// ============================================================================

describe('generate_handoff_packet', () => {
  it('calls generator.generate with mapped config', async () => {
    const gen = mockGenerator();
    const deps: HandoffToolDeps = { generator: gen };

    await executeGenerateHandoffPacket(deps, VALID_INPUT);

    expect(gen.generate).toHaveBeenCalledTimes(1);
    const callArg = (gen.generate as ReturnType<typeof jest.fn>).mock.calls[0]![0] as HandoffConfig;
    expect(callArg.engagementId).toBe('ENG-2025-001');
    expect(callArg.clientName).toBe('Acme Corp');
    expect(callArg.scope).toBe('FY2025 Q1-Q3 O2C Process Audit');
    expect(callArg.dateRange).toEqual({ from: '2025-01-01', to: '2025-09-30' });
    expect(callArg.systemsAccessed).toEqual(['SAP', 'Salesforce']);
    expect(callArg.preparedBy).toBe('Jane Analyst');
    expect(callArg.includeReproduction).toBe(true);
    expect(callArg.includeChecklist).toBe(true);
  });

  it('returns packet summary with counts and sizes', async () => {
    const gen = mockGenerator();
    const deps: HandoffToolDeps = { generator: gen };

    const result = (await executeGenerateHandoffPacket(deps, VALID_INPUT)) as Record<
      string,
      unknown
    >;

    expect(result.engagementId).toBe('ENG-2025-001');
    expect(result.clientName).toBe('Acme Corp');
    expect(result.findingCount).toBe(1);
    expect(result.contradictionCount).toBe(1);
    expect(result.realityGapCount).toBe(0);
    expect(result.checklistItems).toBe(1);
    expect(result.manifestEntries).toBe(1);
    expect(result.fileCount).toBeGreaterThan(0);
    expect(result.totalSize).toBeGreaterThan(0);
    expect(result.generatedAt).toBe('2025-06-01T00:00:00.000Z');
  });

  it('throws when generator is not configured', async () => {
    const deps: HandoffToolDeps = {};

    await expect(executeGenerateHandoffPacket(deps, VALID_INPUT)).rejects.toThrow(
      'Handoff packet generator not configured'
    );
  });

  it('validates required fields — rejects missing engagement_id', () => {
    const { engagement_id: _, ...missing } = VALID_INPUT;
    expect(() => GenerateHandoffPacketSchema.parse(missing)).toThrow();
  });

  it('validates required fields — rejects missing client_name', () => {
    const { client_name: _, ...missing } = VALID_INPUT;
    expect(() => GenerateHandoffPacketSchema.parse(missing)).toThrow();
  });

  it('validates required fields — rejects missing systems', () => {
    const { systems: _, ...missing } = VALID_INPUT;
    expect(() => GenerateHandoffPacketSchema.parse(missing)).toThrow();
  });

  it('validates required fields — rejects empty systems array', () => {
    expect(() => GenerateHandoffPacketSchema.parse({ ...VALID_INPUT, systems: [] })).toThrow();
  });

  it('applies default values for optional boolean fields', () => {
    const parsed = GenerateHandoffPacketSchema.parse(VALID_INPUT);
    expect(parsed.include_reproduction).toBe(true);
    expect(parsed.include_checklist).toBe(true);
  });

  it('allows overriding optional boolean fields', () => {
    const parsed = GenerateHandoffPacketSchema.parse({
      ...VALID_INPUT,
      include_reproduction: false,
      include_checklist: false,
    });
    expect(parsed.include_reproduction).toBe(false);
    expect(parsed.include_checklist).toBe(false);
  });
});

// ============================================================================
// Tests: Tool schema definition
// ============================================================================

describe('generate_handoff_packet tool schema', () => {
  it('has correct name and description', () => {
    expect(generateHandoffPacketTool.name).toBe('generate_handoff_packet');
    expect(generateHandoffPacketTool.description).toContain('handoff packet');
    expect(generateHandoffPacketTool.description).toContain('independently verified');
  });

  it('lists all required fields', () => {
    const required = generateHandoffPacketTool.inputSchema.required;
    expect(required).toContain('engagement_id');
    expect(required).toContain('client_name');
    expect(required).toContain('scope');
    expect(required).toContain('date_from');
    expect(required).toContain('date_to');
    expect(required).toContain('prepared_by');
    expect(required).toContain('systems');
  });

  it('defines all properties', () => {
    const props = generateHandoffPacketTool.inputSchema.properties;
    expect(props.engagement_id).toBeDefined();
    expect(props.client_name).toBeDefined();
    expect(props.scope).toBeDefined();
    expect(props.date_from).toBeDefined();
    expect(props.date_to).toBeDefined();
    expect(props.prepared_by).toBeDefined();
    expect(props.systems).toBeDefined();
    expect(props.include_reproduction).toBeDefined();
    expect(props.include_checklist).toBeDefined();
  });
});

// ============================================================================
// Tests: createHandoffTools factory
// ============================================================================

describe('createHandoffTools', () => {
  it('returns tool with definition and handler', () => {
    const tools = createHandoffTools({});

    expect(tools.generateHandoffPacket.tool.name).toBe('generate_handoff_packet');
    expect(typeof tools.generateHandoffPacket.handler).toBe('function');
  });

  it('handler routes to injected generator', async () => {
    const gen = mockGenerator();
    const tools = createHandoffTools({ generator: gen });

    const result = await tools.generateHandoffPacket.handler(VALID_INPUT);

    expect(gen.generate).toHaveBeenCalledTimes(1);
    expect(result).toHaveProperty('engagementId', 'ENG-2025-001');
  });
});
