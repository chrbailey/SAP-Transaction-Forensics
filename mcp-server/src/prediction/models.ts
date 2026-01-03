/**
 * Prediction Models
 *
 * ML-based and heuristic models for process outcome prediction.
 */

import {
  CaseFeatures,
  PredictionType,
  PredictionResult,
  PredictionFactor,
  RiskLevel,
  ModelConfig,
  RISK_THRESHOLDS,
  DEFAULT_MODEL_CONFIG,
} from './types.js';

/**
 * Base interface for prediction models
 */
interface PredictionModel {
  predict(features: CaseFeatures): { probability: number; factors: PredictionFactor[] };
}

/**
 * Determines risk level from probability
 */
function getRiskLevel(probability: number): RiskLevel {
  if (probability >= RISK_THRESHOLDS.critical.min) return 'critical';
  if (probability >= RISK_THRESHOLDS.high.min) return 'high';
  if (probability >= RISK_THRESHOLDS.medium.min) return 'medium';
  return 'low';
}

/**
 * Late Delivery Prediction Model
 *
 * Predicts probability that an order will be delivered late.
 */
class LateDeliveryModel implements PredictionModel {
  private config: ModelConfig;

  constructor(config: Partial<ModelConfig> = {}) {
    this.config = { ...DEFAULT_MODEL_CONFIG, ...config };
  }

  predict(features: CaseFeatures): { probability: number; factors: PredictionFactor[] } {
    const factors: PredictionFactor[] = [];
    let score = 0;

    // Case age factor (longer = higher risk)
    const ageScore = Math.min(features.caseAge / 336, 1); // Normalize to 2 weeks
    if (features.caseAge > 72) {
      score += ageScore * 0.25;
      factors.push({
        name: 'case_age',
        value: `${Math.round(features.caseAge)} hours`,
        impact: 'negative',
        weight: 0.25,
        description: `Case is ${Math.round(features.caseAge / 24)} days old`,
      });
    }

    // Progress factor (low progress + high age = risk)
    if (features.progressScore < 0.5 && features.caseAge > 48) {
      const progressRisk = (1 - features.progressScore) * 0.2;
      score += progressRisk;
      factors.push({
        name: 'low_progress',
        value: `${Math.round(features.progressScore * 100)}%`,
        impact: 'negative',
        weight: 0.2,
        description: 'Case has not reached key milestones',
      });
    }

    // Stalled case factor
    if (features.timeSinceLastEvent > 24) {
      const stalledScore = Math.min(features.timeSinceLastEvent / 168, 1) * 0.2;
      score += stalledScore;
      factors.push({
        name: 'stalled',
        value: `${Math.round(features.timeSinceLastEvent)} hours`,
        impact: 'negative',
        weight: 0.2,
        description: 'No activity for extended period',
      });
    }

    // Credit hold factor
    if (features.hasCreditHold) {
      score += 0.3;
      factors.push({
        name: 'credit_hold',
        value: true,
        impact: 'negative',
        weight: 0.3,
        description: 'Case is blocked on credit check',
      });
    }

    // Rework factor
    if (features.hasRework) {
      score += 0.1;
      factors.push({
        name: 'rework',
        value: true,
        impact: 'negative',
        weight: 0.1,
        description: 'Case has repeated activities',
      });
    }

    // Backtrack factor
    if (features.backtrackCount > 0) {
      const backtrackScore = Math.min(features.backtrackCount * 0.1, 0.2);
      score += backtrackScore;
      factors.push({
        name: 'backtracks',
        value: features.backtrackCount,
        impact: 'negative',
        weight: 0.1,
        description: 'Process went back to earlier steps',
      });
    }

    // Weekend factor (minor risk)
    if (features.isWeekend) {
      score += 0.05;
      factors.push({
        name: 'weekend_start',
        value: true,
        impact: 'negative',
        weight: 0.05,
        description: 'Case started on weekend',
      });
    }

    // Positive factors (reduce risk)
    if (features.hasGoodsIssued) {
      score -= 0.3;
      factors.push({
        name: 'goods_issued',
        value: true,
        impact: 'positive',
        weight: 0.3,
        description: 'Goods have been shipped',
      });
    }

    if (features.hasDeliveryCreated && !features.hasGoodsIssued) {
      score -= 0.15;
      factors.push({
        name: 'delivery_created',
        value: true,
        impact: 'positive',
        weight: 0.15,
        description: 'Delivery document exists',
      });
    }

    // Clamp probability
    const probability = Math.max(0, Math.min(1, score));

    return { probability, factors };
  }
}

/**
 * Credit Hold Prediction Model
 *
 * Predicts probability that an order will be put on credit hold.
 */
class CreditHoldModel implements PredictionModel {
  private config: ModelConfig;

  constructor(config: Partial<ModelConfig> = {}) {
    this.config = { ...DEFAULT_MODEL_CONFIG, ...config };
  }

  predict(features: CaseFeatures): { probability: number; factors: PredictionFactor[] } {
    const factors: PredictionFactor[] = [];
    let score = 0;

    // Already on credit hold
    if (features.hasCreditHold) {
      return {
        probability: 1,
        factors: [
          {
            name: 'credit_hold_active',
            value: true,
            impact: 'negative',
            weight: 1,
            description: 'Case is already on credit hold',
          },
        ],
      };
    }

    // No credit check yet = higher risk
    if (!features.hasCreditCheck && features.eventCount > 2) {
      score += 0.3;
      factors.push({
        name: 'no_credit_check',
        value: true,
        impact: 'negative',
        weight: 0.3,
        description: 'Credit check not yet performed',
      });
    }

    // Large order indicator (from complexity)
    if (features.complexityScore > 0.5) {
      score += features.complexityScore * 0.2;
      factors.push({
        name: 'high_complexity',
        value: `${Math.round(features.complexityScore * 100)}%`,
        impact: 'negative',
        weight: 0.2,
        description: 'Complex order more likely to trigger credit review',
      });
    }

    // Risk indicators
    if (features.riskIndicators.includes('rejection_detected')) {
      score += 0.25;
      factors.push({
        name: 'rejection_history',
        value: true,
        impact: 'negative',
        weight: 0.25,
        description: 'Case has rejection events',
      });
    }

    if (features.riskIndicators.includes('block_detected')) {
      score += 0.2;
      factors.push({
        name: 'block_history',
        value: true,
        impact: 'negative',
        weight: 0.2,
        description: 'Case has blocking events',
      });
    }

    // Positive: credit check passed
    if (features.hasCreditCheck && !features.hasCreditHold) {
      score -= 0.4;
      factors.push({
        name: 'credit_check_passed',
        value: true,
        impact: 'positive',
        weight: 0.4,
        description: 'Credit check completed without hold',
      });
    }

    // Positive: already in late stages
    if (features.hasGoodsIssued || features.hasInvoiceCreated) {
      score -= 0.3;
      factors.push({
        name: 'late_stage',
        value: true,
        impact: 'positive',
        weight: 0.3,
        description: 'Order past credit check stage',
      });
    }

    const probability = Math.max(0, Math.min(1, score));
    return { probability, factors };
  }
}

/**
 * Completion Time Prediction Model
 *
 * Predicts remaining time to case completion (in hours).
 */
class CompletionTimeModel implements PredictionModel {
  private config: ModelConfig;

  constructor(config: Partial<ModelConfig> = {}) {
    this.config = { ...DEFAULT_MODEL_CONFIG, ...config };
  }

  predict(features: CaseFeatures): { probability: number; factors: PredictionFactor[] } {
    const factors: PredictionFactor[] = [];

    // Base estimate: average case takes ~5 days (120 hours)
    const baseTime = 120;
    let estimatedRemaining = baseTime;

    // Adjust based on progress
    const remainingProgress = 1 - features.progressScore;
    estimatedRemaining = baseTime * remainingProgress;

    factors.push({
      name: 'progress_based_estimate',
      value: `${Math.round(estimatedRemaining)} hours`,
      impact: 'neutral',
      weight: 0.4,
      description: `Based on ${Math.round(features.progressScore * 100)}% progress`,
    });

    // Adjust based on current pace
    if (features.eventCount > 1 && features.avgTimeBetweenEvents > 0) {
      // Estimate remaining events needed
      const avgEventsPerMilestone = 3;
      const remainingMilestones = Math.ceil(remainingProgress * 7); // ~7 milestones
      const estimatedRemainingEvents = remainingMilestones * avgEventsPerMilestone;
      const paceEstimate = estimatedRemainingEvents * features.avgTimeBetweenEvents;

      // Blend with progress estimate
      estimatedRemaining = (estimatedRemaining + paceEstimate) / 2;

      factors.push({
        name: 'pace_based_estimate',
        value: `${Math.round(paceEstimate)} hours`,
        impact: features.avgTimeBetweenEvents > 24 ? 'negative' : 'neutral',
        weight: 0.3,
        description: `Average ${Math.round(features.avgTimeBetweenEvents)} hours between events`,
      });
    }

    // Risk adjustments
    if (features.hasCreditHold) {
      estimatedRemaining += 48; // Add 2 days for credit hold
      factors.push({
        name: 'credit_hold_delay',
        value: '+48 hours',
        impact: 'negative',
        weight: 0.15,
        description: 'Credit hold typically adds 2 days',
      });
    }

    if (features.hasRework) {
      estimatedRemaining *= 1.2; // 20% increase for rework
      factors.push({
        name: 'rework_delay',
        value: '+20%',
        impact: 'negative',
        weight: 0.1,
        description: 'Rework extends completion time',
      });
    }

    if (features.backtrackCount > 0) {
      estimatedRemaining += features.backtrackCount * 12; // 12 hours per backtrack
      factors.push({
        name: 'backtrack_delay',
        value: `+${features.backtrackCount * 12} hours`,
        impact: 'negative',
        weight: 0.1,
        description: 'Process backtracks cause delays',
      });
    }

    // Already complete check
    if (features.progressScore >= 0.95) {
      estimatedRemaining = Math.min(estimatedRemaining, 24);
      factors.push({
        name: 'near_completion',
        value: true,
        impact: 'positive',
        weight: 0.2,
        description: 'Case is nearly complete',
      });
    }

    // For completion time, we return the estimated hours as the "probability"
    // (it's actually a regression value, not a probability)
    return { probability: Math.max(0, estimatedRemaining), factors };
  }
}

/**
 * Model factory
 */
function getModel(type: PredictionType, config?: Partial<ModelConfig>): PredictionModel {
  switch (type) {
    case 'late_delivery':
      return new LateDeliveryModel(config);
    case 'credit_hold':
      return new CreditHoldModel(config);
    case 'completion_time':
      return new CompletionTimeModel(config);
    default:
      throw new Error(`Unknown prediction type: ${type}`);
  }
}

/**
 * Generates recommendations based on prediction factors
 */
function generateRecommendations(
  type: PredictionType,
  probability: number,
  factors: PredictionFactor[]
): string[] {
  const recommendations: string[] = [];
  const negativeFactors = factors.filter(f => f.impact === 'negative');

  if (type === 'late_delivery') {
    if (probability > 0.5) {
      recommendations.push('Prioritize this order to prevent late delivery');
    }
    for (const factor of negativeFactors) {
      switch (factor.name) {
        case 'credit_hold':
          recommendations.push('Expedite credit review to unblock order');
          break;
        case 'stalled':
          recommendations.push('Investigate why order has stalled and take action');
          break;
        case 'low_progress':
          recommendations.push('Check for missing documents or approvals');
          break;
        case 'backtracks':
          recommendations.push('Review process for root cause of backtracks');
          break;
      }
    }
  }

  if (type === 'credit_hold') {
    if (probability > 0.5) {
      recommendations.push('Proactively review customer credit status');
    }
    for (const factor of negativeFactors) {
      switch (factor.name) {
        case 'no_credit_check':
          recommendations.push('Initiate credit check early');
          break;
        case 'high_complexity':
          recommendations.push('Flag for manual credit review');
          break;
        case 'rejection_history':
          recommendations.push('Review rejection reasons and resolve issues');
          break;
      }
    }
  }

  if (type === 'completion_time') {
    const estimatedHours = probability;
    if (estimatedHours > 168) {
      // > 1 week
      recommendations.push('Order may take over a week - consider expediting');
    }
    for (const factor of negativeFactors) {
      switch (factor.name) {
        case 'credit_hold_delay':
          recommendations.push('Resolve credit hold to reduce completion time');
          break;
        case 'rework_delay':
          recommendations.push('Investigate cause of rework to prevent further delays');
          break;
        case 'pace_based_estimate':
          recommendations.push('Current processing pace is slow - check for bottlenecks');
          break;
      }
    }
  }

  // Limit to top 3 recommendations
  return recommendations.slice(0, 3);
}

/**
 * Makes a prediction for a single case
 */
export function predict(
  features: CaseFeatures,
  type: PredictionType,
  config?: Partial<ModelConfig>
): PredictionResult {
  const model = getModel(type, config);
  const { probability, factors } = model.predict(features);

  // For completion_time, probability is actually the estimated hours
  const isClassification = type !== 'completion_time';
  const riskLevel = isClassification
    ? getRiskLevel(probability)
    : getRiskLevel(Math.min(probability / 336, 1)); // Normalize hours to 2-week scale

  const recommendations = generateRecommendations(type, probability, factors);

  return {
    caseId: features.caseId,
    predictionType: type,
    prediction: isClassification ? probability >= (config?.threshold ?? 0.5) : probability,
    probability: isClassification ? probability : Math.min(probability / 336, 1),
    riskLevel,
    factors,
    recommendations,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Makes predictions for multiple cases
 */
export function predictBatch(
  featuresArray: CaseFeatures[],
  type: PredictionType,
  config?: Partial<ModelConfig>
): PredictionResult[] {
  return featuresArray.map(features => predict(features, type, config));
}

/**
 * Available prediction types
 */
export const PREDICTION_TYPES: PredictionType[] = [
  'late_delivery',
  'credit_hold',
  'completion_time',
];

/**
 * Model descriptions
 */
export const MODEL_DESCRIPTIONS: Record<PredictionType, string> = {
  late_delivery:
    'Predicts the probability that an order will be delivered late based on current progress, delays, and risk factors.',
  credit_hold:
    'Predicts the probability that an order will be put on credit hold based on credit check status and order complexity.',
  completion_time:
    'Estimates the remaining time (in hours) until case completion based on progress and historical patterns.',
};
