/**
 * Predictive Monitoring Module Tests
 */

import {
  extractFeatures,
  extractBatchFeatures,
  getFeatureNames,
  featuresToArray,
  predict,
  predictBatch,
  PREDICTION_TYPES,
  MODEL_DESCRIPTIONS,
  predictOutcomes,
  assessRisk,
  meetsRiskThreshold,
  getOverallRiskLevel,
  calculateRiskDistribution,
  getHighRiskCases,
  getTopRiskFactors,
  generateAlerts,
  calculateCompositeRiskScore,
  rankByRisk,
  formatRiskLevel,
  getRiskColor,
  ProcessCase,
  PredictionResult,
  RISK_THRESHOLDS,
} from '../index.js';

describe('Predictive Monitoring Module', () => {
  // Sample test data
  const createSampleCase = (
    caseId: string,
    events: Array<{ activity: string; timestamp: string; resource?: string }>
  ): ProcessCase => ({
    caseId,
    events: events.map(e => {
      const event: ProcessCase['events'][0] = {
        caseId,
        activity: e.activity,
        timestamp: e.timestamp,
      };
      if (e.resource !== undefined) {
        event.resource = e.resource;
      }
      return event;
    }),
  });

  const healthyCase = createSampleCase('HEALTHY-001', [
    { activity: 'order_created', timestamp: '2024-01-01T10:00:00Z' },
    { activity: 'credit_check', timestamp: '2024-01-01T11:00:00Z' },
    { activity: 'delivery_created', timestamp: '2024-01-02T10:00:00Z' },
    { activity: 'goods_issued', timestamp: '2024-01-03T10:00:00Z' },
    { activity: 'invoice_created', timestamp: '2024-01-04T10:00:00Z' },
  ]);

  const riskyCase = createSampleCase('RISKY-001', [
    { activity: 'order_created', timestamp: '2024-01-01T10:00:00Z' },
    { activity: 'credit_hold', timestamp: '2024-01-02T10:00:00Z' },
    { activity: 'order_created', timestamp: '2024-01-05T10:00:00Z' }, // Rework
    { activity: 'credit_check', timestamp: '2024-01-06T10:00:00Z' },
  ]);

  const stalledCase = createSampleCase('STALLED-001', [
    { activity: 'order_created', timestamp: '2023-12-01T10:00:00Z' }, // Old case
    { activity: 'delivery_created', timestamp: '2023-12-02T10:00:00Z' },
  ]);

  describe('Feature Extraction', () => {
    it('should extract features from a case', () => {
      const features = extractFeatures(healthyCase);

      expect(features.caseId).toBe('HEALTHY-001');
      expect(features.eventCount).toBe(5);
      expect(features.uniqueActivities).toBe(5);
    });

    it('should detect activity milestones', () => {
      const features = extractFeatures(healthyCase);

      expect(features.hasCreditCheck).toBe(true);
      expect(features.hasDeliveryCreated).toBe(true);
      expect(features.hasGoodsIssued).toBe(true);
      expect(features.hasInvoiceCreated).toBe(true);
    });

    it('should detect credit hold', () => {
      const features = extractFeatures(riskyCase);

      expect(features.hasCreditHold).toBe(true);
    });

    it('should detect rework', () => {
      const features = extractFeatures(riskyCase);

      expect(features.hasRework).toBe(true);
      expect(features.loopCount).toBeGreaterThan(0);
    });

    it('should calculate progress score', () => {
      const healthyFeatures = extractFeatures(healthyCase);
      const riskyFeatures = extractFeatures(riskyCase);

      expect(healthyFeatures.progressScore).toBeGreaterThan(riskyFeatures.progressScore);
    });

    it('should identify risk indicators', () => {
      const features = extractFeatures(riskyCase);

      expect(features.riskIndicators.length).toBeGreaterThan(0);
    });

    it('should calculate complexity score', () => {
      const features = extractFeatures(riskyCase);

      expect(features.complexityScore).toBeGreaterThan(0);
      expect(features.complexityScore).toBeLessThanOrEqual(1);
    });

    it('should handle empty case', () => {
      const emptyCase: ProcessCase = { caseId: 'EMPTY', events: [] };
      const features = extractFeatures(emptyCase);

      expect(features.eventCount).toBe(0);
      expect(features.progressScore).toBe(0);
    });

    it('should extract batch features', () => {
      const cases = [healthyCase, riskyCase];
      const batchFeatures = extractBatchFeatures(cases);

      expect(batchFeatures).toHaveLength(2);
      expect(batchFeatures[0]!.caseId).toBe('HEALTHY-001');
      expect(batchFeatures[1]!.caseId).toBe('RISKY-001');
    });

    it('should return feature names', () => {
      const names = getFeatureNames();

      expect(names.length).toBeGreaterThan(20);
      expect(names).toContain('caseAge');
      expect(names).toContain('progressScore');
    });

    it('should convert features to array', () => {
      const features = extractFeatures(healthyCase);
      const array = featuresToArray(features);

      expect(Array.isArray(array)).toBe(true);
      expect(array.length).toBe(getFeatureNames().length);
    });
  });

  describe('Prediction Models', () => {
    it('should have all prediction types defined', () => {
      expect(PREDICTION_TYPES).toContain('late_delivery');
      expect(PREDICTION_TYPES).toContain('credit_hold');
      expect(PREDICTION_TYPES).toContain('completion_time');
    });

    it('should have model descriptions', () => {
      expect(MODEL_DESCRIPTIONS.late_delivery).toBeDefined();
      expect(MODEL_DESCRIPTIONS.credit_hold).toBeDefined();
      expect(MODEL_DESCRIPTIONS.completion_time).toBeDefined();
    });

    it('should predict late delivery', () => {
      const features = extractFeatures(stalledCase);
      const result = predict(features, 'late_delivery');

      expect(result.predictionType).toBe('late_delivery');
      expect(result.probability).toBeGreaterThanOrEqual(0);
      expect(result.probability).toBeLessThanOrEqual(1);
      expect(result.riskLevel).toBeDefined();
    });

    it('should predict credit hold', () => {
      const features = extractFeatures(riskyCase);
      const result = predict(features, 'credit_hold');

      expect(result.predictionType).toBe('credit_hold');
      // Risky case with credit hold should have high probability
      expect(result.probability).toBe(1); // Already on hold
    });

    it('should predict completion time', () => {
      const features = extractFeatures(healthyCase);
      const result = predict(features, 'completion_time');

      expect(result.predictionType).toBe('completion_time');
      expect(typeof result.prediction).toBe('number');
    });

    it('should return factors with predictions', () => {
      const features = extractFeatures(riskyCase);
      const result = predict(features, 'late_delivery');

      expect(result.factors.length).toBeGreaterThan(0);
      expect(result.factors[0]).toHaveProperty('name');
      expect(result.factors[0]).toHaveProperty('description');
    });

    it('should return recommendations', () => {
      const features = extractFeatures(riskyCase);
      const result = predict(features, 'late_delivery');

      expect(Array.isArray(result.recommendations)).toBe(true);
    });

    it('should batch predict', () => {
      const cases = [healthyCase, riskyCase];
      const features = extractBatchFeatures(cases);
      const results = predictBatch(features, 'late_delivery');

      expect(results).toHaveLength(2);
    });
  });

  describe('Risk Scoring', () => {
    it('should check risk threshold', () => {
      expect(meetsRiskThreshold('critical', 'high')).toBe(true);
      expect(meetsRiskThreshold('high', 'high')).toBe(true);
      expect(meetsRiskThreshold('medium', 'high')).toBe(false);
      expect(meetsRiskThreshold('low', 'high')).toBe(false);
    });

    it('should get overall risk level', () => {
      const predictions: PredictionResult[] = [
        {
          caseId: 'A',
          predictionType: 'late_delivery',
          prediction: true,
          probability: 0.8,
          riskLevel: 'high',
          factors: [],
          recommendations: [],
          timestamp: new Date().toISOString(),
        },
        {
          caseId: 'A',
          predictionType: 'credit_hold',
          prediction: false,
          probability: 0.2,
          riskLevel: 'low',
          factors: [],
          recommendations: [],
          timestamp: new Date().toISOString(),
        },
      ];

      expect(getOverallRiskLevel(predictions)).toBe('high');
    });

    it('should calculate risk distribution', () => {
      const predictions: PredictionResult[] = [
        {
          caseId: 'A',
          predictionType: 'late_delivery',
          prediction: true,
          probability: 0.8,
          riskLevel: 'high',
          factors: [],
          recommendations: [],
          timestamp: '',
        },
        {
          caseId: 'B',
          predictionType: 'late_delivery',
          prediction: false,
          probability: 0.2,
          riskLevel: 'low',
          factors: [],
          recommendations: [],
          timestamp: '',
        },
        {
          caseId: 'C',
          predictionType: 'late_delivery',
          prediction: true,
          probability: 0.9,
          riskLevel: 'critical',
          factors: [],
          recommendations: [],
          timestamp: '',
        },
      ];

      const distribution = calculateRiskDistribution(predictions);

      expect(distribution.high).toBe(1);
      expect(distribution.low).toBe(1);
      expect(distribution.critical).toBe(1);
      expect(distribution.medium).toBe(0);
    });

    it('should get high risk cases', () => {
      const predictions: PredictionResult[] = [
        {
          caseId: 'HIGH',
          predictionType: 'late_delivery',
          prediction: true,
          probability: 0.8,
          riskLevel: 'high',
          factors: [],
          recommendations: [],
          timestamp: '',
        },
        {
          caseId: 'LOW',
          predictionType: 'late_delivery',
          prediction: false,
          probability: 0.2,
          riskLevel: 'low',
          factors: [],
          recommendations: [],
          timestamp: '',
        },
      ];

      const highRisk = getHighRiskCases(predictions, 'high');

      expect(highRisk).toContain('HIGH');
      expect(highRisk).not.toContain('LOW');
    });

    it('should extract top risk factors', () => {
      const predictions: PredictionResult[] = [
        {
          caseId: 'A',
          predictionType: 'late_delivery',
          prediction: true,
          probability: 0.8,
          riskLevel: 'high',
          factors: [
            {
              name: 'stalled',
              value: true,
              impact: 'negative',
              weight: 0.2,
              description: 'Stalled',
            },
            {
              name: 'credit_hold',
              value: true,
              impact: 'negative',
              weight: 0.3,
              description: 'Hold',
            },
          ],
          recommendations: [],
          timestamp: '',
        },
        {
          caseId: 'B',
          predictionType: 'late_delivery',
          prediction: true,
          probability: 0.7,
          riskLevel: 'high',
          factors: [
            {
              name: 'stalled',
              value: true,
              impact: 'negative',
              weight: 0.2,
              description: 'Stalled',
            },
          ],
          recommendations: [],
          timestamp: '',
        },
      ];

      const topFactors = getTopRiskFactors(predictions);

      expect(topFactors[0]!.factor).toBe('stalled');
      expect(topFactors[0]!.count).toBe(2);
    });

    it('should generate alerts', () => {
      const features = extractFeatures(riskyCase);
      const predictions = [predict(features, 'credit_hold')];

      const alerts = generateAlerts(predictions, {
        enabled: true,
        riskThreshold: 'high',
        predictionTypes: ['credit_hold'],
      });

      expect(alerts.length).toBeGreaterThan(0);
      expect(alerts[0]!.caseId).toBe('RISKY-001');
    });

    it('should not generate alerts when disabled', () => {
      const features = extractFeatures(riskyCase);
      const predictions = [predict(features, 'credit_hold')];

      const alerts = generateAlerts(predictions, {
        enabled: false,
        riskThreshold: 'high',
        predictionTypes: ['credit_hold'],
      });

      expect(alerts).toHaveLength(0);
    });

    it('should calculate composite risk score', () => {
      const predictions: PredictionResult[] = [
        {
          caseId: 'A',
          predictionType: 'late_delivery',
          prediction: true,
          probability: 0.8,
          riskLevel: 'high',
          factors: [],
          recommendations: [],
          timestamp: '',
        },
        {
          caseId: 'A',
          predictionType: 'credit_hold',
          prediction: false,
          probability: 0.4,
          riskLevel: 'medium',
          factors: [],
          recommendations: [],
          timestamp: '',
        },
      ];

      const score = calculateCompositeRiskScore(predictions);

      expect(score).toBeGreaterThan(0);
      expect(score).toBeLessThanOrEqual(100);
    });

    it('should rank cases by risk', () => {
      const predictions: PredictionResult[] = [
        {
          caseId: 'LOW',
          predictionType: 'late_delivery',
          prediction: false,
          probability: 0.1,
          riskLevel: 'low',
          factors: [],
          recommendations: [],
          timestamp: '',
        },
        {
          caseId: 'HIGH',
          predictionType: 'late_delivery',
          prediction: true,
          probability: 0.9,
          riskLevel: 'critical',
          factors: [],
          recommendations: [],
          timestamp: '',
        },
        {
          caseId: 'MED',
          predictionType: 'late_delivery',
          prediction: true,
          probability: 0.5,
          riskLevel: 'medium',
          factors: [],
          recommendations: [],
          timestamp: '',
        },
      ];

      const ranked = rankByRisk(predictions);

      expect(ranked[0]!.caseId).toBe('HIGH');
      expect(ranked[2]!.caseId).toBe('LOW');
    });
  });

  describe('Formatting', () => {
    it('should format risk level', () => {
      const formatted = formatRiskLevel('critical');

      expect(formatted).toContain('Critical');
      expect(formatted).toContain('🔴');
    });

    it('should get risk color', () => {
      expect(getRiskColor('low')).toBe('#4CAF50');
      expect(getRiskColor('critical')).toBe('#F44336');
    });
  });

  describe('Integration', () => {
    it('should run full prediction pipeline', () => {
      const cases = [healthyCase, riskyCase, stalledCase];
      const { result } = predictOutcomes(cases, 'late_delivery');

      expect(result.predictions).toHaveLength(3);
      expect(result.summary.totalCases).toBe(3);
      expect(result.summary.riskDistribution).toBeDefined();
    });

    it('should assess risk for single case', () => {
      const assessment = assessRisk(riskyCase);

      expect(assessment.lateDeliveryRisk).toBeDefined();
      expect(assessment.creditHoldRisk).toBeDefined();
      expect(assessment.estimatedCompletion).toBeDefined();
      expect(assessment.overallRisk).toBeDefined();
      expect(Array.isArray(assessment.recommendations)).toBe(true);
    });

    it('should handle P2P process', () => {
      const p2pCase = createSampleCase('P2P-001', [
        { activity: 'purchase_requisition', timestamp: '2024-01-01T10:00:00Z' },
        { activity: 'create_purchase_order', timestamp: '2024-01-02T10:00:00Z' },
        { activity: 'record_goods_receipt', timestamp: '2024-01-05T10:00:00Z' },
        { activity: 'record_service_entry', timestamp: '2024-01-06T10:00:00Z' },
        { activity: 'record_invoice_receipt', timestamp: '2024-01-07T10:00:00Z' },
      ]);

      const features = extractFeatures(p2pCase);

      expect(features.hasPurchaseOrder).toBe(true);
      expect(features.hasGoodsReceipt).toBe(true);
      expect(features.hasServiceEntry).toBe(true);
    });
  });

  describe('Risk Thresholds', () => {
    it('should have all risk levels defined', () => {
      expect(RISK_THRESHOLDS.low).toBeDefined();
      expect(RISK_THRESHOLDS.medium).toBeDefined();
      expect(RISK_THRESHOLDS.high).toBeDefined();
      expect(RISK_THRESHOLDS.critical).toBeDefined();
    });

    it('should have non-overlapping thresholds', () => {
      expect(RISK_THRESHOLDS.low.max).toBe(RISK_THRESHOLDS.medium.min);
      expect(RISK_THRESHOLDS.medium.max).toBe(RISK_THRESHOLDS.high.min);
      expect(RISK_THRESHOLDS.high.max).toBe(RISK_THRESHOLDS.critical.min);
    });
  });
});
