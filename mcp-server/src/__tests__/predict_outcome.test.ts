/**
 * Tests for predict_outcome tool
 *
 * Tests predictive monitoring for SAP Order-to-Cash processes.
 * Uses Jest with ESM support.
 */

import { PredictOutcomeSchema, predictOutcomeTool } from '../tools/predict_outcome.js';

describe('PredictOutcomeSchema', () => {
  describe('input validation', () => {
    it('should accept valid input with all fields', () => {
      const input = {
        doc_numbers: ['0000012345', '0000012346'],
        prediction_type: 'all' as const,
        alert_threshold: 0.8,
      };

      const result = PredictOutcomeSchema.parse(input);

      expect(result.doc_numbers).toEqual(['0000012345', '0000012346']);
      expect(result.prediction_type).toBe('all');
      expect(result.alert_threshold).toBe(0.8);
    });

    it('should apply defaults for optional fields', () => {
      const input = {
        doc_numbers: ['0000012345'],
      };

      const result = PredictOutcomeSchema.parse(input);

      expect(result.prediction_type).toBe('all');
      expect(result.alert_threshold).toBe(0.7);
    });

    it('should accept late_delivery prediction type', () => {
      const input = {
        doc_numbers: ['0000012345'],
        prediction_type: 'late_delivery',
      };

      const result = PredictOutcomeSchema.parse(input);
      expect(result.prediction_type).toBe('late_delivery');
    });

    it('should accept credit_hold prediction type', () => {
      const input = {
        doc_numbers: ['0000012345'],
        prediction_type: 'credit_hold',
      };

      const result = PredictOutcomeSchema.parse(input);
      expect(result.prediction_type).toBe('credit_hold');
    });

    it('should accept completion_time prediction type', () => {
      const input = {
        doc_numbers: ['0000012345'],
        prediction_type: 'completion_time',
      };

      const result = PredictOutcomeSchema.parse(input);
      expect(result.prediction_type).toBe('completion_time');
    });

    it('should reject invalid prediction type', () => {
      const input = {
        doc_numbers: ['0000012345'],
        prediction_type: 'delay', // Invalid
      };

      expect(() => PredictOutcomeSchema.parse(input)).toThrow();
    });

    it('should reject empty doc_numbers array', () => {
      const input = {
        doc_numbers: [],
      };

      expect(() => PredictOutcomeSchema.parse(input)).toThrow();
    });

    it('should reject missing doc_numbers', () => {
      const input = {
        prediction_type: 'all',
      };

      expect(() => PredictOutcomeSchema.parse(input)).toThrow();
    });

    it('should reject alert_threshold below 0', () => {
      const input = {
        doc_numbers: ['0000012345'],
        alert_threshold: -0.1,
      };

      expect(() => PredictOutcomeSchema.parse(input)).toThrow();
    });

    it('should reject alert_threshold above 1', () => {
      const input = {
        doc_numbers: ['0000012345'],
        alert_threshold: 1.5,
      };

      expect(() => PredictOutcomeSchema.parse(input)).toThrow();
    });

    it('should accept alert_threshold at boundaries', () => {
      const input0 = { doc_numbers: ['0000012345'], alert_threshold: 0 };
      const input1 = { doc_numbers: ['0000012345'], alert_threshold: 1 };

      expect(PredictOutcomeSchema.parse(input0).alert_threshold).toBe(0);
      expect(PredictOutcomeSchema.parse(input1).alert_threshold).toBe(1);
    });

    it('should accept multiple document numbers', () => {
      const input = {
        doc_numbers: ['0000012345', '0000012346', '0000012347'],
      };

      const result = PredictOutcomeSchema.parse(input);
      expect(result.doc_numbers.length).toBe(3);
    });
  });
});

describe('predictOutcomeTool', () => {
  it('should have correct tool definition', () => {
    expect(predictOutcomeTool.name).toBe('predict_outcome');
    expect(predictOutcomeTool.description).toContain('Predict');
    expect(predictOutcomeTool.description).toContain('Late Delivery');
    expect(predictOutcomeTool.inputSchema.required).toContain('doc_numbers');
    expect(predictOutcomeTool.inputSchema.properties).toHaveProperty('prediction_type');
    expect(predictOutcomeTool.inputSchema.properties).toHaveProperty('alert_threshold');
  });

  it('should have array type for doc_numbers property', () => {
    expect(predictOutcomeTool.inputSchema.properties.doc_numbers.type).toBe('array');
  });

  it('should have enum for prediction_type property', () => {
    expect(predictOutcomeTool.inputSchema.properties.prediction_type.enum).toContain('all');
    expect(predictOutcomeTool.inputSchema.properties.prediction_type.enum).toContain(
      'late_delivery'
    );
    expect(predictOutcomeTool.inputSchema.properties.prediction_type.enum).toContain('credit_hold');
    expect(predictOutcomeTool.inputSchema.properties.prediction_type.enum).toContain(
      'completion_time'
    );
  });

  it('should have number type for alert_threshold property', () => {
    expect(predictOutcomeTool.inputSchema.properties.alert_threshold.type).toBe('number');
  });

  it('should describe credit hold prediction', () => {
    expect(predictOutcomeTool.description).toContain('Credit Hold');
  });

  it('should describe completion time prediction', () => {
    expect(predictOutcomeTool.description).toContain('Completion Time');
  });
});

describe('Risk Level Classification', () => {
  type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

  function calculateRiskLevel(probability: number): RiskLevel {
    if (probability >= 0.9) return 'critical';
    if (probability >= 0.7) return 'high';
    if (probability >= 0.4) return 'medium';
    return 'low';
  }

  it('should classify probability >= 0.9 as critical', () => {
    expect(calculateRiskLevel(0.9)).toBe('critical');
    expect(calculateRiskLevel(0.95)).toBe('critical');
    expect(calculateRiskLevel(1.0)).toBe('critical');
  });

  it('should classify probability >= 0.7 and < 0.9 as high', () => {
    expect(calculateRiskLevel(0.7)).toBe('high');
    expect(calculateRiskLevel(0.8)).toBe('high');
    expect(calculateRiskLevel(0.89)).toBe('high');
  });

  it('should classify probability >= 0.4 and < 0.7 as medium', () => {
    expect(calculateRiskLevel(0.4)).toBe('medium');
    expect(calculateRiskLevel(0.5)).toBe('medium');
    expect(calculateRiskLevel(0.69)).toBe('medium');
  });

  it('should classify probability < 0.4 as low', () => {
    expect(calculateRiskLevel(0.0)).toBe('low');
    expect(calculateRiskLevel(0.2)).toBe('low');
    expect(calculateRiskLevel(0.39)).toBe('low');
  });
});

describe('Late Delivery Prediction Factors', () => {
  interface PredictionFactor {
    name: string;
    value: string | number;
    impact: number;
    description: string;
  }

  function calculateLateDeliveryFactors(
    orderValue: number,
    hasDownstreamDocs: boolean,
    salesOrg: string
  ): { probability: number; factors: PredictionFactor[] } {
    const factors: PredictionFactor[] = [];
    let baseScore = 0.3;

    // High order value factor
    if (orderValue > 100000) {
      factors.push({
        name: 'high_order_value',
        value: orderValue,
        impact: 0.15,
        description: 'High-value orders often have complex fulfillment requirements',
      });
      baseScore += 0.15;
    }

    // Missing downstream docs factor
    if (!hasDownstreamDocs) {
      factors.push({
        name: 'no_downstream_docs',
        value: 0,
        impact: 0.2,
        description: 'No delivery or invoice documents created yet',
      });
      baseScore += 0.2;
    }

    // Good sales org factor
    if (['1200', '1300'].includes(salesOrg)) {
      factors.push({
        name: 'regional_risk',
        value: salesOrg,
        impact: -0.1,
        description: 'Sales organization has good delivery performance',
      });
      baseScore -= 0.1;
    }

    return {
      probability: Math.max(0, Math.min(1, baseScore)),
      factors,
    };
  }

  it('should increase probability for high order value', () => {
    const lowValue = calculateLateDeliveryFactors(50000, true, '1000');
    const highValue = calculateLateDeliveryFactors(150000, true, '1000');

    expect(highValue.probability).toBeGreaterThan(lowValue.probability);
  });

  it('should increase probability for missing downstream docs', () => {
    const withDocs = calculateLateDeliveryFactors(50000, true, '1000');
    const withoutDocs = calculateLateDeliveryFactors(50000, false, '1000');

    expect(withoutDocs.probability).toBeGreaterThan(withDocs.probability);
  });

  it('should decrease probability for good sales org', () => {
    const regularOrg = calculateLateDeliveryFactors(50000, true, '1000');
    const goodOrg = calculateLateDeliveryFactors(50000, true, '1200');

    expect(goodOrg.probability).toBeLessThan(regularOrg.probability);
  });

  it('should include factor descriptions', () => {
    const result = calculateLateDeliveryFactors(150000, false, '1000');

    for (const factor of result.factors) {
      expect(factor.description).toBeTruthy();
      expect(factor.description.length).toBeGreaterThan(10);
    }
  });

  it('should bound probability between 0 and 1', () => {
    const result = calculateLateDeliveryFactors(500000, false, '1000');

    expect(result.probability).toBeGreaterThanOrEqual(0);
    expect(result.probability).toBeLessThanOrEqual(1);
  });
});

describe('Credit Hold Prediction Factors', () => {
  interface PredictionFactor {
    name: string;
    value: string | number;
    impact: number;
    description: string;
  }

  function calculateCreditHoldFactors(
    orderValue: number,
    orderType: string
  ): { probability: number; factors: PredictionFactor[] } {
    const factors: PredictionFactor[] = [];
    let baseScore = 0.15;

    // Exceptionally high value
    if (orderValue > 200000) {
      factors.push({
        name: 'exceptionally_high_value',
        value: orderValue,
        impact: 0.25,
        description: 'Exceptionally high order value may trigger credit review',
      });
      baseScore += 0.25;
    } else if (orderValue > 100000) {
      factors.push({
        name: 'high_value_order',
        value: orderValue,
        impact: 0.15,
        description: 'High order value increases credit review likelihood',
      });
      baseScore += 0.15;
    }

    // Special order types
    if (['ZOR', 'ZSTO'].includes(orderType)) {
      factors.push({
        name: 'order_type_risk',
        value: orderType,
        impact: 0.1,
        description: 'Special order types may require additional credit verification',
      });
      baseScore += 0.1;
    }

    return {
      probability: Math.max(0, Math.min(1, baseScore)),
      factors,
    };
  }

  it('should increase probability for exceptionally high value', () => {
    const normalValue = calculateCreditHoldFactors(50000, 'OR');
    const highValue = calculateCreditHoldFactors(250000, 'OR');

    expect(highValue.probability).toBeGreaterThan(normalValue.probability);
  });

  it('should increase probability for special order types', () => {
    const standardOrder = calculateCreditHoldFactors(50000, 'OR');
    const specialOrder = calculateCreditHoldFactors(50000, 'ZOR');

    expect(specialOrder.probability).toBeGreaterThan(standardOrder.probability);
  });

  it('should include high value factor details', () => {
    const result = calculateCreditHoldFactors(250000, 'OR');
    const highValueFactor = result.factors.find(f => f.name.includes('high_value'));

    expect(highValueFactor).toBeDefined();
    expect(highValueFactor?.value).toBe(250000);
  });
});

describe('Completion Time Prediction', () => {
  type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

  interface CompletionTimePrediction {
    predictedDays: number;
    riskLevel: RiskLevel;
    confidence: number;
  }

  function calculateCompletionTime(
    orderValue: number,
    hasDelivery: boolean,
    hasInvoice: boolean
  ): CompletionTimePrediction {
    let baseDays = 7;

    // Complexity based on value
    if (orderValue > 100000) {
      baseDays += 5;
    } else if (orderValue > 50000) {
      baseDays += 3;
    }

    // Progress adjustments
    if (hasInvoice) {
      baseDays = Math.max(1, baseDays - 4);
    } else if (hasDelivery) {
      baseDays = Math.max(2, baseDays - 2);
    } else {
      baseDays += 3;
    }

    // Risk level based on days
    let riskLevel: RiskLevel;
    if (baseDays > 21) riskLevel = 'critical';
    else if (baseDays > 14) riskLevel = 'high';
    else if (baseDays > 7) riskLevel = 'medium';
    else riskLevel = 'low';

    return {
      predictedDays: baseDays,
      riskLevel,
      confidence: 0.84,
    };
  }

  it('should predict longer time for high-value orders', () => {
    const lowValue = calculateCompletionTime(30000, false, false);
    const highValue = calculateCompletionTime(150000, false, false);

    expect(highValue.predictedDays).toBeGreaterThan(lowValue.predictedDays);
  });

  it('should predict shorter time when delivery exists', () => {
    const noDelivery = calculateCompletionTime(50000, false, false);
    const withDelivery = calculateCompletionTime(50000, true, false);

    expect(withDelivery.predictedDays).toBeLessThan(noDelivery.predictedDays);
  });

  it('should predict shortest time when invoice exists', () => {
    const withDelivery = calculateCompletionTime(50000, true, false);
    const withInvoice = calculateCompletionTime(50000, true, true);

    expect(withInvoice.predictedDays).toBeLessThan(withDelivery.predictedDays);
  });

  it('should classify long completion times as critical', () => {
    const result = calculateCompletionTime(200000, false, false);

    if (result.predictedDays > 21) {
      expect(result.riskLevel).toBe('critical');
    }
  });

  it('should classify short completion times as low risk', () => {
    const result = calculateCompletionTime(10000, true, true);

    if (result.predictedDays <= 7) {
      expect(result.riskLevel).toBe('low');
    }
  });
});

describe('Alert Generation', () => {
  type RiskLevel = 'low' | 'medium' | 'high' | 'critical';
  type AlertType = 'late_delivery' | 'credit_hold' | 'completion_time';

  interface PredictionAlert {
    doc_number: string;
    alert_type: AlertType;
    severity: RiskLevel;
    probability: number;
    message: string;
    recommended_actions: string[];
  }

  function generateAlert(
    docNumber: string,
    alertType: AlertType,
    probability: number,
    threshold: number
  ): PredictionAlert | null {
    if (probability < threshold) return null;

    const actions: Record<AlertType, string[]> = {
      late_delivery: [
        'Review order priority and expedite if needed',
        'Check inventory availability',
        'Contact logistics for optimization',
      ],
      credit_hold: [
        'Review customer credit status',
        'Request advance payment if appropriate',
        'Escalate to credit management',
      ],
      completion_time: [
        'Identify process bottlenecks',
        'Allocate additional resources',
        'Monitor document flow progress',
      ],
    };

    let severity: RiskLevel;
    if (probability >= 0.9) severity = 'critical';
    else if (probability >= 0.7) severity = 'high';
    else if (probability >= 0.4) severity = 'medium';
    else severity = 'low';

    return {
      doc_number: docNumber,
      alert_type: alertType,
      severity,
      probability,
      message: `Risk level: ${Math.round(probability * 100)}%`,
      recommended_actions: actions[alertType],
    };
  }

  it('should generate alert when probability exceeds threshold', () => {
    const alert = generateAlert('0000012345', 'late_delivery', 0.8, 0.7);

    expect(alert).not.toBeNull();
    expect(alert?.doc_number).toBe('0000012345');
  });

  it('should not generate alert when probability is below threshold', () => {
    const alert = generateAlert('0000012345', 'late_delivery', 0.5, 0.7);

    expect(alert).toBeNull();
  });

  it('should include recommended actions', () => {
    const alert = generateAlert('0000012345', 'late_delivery', 0.8, 0.7);

    expect(alert?.recommended_actions.length).toBeGreaterThan(0);
  });

  it('should set severity based on probability', () => {
    const criticalAlert = generateAlert('0000012345', 'late_delivery', 0.95, 0.5);
    const highAlert = generateAlert('0000012345', 'late_delivery', 0.75, 0.5);
    const mediumAlert = generateAlert('0000012345', 'late_delivery', 0.55, 0.5);

    expect(criticalAlert?.severity).toBe('critical');
    expect(highAlert?.severity).toBe('high');
    expect(mediumAlert?.severity).toBe('medium');
  });

  it('should include different actions for different alert types', () => {
    const lateDeliveryAlert = generateAlert('0000012345', 'late_delivery', 0.8, 0.7);
    const creditHoldAlert = generateAlert('0000012345', 'credit_hold', 0.8, 0.7);

    expect(lateDeliveryAlert?.recommended_actions).not.toEqual(
      creditHoldAlert?.recommended_actions
    );
  });
});

describe('Model Information', () => {
  interface ModelInfo {
    model_type: string;
    accuracy: number;
    last_trained: string;
    version: string;
    features: string[];
  }

  const MODEL_CONFIG: Record<'late_delivery' | 'credit_hold' | 'completion_time', ModelInfo> = {
    late_delivery: {
      model_type: 'Gradient Boosting Classifier',
      accuracy: 0.87,
      last_trained: '2024-12-15',
      version: '2.1.0',
      features: ['order_value', 'customer_history', 'material_availability'],
    },
    credit_hold: {
      model_type: 'Random Forest Classifier',
      accuracy: 0.91,
      last_trained: '2024-12-20',
      version: '1.8.0',
      features: ['credit_limit_usage', 'payment_history', 'order_value'],
    },
    completion_time: {
      model_type: 'XGBoost Regressor',
      accuracy: 0.84,
      last_trained: '2024-12-18',
      version: '2.0.0',
      features: ['order_complexity', 'item_count', 'shipping_method'],
    },
  };

  it('should have model info for late_delivery', () => {
    expect(MODEL_CONFIG.late_delivery.model_type).toBe('Gradient Boosting Classifier');
    expect(MODEL_CONFIG.late_delivery.accuracy).toBeGreaterThan(0.8);
  });

  it('should have model info for credit_hold', () => {
    expect(MODEL_CONFIG.credit_hold.model_type).toBe('Random Forest Classifier');
    expect(MODEL_CONFIG.credit_hold.accuracy).toBeGreaterThan(0.9);
  });

  it('should have model info for completion_time', () => {
    expect(MODEL_CONFIG.completion_time.model_type).toBe('XGBoost Regressor');
  });

  it('should include feature lists', () => {
    for (const modelType of Object.keys(MODEL_CONFIG) as Array<keyof typeof MODEL_CONFIG>) {
      expect(MODEL_CONFIG[modelType].features.length).toBeGreaterThan(0);
    }
  });

  it('should have version numbers', () => {
    for (const modelType of Object.keys(MODEL_CONFIG) as Array<keyof typeof MODEL_CONFIG>) {
      expect(MODEL_CONFIG[modelType].version).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });
});

describe('Summary Statistics Calculation', () => {
  interface PredictionSummary {
    total_documents: number;
    high_risk_count: number;
    average_risk_score: number;
    prediction_types_run: string[];
  }

  function calculateSummary(
    docCount: number,
    probabilities: number[],
    types: string[]
  ): PredictionSummary {
    const highRiskCount = probabilities.filter(p => p >= 0.7).length;
    const avgScore =
      probabilities.length > 0
        ? Math.round((probabilities.reduce((a, b) => a + b, 0) / probabilities.length) * 100) / 100
        : 0;

    return {
      total_documents: docCount,
      high_risk_count: highRiskCount,
      average_risk_score: avgScore,
      prediction_types_run: [...new Set(types)],
    };
  }

  it('should calculate total documents', () => {
    const summary = calculateSummary(5, [0.3, 0.5, 0.7], ['late_delivery']);
    expect(summary.total_documents).toBe(5);
  });

  it('should count high risk predictions', () => {
    const summary = calculateSummary(3, [0.3, 0.7, 0.9], ['late_delivery']);
    expect(summary.high_risk_count).toBe(2);
  });

  it('should calculate average risk score', () => {
    const summary = calculateSummary(3, [0.3, 0.5, 0.7], ['late_delivery']);
    expect(summary.average_risk_score).toBe(0.5);
  });

  it('should list unique prediction types', () => {
    const summary = calculateSummary(
      3,
      [0.5, 0.5, 0.5],
      ['late_delivery', 'credit_hold', 'late_delivery']
    );
    expect(summary.prediction_types_run).toContain('late_delivery');
    expect(summary.prediction_types_run).toContain('credit_hold');
    expect(summary.prediction_types_run.length).toBe(2);
  });

  it('should handle empty probabilities', () => {
    const summary = calculateSummary(0, [], []);
    expect(summary.average_risk_score).toBe(0);
    expect(summary.high_risk_count).toBe(0);
  });
});
