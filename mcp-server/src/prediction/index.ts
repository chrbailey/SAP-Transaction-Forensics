/**
 * Predictive Monitoring Module
 *
 * ML-based prediction of process outcomes for SAP workflows.
 *
 * Features:
 * - Late delivery prediction
 * - Credit hold prediction
 * - Completion time estimation
 * - Risk scoring and alerts
 */

// Types
export type {
  PredictionType,
  RiskLevel,
  ProcessEvent,
  ProcessCase,
  CaseFeatures,
  PredictionResult,
  PredictionFactor,
  ModelConfig,
  AlertConfig,
  PredictionOptions,
  BatchPredictionResult,
  PredictionSummary,
  HistoricalOutcome,
  ModelMetrics,
} from './types.js';

export { RISK_THRESHOLDS, DEFAULT_MODEL_CONFIG, O2C_MILESTONES, P2P_MILESTONES } from './types.js';

// Feature extraction
export {
  extractFeatures,
  extractBatchFeatures,
  getFeatureNames,
  featuresToArray,
} from './feature-extractor.js';

// Prediction models
export { predict, predictBatch, PREDICTION_TYPES, MODEL_DESCRIPTIONS } from './models.js';

// Risk scoring and alerts
export type { Alert } from './risk-scorer.js';
export {
  DEFAULT_ALERT_CONFIG,
  meetsRiskThreshold,
  getOverallRiskLevel,
  calculateRiskDistribution,
  getHighRiskCases,
  getTopRiskFactors,
  calculateAvgProbability,
  createPredictionSummary,
  createBatchResult,
  generateAlerts,
  calculateCompositeRiskScore,
  rankByRisk,
  formatRiskLevel,
  getRiskColor,
} from './risk-scorer.js';

// Convenience function for full prediction pipeline
import { ProcessCase, PredictionType, BatchPredictionResult, AlertConfig } from './types.js';
import { extractBatchFeatures } from './feature-extractor.js';
import { predictBatch } from './models.js';
import { createBatchResult, generateAlerts, DEFAULT_ALERT_CONFIG } from './risk-scorer.js';
import type { Alert } from './risk-scorer.js';

/**
 * Full prediction pipeline: extract features, predict, and generate alerts
 */
export function predictOutcomes(
  cases: ProcessCase[],
  predictionType: PredictionType,
  alertConfig: AlertConfig = DEFAULT_ALERT_CONFIG
): {
  result: BatchPredictionResult;
  alerts: Alert[];
} {
  // Extract features from all cases
  const features = extractBatchFeatures(cases);

  // Make predictions
  const predictions = predictBatch(features, predictionType);

  // Create batch result with summary
  const result = createBatchResult(predictions, predictionType);

  // Generate alerts
  const alerts = generateAlerts(predictions, alertConfig);

  return { result, alerts };
}

/**
 * Quick risk assessment for a single case
 */
export function assessRisk(processCase: ProcessCase): {
  lateDeliveryRisk: number;
  creditHoldRisk: number;
  estimatedCompletion: number;
  overallRisk: string;
  recommendations: string[];
} {
  const features = extractBatchFeatures([processCase])[0]!;

  const lateDelivery = predictBatch([features], 'late_delivery')[0]!;
  const creditHold = predictBatch([features], 'credit_hold')[0]!;
  const completion = predictBatch([features], 'completion_time')[0]!;

  // Combine recommendations
  const allRecommendations = [
    ...lateDelivery.recommendations,
    ...creditHold.recommendations,
    ...completion.recommendations,
  ];

  // Deduplicate
  const uniqueRecommendations = [...new Set(allRecommendations)];

  // Determine overall risk
  const maxRisk = Math.max(lateDelivery.probability, creditHold.probability);
  let overallRisk = 'Low';
  if (maxRisk >= 0.75) overallRisk = 'Critical';
  else if (maxRisk >= 0.5) overallRisk = 'High';
  else if (maxRisk >= 0.25) overallRisk = 'Medium';

  return {
    lateDeliveryRisk: Math.round(lateDelivery.probability * 100),
    creditHoldRisk: Math.round(creditHold.probability * 100),
    estimatedCompletion: Math.round(completion.prediction as number),
    overallRisk,
    recommendations: uniqueRecommendations.slice(0, 5),
  };
}
