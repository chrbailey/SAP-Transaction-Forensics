/**
 * Conformance Checking Module Tests
 */
import { createChecker, Trace } from '../checker.js';
import {
  O2C_SIMPLE_MODEL,
  O2C_DETAILED_MODEL,
  P2P_SIMPLE_MODEL,
  P2P_DETAILED_MODEL,
  getDefaultModel,
  getModelById,
  listModels,
} from '../models.js';

describe('Conformance Checking Module', () => {
  describe('Reference Models', () => {
    it('should have O2C simple model', () => {
      expect(O2C_SIMPLE_MODEL).toBeDefined();
      expect(O2C_SIMPLE_MODEL.id).toBe('o2c-simple');
      expect(O2C_SIMPLE_MODEL.processType).toBe('O2C');
      expect(O2C_SIMPLE_MODEL.activities.length).toBeGreaterThan(0);
    });

    it('should have O2C detailed model', () => {
      expect(O2C_DETAILED_MODEL).toBeDefined();
      expect(O2C_DETAILED_MODEL.id).toBe('o2c-detailed');
      expect(O2C_DETAILED_MODEL.processType).toBe('O2C');
      expect(O2C_DETAILED_MODEL.activities.length).toBeGreaterThan(
        O2C_SIMPLE_MODEL.activities.length
      );
    });

    it('should have P2P simple model', () => {
      expect(P2P_SIMPLE_MODEL).toBeDefined();
      expect(P2P_SIMPLE_MODEL.id).toBe('p2p-simple');
      expect(P2P_SIMPLE_MODEL.processType).toBe('P2P');
      expect(P2P_SIMPLE_MODEL.activities.length).toBeGreaterThan(0);
    });

    it('should have P2P detailed model', () => {
      expect(P2P_DETAILED_MODEL).toBeDefined();
      expect(P2P_DETAILED_MODEL.id).toBe('p2p-detailed');
      expect(P2P_DETAILED_MODEL.processType).toBe('P2P');
      expect(P2P_DETAILED_MODEL.activities.length).toBeGreaterThan(
        P2P_SIMPLE_MODEL.activities.length
      );
    });

    it('should get default model for O2C', () => {
      const model = getDefaultModel('O2C');
      expect(model).toBe(O2C_SIMPLE_MODEL);
    });

    it('should get default model for P2P', () => {
      const model = getDefaultModel('P2P');
      expect(model).toBe(P2P_SIMPLE_MODEL);
    });

    it('should get model by ID', () => {
      expect(getModelById('o2c-simple')).toBe(O2C_SIMPLE_MODEL);
      expect(getModelById('o2c-detailed')).toBe(O2C_DETAILED_MODEL);
      expect(getModelById('p2p-simple')).toBe(P2P_SIMPLE_MODEL);
      expect(getModelById('p2p-detailed')).toBe(P2P_DETAILED_MODEL);
      expect(getModelById('unknown')).toBeUndefined();
    });

    it('should list all models', () => {
      const models = listModels();
      expect(models).toHaveLength(4);
      expect(models.map(m => m.id)).toContain('o2c-simple');
      expect(models.map(m => m.id)).toContain('p2p-simple');
    });

    it('should list models by process type', () => {
      const o2cModels = listModels('O2C');
      expect(o2cModels).toHaveLength(2);
      expect(o2cModels.every(m => m.processType === 'O2C')).toBe(true);

      const p2pModels = listModels('P2P');
      expect(p2pModels).toHaveLength(2);
      expect(p2pModels.every(m => m.processType === 'P2P')).toBe(true);
    });

    it('should have activity mappings for BPI events', () => {
      // P2P model should map BPI Challenge 2019 activities
      expect(P2P_SIMPLE_MODEL.activityMappings['Create Purchase Order Item']).toBe('po_created');
      expect(P2P_SIMPLE_MODEL.activityMappings['Record Goods Receipt']).toBe('goods_receipt');
      expect(P2P_SIMPLE_MODEL.activityMappings['Record Invoice Receipt']).toBe('invoice_receipt');
      expect(P2P_SIMPLE_MODEL.activityMappings['Clear Invoice']).toBe('invoice_cleared');
    });
  });

  describe('Conformance Checker - O2C', () => {
    let checker: ConformanceChecker;

    beforeEach(() => {
      checker = createChecker(O2C_SIMPLE_MODEL);
    });

    it('should create checker with model', () => {
      expect(checker).toBeDefined();
      expect(checker.getModel()).toBe(O2C_SIMPLE_MODEL);
    });

    it('should detect conforming trace', () => {
      const trace: Trace = {
        caseId: 'TEST-001',
        events: [
          { activity: 'order_created', timestamp: '2024-01-01T10:00:00' },
          { activity: 'delivery_created', timestamp: '2024-01-02T10:00:00' },
          { activity: 'goods_issued', timestamp: '2024-01-03T10:00:00' },
          { activity: 'invoice_created', timestamp: '2024-01-04T10:00:00' },
        ],
      };

      const result = checker.analyzeTrace(trace);
      expect(result.conforming).toBe(true);
      expect(result.deviations).toHaveLength(0);
      expect(result.fitness).toBe(1);
    });

    it('should detect missing required activity', () => {
      const trace: Trace = {
        caseId: 'TEST-002',
        events: [
          { activity: 'order_created', timestamp: '2024-01-01T10:00:00' },
          { activity: 'delivery_created', timestamp: '2024-01-02T10:00:00' },
          // Missing goods_issued
          { activity: 'invoice_created', timestamp: '2024-01-04T10:00:00' },
        ],
      };

      const result = checker.analyzeTrace(trace);
      expect(result.conforming).toBe(false);
      expect(result.deviations.some(d => d.deviation_type === 'missing_activity')).toBe(true);
      expect(result.deviations.some(d => d.activity === 'goods_issued')).toBe(true);
    });

    it('should detect wrong order', () => {
      const trace: Trace = {
        caseId: 'TEST-003',
        events: [
          { activity: 'order_created', timestamp: '2024-01-01T10:00:00' },
          { activity: 'invoice_created', timestamp: '2024-01-02T10:00:00' }, // Wrong order
          { activity: 'delivery_created', timestamp: '2024-01-03T10:00:00' },
          { activity: 'goods_issued', timestamp: '2024-01-04T10:00:00' },
        ],
      };

      const result = checker.analyzeTrace(trace);
      expect(result.conforming).toBe(false);
      expect(result.deviations.some(d => d.deviation_type === 'wrong_order')).toBe(true);
    });

    it('should detect unexpected activity', () => {
      const trace: Trace = {
        caseId: 'TEST-004',
        events: [
          { activity: 'order_created', timestamp: '2024-01-01T10:00:00' },
          { activity: 'unknown_activity', timestamp: '2024-01-01T12:00:00' },
          { activity: 'delivery_created', timestamp: '2024-01-02T10:00:00' },
          { activity: 'goods_issued', timestamp: '2024-01-03T10:00:00' },
          { activity: 'invoice_created', timestamp: '2024-01-04T10:00:00' },
        ],
      };

      const result = checker.analyzeTrace(trace);
      expect(result.conforming).toBe(false);
      expect(result.deviations.some(d => d.deviation_type === 'unexpected_activity')).toBe(true);
      expect(result.deviations.some(d => d.actual === 'unknown_activity')).toBe(true);
    });

    it('should detect repeated activity', () => {
      const trace: Trace = {
        caseId: 'TEST-005',
        events: [
          { activity: 'order_created', timestamp: '2024-01-01T10:00:00' },
          { activity: 'delivery_created', timestamp: '2024-01-02T10:00:00' },
          { activity: 'delivery_created', timestamp: '2024-01-02T12:00:00' }, // Repeated
          { activity: 'goods_issued', timestamp: '2024-01-03T10:00:00' },
          { activity: 'invoice_created', timestamp: '2024-01-04T10:00:00' },
        ],
      };

      const result = checker.analyzeTrace(trace);
      expect(result.conforming).toBe(false);
      expect(result.deviations.some(d => d.deviation_type === 'repeated_activity')).toBe(true);
    });

    it('should map activity names correctly', () => {
      const trace: Trace = {
        caseId: 'TEST-006',
        events: [
          { activity: 'order', timestamp: '2024-01-01T10:00:00' }, // Should map to order_created
          { activity: 'delivery', timestamp: '2024-01-02T10:00:00' }, // Should map to delivery_created
          { activity: 'goods_issued', timestamp: '2024-01-03T10:00:00' },
          { activity: 'billing', timestamp: '2024-01-04T10:00:00' }, // Should map to invoice_created
        ],
      };

      const result = checker.analyzeTrace(trace);
      expect(result.actualSequence).toEqual([
        'order_created',
        'delivery_created',
        'goods_issued',
        'invoice_created',
      ]);
    });
  });

  describe('Conformance Checker - P2P', () => {
    let checker: ConformanceChecker;

    beforeEach(() => {
      checker = createChecker(P2P_SIMPLE_MODEL);
    });

    it('should create P2P checker', () => {
      expect(checker.getModel().processType).toBe('P2P');
    });

    it('should detect conforming P2P trace', () => {
      const trace: Trace = {
        caseId: 'PO-001',
        events: [
          { activity: 'Create Purchase Order Item', timestamp: '2024-01-01T10:00:00' },
          { activity: 'Record Goods Receipt', timestamp: '2024-01-02T10:00:00' },
          { activity: 'Record Invoice Receipt', timestamp: '2024-01-03T10:00:00' },
          { activity: 'Clear Invoice', timestamp: '2024-01-04T10:00:00' },
        ],
      };

      const result = checker.analyzeTrace(trace);
      expect(result.conforming).toBe(true);
      expect(result.fitness).toBe(1);
    });

    it('should handle service entry as goods receipt', () => {
      const trace: Trace = {
        caseId: 'PO-002',
        events: [
          { activity: 'Create Purchase Order Item', timestamp: '2024-01-01T10:00:00' },
          { activity: 'Record Service Entry Sheet', timestamp: '2024-01-02T10:00:00' }, // Mapped to GR
          { activity: 'Record Invoice Receipt', timestamp: '2024-01-03T10:00:00' },
          { activity: 'Clear Invoice', timestamp: '2024-01-04T10:00:00' },
        ],
      };

      const result = checker.analyzeTrace(trace);
      expect(result.actualSequence).toContain('goods_receipt');
    });
  });

  describe('Analyze Multiple Traces', () => {
    let checker: ConformanceChecker;

    beforeEach(() => {
      checker = createChecker(O2C_SIMPLE_MODEL);
    });

    it('should analyze multiple traces', () => {
      const traces: Trace[] = [
        {
          caseId: 'TEST-001',
          events: [
            { activity: 'order_created', timestamp: '2024-01-01T10:00:00' },
            { activity: 'delivery_created', timestamp: '2024-01-02T10:00:00' },
            { activity: 'goods_issued', timestamp: '2024-01-03T10:00:00' },
            { activity: 'invoice_created', timestamp: '2024-01-04T10:00:00' },
          ],
        },
        {
          caseId: 'TEST-002',
          events: [
            { activity: 'order_created', timestamp: '2024-01-01T10:00:00' },
            { activity: 'delivery_created', timestamp: '2024-01-02T10:00:00' },
            // Missing activities
          ],
        },
      ];

      const result = checker.analyzeTraces(traces);

      expect(result.total_cases).toBe(2);
      expect(result.conforming_cases).toBe(1);
      expect(result.non_conforming_cases).toBe(1);
      expect(result.conformance_rate).toBe(50);
    });

    it('should calculate fitness score correctly', () => {
      const traces: Trace[] = [
        {
          caseId: 'PERFECT',
          events: [
            { activity: 'order_created', timestamp: '2024-01-01T10:00:00' },
            { activity: 'delivery_created', timestamp: '2024-01-02T10:00:00' },
            { activity: 'goods_issued', timestamp: '2024-01-03T10:00:00' },
            { activity: 'invoice_created', timestamp: '2024-01-04T10:00:00' },
          ],
        },
      ];

      const result = checker.analyzeTraces(traces);
      expect(result.fitness_score).toBe(1);
    });

    it('should aggregate severity counts', () => {
      const traces: Trace[] = [
        {
          caseId: 'BAD-001',
          events: [
            { activity: 'order_created', timestamp: '2024-01-01T10:00:00' },
            { activity: 'invoice_created', timestamp: '2024-01-02T10:00:00' }, // Wrong order - critical
          ],
        },
        {
          caseId: 'BAD-002',
          events: [
            { activity: 'order_created', timestamp: '2024-01-01T10:00:00' },
            { activity: 'unknown', timestamp: '2024-01-02T10:00:00' }, // Unexpected - major
          ],
        },
      ];

      const result = checker.analyzeTraces(traces);

      expect(result.severity_summary.critical).toBeGreaterThan(0);
      expect(result.severity_summary.major).toBeGreaterThan(0);
    });

    it('should identify top deviation patterns', () => {
      const traces: Trace[] = Array.from({ length: 5 }, (_, i) => ({
        caseId: `TEST-${i}`,
        events: [
          { activity: 'order_created', timestamp: '2024-01-01T10:00:00' },
          { activity: 'common_unknown', timestamp: '2024-01-02T10:00:00' }, // Same unexpected activity
        ],
      }));

      const result = checker.analyzeTraces(traces);

      expect(result.top_deviations.length).toBeGreaterThan(0);
      expect(result.top_deviations[0]!.count).toBe(5);
    });

    it('should include metadata', () => {
      const traces: Trace[] = [
        {
          caseId: 'TEST',
          events: [{ activity: 'order_created', timestamp: '2024-01-01T10:00:00' }],
        },
      ];

      const result = checker.analyzeTraces(traces);

      expect(result.metadata).toBeDefined();
      expect(result.metadata.reference_model).toBe(O2C_SIMPLE_MODEL.name);
      expect(result.metadata.model_version).toBe(O2C_SIMPLE_MODEL.version);
      expect(result.metadata.analyzed_at).toBeDefined();
    });
  });

  describe('Severity Classification', () => {
    let checker: ConformanceChecker;

    beforeEach(() => {
      checker = createChecker(O2C_SIMPLE_MODEL);
    });

    it('should classify missing required activity as critical', () => {
      const trace: Trace = {
        caseId: 'TEST',
        events: [
          { activity: 'order_created', timestamp: '2024-01-01T10:00:00' },
          // Missing all required activities
        ],
      };

      const result = checker.analyzeTrace(trace);
      const missingDeviations = result.deviations.filter(
        d => d.deviation_type === 'missing_activity'
      );

      expect(missingDeviations.some(d => d.severity === 'critical')).toBe(true);
    });

    it('should classify wrong order as critical', () => {
      const trace: Trace = {
        caseId: 'TEST',
        events: [
          { activity: 'invoice_created', timestamp: '2024-01-01T10:00:00' },
          { activity: 'order_created', timestamp: '2024-01-02T10:00:00' },
        ],
      };

      const result = checker.analyzeTrace(trace);
      const wrongOrderDeviations = result.deviations.filter(
        d => d.deviation_type === 'wrong_order'
      );

      expect(wrongOrderDeviations.some(d => d.severity === 'critical')).toBe(true);
    });

    it('should classify unexpected activity as major', () => {
      const trace: Trace = {
        caseId: 'TEST',
        events: [
          { activity: 'order_created', timestamp: '2024-01-01T10:00:00' },
          { activity: 'random_activity', timestamp: '2024-01-02T10:00:00' },
        ],
      };

      const result = checker.analyzeTrace(trace);
      const unexpectedDeviations = result.deviations.filter(
        d => d.deviation_type === 'unexpected_activity'
      );

      expect(unexpectedDeviations[0]!.severity).toBe('major');
    });

    it('should classify repeated activity as minor', () => {
      const trace: Trace = {
        caseId: 'TEST',
        events: [
          { activity: 'order_created', timestamp: '2024-01-01T10:00:00' },
          { activity: 'order_created', timestamp: '2024-01-01T12:00:00' },
          { activity: 'delivery_created', timestamp: '2024-01-02T10:00:00' },
          { activity: 'goods_issued', timestamp: '2024-01-03T10:00:00' },
          { activity: 'invoice_created', timestamp: '2024-01-04T10:00:00' },
        ],
      };

      const result = checker.analyzeTrace(trace);
      const repeatedDeviations = result.deviations.filter(
        d => d.deviation_type === 'repeated_activity'
      );

      expect(repeatedDeviations[0]!.severity).toBe('minor');
    });
  });
});
