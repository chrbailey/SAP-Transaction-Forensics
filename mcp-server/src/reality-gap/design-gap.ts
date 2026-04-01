// =============================================================================
// DESIGN GAP DETECTOR
// Detects gaps between reference process models (best practice) and
// documented business rules (client SOPs / workflow documentation).
// =============================================================================

// ---------------------------------------------------------------------------
// Local types (parallel-build safe — no cross-module imports)
// ---------------------------------------------------------------------------

export type GapSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';

export type SystemType = 'SAP' | 'NetSuite' | 'Salesforce';

export interface WorkflowRule {
  id: string;
  sourceDocument: string;
  section: string;
  ruleText: string;
  systemScope: SystemType | 'cross-system';
  ruleType: string;
  parameters: Record<string, string | number>;
  extractionPathId?: string;
  active: boolean;
}

export interface ReferenceStep {
  modelId: string;
  stepIndex: number;
  activityName: string;
  sapTcode?: string;
  expectedNext: string[];
  required: boolean;
}

export interface GapFinding {
  id: string;
  gapType: 'design' | 'compliance' | 'shadow';
  severity: GapSeverity;
  confidence: number;
  title: string;
  description: string;
  expectedSource: 'reference' | 'documented';
  expectedRule?: string;
  expectedBehavior: string;
  actualBehavior: string;
  actualEvents: string[];
  frequency: number;
  materiality: number;
  recency: number;
  detectedAt: string;
  systemScope: SystemType | 'cross-system';
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let findingCounter = 0;

function generateId(): string {
  findingCounter += 1;
  return `DG-${String(findingCounter).padStart(4, '0')}`;
}

/** Reset the ID counter (useful for deterministic tests). */
export function resetIdCounter(): void {
  findingCounter = 0;
}

function now(): string {
  return new Date().toISOString();
}

/**
 * Normalise a string for fuzzy matching: lower-case, collapse whitespace,
 * strip underscores and hyphens.
 */
function normalise(s: string): string {
  return s
    .toLowerCase()
    .replace(/[_-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------------------------------------------------------------------------
// DesignGapDetector
// ---------------------------------------------------------------------------

export class DesignGapDetector {
  /**
   * Compare reference model steps against documented workflow rules.
   *
   * Finds:
   *  - Missing steps   — reference has it, docs don't
   *  - Extra steps     — docs add steps not in reference
   *  - Weakened controls — reference requires approval, docs have higher
   *                        threshold or no approval
   *  - Sequence deviations — docs prescribe different order than reference
   *  - Missing SoD     — reference implies segregation, docs don't enforce
   */
  detectGaps(
    referenceSteps: ReferenceStep[],
    documentedRules: WorkflowRule[],
  ): GapFinding[] {
    const findings: GapFinding[] = [];

    // 1. Missing steps
    findings.push(...this.detectMissingSteps(referenceSteps, documentedRules));

    // 2. Extra (non-standard) documented steps
    findings.push(...this.detectExtraSteps(referenceSteps, documentedRules));

    // 3. Weakened approval thresholds
    findings.push(...this.detectThresholdGaps(referenceSteps, documentedRules));

    // 4. Missing SoD constraints
    findings.push(...this.detectMissingSoDGaps(referenceSteps, documentedRules));

    // 5. Sequence deviations
    findings.push(...this.detectSequenceGaps(referenceSteps, documentedRules));

    return findings;
  }

  // -----------------------------------------------------------------------
  // Missing steps
  // -----------------------------------------------------------------------

  private detectMissingSteps(
    referenceSteps: ReferenceStep[],
    documentedRules: WorkflowRule[],
  ): GapFinding[] {
    const findings: GapFinding[] = [];

    for (const step of referenceSteps) {
      const match = this.findMatchingRule(step, documentedRules);
      if (match === null) {
        const severity: GapSeverity = step.required ? 'HIGH' : 'LOW';
        findings.push({
          id: generateId(),
          gapType: 'design',
          severity,
          confidence: 0.85,
          title: `Missing ${step.required ? 'required ' : ''}step: ${step.activityName}`,
          description:
            `Reference model "${step.modelId}" requires "${step.activityName}" ` +
            `at step ${step.stepIndex}, but no corresponding documented rule was found.`,
          expectedSource: 'reference',
          expectedRule: `${step.modelId}:step-${step.stepIndex}`,
          expectedBehavior: `Step "${step.activityName}" should be documented and enforced.`,
          actualBehavior: 'No matching workflow rule exists in documentation.',
          actualEvents: [],
          frequency: 0,
          materiality: step.required ? 0.9 : 0.3,
          recency: 0,
          detectedAt: now(),
          systemScope: 'SAP',
        });
      }
    }

    return findings;
  }

  // -----------------------------------------------------------------------
  // Extra documented steps (not in reference)
  // -----------------------------------------------------------------------

  private detectExtraSteps(
    referenceSteps: ReferenceStep[],
    documentedRules: WorkflowRule[],
  ): GapFinding[] {
    const findings: GapFinding[] = [];

    // Only consider active rules of type "step" or "process_step"
    const stepRules = documentedRules.filter(
      r => r.active && (r.ruleType === 'step' || r.ruleType === 'process_step'),
    );

    for (const rule of stepRules) {
      const matched = referenceSteps.some(
        s => normalise(s.activityName) === normalise(rule.ruleText),
      );
      if (!matched) {
        findings.push({
          id: generateId(),
          gapType: 'design',
          severity: 'LOW',
          confidence: 0.7,
          title: `Extra documented step: ${rule.ruleText}`,
          description:
            `Workflow rule "${rule.id}" documents step "${rule.ruleText}" ` +
            `which has no counterpart in the reference model.`,
          expectedSource: 'reference',
          expectedBehavior: 'Only reference model steps should be present.',
          actualBehavior: `Documentation adds non-standard step "${rule.ruleText}".`,
          actualEvents: [rule.id],
          frequency: 0,
          materiality: 0.2,
          recency: 0,
          detectedAt: now(),
          systemScope: rule.systemScope,
        });
      }
    }

    return findings;
  }

  // -----------------------------------------------------------------------
  // Weakened approval thresholds
  // -----------------------------------------------------------------------

  private detectThresholdGaps(
    referenceSteps: ReferenceStep[],
    documentedRules: WorkflowRule[],
  ): GapFinding[] {
    const findings: GapFinding[] = [];

    // Find reference steps that imply approval
    const approvalSteps = referenceSteps.filter(s =>
      /approv/i.test(s.activityName),
    );

    for (const step of approvalSteps) {
      // Look for matching approval rules in docs
      const approvalRules = documentedRules.filter(
        r =>
          r.active &&
          r.ruleType === 'approval' &&
          normalise(r.ruleText).includes(normalise(step.activityName)),
      );

      if (approvalRules.length === 0) {
        // No approval rule at all — already caught by missing-step detection
        // if the step is required, but flag the weakened-control angle here
        // only when a *non-required* approval step exists in reference but
        // the docs don't mention approval at all.
        if (!step.required) {
          findings.push({
            id: generateId(),
            gapType: 'design',
            severity: 'MEDIUM',
            confidence: 0.75,
            title: `No approval rule for: ${step.activityName}`,
            description:
              `Reference model suggests an approval step "${step.activityName}" ` +
              `but no corresponding approval rule is documented.`,
            expectedSource: 'reference',
            expectedRule: `${step.modelId}:step-${step.stepIndex}`,
            expectedBehavior: 'Approval should be documented with threshold and scope.',
            actualBehavior: 'No approval rule found in documentation.',
            actualEvents: [],
            frequency: 0,
            materiality: 0.6,
            recency: 0,
            detectedAt: now(),
            systemScope: 'SAP',
          });
        }
        continue;
      }

      // Check whether documented threshold is weaker (higher) than reference
      for (const rule of approvalRules) {
        const docThreshold = Number(rule.parameters['threshold']);
        const refThreshold = Number(
          referenceSteps.find(s => s === step)
            ? (step as ReferenceStep & { threshold?: number }).threshold
            : undefined,
        );

        // If rule has a threshold parameter and it exceeds a reasonable
        // best-practice default (e.g. reference model sets one via convention)
        if (
          !Number.isNaN(docThreshold) &&
          rule.parameters['referenceThreshold'] !== undefined
        ) {
          const bestPractice = Number(rule.parameters['referenceThreshold']);
          if (!Number.isNaN(bestPractice) && docThreshold > bestPractice) {
            findings.push({
              id: generateId(),
              gapType: 'design',
              severity: 'MEDIUM',
              confidence: 0.8,
              title: `Weakened approval threshold: ${step.activityName}`,
              description:
                `Documented approval threshold ($${docThreshold}) exceeds ` +
                `best-practice reference ($${bestPractice}) for "${step.activityName}".`,
              expectedSource: 'reference',
              expectedRule: rule.id,
              expectedBehavior: `Approval threshold <= $${bestPractice}.`,
              actualBehavior: `Documented threshold is $${docThreshold}.`,
              actualEvents: [rule.id],
              frequency: 0,
              materiality: 0.7,
              recency: 0,
              detectedAt: now(),
              systemScope: rule.systemScope,
            });
          }
        }
      }
    }

    return findings;
  }

  // -----------------------------------------------------------------------
  // Missing SoD constraints
  // -----------------------------------------------------------------------

  private detectMissingSoDGaps(
    referenceSteps: ReferenceStep[],
    documentedRules: WorkflowRule[],
  ): GapFinding[] {
    const findings: GapFinding[] = [];

    // SoD-sensitive step pairs: steps that should be performed by different
    // people per best practice (e.g. create PO vs approve PO,
    // post journal vs approve journal, create invoice vs clear invoice).
    const sodPairs = this.identifySoDPairs(referenceSteps);

    const sodRules = documentedRules.filter(
      r => r.active && r.ruleType === 'sod',
    );

    for (const [stepA, stepB] of sodPairs) {
      const hasSoDRule = sodRules.some(r => {
        const ruleNorm = normalise(r.ruleText);
        return (
          (ruleNorm.includes(normalise(stepA.activityName)) &&
            ruleNorm.includes(normalise(stepB.activityName))) ||
          (r.parameters['stepA'] !== undefined &&
            r.parameters['stepB'] !== undefined &&
            normalise(String(r.parameters['stepA'])) ===
              normalise(stepA.activityName) &&
            normalise(String(r.parameters['stepB'])) ===
              normalise(stepB.activityName))
        );
      });

      if (!hasSoDRule) {
        findings.push({
          id: generateId(),
          gapType: 'design',
          severity: 'HIGH',
          confidence: 0.8,
          title: `Missing SoD: ${stepA.activityName} / ${stepB.activityName}`,
          description:
            `Best practice requires segregation of duties between ` +
            `"${stepA.activityName}" and "${stepB.activityName}", ` +
            `but no SoD rule is documented.`,
          expectedSource: 'reference',
          expectedRule: `${stepA.modelId}:sod-${stepA.stepIndex}-${stepB.stepIndex}`,
          expectedBehavior:
            `"${stepA.activityName}" and "${stepB.activityName}" must be ` +
            `performed by different people.`,
          actualBehavior: 'No SoD constraint documented.',
          actualEvents: [],
          frequency: 0,
          materiality: 0.85,
          recency: 0,
          detectedAt: now(),
          systemScope: 'SAP',
        });
      }
    }

    return findings;
  }

  // -----------------------------------------------------------------------
  // Sequence deviations
  // -----------------------------------------------------------------------

  private detectSequenceGaps(
    referenceSteps: ReferenceStep[],
    documentedRules: WorkflowRule[],
  ): GapFinding[] {
    const findings: GapFinding[] = [];

    const sequenceRules = documentedRules.filter(
      r => r.active && r.ruleType === 'sequence',
    );

    for (const rule of sequenceRules) {
      const fromStep = rule.parameters['from'];
      const toStep = rule.parameters['to'];
      if (fromStep === undefined || toStep === undefined) continue;

      const fromRef = referenceSteps.find(
        s => normalise(s.activityName) === normalise(String(fromStep)),
      );
      const toRef = referenceSteps.find(
        s => normalise(s.activityName) === normalise(String(toStep)),
      );

      if (fromRef && toRef && fromRef.stepIndex > toRef.stepIndex) {
        findings.push({
          id: generateId(),
          gapType: 'design',
          severity: 'MEDIUM',
          confidence: 0.75,
          title: `Sequence deviation: ${String(fromStep)} before ${String(toStep)}`,
          description:
            `Documentation prescribes "${String(fromStep)}" → "${String(toStep)}" ` +
            `but the reference model has the reverse order ` +
            `(step ${toRef.stepIndex} before step ${fromRef.stepIndex}).`,
          expectedSource: 'reference',
          expectedRule: rule.id,
          expectedBehavior: `"${toRef.activityName}" (step ${toRef.stepIndex}) before "${fromRef.activityName}" (step ${fromRef.stepIndex}).`,
          actualBehavior: `Documentation says "${String(fromStep)}" → "${String(toStep)}".`,
          actualEvents: [rule.id],
          frequency: 0,
          materiality: 0.5,
          recency: 0,
          detectedAt: now(),
          systemScope: rule.systemScope,
        });
      }
    }

    return findings;
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  /**
   * Check if a specific reference step has a corresponding documented rule.
   * Matches by normalised activity name against rule text for step-type rules.
   */
  private findMatchingRule(
    step: ReferenceStep,
    rules: WorkflowRule[],
  ): WorkflowRule | null {
    const stepNorm = normalise(step.activityName);

    for (const rule of rules) {
      if (!rule.active) continue;

      // Match step-type rules by activity name
      if (
        rule.ruleType === 'step' ||
        rule.ruleType === 'process_step' ||
        rule.ruleType === 'approval' ||
        rule.ruleType === 'sod' ||
        rule.ruleType === 'control'
      ) {
        if (normalise(rule.ruleText).includes(stepNorm)) {
          return rule;
        }
      }

      // Match by SAP tcode if present
      if (step.sapTcode && rule.parameters['tcode'] !== undefined) {
        if (String(rule.parameters['tcode']) === step.sapTcode) {
          return rule;
        }
      }
    }

    return null;
  }

  /**
   * Identify SoD-sensitive pairs from reference steps.
   *
   * Heuristic: any pair where one step name contains "create"/"post" and
   * another contains "approve"/"clear"/"confirm" within the same model
   * implies a segregation requirement.
   */
  private identifySoDPairs(
    steps: ReferenceStep[],
  ): Array<[ReferenceStep, ReferenceStep]> {
    const pairs: Array<[ReferenceStep, ReferenceStep]> = [];
    const initiators = steps.filter(s =>
      /\b(create|post|enter|submit)/i.test(s.activityName),
    );
    const controllers = steps.filter(s =>
      /\b(approv|clear|confirm|review|verif)/i.test(s.activityName),
    );

    for (const init of initiators) {
      for (const ctrl of controllers) {
        if (init.modelId === ctrl.modelId && init.stepIndex !== ctrl.stepIndex) {
          pairs.push([init, ctrl]);
        }
      }
    }

    return pairs;
  }
}
