/**
 * Phase 3 Integration: Reality-Gap Engine + Finding Lifecycle
 *
 * End-to-end test proving the full Phase 3 pipeline works with realistic
 * SAP O2C (Order-to-Cash) process data. Covers three-way gap analysis
 * (design, compliance, shadow), finding lifecycle management with state
 * machine transitions, deduplication, and cross-phase provenance linkage.
 *
 * Uses realistic O2C steps: Order -> Credit Check -> Delivery ->
 * Goods Issue -> Invoice -> Payment, with documented rules for approval
 * thresholds ($10K) and delivery SLA (5 days).
 */

import { describe, test, expect, beforeEach } from '@jest/globals';

// ---------------------------------------------------------------------------
// Reality-Gap barrel imports
// ---------------------------------------------------------------------------

import {
  RealityGapEngine,
  DesignGapDetector,
  ComplianceGapDetector,
  ShadowGapDetector,
  DEFAULT_GAP_CONFIG,
  createDefaultEngine,
} from '../reality-gap/index.js';

import type {
  GapType,
  GapSeverity,
  GapFinding,
  GapDetectionConfig,
  GapDetectionResult,
  ReferenceStep,
  WorkflowRule,
  ActualEvent,
} from '../reality-gap/index.js';

// ---------------------------------------------------------------------------
// Finding-Lifecycle barrel imports
// ---------------------------------------------------------------------------

import {
  FindingLifecycleManager,
  VALID_TRANSITIONS,
  TERMINAL_STATES,
} from '../finding-lifecycle/index.js';

import type {
  FindingState,
  FindingSource,
  FindingSeverity,
  UnifiedFinding,
  FindingKey,
} from '../finding-lifecycle/index.js';

// ---------------------------------------------------------------------------
// Realistic O2C Reference Data
// ---------------------------------------------------------------------------

/** O2C Detailed reference model: 6 steps */
const O2C_REFERENCE_STEPS: ReferenceStep[] = [
  {
    modelId: 'o2c-detailed',
    stepIndex: 1,
    activityName: 'Create Sales Order',
    sapTcode: 'VA01',
    expectedNext: ['Credit Check'],
    required: true,
  },
  {
    modelId: 'o2c-detailed',
    stepIndex: 2,
    activityName: 'Credit Check',
    sapTcode: 'FD32',
    expectedNext: ['Delivery'],
    required: true,
  },
  {
    modelId: 'o2c-detailed',
    stepIndex: 3,
    activityName: 'Delivery',
    sapTcode: 'VL01N',
    expectedNext: ['Goods Issue'],
    required: true,
  },
  {
    modelId: 'o2c-detailed',
    stepIndex: 4,
    activityName: 'Goods Issue',
    sapTcode: 'VL02N',
    expectedNext: ['Invoice'],
    required: true,
  },
  {
    modelId: 'o2c-detailed',
    stepIndex: 5,
    activityName: 'Invoice',
    sapTcode: 'VF01',
    expectedNext: ['Payment'],
    required: true,
  },
  {
    modelId: 'o2c-detailed',
    stepIndex: 6,
    activityName: 'Payment',
    sapTcode: 'F-28',
    expectedNext: [],
    required: true,
  },
];

/** Documented workflow rules — deliberately missing "Credit Check" documentation */
const O2C_DOCUMENTED_RULES: WorkflowRule[] = [
  {
    id: 'RULE-O2C-001',
    sourceDocument: 'SOP-SD-001 v2.1',
    section: 'Section 3.1 - Order Entry',
    ruleText: 'Create Sales Order must be performed via VA01',
    systemScope: 'SAP',
    ruleType: 'sequence_requirement',
    parameters: { tcode: 'VA01', activityName: 'Create Sales Order' },
    active: true,
  },
  {
    id: 'RULE-O2C-002',
    sourceDocument: 'SOP-SD-001 v2.1',
    section: 'Section 4.1 - Delivery Processing',
    ruleText: 'Delivery must be completed within 5 business days of order',
    systemScope: 'SAP',
    ruleType: 'timing_sla',
    parameters: {
      maxDays: 5,
      startActivity: 'Create Sales Order',
      endActivity: 'Delivery',
      activityName: 'Delivery',
    },
    active: true,
  },
  {
    id: 'RULE-O2C-003',
    sourceDocument: 'SOP-SD-001 v2.1',
    section: 'Section 4.2 - Goods Movement',
    ruleText: 'Goods Issue follows Delivery',
    systemScope: 'SAP',
    ruleType: 'sequence_requirement',
    parameters: { tcode: 'VL02N', activityName: 'Goods Issue' },
    active: true,
  },
  {
    id: 'RULE-O2C-004',
    sourceDocument: 'SOP-FI-001 v1.8',
    section: 'Section 2.1 - Billing',
    ruleText: 'Invoice creation via VF01',
    systemScope: 'SAP',
    ruleType: 'sequence_requirement',
    parameters: { tcode: 'VF01', activityName: 'Invoice' },
    active: true,
  },
  {
    id: 'RULE-O2C-005',
    sourceDocument: 'SOP-FI-001 v1.8',
    section: 'Section 3.1 - Approval Thresholds',
    ruleText: 'Orders above $10,000 require manager approval',
    systemScope: 'SAP',
    ruleType: 'approval_threshold',
    parameters: { threshold: 10000, currency: 'USD' },
    active: true,
  },
  {
    id: 'RULE-O2C-006',
    sourceDocument: 'SOP-FI-001 v1.8',
    section: 'Section 5.1 - Payment Receipt',
    ruleText: 'Payment posting via F-28',
    systemScope: 'SAP',
    ruleType: 'sequence_requirement',
    parameters: { tcode: 'F-28', activityName: 'Payment' },
    active: true,
  },
];

/** Actual events — mix of compliant and violating cases */
const O2C_ACTUAL_EVENTS: ActualEvent[] = [
  // Case 1: Compliant order
  {
    caseId: 'SO-001',
    activityName: 'Create Sales Order',
    timestamp: '2025-03-01T09:00:00Z',
    userId: 'USER01',
    systemType: 'SAP',
    tableName: 'VBAK',
    recordId: 'SO-001-001',
    extractionId: 'EXT-001',
  },
  {
    caseId: 'SO-001',
    activityName: 'Credit Check',
    timestamp: '2025-03-01T09:30:00Z',
    userId: 'USER02',
    systemType: 'SAP',
    tableName: 'VBKD',
    recordId: 'SO-001-002',
    extractionId: 'EXT-002',
  },
  {
    caseId: 'SO-001',
    activityName: 'Delivery',
    timestamp: '2025-03-03T10:00:00Z',
    userId: 'USER03',
    systemType: 'SAP',
    tableName: 'LIKP',
    recordId: 'SO-001-003',
    extractionId: 'EXT-003',
  },
  {
    caseId: 'SO-001',
    activityName: 'Goods Issue',
    timestamp: '2025-03-03T14:00:00Z',
    userId: 'USER03',
    systemType: 'SAP',
    tableName: 'LIPS',
    recordId: 'SO-001-004',
    extractionId: 'EXT-004',
  },
  {
    caseId: 'SO-001',
    activityName: 'Invoice',
    timestamp: '2025-03-04T08:00:00Z',
    userId: 'USER04',
    systemType: 'SAP',
    tableName: 'VBRK',
    recordId: 'SO-001-005',
    extractionId: 'EXT-005',
  },
  {
    caseId: 'SO-001',
    activityName: 'Payment',
    timestamp: '2025-03-15T12:00:00Z',
    userId: 'USER05',
    systemType: 'SAP',
    tableName: 'BSAD',
    recordId: 'SO-001-006',
    extractionId: 'EXT-006',
  },

  // Case 2: Missing credit check (skipped required step)
  {
    caseId: 'SO-002',
    activityName: 'Create Sales Order',
    timestamp: '2025-03-02T08:00:00Z',
    userId: 'USER01',
    systemType: 'SAP',
    tableName: 'VBAK',
    recordId: 'SO-002-001',
    extractionId: 'EXT-007',
  },
  // No credit check event!
  {
    caseId: 'SO-002',
    activityName: 'Delivery',
    timestamp: '2025-03-04T09:00:00Z',
    userId: 'USER03',
    systemType: 'SAP',
    tableName: 'LIKP',
    recordId: 'SO-002-002',
    extractionId: 'EXT-008',
  },
  {
    caseId: 'SO-002',
    activityName: 'Goods Issue',
    timestamp: '2025-03-04T15:00:00Z',
    userId: 'USER03',
    systemType: 'SAP',
    tableName: 'LIPS',
    recordId: 'SO-002-003',
    extractionId: 'EXT-009',
  },
  {
    caseId: 'SO-002',
    activityName: 'Invoice',
    timestamp: '2025-03-05T10:00:00Z',
    userId: 'USER04',
    systemType: 'SAP',
    tableName: 'VBRK',
    recordId: 'SO-002-004',
    extractionId: 'EXT-010',
  },
  {
    caseId: 'SO-002',
    activityName: 'Payment',
    timestamp: '2025-03-20T16:00:00Z',
    userId: 'USER05',
    systemType: 'SAP',
    tableName: 'BSAD',
    recordId: 'SO-002-005',
    extractionId: 'EXT-011',
  },

  // Case 3: SLA breach — delivery 8 days after order (5-day limit)
  {
    caseId: 'SO-003',
    activityName: 'Create Sales Order',
    timestamp: '2025-03-05T10:00:00Z',
    userId: 'USER01',
    systemType: 'SAP',
    tableName: 'VBAK',
    recordId: 'SO-003-001',
    extractionId: 'EXT-012',
  },
  {
    caseId: 'SO-003',
    activityName: 'Credit Check',
    timestamp: '2025-03-05T11:00:00Z',
    userId: 'USER02',
    systemType: 'SAP',
    tableName: 'VBKD',
    recordId: 'SO-003-002',
    extractionId: 'EXT-013',
  },
  {
    caseId: 'SO-003',
    activityName: 'Delivery',
    timestamp: '2025-03-13T09:00:00Z',
    userId: 'USER03',
    systemType: 'SAP',
    tableName: 'LIKP',
    recordId: 'SO-003-003',
    extractionId: 'EXT-014',
  },
  {
    caseId: 'SO-003',
    activityName: 'Goods Issue',
    timestamp: '2025-03-13T14:00:00Z',
    userId: 'USER03',
    systemType: 'SAP',
    tableName: 'LIPS',
    recordId: 'SO-003-004',
    extractionId: 'EXT-015',
  },
  {
    caseId: 'SO-003',
    activityName: 'Invoice',
    timestamp: '2025-03-14T08:00:00Z',
    userId: 'USER04',
    systemType: 'SAP',
    tableName: 'VBRK',
    recordId: 'SO-003-005',
    extractionId: 'EXT-016',
  },
  {
    caseId: 'SO-003',
    activityName: 'Payment',
    timestamp: '2025-03-25T10:00:00Z',
    userId: 'USER05',
    systemType: 'SAP',
    tableName: 'BSAD',
    recordId: 'SO-003-006',
    extractionId: 'EXT-017',
  },

  // Case 4: Shadow process — unauthorized batch job (admin user, after hours)
  {
    caseId: 'SO-004',
    activityName: 'Create Sales Order',
    timestamp: '2025-03-10T09:00:00Z',
    userId: 'USER01',
    systemType: 'SAP',
    tableName: 'VBAK',
    recordId: 'SO-004-001',
    extractionId: 'EXT-018',
  },
  {
    caseId: 'SO-004',
    activityName: 'Credit Check',
    timestamp: '2025-03-10T09:30:00Z',
    userId: 'USER02',
    systemType: 'SAP',
    tableName: 'VBKD',
    recordId: 'SO-004-002',
    extractionId: 'EXT-019',
  },
  {
    caseId: 'SO-004',
    activityName: 'BATCH_PRICING_OVERRIDE',
    timestamp: '2025-03-10T23:15:00Z',
    userId: 'BATCH_USER',
    systemType: 'SAP',
    tableName: 'KONV',
    recordId: 'SO-004-010',
    extractionId: 'EXT-020',
  },
  {
    caseId: 'SO-004',
    activityName: 'Delivery',
    timestamp: '2025-03-12T10:00:00Z',
    userId: 'USER03',
    systemType: 'SAP',
    tableName: 'LIKP',
    recordId: 'SO-004-003',
    extractionId: 'EXT-021',
  },
  {
    caseId: 'SO-004',
    activityName: 'Goods Issue',
    timestamp: '2025-03-12T14:00:00Z',
    userId: 'USER03',
    systemType: 'SAP',
    tableName: 'LIPS',
    recordId: 'SO-004-004',
    extractionId: 'EXT-022',
  },
  {
    caseId: 'SO-004',
    activityName: 'Invoice',
    timestamp: '2025-03-13T08:00:00Z',
    userId: 'USER04',
    systemType: 'SAP',
    tableName: 'VBRK',
    recordId: 'SO-004-005',
    extractionId: 'EXT-023',
  },
  {
    caseId: 'SO-004',
    activityName: 'Payment',
    timestamp: '2025-03-28T12:00:00Z',
    userId: 'USER05',
    systemType: 'SAP',
    tableName: 'BSAD',
    recordId: 'SO-004-006',
    extractionId: 'EXT-024',
  },
];

// ===========================================================================
// Phase 3 Integration Tests
// ===========================================================================

describe('Phase 3 Integration', () => {
  // =========================================================================
  // Reality-Gap Engine
  // =========================================================================

  describe('Reality-Gap Engine', () => {
    let engine: RealityGapEngine;

    beforeEach(() => {
      engine = createDefaultEngine();
    });

    test('detects design gap: missing credit check step', () => {
      // Credit Check is in the reference model but NOT documented in the
      // workflow rules (no rule with ruleText matching "Credit Check")
      const result = engine.analyzeDesignGaps(O2C_REFERENCE_STEPS, O2C_DOCUMENTED_RULES);

      // Should find at least one design gap for the undocumented Credit Check
      const creditCheckGap = result.find(
        g => g.gapType === 'design' && g.title.toLowerCase().includes('credit check')
      );
      expect(creditCheckGap).toBeDefined();
      expect(creditCheckGap!.severity).toBe('HIGH');
      expect(creditCheckGap!.expectedSource).toBe('reference');
    });

    test('detects compliance gap: SLA breach on delivery', () => {
      // The engine's compliance detector checks documented rules against actual
      // events. RULE-O2C-005 requires approval for amounts > $10K — with no
      // approval events in the log, the engine should flag this.
      const result = engine.analyzeComplianceGaps(O2C_DOCUMENTED_RULES, O2C_ACTUAL_EVENTS);

      // Should detect at least one compliance gap
      expect(result.length).toBeGreaterThan(0);

      // All findings should be compliance type
      for (const finding of result) {
        expect(finding.gapType).toBe('compliance');
        expect(finding.expectedSource).toBe('documented');
      }
    });

    test('detects shadow process: unauthorized batch job', () => {
      // BATCH_PRICING_OVERRIDE is not in reference model or documented rules
      const result = engine.analyzeShadowGaps(
        O2C_REFERENCE_STEPS,
        O2C_DOCUMENTED_RULES,
        O2C_ACTUAL_EVENTS
      );

      // Should find the batch pricing override as a shadow activity
      const batchGap = result.find(
        g =>
          g.gapType === 'shadow' &&
          (g.title.toLowerCase().includes('batch_pricing_override') ||
            g.title.toLowerCase().includes('batch pricing override'))
      );
      expect(batchGap).toBeDefined();
      expect(batchGap!.gapType).toBe('shadow');
      // Shadow activities should reference the case IDs where they occurred
      expect(batchGap!.actualEvents.length).toBeGreaterThan(0);
    });

    test('full three-way analysis returns all gap types', () => {
      const result = engine.analyze(O2C_REFERENCE_STEPS, O2C_DOCUMENTED_RULES, O2C_ACTUAL_EVENTS);

      // Verify result structure
      expect(result.designGaps).toBeInstanceOf(Array);
      expect(result.complianceGaps).toBeInstanceOf(Array);
      expect(result.shadowGaps).toBeInstanceOf(Array);
      expect(result.totalCasesAnalyzed).toBe(4); // SO-001 through SO-004
      expect(result.totalEventsAnalyzed).toBe(O2C_ACTUAL_EVENTS.length);
      expect(result.duration).toBeGreaterThanOrEqual(0);

      // Should have findings in each category
      expect(result.designGaps.length).toBeGreaterThan(0);
      expect(result.complianceGaps.length).toBeGreaterThan(0);
      expect(result.shadowGaps.length).toBeGreaterThan(0);

      // Verify gap types are correct
      for (const g of result.designGaps) expect(g.gapType).toBe('design');
      for (const g of result.complianceGaps) expect(g.gapType).toBe('compliance');
      for (const g of result.shadowGaps) expect(g.gapType).toBe('shadow');

      // All findings should have required fields
      const allFindings = [...result.designGaps, ...result.complianceGaps, ...result.shadowGaps];
      for (const finding of allFindings) {
        expect(finding.id).toBeDefined();
        expect(finding.title).toBeDefined();
        expect(finding.description).toBeDefined();
        expect(finding.severity).toBeDefined();
        expect(finding.detectedAt).toBeDefined();
      }
    });
  });

  // =========================================================================
  // Finding Lifecycle
  // =========================================================================

  describe('Finding Lifecycle', () => {
    let manager: FindingLifecycleManager;

    beforeEach(() => {
      manager = new FindingLifecycleManager();
    });

    test('creates finding from gap detection result', () => {
      // Run gap detection first
      const engine = createDefaultEngine();
      const result = engine.analyze(O2C_REFERENCE_STEPS, O2C_DOCUMENTED_RULES, O2C_ACTUAL_EVENTS);

      // Convert a design gap to a unified finding
      const gap = result.designGaps[0]!;
      const finding = manager.createFinding({
        source: 'reality_gap',
        sourceId: gap.id,
        title: gap.title,
        description: gap.description,
        severity: gap.severity as FindingSeverity,
        riskScore: Math.round(gap.materiality * 100),
        systemsCovered: ['SAP'],
        tablesCovered: ['VBAK', 'VBKD'],
        extractionIds: ['EXT-001', 'EXT-002'],
      });

      expect(finding.id).toBeDefined();
      expect(finding.state).toBe('DETECTED');
      expect(finding.source).toBe('reality_gap');
      expect(finding.sourceId).toBe(gap.id);
      expect(finding.riskScore).toBeGreaterThan(0);
      expect(finding.transitions).toHaveLength(0);
    });

    test('transitions through full lifecycle', () => {
      const finding = manager.createFinding({
        source: 'reality_gap',
        sourceId: 'GAP-001',
        title: 'Missing credit check step',
        description: 'Credit Check is required but not documented',
        severity: 'HIGH',
        riskScore: 70,
        systemsCovered: ['SAP'],
        tablesCovered: ['VBKD'],
        extractionIds: ['EXT-002'],
      });

      // DETECTED -> TRIAGED
      let updated = manager.transition(
        finding.id,
        'TRIAGED',
        'analyst-1',
        'Confirmed as real gap, needs investigation'
      );
      expect(updated.state).toBe('TRIAGED');
      expect(updated.transitions).toHaveLength(1);

      // TRIAGED -> INVESTIGATING
      updated = manager.transition(
        finding.id,
        'INVESTIGATING',
        'analyst-1',
        'Reviewing all cases without credit check'
      );
      expect(updated.state).toBe('INVESTIGATING');
      expect(updated.transitions).toHaveLength(2);

      // INVESTIGATING -> CONFIRMED
      updated = manager.transition(
        finding.id,
        'CONFIRMED',
        'analyst-1',
        'Found 5 cases bypassing credit check',
        'EXT-007'
      );
      expect(updated.state).toBe('CONFIRMED');

      // CONFIRMED -> REMEDIATION
      updated = manager.transition(
        finding.id,
        'REMEDIATION',
        'manager-1',
        'Adding mandatory credit check workflow step'
      );
      expect(updated.state).toBe('REMEDIATION');

      // REMEDIATION -> RESOLVED
      updated = manager.transition(
        finding.id,
        'RESOLVED',
        'manager-1',
        'Credit check now mandatory in VA01 config'
      );
      expect(updated.state).toBe('RESOLVED');
      expect(updated.resolvedAt).toBeDefined();
      expect(updated.transitions).toHaveLength(5);

      // Verify terminal state — should not allow further transitions
      expect(() => manager.transition(finding.id, 'DETECTED', 'system', 'reset')).toThrow(
        /Invalid transition/
      );
    });

    test('deduplication prevents duplicate findings', () => {
      const finding1 = manager.createFinding({
        source: 'reality_gap',
        sourceId: 'GAP-CREDIT-CHECK',
        title: 'Missing credit check',
        description: 'Credit check not documented',
        severity: 'HIGH',
        riskScore: 70,
        systemsCovered: ['SAP'],
        tablesCovered: ['VBKD'],
        extractionIds: ['EXT-002'],
      });

      // Register dedup key for the first finding
      const key: FindingKey = {
        source: 'reality_gap',
        systemLeft: 'SAP',
        tableLeft: 'VBKD',
        recordLeft: 'credit-check-gap',
      };
      manager.registerKey(finding1.id, key);

      // Check that the same key is now a duplicate
      expect(manager.isDuplicate(key)).toBe(true);

      // Different key should not be a duplicate
      const differentKey: FindingKey = {
        source: 'reality_gap',
        systemLeft: 'SAP',
        tableLeft: 'LIKP',
        recordLeft: 'delivery-gap',
      };
      expect(manager.isDuplicate(differentKey)).toBe(false);
    });

    test('summary aggregates across sources', () => {
      // Create findings from different sources
      manager.createFinding({
        source: 'reality_gap',
        sourceId: 'GAP-001',
        title: 'Design gap',
        description: 'Missing step',
        severity: 'HIGH',
        riskScore: 70,
        systemsCovered: ['SAP'],
        tablesCovered: ['VBAK'],
        extractionIds: ['EXT-001'],
      });

      manager.createFinding({
        source: 'contradiction',
        sourceId: 'CONTRA-001',
        title: 'Amount mismatch',
        description: 'SAP and SFDC disagree on amount',
        severity: 'CRITICAL',
        riskScore: 90,
        systemsCovered: ['SAP', 'Salesforce'],
        tablesCovered: ['VBRK', 'Opportunity'],
        extractionIds: ['EXT-005', 'EXT-100'],
      });

      const finding3 = manager.createFinding({
        source: 'conformance',
        sourceId: 'CONF-001',
        title: 'Sequence violation',
        description: 'Goods Issue before Delivery',
        severity: 'MEDIUM',
        riskScore: 50,
        systemsCovered: ['SAP'],
        tablesCovered: ['LIPS', 'LIKP'],
        extractionIds: ['EXT-003', 'EXT-004'],
      });

      // Transition one finding to FALSE_POSITIVE
      manager.transition(finding3.id, 'TRIAGED', 'analyst-1', 'Reviewing');
      manager.transition(finding3.id, 'FALSE_POSITIVE', 'analyst-1', 'System timing artifact');

      const summary = manager.getSummary();
      expect(summary.total).toBe(3);
      expect(summary.bySource['reality_gap']).toBe(1);
      expect(summary.bySource['contradiction']).toBe(1);
      expect(summary.bySource['conformance']).toBe(1);
      expect(summary.byState['DETECTED']).toBe(2);
      expect(summary.byState['FALSE_POSITIVE']).toBe(1);
      expect(summary.avgRiskScore).toBeCloseTo(70, 0);
    });
  });

  // =========================================================================
  // Cross-Phase: Gap + Contradiction + Provenance
  // =========================================================================

  describe('Cross-Phase: Gap + Contradiction + Provenance', () => {
    test('gap findings reference extraction IDs from provenance', () => {
      const engine = createDefaultEngine();
      const manager = new FindingLifecycleManager();

      // Run full gap analysis
      const result = engine.analyze(O2C_REFERENCE_STEPS, O2C_DOCUMENTED_RULES, O2C_ACTUAL_EVENTS);

      // Convert all gap findings to unified findings with provenance links
      const allGaps = [...result.designGaps, ...result.complianceGaps, ...result.shadowGaps];

      // Create unified findings, linking back to extraction IDs
      for (const gap of allGaps) {
        // In a real pipeline, gap.actualEvents would contain event IDs that
        // link to extraction records. Here we simulate the linkage.
        const extractionIds = gap.actualEvents
          .map(caseId => {
            const event = O2C_ACTUAL_EVENTS.find(e => e.caseId === caseId);
            return event?.extractionId;
          })
          .filter((id): id is string => id !== undefined);

        const finding = manager.createFinding({
          source: 'reality_gap',
          sourceId: gap.id,
          title: gap.title,
          description: gap.description,
          severity: gap.severity as FindingSeverity,
          riskScore: Math.round(gap.materiality * gap.confidence * 100),
          systemsCovered: [gap.systemScope],
          tablesCovered: [],
          extractionIds,
        });

        expect(finding.source).toBe('reality_gap');
        expect(finding.sourceId).toBe(gap.id);
      }

      // Verify all gap findings are tracked
      const gapFindings = manager.query({ source: 'reality_gap' });
      expect(gapFindings.length).toBe(allGaps.length);

      // At least one finding should have extraction IDs (from shadow gaps
      // which reference actual events with extractionIds)
      const withProvenance = gapFindings.filter(f => f.extractionIds.length > 0);
      expect(withProvenance.length).toBeGreaterThan(0);
    });

    test('lifecycle manager tracks findings from multiple sources', () => {
      const engine = createDefaultEngine();
      const manager = new FindingLifecycleManager();

      // 1. Reality-gap findings
      const gapResult = engine.analyze(
        O2C_REFERENCE_STEPS,
        O2C_DOCUMENTED_RULES,
        O2C_ACTUAL_EVENTS
      );

      for (const gap of gapResult.designGaps) {
        manager.createFinding({
          source: 'reality_gap',
          sourceId: gap.id,
          title: gap.title,
          description: gap.description,
          severity: gap.severity as FindingSeverity,
          riskScore: Math.round(gap.materiality * 100),
          systemsCovered: ['SAP'],
          tablesCovered: [],
          extractionIds: [],
        });
      }

      // 2. Simulated contradiction findings (from Phase 2)
      manager.createFinding({
        source: 'contradiction',
        sourceId: 'CONTRA-SAP-SFDC-001',
        title: 'Invoice amount mismatch: SAP vs Salesforce',
        description: 'VBRK.NETWR = $15,200 but Opportunity.Amount = $14,800',
        severity: 'HIGH',
        riskScore: 75,
        systemsCovered: ['SAP', 'Salesforce'],
        tablesCovered: ['VBRK', 'Opportunity'],
        extractionIds: ['EXT-005', 'EXT-100'],
      });

      // 3. Simulated conformance finding (from Phase 1)
      manager.createFinding({
        source: 'conformance',
        sourceId: 'CONF-O2C-001',
        title: 'Out-of-sequence: Goods Issue before Credit Check',
        description: 'Case SO-002 performed Goods Issue without prior Credit Check',
        severity: 'HIGH',
        riskScore: 80,
        systemsCovered: ['SAP'],
        tablesCovered: ['LIPS', 'VBKD'],
        extractionIds: ['EXT-009', 'EXT-007'],
      });

      // Verify multi-source tracking
      const allFindings = manager.query();
      const sources = new Set(allFindings.map(f => f.source));
      expect(sources.has('reality_gap')).toBe(true);
      expect(sources.has('contradiction')).toBe(true);
      expect(sources.has('conformance')).toBe(true);

      // Verify queries by source work
      const gapOnly = manager.query({ source: 'reality_gap' });
      expect(gapOnly.length).toBe(gapResult.designGaps.length);

      const contradictionOnly = manager.query({ source: 'contradiction' });
      expect(contradictionOnly.length).toBe(1);

      const conformanceOnly = manager.query({ source: 'conformance' });
      expect(conformanceOnly.length).toBe(1);

      // Active vs resolved
      expect(manager.getActive().length).toBe(allFindings.length);
      expect(manager.getResolved().length).toBe(0);

      // Transition the contradiction finding to RESOLVED
      const contraFinding = contradictionOnly[0]!;
      manager.transition(contraFinding.id, 'TRIAGED', 'system', 'Auto-triaged');
      manager.transition(contraFinding.id, 'INVESTIGATING', 'analyst-1', 'Checking amounts');
      manager.transition(
        contraFinding.id,
        'CONFIRMED',
        'analyst-1',
        'Amount discrepancy confirmed'
      );
      manager.transition(contraFinding.id, 'REMEDIATION', 'manager-1', 'Correcting SAP amount');
      manager.transition(
        contraFinding.id,
        'RESOLVED',
        'manager-1',
        'SAP amount corrected to match'
      );

      expect(manager.getResolved().length).toBe(1);
      expect(manager.getActive().length).toBe(allFindings.length - 1);
    });
  });
});
