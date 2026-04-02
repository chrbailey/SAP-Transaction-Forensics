/**
 * Tests for provenance + extraction registry MCP tools
 *
 * Validates tool schemas, handler routing, and dependency injection
 * using mock implementations of ProvenanceQuery, ProvenanceExporter,
 * and ExtractionRegistry.
 */

import { describe, it, expect, jest } from '@jest/globals';
import {
  QueryProvenanceSchema,
  ListExtractionPathsSchema,
  RunExtractionSchema,
  queryProvenanceTool,
  listExtractionPathsTool,
  runExtractionTool,
  executeQueryProvenance,
  executeListExtractionPaths,
  executeRunExtraction,
  createProvenanceTools,
} from '../tools/provenance-tools.js';
import type { ProvenanceToolDeps } from '../tools/provenance-tools.js';

// ============================================================================
// Mock factories
// ============================================================================

function mockExporter() {
  return {
    exportDAG: jest.fn().mockReturnValue({
      rootFindingId: 'F-001',
      nodes: [{ type: 'finding', id: 'F-001', data: {}, children: [] }],
      generatedAt: '2025-01-01T00:00:00.000Z',
      replayable: true,
    }),
    exportFlat: jest.fn().mockReturnValue([
      {
        findingId: 'F-001',
        role: 'primary',
        extractionId: 'E-001',
        systemType: 'SAP',
        tableName: 'VBAK',
        recordId: '0000000100',
        fieldName: 'AUART',
        rawValue: 'OR',
        extractedAt: '2025-01-01T00:00:00.000Z',
        queryHash: 'abc123',
        replayHash: 'def456',
      },
    ]),
    exportMarkdown: jest
      .fn()
      .mockReturnValue(
        '# Provenance: F-001\n\n| Role | System | Table | Record | Field | Value | Extracted At | Query Hash |\n|------|--------|-------|--------|-------|-------|--------------|------------|\n| primary | SAP | VBAK | 0000000100 | AUART | OR | 2025-01-01T00:00:00.000Z | abc123... |\n'
      ),
  };
}

function mockRegistry() {
  const paths = [
    {
      id: 'sap.o2c.order-header',
      version: '1.0.0',
      name: 'SAP Order Header',
      description: 'Extract order headers from VBAK',
      systemType: 'SAP' as const,
      domain: 'o2c' as const,
      queryType: 'rfc' as const,
      query: 'SELECT * FROM VBAK WHERE VBELN = :order_number',
      parameters: [
        {
          name: 'order_number',
          type: 'string' as const,
          required: true,
          description: 'Order number',
        },
      ],
      expectedFields: [
        { name: 'VBELN', type: 'string' as const, description: 'Sales document number' },
        { name: 'AUART', type: 'string' as const, description: 'Order type' },
      ],
    },
    {
      id: 'sap.fi-co.journal-header',
      version: '1.0.0',
      name: 'SAP Journal Header',
      description: 'Extract journal headers from BKPF',
      systemType: 'SAP' as const,
      domain: 'fi-co' as const,
      queryType: 'rfc' as const,
      query: 'SELECT * FROM BKPF WHERE BUKRS = :company_code',
      parameters: [
        {
          name: 'company_code',
          type: 'string' as const,
          required: true,
          description: 'Company code',
        },
      ],
      expectedFields: [
        { name: 'BUKRS', type: 'string' as const, description: 'Company code' },
        { name: 'BELNR', type: 'string' as const, description: 'Document number' },
      ],
    },
    {
      id: 'sfdc.pipeline.opportunity',
      version: '1.0.0',
      name: 'Salesforce Opportunity',
      description: 'Extract pipeline opportunities',
      systemType: 'Salesforce' as const,
      domain: 'pipeline' as const,
      queryType: 'soql' as const,
      query: 'SELECT Id, Name FROM Opportunity WHERE StageName = :stage',
      parameters: [
        { name: 'stage', type: 'string' as const, required: true, description: 'Pipeline stage' },
      ],
      expectedFields: [
        { name: 'Id', type: 'string' as const, description: 'Record ID' },
        { name: 'Name', type: 'string' as const, description: 'Opportunity name' },
      ],
    },
  ];

  return {
    get: jest.fn((id: string) => paths.find(p => p.id === id)),
    list: jest.fn((filter?: { systemType?: string; domain?: string }) => {
      if (!filter) return paths;
      return paths.filter(p => {
        if (filter.systemType && p.systemType !== filter.systemType) return false;
        if (filter.domain && p.domain !== filter.domain) return false;
        return true;
      });
    }),
    validateParameters: jest.fn((pathId: string, params: Record<string, string>) => {
      const path = paths.find(p => p.id === pathId);
      if (!path) return { valid: false, errors: [`Unknown path ID: '${pathId}'`] };
      const errors: string[] = [];
      for (const paramDef of path.parameters) {
        if (paramDef.required && !(paramDef.name in params)) {
          errors.push(`Missing required parameter: ${paramDef.name}`);
        }
      }
      return { valid: errors.length === 0, errors };
    }),
  };
}

function mockExecutor() {
  return jest.fn().mockResolvedValue({
    pathId: 'sap.o2c.order-header',
    pathVersion: '1.0.0',
    parameters: { order_number: '0000000100' },
    rows: [{ VBELN: '0000000100', AUART: 'OR' }],
    rowCount: 1,
    replayHash: 'abc123def456',
    extractedAt: '2025-01-01T00:00:00.000Z',
  });
}

// ============================================================================
// Tests: queryProvenance
// ============================================================================

describe('query_provenance', () => {
  it('calls exporter.exportFlat by default', async () => {
    const exporter = mockExporter();
    const deps: ProvenanceToolDeps = {
      provenanceExporter: exporter as unknown as ProvenanceToolDeps['provenanceExporter'],
    };

    const result = await executeQueryProvenance(deps, { finding_id: 'F-001' });

    expect(exporter.exportFlat).toHaveBeenCalledWith('F-001');
    expect(Array.isArray(result)).toBe(true);
  });

  it('calls exporter.exportDAG when format=dag', async () => {
    const exporter = mockExporter();
    const deps: ProvenanceToolDeps = {
      provenanceExporter: exporter as unknown as ProvenanceToolDeps['provenanceExporter'],
    };

    const result = await executeQueryProvenance(deps, {
      finding_id: 'F-001',
      format: 'dag',
    });

    expect(exporter.exportDAG).toHaveBeenCalledWith('F-001');
    expect(result).toHaveProperty('rootFindingId', 'F-001');
  });

  it('calls exporter.exportMarkdown when format=markdown', async () => {
    const exporter = mockExporter();
    const deps: ProvenanceToolDeps = {
      provenanceExporter: exporter as unknown as ProvenanceToolDeps['provenanceExporter'],
    };

    const result = await executeQueryProvenance(deps, {
      finding_id: 'F-001',
      format: 'markdown',
    });

    expect(exporter.exportMarkdown).toHaveBeenCalledWith('F-001');
    expect(typeof result).toBe('string');
    expect(result).toContain('Provenance: F-001');
  });

  it('returns error when exporter is not configured', async () => {
    const deps: ProvenanceToolDeps = {};

    await expect(executeQueryProvenance(deps, { finding_id: 'F-001' })).rejects.toThrow(
      'Provenance exporter not configured'
    );
  });
});

// ============================================================================
// Tests: listExtractionPaths
// ============================================================================

describe('list_extraction_paths', () => {
  it('returns all paths unfiltered', async () => {
    const registry = mockRegistry();
    const deps: ProvenanceToolDeps = {
      registry: registry as unknown as ProvenanceToolDeps['registry'],
    };

    const result = await executeListExtractionPaths(deps, {});

    expect(registry.list).toHaveBeenCalledWith(undefined);
    expect(Array.isArray(result)).toBe(true);
    const paths = result as Array<Record<string, unknown>>;
    expect(paths).toHaveLength(3);
    expect(paths[0]).toHaveProperty('id', 'sap.o2c.order-header');
    expect(paths[0]).toHaveProperty('parameterCount', 1);
    expect(paths[0]).toHaveProperty('fieldCount', 2);
  });

  it('filters by system_type', async () => {
    const registry = mockRegistry();
    const deps: ProvenanceToolDeps = {
      registry: registry as unknown as ProvenanceToolDeps['registry'],
    };

    const result = await executeListExtractionPaths(deps, {
      system_type: 'Salesforce',
    });

    expect(registry.list).toHaveBeenCalledWith({ systemType: 'Salesforce' });
    const paths = result as Array<Record<string, unknown>>;
    expect(paths).toHaveLength(1);
    expect(paths[0]).toHaveProperty('id', 'sfdc.pipeline.opportunity');
  });

  it('filters by domain', async () => {
    const registry = mockRegistry();
    const deps: ProvenanceToolDeps = {
      registry: registry as unknown as ProvenanceToolDeps['registry'],
    };

    const result = await executeListExtractionPaths(deps, {
      domain: 'fi-co',
    });

    expect(registry.list).toHaveBeenCalledWith({ domain: 'fi-co' });
    const paths = result as Array<Record<string, unknown>>;
    expect(paths).toHaveLength(1);
    expect(paths[0]).toHaveProperty('id', 'sap.fi-co.journal-header');
  });
});

// ============================================================================
// Tests: runExtraction
// ============================================================================

describe('run_extraction', () => {
  it('validates parameters before execution', async () => {
    const registry = mockRegistry();
    const executor = mockExecutor();
    const deps: ProvenanceToolDeps = {
      registry: registry as unknown as ProvenanceToolDeps['registry'],
      executeExtraction: executor,
    };

    const result = await executeRunExtraction(deps, {
      path_id: 'sap.o2c.order-header',
      parameters: { order_number: '0000000100' },
    });

    expect(registry.validateParameters).toHaveBeenCalledWith('sap.o2c.order-header', {
      order_number: '0000000100',
    });
    expect(executor).toHaveBeenCalledWith('sap.o2c.order-header', { order_number: '0000000100' });
    expect(result).toHaveProperty('pathId', 'sap.o2c.order-header');
    expect(result).toHaveProperty('replayHash');
  });

  it('returns validation errors for bad params', async () => {
    const registry = mockRegistry();
    const executor = mockExecutor();
    const deps: ProvenanceToolDeps = {
      registry: registry as unknown as ProvenanceToolDeps['registry'],
      executeExtraction: executor,
    };

    const result = await executeRunExtraction(deps, {
      path_id: 'sap.o2c.order-header',
      parameters: {},
    });

    expect(result).toHaveProperty('error', 'Parameter validation failed');
    expect(result).toHaveProperty('details');
    const details = (result as { details: string[] }).details;
    expect(details).toContain('Missing required parameter: order_number');
    expect(executor).not.toHaveBeenCalled();
  });

  it('returns error for unknown path_id', async () => {
    const registry = mockRegistry();
    const deps: ProvenanceToolDeps = {
      registry: registry as unknown as ProvenanceToolDeps['registry'],
    };

    const result = await executeRunExtraction(deps, {
      path_id: 'nonexistent.path',
      parameters: {},
    });

    expect(result).toHaveProperty('error', "Unknown extraction path: 'nonexistent.path'");
  });

  it('dry_run returns query without executing', async () => {
    const registry = mockRegistry();
    const executor = mockExecutor();
    const deps: ProvenanceToolDeps = {
      registry: registry as unknown as ProvenanceToolDeps['registry'],
      executeExtraction: executor,
    };

    const result = await executeRunExtraction(deps, {
      path_id: 'sap.o2c.order-header',
      parameters: { order_number: '0000000100' },
      dry_run: true,
    });

    expect(result).toHaveProperty('dry_run', true);
    expect(result).toHaveProperty('path_id', 'sap.o2c.order-header');
    expect(result).toHaveProperty('query');
    expect(result).toHaveProperty('expectedFields');
    expect(executor).not.toHaveBeenCalled();
  });
});

// ============================================================================
// Tests: Tool schemas
// ============================================================================

describe('tool schemas', () => {
  it('query_provenance: finding_id is required, format is optional with default', () => {
    expect(queryProvenanceTool.inputSchema.required).toContain('finding_id');

    // Validates with only required field
    const result = QueryProvenanceSchema.parse({ finding_id: 'F-001' });
    expect(result.format).toBe('flat');

    // Rejects empty finding_id
    expect(() => QueryProvenanceSchema.parse({ finding_id: '' })).toThrow();

    // Rejects missing finding_id
    expect(() => QueryProvenanceSchema.parse({})).toThrow();
  });

  it('list_extraction_paths: all fields are optional', () => {
    expect(listExtractionPathsTool.inputSchema.required).toEqual([]);

    // Validates with no input
    const result = ListExtractionPathsSchema.parse({});
    expect(result.system_type).toBeUndefined();
    expect(result.domain).toBeUndefined();

    // Rejects invalid enum values
    expect(() => ListExtractionPathsSchema.parse({ system_type: 'Oracle' })).toThrow();
    expect(() => ListExtractionPathsSchema.parse({ domain: 'hr' })).toThrow();
  });

  it('run_extraction: path_id and parameters are required, dry_run is optional', () => {
    expect(runExtractionTool.inputSchema.required).toContain('path_id');
    expect(runExtractionTool.inputSchema.required).toContain('parameters');

    // Validates with required fields
    const result = RunExtractionSchema.parse({
      path_id: 'sap.o2c.order-header',
      parameters: { order_number: '100' },
    });
    expect(result.dry_run).toBe(false);

    // Rejects missing path_id
    expect(() => RunExtractionSchema.parse({ parameters: {} })).toThrow();

    // Rejects missing parameters
    expect(() => RunExtractionSchema.parse({ path_id: 'test' })).toThrow();
  });
});

// ============================================================================
// Tests: createProvenanceTools factory
// ============================================================================

describe('createProvenanceTools', () => {
  it('returns three tools with tool definitions and handlers', () => {
    const tools = createProvenanceTools({});

    expect(tools.queryProvenance.tool.name).toBe('query_provenance');
    expect(tools.listExtractionPaths.tool.name).toBe('list_extraction_paths');
    expect(tools.runExtraction.tool.name).toBe('run_extraction');

    expect(typeof tools.queryProvenance.handler).toBe('function');
    expect(typeof tools.listExtractionPaths.handler).toBe('function');
    expect(typeof tools.runExtraction.handler).toBe('function');
  });
});
