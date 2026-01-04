// ═══════════════════════════════════════════════════════════════════════════
// CONFORMANCE CHECKER ENGINE
// Implements token-based replay and alignment-based conformance checking
// ═══════════════════════════════════════════════════════════════════════════

import {
  ReferenceModel,
  ReferenceActivity,
  Deviation,
  DeviationType,
  DeviationSeverity,
  CaseAnalysisResult,
  ConformanceResult,
} from './types.js';

/**
 * Event from a trace
 */
export interface TraceEvent {
  activity: string;
  timestamp: string;
  attributes?: Record<string, unknown>;
}

/**
 * Process trace (case)
 */
export interface Trace {
  caseId: string;
  events: TraceEvent[];
}

/**
 * Conformance Checker
 * Analyzes traces against a reference model
 */
export class ConformanceChecker {
  private model: ReferenceModel;
  private activityIndex: Map<string, ReferenceActivity>;

  constructor(model: ReferenceModel) {
    this.model = model;
    this.activityIndex = new Map();

    // Build activity index
    for (const activity of model.activities) {
      this.activityIndex.set(activity.id, activity);
    }
  }

  /**
   * Map raw activity name to reference model activity ID
   */
  private mapActivity(rawActivity: string): string | null {
    // Try exact match first
    if (this.activityIndex.has(rawActivity)) {
      return rawActivity;
    }

    // Try mapping
    const mapped = this.model.activityMappings[rawActivity];
    if (mapped && this.activityIndex.has(mapped)) {
      return mapped;
    }

    // Try case-insensitive mapping
    const lowerRaw = rawActivity.toLowerCase();
    for (const [key, value] of Object.entries(this.model.activityMappings)) {
      if (key.toLowerCase() === lowerRaw) {
        return value;
      }
    }

    return null;
  }

  /**
   * Get activity order (position in reference model)
   */
  private getActivityOrder(activityId: string): number {
    const activity = this.activityIndex.get(activityId);
    return activity?.order ?? -1;
  }

  /**
   * Check if activity is required
   */
  private isRequired(activityId: string): boolean {
    const activity = this.activityIndex.get(activityId);
    return activity?.required ?? false;
  }

  /**
   * Determine severity based on deviation type and context
   */
  private determineSeverity(deviationType: DeviationType, activityId?: string): DeviationSeverity {
    // Missing required activities are critical
    if (deviationType === 'missing_activity' && activityId && this.isRequired(activityId)) {
      return 'critical';
    }

    // Skipped required activities are critical
    if (deviationType === 'skipped_activity' && activityId && this.isRequired(activityId)) {
      return 'critical';
    }

    // Wrong order is usually critical for main flow
    if (deviationType === 'wrong_order') {
      return 'critical';
    }

    // Unexpected activities are major (could indicate process issues)
    if (deviationType === 'unexpected_activity') {
      return 'major';
    }

    // Repeated activities are minor (rework)
    if (deviationType === 'repeated_activity') {
      return 'minor';
    }

    // Default to minor
    return 'minor';
  }

  /**
   * Analyze a single trace for conformance
   */
  analyzeTrace(trace: Trace): CaseAnalysisResult {
    const deviations: Deviation[] = [];
    const actualSequence: string[] = [];
    const seenActivities = new Set<string>();
    const activityCounts = new Map<string, number>();

    // Map events to reference activities
    for (const event of trace.events) {
      const mappedActivity = this.mapActivity(event.activity);

      if (mappedActivity) {
        actualSequence.push(mappedActivity);
        seenActivities.add(mappedActivity);

        // Count occurrences
        const count = activityCounts.get(mappedActivity) || 0;
        activityCounts.set(mappedActivity, count + 1);
      } else {
        // Unexpected activity
        deviations.push({
          case_id: trace.caseId,
          deviation_type: 'unexpected_activity',
          severity: this.determineSeverity('unexpected_activity'),
          description: `Activity '${event.activity}' is not in the reference model`,
          expected: 'Known activity from reference model',
          actual: event.activity,
          activity: event.activity,
          timestamp: event.timestamp,
        });
      }
    }

    // Check for missing required activities
    for (const activity of this.model.activities) {
      if (activity.required && !seenActivities.has(activity.id)) {
        deviations.push({
          case_id: trace.caseId,
          deviation_type: 'missing_activity',
          severity: this.determineSeverity('missing_activity', activity.id),
          description: `Required activity '${activity.name}' is missing`,
          expected: activity.name,
          actual: 'Not found',
          activity: activity.id,
          position: activity.order,
        });
      }
    }

    // Check for wrong order
    let lastOrder = 0;
    let lastActivity = '';
    for (let i = 0; i < actualSequence.length; i++) {
      const activityId = actualSequence[i];
      if (!activityId) continue;
      const order = this.getActivityOrder(activityId);

      if (order > 0 && order < lastOrder) {
        // Out of order
        const activity = this.activityIndex.get(activityId);
        const prevActivity = this.activityIndex.get(lastActivity);

        // Check if this ordering is allowed
        if (activity?.allowedPredecessors?.includes(lastActivity)) {
          // This order is explicitly allowed, skip deviation
          continue;
        }

        deviations.push({
          case_id: trace.caseId,
          deviation_type: 'wrong_order',
          severity: this.determineSeverity('wrong_order', activityId),
          description: `'${activity?.name || activityId}' occurred before '${prevActivity?.name || lastActivity}'`,
          expected: `${prevActivity?.name || lastActivity} → ${activity?.name || activityId}`,
          actual: `${activity?.name || activityId} → ${prevActivity?.name || lastActivity}`,
          activity: activityId,
          position: i,
        });
      }

      if (order > lastOrder) {
        lastOrder = order;
        lastActivity = activityId;
      }
    }

    // Check for repeated activities
    for (const [activityId, count] of activityCounts) {
      if (count > 1) {
        const activity = this.activityIndex.get(activityId);
        deviations.push({
          case_id: trace.caseId,
          deviation_type: 'repeated_activity',
          severity: this.determineSeverity('repeated_activity', activityId),
          description: `Activity '${activity?.name || activityId}' was executed ${count} times`,
          expected: `${activity?.name || activityId} (once)`,
          actual: `${activity?.name || activityId} (${count} times)`,
          activity: activityId,
        });
      }
    }

    // Calculate fitness score
    const expectedSequence = this.model.activities.filter(a => a.required).map(a => a.id);

    const fitness = this.calculateFitness(actualSequence, expectedSequence, deviations);

    return {
      caseId: trace.caseId,
      conforming: deviations.length === 0,
      deviations,
      actualSequence,
      expectedSequence,
      fitness,
    };
  }

  /**
   * Calculate fitness score (0-1)
   * Based on ratio of conforming activities to expected activities
   */
  private calculateFitness(actual: string[], expected: string[], deviations: Deviation[]): number {
    if (expected.length === 0) return 1;

    // Count how many expected activities are present in correct order
    let matchCount = 0;
    const actualSet = new Set(actual);

    for (const exp of expected) {
      if (actualSet.has(exp)) {
        matchCount++;
      }
    }

    // Penalize for deviations
    const criticalPenalty = deviations.filter(d => d.severity === 'critical').length * 0.2;
    const majorPenalty = deviations.filter(d => d.severity === 'major').length * 0.1;
    const minorPenalty = deviations.filter(d => d.severity === 'minor').length * 0.05;

    const baseFitness = matchCount / expected.length;
    const penalty = Math.min(criticalPenalty + majorPenalty + minorPenalty, baseFitness);

    return Math.max(0, baseFitness - penalty);
  }

  /**
   * Analyze multiple traces and aggregate results
   */
  analyzeTraces(traces: Trace[]): ConformanceResult {
    const results: CaseAnalysisResult[] = [];
    const allDeviations: Deviation[] = [];
    const deviationPatterns = new Map<string, { count: number; severity: DeviationSeverity }>();
    let conformingCount = 0;
    let totalFitness = 0;

    const severitySummary = { critical: 0, major: 0, minor: 0 };
    const deviationTypeSummary: Record<DeviationType, number> = {
      skipped_activity: 0,
      wrong_order: 0,
      unexpected_activity: 0,
      missing_activity: 0,
      repeated_activity: 0,
      timing_violation: 0,
    };

    for (const trace of traces) {
      const result = this.analyzeTrace(trace);
      results.push(result);
      totalFitness += result.fitness;

      if (result.conforming) {
        conformingCount++;
      } else {
        for (const deviation of result.deviations) {
          allDeviations.push(deviation);
          severitySummary[deviation.severity]++;
          deviationTypeSummary[deviation.deviation_type]++;

          // Track patterns
          const pattern = `${deviation.deviation_type}:${deviation.activity || deviation.actual}`;
          const existing = deviationPatterns.get(pattern);
          if (existing) {
            existing.count++;
          } else {
            deviationPatterns.set(pattern, { count: 1, severity: deviation.severity });
          }
        }
      }
    }

    // Calculate rates
    const totalCases = traces.length;
    const conformanceRate =
      totalCases > 0 ? Math.round((conformingCount / totalCases) * 100 * 100) / 100 : 0;
    const fitnessScore = totalCases > 0 ? Math.round((totalFitness / totalCases) * 100) / 100 : 0;

    // Get top deviations
    const topDeviations = Array.from(deviationPatterns.entries())
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 10)
      .map(([pattern, data]) => ({
        pattern,
        count: data.count,
        severity: data.severity,
      }));

    return {
      conformance_rate: conformanceRate,
      fitness_score: fitnessScore,
      total_cases: totalCases,
      conforming_cases: conformingCount,
      non_conforming_cases: totalCases - conformingCount,
      process_type: this.model.processType,
      severity_summary: severitySummary,
      deviation_type_summary: deviationTypeSummary,
      deviations: allDeviations,
      top_deviations: topDeviations,
      metadata: {
        analyzed_at: new Date().toISOString(),
        reference_model: this.model.name,
        model_version: this.model.version,
        filters_applied: {},
      },
    };
  }

  /**
   * Get the reference model being used
   */
  getModel(): ReferenceModel {
    return this.model;
  }
}

/**
 * Create a conformance checker for a given model
 */
export function createChecker(model: ReferenceModel): ConformanceChecker {
  return new ConformanceChecker(model);
}
