/**
 * Risk Scoring and Alerting Module
 *
 * Aggregates predictions into risk scores and generates alerts.
 */

import {
  PredictionResult,
  PredictionSummary,
  BatchPredictionResult,
  RiskLevel,
  PredictionType,
  AlertConfig,
} from './types.js';

/**
 * Default alert configuration
 */
export const DEFAULT_ALERT_CONFIG: AlertConfig = {
  enabled: true,
  riskThreshold: 'high',
  predictionTypes: ['late_delivery', 'credit_hold', 'completion_time'],
};

/**
 * Risk level numeric values for comparison
 */
const RISK_LEVEL_VALUES: Record<RiskLevel, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

/**
 * Checks if a risk level meets or exceeds a threshold
 */
export function meetsRiskThreshold(level: RiskLevel, threshold: RiskLevel): boolean {
  return RISK_LEVEL_VALUES[level] >= RISK_LEVEL_VALUES[threshold];
}

/**
 * Gets the overall risk level from multiple predictions
 */
export function getOverallRiskLevel(predictions: PredictionResult[]): RiskLevel {
  if (predictions.length === 0) return 'low';

  // Take the highest risk level
  let maxRisk: RiskLevel = 'low';
  for (const pred of predictions) {
    if (RISK_LEVEL_VALUES[pred.riskLevel] > RISK_LEVEL_VALUES[maxRisk]) {
      maxRisk = pred.riskLevel;
    }
  }

  return maxRisk;
}

/**
 * Calculates risk distribution from predictions
 */
export function calculateRiskDistribution(
  predictions: PredictionResult[]
): Record<RiskLevel, number> {
  const distribution: Record<RiskLevel, number> = {
    low: 0,
    medium: 0,
    high: 0,
    critical: 0,
  };

  for (const pred of predictions) {
    distribution[pred.riskLevel]++;
  }

  return distribution;
}

/**
 * Gets high-risk cases from predictions
 */
export function getHighRiskCases(
  predictions: PredictionResult[],
  threshold: RiskLevel = 'high'
): string[] {
  return predictions.filter(p => meetsRiskThreshold(p.riskLevel, threshold)).map(p => p.caseId);
}

/**
 * Extracts top risk factors across all predictions
 */
export function getTopRiskFactors(
  predictions: PredictionResult[],
  limit: number = 5
): { factor: string; count: number }[] {
  const factorCounts = new Map<string, number>();

  for (const pred of predictions) {
    for (const factor of pred.factors) {
      if (factor.impact === 'negative') {
        const current = factorCounts.get(factor.name) || 0;
        factorCounts.set(factor.name, current + 1);
      }
    }
  }

  return Array.from(factorCounts.entries())
    .map(([factor, count]) => ({ factor, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

/**
 * Calculates average probability across predictions
 */
export function calculateAvgProbability(predictions: PredictionResult[]): number {
  if (predictions.length === 0) return 0;

  const sum = predictions.reduce((acc, p) => acc + p.probability, 0);
  return sum / predictions.length;
}

/**
 * Creates a summary of batch predictions
 */
export function createPredictionSummary(
  predictions: PredictionResult[],
  type: PredictionType
): PredictionSummary {
  return {
    totalCases: predictions.length,
    predictionType: type,
    riskDistribution: calculateRiskDistribution(predictions),
    avgProbability: calculateAvgProbability(predictions),
    highRiskCases: getHighRiskCases(predictions),
    topRiskFactors: getTopRiskFactors(predictions),
  };
}

/**
 * Creates a batch prediction result with summary
 */
export function createBatchResult(
  predictions: PredictionResult[],
  type: PredictionType
): BatchPredictionResult {
  return {
    predictions,
    summary: createPredictionSummary(predictions, type),
    timestamp: new Date().toISOString(),
  };
}

/**
 * Alert for high-risk cases
 */
export interface Alert {
  caseId: string;
  alertType: 'risk_warning' | 'immediate_action' | 'monitoring';
  predictionType: PredictionType;
  riskLevel: RiskLevel;
  probability: number;
  message: string;
  recommendations: string[];
  timestamp: string;
}

/**
 * Generates alerts from predictions based on configuration
 */
export function generateAlerts(
  predictions: PredictionResult[],
  config: AlertConfig = DEFAULT_ALERT_CONFIG
): Alert[] {
  if (!config.enabled) return [];

  const alerts: Alert[] = [];

  for (const pred of predictions) {
    // Check if prediction type is enabled
    if (!config.predictionTypes.includes(pred.predictionType)) {
      continue;
    }

    // Check if risk level meets threshold
    if (!meetsRiskThreshold(pred.riskLevel, config.riskThreshold)) {
      continue;
    }

    // Determine alert type based on risk level
    let alertType: Alert['alertType'];
    if (pred.riskLevel === 'critical') {
      alertType = 'immediate_action';
    } else if (pred.riskLevel === 'high') {
      alertType = 'risk_warning';
    } else {
      alertType = 'monitoring';
    }

    // Generate message
    const message = generateAlertMessage(pred);

    alerts.push({
      caseId: pred.caseId,
      alertType,
      predictionType: pred.predictionType,
      riskLevel: pred.riskLevel,
      probability: pred.probability,
      message,
      recommendations: pred.recommendations,
      timestamp: new Date().toISOString(),
    });
  }

  // Sort by risk level (critical first)
  alerts.sort((a, b) => RISK_LEVEL_VALUES[b.riskLevel] - RISK_LEVEL_VALUES[a.riskLevel]);

  return alerts;
}

/**
 * Generates alert message based on prediction
 */
function generateAlertMessage(pred: PredictionResult): string {
  const probability = Math.round(pred.probability * 100);

  switch (pred.predictionType) {
    case 'late_delivery':
      if (pred.riskLevel === 'critical') {
        return `CRITICAL: Case ${pred.caseId} has ${probability}% probability of late delivery. Immediate action required.`;
      }
      return `Case ${pred.caseId} has ${probability}% probability of late delivery.`;

    case 'credit_hold':
      if (pred.riskLevel === 'critical') {
        return `CRITICAL: Case ${pred.caseId} has ${probability}% probability of credit hold. Review immediately.`;
      }
      return `Case ${pred.caseId} has ${probability}% probability of being put on credit hold.`;

    case 'completion_time': {
      // For completion time, probability represents normalized time
      const estimatedHours = pred.prediction as number;
      const days = Math.round(estimatedHours / 24);
      if (pred.riskLevel === 'critical') {
        return `CRITICAL: Case ${pred.caseId} estimated to take ${days} more days. Exceeds SLA threshold.`;
      }
      return `Case ${pred.caseId} estimated to complete in ${days} days.`;
    }

    default:
      return `Alert for case ${pred.caseId}: ${pred.riskLevel} risk detected.`;
  }
}

/**
 * Calculates a composite risk score (0-100) for a case
 */
export function calculateCompositeRiskScore(predictions: PredictionResult[]): number {
  if (predictions.length === 0) return 0;

  // Weight by prediction type importance
  const weights: Record<PredictionType, number> = {
    late_delivery: 0.4,
    credit_hold: 0.35,
    completion_time: 0.25,
  };

  let weightedSum = 0;
  let totalWeight = 0;

  for (const pred of predictions) {
    const weight = weights[pred.predictionType] || 0.33;
    weightedSum += pred.probability * weight;
    totalWeight += weight;
  }

  if (totalWeight === 0) return 0;

  return Math.round((weightedSum / totalWeight) * 100);
}

/**
 * Ranks cases by risk priority
 */
export function rankByRisk(
  predictions: PredictionResult[]
): { caseId: string; riskScore: number; riskLevel: RiskLevel }[] {
  // Group predictions by case
  const caseMap = new Map<string, PredictionResult[]>();
  for (const pred of predictions) {
    const existing = caseMap.get(pred.caseId) || [];
    existing.push(pred);
    caseMap.set(pred.caseId, existing);
  }

  // Calculate composite scores
  const rankings: { caseId: string; riskScore: number; riskLevel: RiskLevel }[] = [];

  for (const [caseId, casePreds] of caseMap) {
    const riskScore = calculateCompositeRiskScore(casePreds);
    const riskLevel = getOverallRiskLevel(casePreds);
    rankings.push({ caseId, riskScore, riskLevel });
  }

  // Sort by risk score descending
  rankings.sort((a, b) => b.riskScore - a.riskScore);

  return rankings;
}

/**
 * Formats risk level for display
 */
export function formatRiskLevel(level: RiskLevel): string {
  const icons: Record<RiskLevel, string> = {
    low: '🟢',
    medium: '🟡',
    high: '🟠',
    critical: '🔴',
  };

  const labels: Record<RiskLevel, string> = {
    low: 'Low Risk',
    medium: 'Medium Risk',
    high: 'High Risk',
    critical: 'Critical Risk',
  };

  return `${icons[level]} ${labels[level]}`;
}

/**
 * Gets risk color for visualization
 */
export function getRiskColor(level: RiskLevel): string {
  const colors: Record<RiskLevel, string> = {
    low: '#4CAF50',
    medium: '#FFC107',
    high: '#FF9800',
    critical: '#F44336',
  };

  return colors[level];
}
