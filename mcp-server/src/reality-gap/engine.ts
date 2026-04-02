/**
 * Reality-Gap Engine — orchestrator for three-way gap analysis
 *
 * Runs DesignGapDetector (reference vs documented), ComplianceGapDetector
 * (documented vs actual), and ShadowGapDetector (actual vs reference+documented).
 * Aggregates, filters, and sorts the combined findings.
 */

import { randomUUID } from 'node:crypto';
import type {
  ActualEvent,
  GapDetectionConfig,
  GapDetectionResult,
  GapFinding,
  GapSeverity,
  ReferenceStep,
  WorkflowRule,
} from './types.js';
import { DEFAULT_GAP_CONFIG } from './types.js';

// ---------------------------------------------------------------------------
// Severity ranking (for composite scoring — lower index = higher severity)
// ---------------------------------------------------------------------------

const SEVERITY_WEIGHT: Record<GapSeverity, number> = {
  CRITICAL: 1.0,
  HIGH: 0.8,
  MEDIUM: 0.5,
  LOW: 0.3,
  INFO: 0.1,
};

// ---------------------------------------------------------------------------
// Gap Detector interface + inline implementations
//
// These are minimal implementations that detect real structural gaps.
// When dedicated detector modules land, swap the imports.
// ---------------------------------------------------------------------------

interface GapDetector<TArgs extends unknown[]> {
  detect(...args: TArgs): GapFinding[];
}

/**
 * Design gap: reference steps that have no matching documented rule.
 * Detects where the process model says something must happen but no SOP
 * or business rule codifies it.
 */
class DesignGapDetector implements GapDetector<[ReferenceStep[], WorkflowRule[]]> {
  detect(referenceSteps: ReferenceStep[], documentedRules: WorkflowRule[]): GapFinding[] {
    const findings: GapFinding[] = [];
    const _ruleActivities = new Set(
      documentedRules
        .filter((r) => r.active)
        .map((r) => r.ruleText.toLowerCase()),
    );

    for (const step of referenceSteps) {
      if (!step.required) continue;

      const hasRule = documentedRules.some(
        (r) =>
          r.active &&
          (r.ruleText.toLowerCase().includes(step.activityName.toLowerCase()) ||
            (step.sapTcode !== undefined &&
              r.parameters['tcode'] === step.sapTcode)),
      );

      if (!hasRule) {
        findings.push({
          id: randomUUID(),
          gapType: 'design',
          severity: 'HIGH',
          confidence: 0.8,
          title: `Undocumented required step: ${step.activityName}`,
          description: `Reference model '${step.modelId}' requires step '${step.activityName}' (index ${step.stepIndex}) but no active workflow rule documents this requirement.`,
          expectedSource: 'reference',
          expectedRule: `${step.modelId}:${step.stepIndex}`,
          expectedBehavior: `Step '${step.activityName}' should be documented in workflow rules`,
          actualBehavior: 'No matching workflow rule found',
          actualEvents: [],
          frequency: 1,
          materiality: step.required ? 0.7 : 0.3,
          recency: 1.0,
          detectedAt: new Date().toISOString(),
          systemScope: 'cross-system',
        });
      }
    }

    return findings;
  }
}

/**
 * Compliance gap: documented rules that are violated by actual events.
 * Detects where the SOP says one thing but the event log shows another.
 */
class ComplianceGapDetector
  implements GapDetector<[WorkflowRule[], ActualEvent[]]>
{
  detect(documentedRules: WorkflowRule[], actualEvents: ActualEvent[]): GapFinding[] {
    const findings: GapFinding[] = [];

    for (const rule of documentedRules) {
      if (!rule.active) continue;

      if (rule.ruleType === 'sequence_requirement') {
        // Check if the required activity appears in the events
        const matchingEvents = actualEvents.filter(
          (e) =>
            e.activityName.toLowerCase().includes(
              rule.ruleText.toLowerCase().split(' ')[0] ?? '',
            ) || rule.ruleText.toLowerCase().includes(e.activityName.toLowerCase()),
        );

        if (matchingEvents.length === 0) {
          findings.push({
            id: randomUUID(),
            gapType: 'compliance',
            severity: 'MEDIUM',
            confidence: 0.7,
            title: `Rule never executed: ${rule.id}`,
            description: `Documented rule '${rule.id}' from ${rule.sourceDocument} (${rule.section}) requires '${rule.ruleText}' but no matching events found.`,
            expectedSource: 'documented',
            expectedRule: rule.id,
            expectedBehavior: rule.ruleText,
            actualBehavior: 'No matching activity in event log',
            actualEvents: [],
            frequency: 1,
            materiality: 0.6,
            recency: 0.8,
            detectedAt: new Date().toISOString(),
            systemScope: rule.systemScope,
          });
        }
      }

      if (rule.ruleType === 'approval_threshold') {
        const threshold = Number(rule.parameters['threshold']) || 0;
        // Check for events that might bypass approval thresholds
        const relatedEvents = actualEvents.filter((e) =>
          e.activityName.toLowerCase().includes('approv'),
        );

        if (threshold > 0 && relatedEvents.length === 0 && actualEvents.length > 0) {
          findings.push({
            id: randomUUID(),
            gapType: 'compliance',
            severity: 'HIGH',
            confidence: 0.75,
            title: `Approval threshold may be bypassed: ${rule.id}`,
            description: `Rule '${rule.id}' requires approval for amounts above ${threshold} but no approval events detected.`,
            expectedSource: 'documented',
            expectedRule: rule.id,
            expectedBehavior: `Approval required for amounts > ${threshold}`,
            actualBehavior: 'No approval events found in event log',
            actualEvents: actualEvents.map((e) => e.recordId),
            frequency: actualEvents.length,
            materiality: 0.8,
            recency: 0.9,
            detectedAt: new Date().toISOString(),
            systemScope: rule.systemScope,
          });
        }
      }
    }

    return findings;
  }
}

/**
 * Shadow gap: actual events that appear in neither the reference model
 * nor the documented rules. These are undocumented, unmodeled activities
 * — potential shadow processes.
 */
class ShadowGapDetector
  implements GapDetector<[ReferenceStep[], WorkflowRule[], ActualEvent[]]>
{
  detect(
    referenceSteps: ReferenceStep[],
    documentedRules: WorkflowRule[],
    actualEvents: ActualEvent[],
  ): GapFinding[] {
    const findings: GapFinding[] = [];

    // Build sets of known activities
    const referenceActivities = new Set(
      referenceSteps.map((s) => s.activityName.toLowerCase()),
    );
    const ruleActivities = new Set(
      documentedRules
        .filter((r) => r.active)
        .flatMap((r) => {
          // Extract activity-like tokens from rule text
          const words = r.ruleText.toLowerCase().split(/\s+/);
          return words;
        }),
    );

    // Group events by activity to find unknown activities
    const activityGroups = new Map<string, ActualEvent[]>();
    for (const event of actualEvents) {
      const key = event.activityName.toLowerCase();
      const group = activityGroups.get(key) ?? [];
      group.push(event);
      activityGroups.set(key, group);
    }

    for (const [activity, events] of activityGroups) {
      const inReference = referenceActivities.has(activity);
      const inRules = [...ruleActivities].some(
        (token) => token.includes(activity) || activity.includes(token),
      );

      if (!inReference && !inRules) {
        const caseIds = [...new Set(events.map((e) => e.caseId))];
        findings.push({
          id: randomUUID(),
          gapType: 'shadow',
          severity: events.length >= 5 ? 'HIGH' : 'MEDIUM',
          confidence: 0.65,
          title: `Shadow activity: ${events[0]?.activityName ?? activity}`,
          description: `Activity '${events[0]?.activityName ?? activity}' appears ${events.length} time(s) across ${caseIds.length} case(s) but is not in the reference model or documented rules.`,
          expectedSource: 'reference',
          expectedBehavior: 'Activity should be documented in reference model or workflow rules',
          actualBehavior: `Undocumented activity occurring in production`,
          actualEvents: caseIds,
          frequency: events.length,
          materiality: Math.min(events.length / 10, 1.0),
          recency: 0.9,
          detectedAt: new Date().toISOString(),
          systemScope: events[0]?.systemType ?? 'cross-system',
        });
      }
    }

    return findings;
  }
}

// ---------------------------------------------------------------------------
// RealityGapEngine
// ---------------------------------------------------------------------------

export class RealityGapEngine {
  private config: GapDetectionConfig;

  private readonly designDetector = new DesignGapDetector();
  private readonly complianceDetector = new ComplianceGapDetector();
  private readonly shadowDetector = new ShadowGapDetector();

  constructor(config?: Partial<GapDetectionConfig>) {
    this.config = { ...DEFAULT_GAP_CONFIG, ...config };
  }

  /** Run the full three-way gap analysis. */
  analyze(
    referenceSteps: ReferenceStep[],
    documentedRules: WorkflowRule[],
    actualEvents: ActualEvent[],
  ): GapDetectionResult {
    const start = performance.now();

    const designGaps = this.config.includeDesignGaps
      ? this.filterFindings(this.designDetector.detect(referenceSteps, documentedRules))
      : [];

    const complianceGaps = this.config.includeComplianceGaps
      ? this.filterFindings(this.complianceDetector.detect(documentedRules, actualEvents))
      : [];

    const shadowGaps = this.config.includeShadowGaps
      ? this.filterFindings(
          this.shadowDetector.detect(referenceSteps, documentedRules, actualEvents),
        )
      : [];

    const uniqueCaseIds = new Set(actualEvents.map((e) => e.caseId));

    const duration = performance.now() - start;

    return {
      designGaps: this.sortFindings(designGaps),
      complianceGaps: this.sortFindings(complianceGaps),
      shadowGaps: this.sortFindings(shadowGaps),
      totalCasesAnalyzed: uniqueCaseIds.size,
      totalEventsAnalyzed: actualEvents.length,
      duration,
    };
  }

  /** Run only design gap detection (reference vs documented). */
  analyzeDesignGaps(
    referenceSteps: ReferenceStep[],
    documentedRules: WorkflowRule[],
  ): GapFinding[] {
    return this.sortFindings(
      this.filterFindings(this.designDetector.detect(referenceSteps, documentedRules)),
    );
  }

  /** Run only compliance gap detection (documented vs actual). */
  analyzeComplianceGaps(
    documentedRules: WorkflowRule[],
    actualEvents: ActualEvent[],
  ): GapFinding[] {
    return this.sortFindings(
      this.filterFindings(this.complianceDetector.detect(documentedRules, actualEvents)),
    );
  }

  /** Run only shadow gap detection (actual vs reference+documented). */
  analyzeShadowGaps(
    referenceSteps: ReferenceStep[],
    documentedRules: WorkflowRule[],
    actualEvents: ActualEvent[],
  ): GapFinding[] {
    return this.sortFindings(
      this.filterFindings(
        this.shadowDetector.detect(referenceSteps, documentedRules, actualEvents),
      ),
    );
  }

  /** Merge partial config updates into the current configuration. */
  updateConfig(config: Partial<GapDetectionConfig>): void {
    this.config = { ...this.config, ...config };
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  /** Filter findings by config thresholds (minFrequency, minMateriality). */
  private filterFindings(findings: GapFinding[]): GapFinding[] {
    return findings.filter(
      (f) =>
        f.frequency >= this.config.minFrequency &&
        f.materiality >= this.config.minMateriality,
    );
  }

  /** Sort findings by composite score (severity × materiality × frequency) descending. */
  private sortFindings(findings: GapFinding[]): GapFinding[] {
    return [...findings].sort((a, b) => {
      const scoreA =
        SEVERITY_WEIGHT[a.severity] * a.materiality * Math.log2(a.frequency + 1);
      const scoreB =
        SEVERITY_WEIGHT[b.severity] * b.materiality * Math.log2(b.frequency + 1);
      return scoreB - scoreA;
    });
  }
}
