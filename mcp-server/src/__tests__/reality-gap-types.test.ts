/**
 * Tests for reality-gap type definitions
 *
 * Validates that type structures are importable, usable, and that
 * runtime constraints hold (since TypeScript types are erased at runtime).
 */

import type {
  GapType,
  GapSeverity,
  WorkflowRule,
  ReferenceStep,
  ActualEvent,
  GapFinding,
  GapDetectionConfig,
  GapDetectionResult,
} from '../reality-gap/types.js';

import { DEFAULT_GAP_CONFIG } from '../reality-gap/types.js';

// --- Runtime validation helpers ---

const VALID_GAP_TYPES: readonly string[] = ['design', 'compliance', 'shadow'];
const VALID_GAP_SEVERITIES: readonly string[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'];
const VALID_RULE_TYPES: readonly string[] = [
  'approval_threshold', 'sod_constraint', 'sequence_requirement',
  'timing_sla', 'field_validation', 'routing_rule',
];
const VALID_SYSTEM_SCOPES: readonly string[] = ['SAP', 'NetSuite', 'Salesforce', 'cross-system'];
const VALID_EXPECTED_SOURCES: readonly string[] = ['reference', 'documented'];

function isValidGapType(value: string): value is GapType {
  return VALID_GAP_TYPES.includes(value);
}

function isValidGapSeverity(value: string): value is GapSeverity {
  return VALID_GAP_SEVERITIES.includes(value);
}

function isValidRuleType(value: string): value is WorkflowRule['ruleType'] {
  return VALID_RULE_TYPES.includes(value);
}

function isValidSystemScope(value: string): boolean {
  return VALID_SYSTEM_SCOPES.includes(value);
}

function isValidExpectedSource(value: string): boolean {
  return VALID_EXPECTED_SOURCES.includes(value);
}

// --- GapType ---

describe('Reality Gap types', () => {
  describe('GapType constraints', () => {
    it('should accept valid gap types', () => {
      for (const gt of VALID_GAP_TYPES) {
        expect(isValidGapType(gt)).toBe(true);
      }
    });

    it('should reject invalid gap types', () => {
      expect(isValidGapType('structural')).toBe(false);
      expect(isValidGapType('DESIGN')).toBe(false);
      expect(isValidGapType('')).toBe(false);
    });

    it('should have exactly 3 valid values', () => {
      expect(VALID_GAP_TYPES).toHaveLength(3);
    });
  });

  // --- GapSeverity ---

  describe('GapSeverity constraints', () => {
    it('should accept valid gap severities', () => {
      for (const gs of VALID_GAP_SEVERITIES) {
        expect(isValidGapSeverity(gs)).toBe(true);
      }
    });

    it('should reject invalid gap severities', () => {
      expect(isValidGapSeverity('critical')).toBe(false);
      expect(isValidGapSeverity('WARNING')).toBe(false);
      expect(isValidGapSeverity('')).toBe(false);
    });

    it('should have exactly 5 valid values', () => {
      expect(VALID_GAP_SEVERITIES).toHaveLength(5);
    });
  });

  // --- WorkflowRule ---

  describe('WorkflowRule', () => {
    const rule: WorkflowRule = {
      id: 'rule-ap-001',
      sourceDocument: 'SOP-AP-001 v3.2',
      section: 'Section 4.2 - Approval Thresholds',
      ruleText: 'Invoices over $50,000 require VP-level approval',
      systemScope: 'SAP',
      ruleType: 'approval_threshold',
      parameters: { threshold: 50000, currency: 'USD' },
      extractionPathId: 'sap.fi.invoice-approvals',
      active: true,
    };

    it('should have all required fields', () => {
      expect(rule.id).toBeDefined();
      expect(rule.sourceDocument).toBeDefined();
      expect(rule.section).toBeDefined();
      expect(rule.ruleText).toBeDefined();
      expect(rule.systemScope).toBeDefined();
      expect(rule.ruleType).toBeDefined();
      expect(rule.parameters).toBeDefined();
      expect(typeof rule.active).toBe('boolean');
    });

    it('should use a valid system scope', () => {
      expect(isValidSystemScope(rule.systemScope)).toBe(true);
    });

    it('should support cross-system scope', () => {
      const crossRule: WorkflowRule = {
        ...rule,
        id: 'rule-cross-001',
        systemScope: 'cross-system',
      };
      expect(isValidSystemScope(crossRule.systemScope)).toBe(true);
    });

    it('ruleType should have exactly 6 valid values', () => {
      expect(VALID_RULE_TYPES).toHaveLength(6);
    });

    it('should accept all valid ruleType values', () => {
      for (const rt of VALID_RULE_TYPES) {
        expect(isValidRuleType(rt)).toBe(true);
      }
    });

    it('should reject invalid ruleType values', () => {
      expect(isValidRuleType('manual_check')).toBe(false);
      expect(isValidRuleType('')).toBe(false);
    });

    it('should support optional extractionPathId', () => {
      const ruleWithout: WorkflowRule = {
        ...rule,
        extractionPathId: undefined,
      };
      expect(ruleWithout.extractionPathId).toBeUndefined();
    });
  });

  // --- ReferenceStep ---

  describe('ReferenceStep', () => {
    const step: ReferenceStep = {
      modelId: 'o2c-detailed',
      stepIndex: 3,
      activityName: 'Create Delivery',
      sapTcode: 'VL01N',
      expectedNext: ['Post Goods Issue', 'Create Billing Document'],
      required: true,
    };

    it('should have all required fields', () => {
      expect(step.modelId).toBeDefined();
      expect(typeof step.stepIndex).toBe('number');
      expect(step.activityName).toBeDefined();
      expect(step.expectedNext).toBeDefined();
      expect(typeof step.required).toBe('boolean');
    });

    it('should support optional sapTcode', () => {
      const stepWithout: ReferenceStep = {
        ...step,
        sapTcode: undefined,
      };
      expect(stepWithout.sapTcode).toBeUndefined();
    });

    it('should have a non-empty expectedNext array', () => {
      expect(step.expectedNext.length).toBeGreaterThan(0);
    });
  });

  // --- ActualEvent ---

  describe('ActualEvent', () => {
    const event: ActualEvent = {
      caseId: 'SO-12345',
      activityName: 'Create Delivery',
      timestamp: '2026-03-31T14:30:00.000Z',
      userId: 'JSMITH',
      systemType: 'SAP',
      tableName: 'LIKP',
      recordId: '0080012345',
      extractionId: 'ext-007',
    };

    it('should have all required fields', () => {
      expect(event.caseId).toBeDefined();
      expect(event.activityName).toBeDefined();
      expect(event.timestamp).toBeDefined();
      expect(event.userId).toBeDefined();
      expect(event.systemType).toBeDefined();
      expect(event.tableName).toBeDefined();
      expect(event.recordId).toBeDefined();
    });

    it('should have an ISO 8601 timestamp', () => {
      expect(new Date(event.timestamp).toISOString()).toBe(event.timestamp);
    });

    it('should support optional extractionId', () => {
      const eventWithout: ActualEvent = {
        ...event,
        extractionId: undefined,
      };
      expect(eventWithout.extractionId).toBeUndefined();
    });
  });

  // --- GapFinding ---

  describe('GapFinding', () => {
    const finding: GapFinding = {
      id: 'gap-001',
      gapType: 'compliance',
      severity: 'HIGH',
      confidence: 0.92,
      title: 'Approval bypass on high-value invoices',
      description: 'Invoices over $50K posted without VP approval in 23 cases',
      expectedSource: 'documented',
      expectedRule: 'rule-ap-001',
      expectedBehavior: 'VP-level approval required for invoices > $50,000',
      actualBehavior: 'Invoices posted with only manager-level approval',
      actualEvents: ['SO-12345', 'SO-12346', 'SO-12347'],
      frequency: 23,
      materiality: 0.85,
      recency: 0.70,
      detectedAt: '2026-03-31T15:00:00.000Z',
      systemScope: 'SAP',
    };

    it('should have all required fields', () => {
      expect(finding.id).toBeDefined();
      expect(finding.gapType).toBeDefined();
      expect(finding.severity).toBeDefined();
      expect(typeof finding.confidence).toBe('number');
      expect(finding.title).toBeDefined();
      expect(finding.description).toBeDefined();
      expect(finding.expectedSource).toBeDefined();
      expect(finding.expectedBehavior).toBeDefined();
      expect(finding.actualBehavior).toBeDefined();
      expect(finding.actualEvents).toBeDefined();
      expect(typeof finding.frequency).toBe('number');
      expect(typeof finding.materiality).toBe('number');
      expect(typeof finding.recency).toBe('number');
      expect(finding.detectedAt).toBeDefined();
      expect(finding.systemScope).toBeDefined();
    });

    it('should use valid gap type and severity', () => {
      expect(isValidGapType(finding.gapType)).toBe(true);
      expect(isValidGapSeverity(finding.severity)).toBe(true);
    });

    it('should use a valid expected source', () => {
      expect(isValidExpectedSource(finding.expectedSource)).toBe(true);
    });

    it('should have confidence in 0.0-1.0 range', () => {
      expect(finding.confidence).toBeGreaterThanOrEqual(0.0);
      expect(finding.confidence).toBeLessThanOrEqual(1.0);
    });

    it('should have materiality in 0.0-1.0 range', () => {
      expect(finding.materiality).toBeGreaterThanOrEqual(0.0);
      expect(finding.materiality).toBeLessThanOrEqual(1.0);
    });

    it('should have recency in 0.0-1.0 range', () => {
      expect(finding.recency).toBeGreaterThanOrEqual(0.0);
      expect(finding.recency).toBeLessThanOrEqual(1.0);
    });

    it('should support optional expectedRule', () => {
      const findingWithout: GapFinding = {
        ...finding,
        expectedRule: undefined,
      };
      expect(findingWithout.expectedRule).toBeUndefined();
    });
  });

  // --- DEFAULT_GAP_CONFIG ---

  describe('DEFAULT_GAP_CONFIG', () => {
    it('should have sensible default minFrequency', () => {
      expect(DEFAULT_GAP_CONFIG.minFrequency).toBe(1);
    });

    it('should have sensible default minMateriality', () => {
      expect(DEFAULT_GAP_CONFIG.minMateriality).toBe(0.0);
    });

    it('should have sensible default lookbackDays', () => {
      expect(DEFAULT_GAP_CONFIG.lookbackDays).toBe(365);
    });

    it('should include all gap types by default', () => {
      expect(DEFAULT_GAP_CONFIG.includeDesignGaps).toBe(true);
      expect(DEFAULT_GAP_CONFIG.includeComplianceGaps).toBe(true);
      expect(DEFAULT_GAP_CONFIG.includeShadowGaps).toBe(true);
    });
  });

  // --- GapDetectionResult ---

  describe('GapDetectionResult', () => {
    const result: GapDetectionResult = {
      designGaps: [],
      complianceGaps: [],
      shadowGaps: [],
      totalCasesAnalyzed: 500,
      totalEventsAnalyzed: 12000,
      duration: 3420,
    };

    it('should have all required fields', () => {
      expect(result.designGaps).toBeDefined();
      expect(result.complianceGaps).toBeDefined();
      expect(result.shadowGaps).toBeDefined();
      expect(typeof result.totalCasesAnalyzed).toBe('number');
      expect(typeof result.totalEventsAnalyzed).toBe('number');
      expect(typeof result.duration).toBe('number');
    });

    it('should have three gap arrays matching the three GapTypes', () => {
      expect(Array.isArray(result.designGaps)).toBe(true);
      expect(Array.isArray(result.complianceGaps)).toBe(true);
      expect(Array.isArray(result.shadowGaps)).toBe(true);
    });
  });
});
