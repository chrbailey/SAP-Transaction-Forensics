/**
 * Tests for contradiction detection + schema validation MCP tools
 *
 * Validates tool schemas, handler routing, dependency injection,
 * severity filtering, config overrides, and customization analysis.
 */

import { describe, it, expect, jest } from '@jest/globals';
import {
  DetectContradictionsSchema,
  ValidateSchemaSchema,
  detectContradictionsTool,
  validateSchemaTool,
  executeDetectContradictions,
  executeValidateSchema,
  createContradictionTools,
} from '../tools/contradiction-tools.js';
import type { ContradictionToolDeps, SchemaValidator, CustomizationReport } from '../tools/contradiction-tools.js';
import type { ContradictionFinding, ComparisonResult, Severity, ContradictionType } from '../contradiction/types.js';
import type { PathValidation, ClientSchema } from '../schema-validator/types.js';

// ============================================================================
// Mock factories
// ============================================================================

function makeFinding(overrides: Partial<ContradictionFinding> = {}): ContradictionFinding {
  return {
    id: 'CF-001',
    type: 'AMOUNT_DIVERGENCE',
    severity: 'HIGH',
    confidence: 0.95,
    description: 'Amount mismatch between SAP and Salesforce',
    leftSystem: 'SAP',
    leftTable: 'VBAK',
    leftRecordId: '100',
    leftField: 'NETWR',
    leftValue: '50000',
    leftExtractionId: 'E-001',
    rightSystem: 'Salesforce',
    rightTable: 'Opportunity',
    rightRecordId: 'OPP-100',
    rightField: 'Amount',
    rightValue: '47000',
    rightExtractionId: 'E-002',
    scoringDetails: { percentDivergence: 0.064 },
    detectedAt: '2025-01-01T00:00:00.000Z',
    resolutionStatus: 'open',
    reviewerNotes: '',
    ...overrides,
  };
}

function mockEngine() {
  const findings: ContradictionFinding[] = [
    makeFinding({ id: 'CF-001', severity: 'CRITICAL', type: 'APPROVAL_BYPASS' }),
    makeFinding({ id: 'CF-002', severity: 'HIGH', type: 'AMOUNT_DIVERGENCE' }),
    makeFinding({ id: 'CF-003', severity: 'MEDIUM', type: 'STATUS_INCOMPATIBLE' }),
    makeFinding({ id: 'CF-004', severity: 'LOW', type: 'DATE_CONFLICT' }),
    makeFinding({ id: 'CF-005', severity: 'INFO', type: 'ENTITY_MISMATCH' }),
  ];

  return {
    analyzeAll: jest.fn<(pairs: unknown[]) => ComparisonResult>().mockReturnValue({
      contradictions: findings,
      recordsCompared: 2,
      comparisonsRun: 10,
      duration: 42,
    }),
    analyzeWithTypes: jest.fn<(pairs: unknown[], types: ContradictionType[]) => ComparisonResult>().mockReturnValue({
      contradictions: [findings[1]!],
      recordsCompared: 2,
      comparisonsRun: 2,
      duration: 12,
    }),
    updateConfig: jest.fn(),
    getRegisteredTypes: jest.fn<() => ContradictionType[]>().mockReturnValue([
      'AMOUNT_DIVERGENCE', 'DATE_CONFLICT', 'STATUS_INCOMPATIBLE',
    ]),
  };
}

function mockValidator(): SchemaValidator {
  const validPath: PathValidation = {
    pathId: 'sap.o2c.order-header',
    pathVersion: '1.0.0',
    systemType: 'SAP',
    valid: true,
    errors: [],
    warnings: ['Field AUART type mismatch: expected CHAR(4), got CHAR(2)'],
    tableValidations: [],
    validatedAt: '2025-01-01T00:00:00.000Z',
  };

  const invalidPath: PathValidation = {
    pathId: 'sap.fi-co.journal-header',
    pathVersion: '1.0.0',
    systemType: 'SAP',
    valid: false,
    errors: ['Table BKPF does not exist in client schema'],
    warnings: [],
    tableValidations: [],
    validatedAt: '2025-01-01T00:00:00.000Z',
  };

  const customizations: CustomizationReport = {
    zTables: ['ZTSD_CUSTOM', 'ZFI_REPORT'],
    zFields: [
      { table: 'VBAK', field: 'ZZPARTNER' },
      { table: 'KNA1', field: 'ZZCUSTGRP' },
    ],
    customNamespaces: ['/ZCUST/'],
    totalCustomizations: 5,
  };

  return {
    validatePath: jest.fn<(pathId: string, schema: ClientSchema) => PathValidation>()
      .mockImplementation((pathId: string) => {
        if (pathId === 'sap.o2c.order-header') return validPath;
        return invalidPath;
      }),
    validateAllPaths: jest.fn<(schema: ClientSchema) => PathValidation[]>()
      .mockReturnValue([validPath, invalidPath]),
    analyzeCustomizations: jest.fn<(schema: ClientSchema) => CustomizationReport>()
      .mockReturnValue(customizations),
  };
}

// ============================================================================
// Shared test data
// ============================================================================

const samplePairs = [
  {
    left: {
      system: 'SAP',
      table: 'VBAK',
      recordId: '100',
      fields: { NETWR: '50000', WAERK: 'USD' },
      extractionId: 'E-001',
    },
    right: {
      system: 'Salesforce',
      table: 'Opportunity',
      recordId: 'OPP-100',
      fields: { Amount: '47000', CurrencyIsoCode: 'USD' },
      extractionId: 'E-002',
    },
  },
  {
    left: {
      system: 'SAP',
      table: 'VBAK',
      recordId: '101',
      fields: { NETWR: '30000', WAERK: 'EUR' },
      extractionId: 'E-003',
    },
    right: {
      system: 'Salesforce',
      table: 'Opportunity',
      recordId: 'OPP-101',
      fields: { Amount: '30000', CurrencyIsoCode: 'EUR' },
      extractionId: 'E-004',
    },
  },
];

const sampleClientSchema = {
  clientId: 'ACME-001',
  systemType: 'SAP',
  tables: {
    VBAK: {
      name: 'VBAK',
      fields: {
        VBELN: { name: 'VBELN', dataType: 'CHAR', length: 10 },
        AUART: { name: 'AUART', dataType: 'CHAR', length: 2 },
        NETWR: { name: 'NETWR', dataType: 'DEC', length: 15, decimals: 2 },
        ZZPARTNER: { name: 'ZZPARTNER', dataType: 'CHAR', length: 10, description: 'Custom partner field' },
      },
      recordCount: 50000,
    },
    ZTSD_CUSTOM: {
      name: 'ZTSD_CUSTOM',
      fields: {
        MANDT: { name: 'MANDT', dataType: 'CHAR', length: 3 },
        ZFIELD: { name: 'ZFIELD', dataType: 'CHAR', length: 20 },
      },
    },
  },
  extractedAt: '2025-01-01T00:00:00.000Z',
};

// ============================================================================
// Tests: detect_contradictions
// ============================================================================

describe('detect_contradictions', () => {
  it('calls engine.analyzeAll with pairs', async () => {
    const engine = mockEngine();
    const deps: ContradictionToolDeps = {
      engine: engine as unknown as ContradictionToolDeps['engine'],
    };

    const result = await executeDetectContradictions(deps, {
      pairs: samplePairs,
    });

    expect(engine.analyzeAll).toHaveBeenCalledTimes(1);
    const callArgs = engine.analyzeAll.mock.calls[0]!;
    expect(callArgs[0]).toHaveLength(2);

    const typed = result as { contradictions: ContradictionFinding[]; recordsCompared: number };
    expect(typed.recordsCompared).toBe(2);
  });

  it('filters by min_severity', async () => {
    const engine = mockEngine();
    const deps: ContradictionToolDeps = {
      engine: engine as unknown as ContradictionToolDeps['engine'],
    };

    // HIGH should include CRITICAL + HIGH, exclude MEDIUM, LOW, INFO
    const result = await executeDetectContradictions(deps, {
      pairs: samplePairs,
      min_severity: 'HIGH',
    }) as { contradictions: ContradictionFinding[] };

    expect(result.contradictions).toHaveLength(2);
    const severities = result.contradictions.map((c) => c.severity);
    expect(severities).toContain('CRITICAL');
    expect(severities).toContain('HIGH');
    expect(severities).not.toContain('MEDIUM');
    expect(severities).not.toContain('LOW');
    expect(severities).not.toContain('INFO');
  });

  it('passes config overrides to engine', async () => {
    const engine = mockEngine();
    const deps: ContradictionToolDeps = {
      engine: engine as unknown as ContradictionToolDeps['engine'],
    };

    await executeDetectContradictions(deps, {
      pairs: samplePairs,
      config: {
        amountDivergencePercent: 0.10,
        approvalThreshold: 100000,
      },
    });

    expect(engine.updateConfig).toHaveBeenCalledWith({
      amountDivergencePercent: 0.10,
      approvalThreshold: 100000,
    });
  });

  it('passes type filter to engine.analyzeWithTypes', async () => {
    const engine = mockEngine();
    const deps: ContradictionToolDeps = {
      engine: engine as unknown as ContradictionToolDeps['engine'],
    };

    await executeDetectContradictions(deps, {
      pairs: samplePairs,
      types: ['AMOUNT_DIVERGENCE'],
    });

    expect(engine.analyzeWithTypes).toHaveBeenCalledTimes(1);
    expect(engine.analyzeAll).not.toHaveBeenCalled();
    const callArgs = engine.analyzeWithTypes.mock.calls[0]!;
    expect(callArgs[1]).toEqual(['AMOUNT_DIVERGENCE']);
  });

  it('returns riskSummary', async () => {
    const engine = mockEngine();
    const deps: ContradictionToolDeps = {
      engine: engine as unknown as ContradictionToolDeps['engine'],
    };

    // Use min_severity INFO to include all findings in the summary
    const result = await executeDetectContradictions(deps, {
      pairs: samplePairs,
      min_severity: 'INFO',
    }) as {
      riskSummary: {
        totalFindings: number;
        bySeverity: Record<Severity, number>;
        byType: Record<string, number>;
        highestSeverity: Severity | null;
      };
    };

    expect(result.riskSummary).toBeDefined();
    expect(result.riskSummary.totalFindings).toBe(5);
    expect(result.riskSummary.bySeverity.CRITICAL).toBe(1);
    expect(result.riskSummary.bySeverity.HIGH).toBe(1);
    expect(result.riskSummary.bySeverity.MEDIUM).toBe(1);
    expect(result.riskSummary.bySeverity.LOW).toBe(1);
    expect(result.riskSummary.bySeverity.INFO).toBe(1);
    expect(result.riskSummary.highestSeverity).toBe('CRITICAL');
    expect(result.riskSummary.byType['APPROVAL_BYPASS']).toBe(1);
    expect(result.riskSummary.byType['AMOUNT_DIVERGENCE']).toBe(1);
  });

  it('throws when engine is not configured', async () => {
    const deps: ContradictionToolDeps = {};

    await expect(
      executeDetectContradictions(deps, { pairs: samplePairs }),
    ).rejects.toThrow('Contradiction engine not configured');
  });
});

// ============================================================================
// Tests: validate_schema
// ============================================================================

describe('validate_schema', () => {
  it('validates all paths by default', async () => {
    const validator = mockValidator();
    const deps: ContradictionToolDeps = {
      validator,
    };

    const result = await executeValidateSchema(deps, {
      client_schema: sampleClientSchema,
    }) as { validations: PathValidation[]; summary: Record<string, number> };

    expect(validator.validateAllPaths).toHaveBeenCalledTimes(1);
    expect((validator.validatePath as jest.Mock).mock.calls).toHaveLength(0);
    expect(result.validations).toHaveLength(2);
  });

  it('validates specific paths when path_ids provided', async () => {
    const validator = mockValidator();
    const deps: ContradictionToolDeps = {
      validator,
    };

    const result = await executeValidateSchema(deps, {
      client_schema: sampleClientSchema,
      path_ids: ['sap.o2c.order-header'],
    }) as { validations: PathValidation[] };

    expect(validator.validatePath).toHaveBeenCalledTimes(1);
    expect((validator.validatePath as jest.Mock).mock.calls[0]![0]).toBe('sap.o2c.order-header');
    expect((validator.validateAllPaths as jest.Mock).mock.calls).toHaveLength(0);
    expect(result.validations).toHaveLength(1);
    expect(result.validations[0]!.valid).toBe(true);
  });

  it('includes customization analysis', async () => {
    const validator = mockValidator();
    const deps: ContradictionToolDeps = {
      validator,
    };

    const result = await executeValidateSchema(deps, {
      client_schema: sampleClientSchema,
      include_customizations: true,
    }) as { customizations: CustomizationReport };

    expect(validator.analyzeCustomizations).toHaveBeenCalledTimes(1);
    expect(result.customizations).toBeDefined();
    expect(result.customizations.zTables).toContain('ZTSD_CUSTOM');
    expect(result.customizations.zFields).toHaveLength(2);
    expect(result.customizations.totalCustomizations).toBe(5);
  });

  it('returns valid/invalid counts in summary', async () => {
    const validator = mockValidator();
    const deps: ContradictionToolDeps = {
      validator,
    };

    const result = await executeValidateSchema(deps, {
      client_schema: sampleClientSchema,
    }) as {
      summary: {
        totalPaths: number;
        validCount: number;
        invalidCount: number;
        totalErrors: number;
        totalWarnings: number;
      };
    };

    expect(result.summary.totalPaths).toBe(2);
    expect(result.summary.validCount).toBe(1);
    expect(result.summary.invalidCount).toBe(1);
    expect(result.summary.totalErrors).toBe(1);
    expect(result.summary.totalWarnings).toBe(1);
  });

  it('throws when validator is not configured', async () => {
    const deps: ContradictionToolDeps = {};

    await expect(
      executeValidateSchema(deps, { client_schema: sampleClientSchema }),
    ).rejects.toThrow('Schema validator not configured');
  });

  it('skips customization analysis when include_customizations is false', async () => {
    const validator = mockValidator();
    const deps: ContradictionToolDeps = {
      validator,
    };

    const result = await executeValidateSchema(deps, {
      client_schema: sampleClientSchema,
      include_customizations: false,
    }) as Record<string, unknown>;

    expect(validator.analyzeCustomizations).not.toHaveBeenCalled();
    expect(result['customizations']).toBeUndefined();
  });
});

// ============================================================================
// Tests: Tool schemas have correct required/optional fields
// ============================================================================

describe('tool schemas', () => {
  it('detect_contradictions: pairs is required, types/config/min_severity are optional', () => {
    expect(detectContradictionsTool.inputSchema.required).toContain('pairs');
    expect(detectContradictionsTool.inputSchema.required).not.toContain('types');
    expect(detectContradictionsTool.inputSchema.required).not.toContain('config');
    expect(detectContradictionsTool.inputSchema.required).not.toContain('min_severity');

    // Validates with only required field
    const result = DetectContradictionsSchema.parse({ pairs: samplePairs });
    expect(result.min_severity).toBe('LOW');
    expect(result.types).toBeUndefined();
    expect(result.config).toBeUndefined();

    // Rejects empty pairs array
    expect(() => DetectContradictionsSchema.parse({ pairs: [] })).toThrow();

    // Rejects missing pairs
    expect(() => DetectContradictionsSchema.parse({})).toThrow();

    // Rejects invalid min_severity
    expect(() =>
      DetectContradictionsSchema.parse({ pairs: samplePairs, min_severity: 'UNKNOWN' }),
    ).toThrow();

    // Rejects invalid contradiction type
    expect(() =>
      DetectContradictionsSchema.parse({ pairs: samplePairs, types: ['INVALID_TYPE'] }),
    ).toThrow();
  });

  it('validate_schema: client_schema is required, path_ids/include_customizations are optional', () => {
    expect(validateSchemaTool.inputSchema.required).toContain('client_schema');
    expect(validateSchemaTool.inputSchema.required).not.toContain('path_ids');
    expect(validateSchemaTool.inputSchema.required).not.toContain('include_customizations');

    // Validates with only required field
    const result = ValidateSchemaSchema.parse({ client_schema: sampleClientSchema });
    expect(result.include_customizations).toBe(true);
    expect(result.path_ids).toBeUndefined();

    // Rejects missing client_schema
    expect(() => ValidateSchemaSchema.parse({})).toThrow();

    // Rejects incomplete client_schema
    expect(() =>
      ValidateSchemaSchema.parse({ client_schema: { clientId: 'test' } }),
    ).toThrow();
  });
});

// ============================================================================
// Tests: createContradictionTools factory
// ============================================================================

describe('createContradictionTools', () => {
  it('returns two tools with tool definitions and handlers', () => {
    const tools = createContradictionTools({});

    expect(tools.detectContradictions.tool.name).toBe('detect_contradictions');
    expect(tools.validateSchema.tool.name).toBe('validate_schema');

    expect(typeof tools.detectContradictions.handler).toBe('function');
    expect(typeof tools.validateSchema.handler).toBe('function');
  });
});
