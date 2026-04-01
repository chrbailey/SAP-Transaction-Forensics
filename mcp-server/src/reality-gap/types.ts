import type { SystemType } from '../provenance/types.js';

/** Three types of process gaps */
export type GapType = 'design' | 'compliance' | 'shadow';

/** Severity for gaps */
export type GapSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';

/** A documented business rule extracted from SOPs */
export interface WorkflowRule {
  id: string;
  sourceDocument: string;       // e.g., "SOP-AP-001 v3.2"
  section: string;              // e.g., "Section 4.2 - Approval Thresholds"
  ruleText: string;             // Human-readable rule text
  systemScope: SystemType | 'cross-system';
  ruleType: 'approval_threshold' | 'sod_constraint' | 'sequence_requirement' | 'timing_sla' | 'field_validation' | 'routing_rule';
  parameters: Record<string, string | number>;  // e.g., {threshold: 50000, currency: 'USD'}
  extractionPathId?: string | undefined; // FK to extraction registry: how to check this rule
  active: boolean;
}

/** A reference process step from our 7 models */
export interface ReferenceStep {
  modelId: string;              // e.g., 'o2c-detailed'
  stepIndex: number;
  activityName: string;
  sapTcode?: string;
  expectedNext: string[];       // allowed next activities
  required: boolean;
}

/** An actual event from the event log */
export interface ActualEvent {
  caseId: string;
  activityName: string;
  timestamp: string;
  userId: string;
  systemType: SystemType;
  tableName: string;
  recordId: string;
  extractionId?: string;        // FK to provenance
}

/** A gap finding with evidence */
export interface GapFinding {
  id: string;
  gapType: GapType;
  severity: GapSeverity;
  confidence: number;           // 0.0-1.0
  title: string;                // Short description
  description: string;          // Detailed explanation

  // What was expected
  expectedSource: 'reference' | 'documented';
  expectedRule?: string;        // Rule ID or model step
  expectedBehavior: string;

  // What actually happened
  actualBehavior: string;
  actualEvents: string[];       // Event IDs or case IDs
  frequency: number;            // How many times this gap occurred

  // Scoring components
  materiality: number;          // 0.0-1.0 (financial impact)
  recency: number;              // 0.0-1.0 (how recent, 1.0 = today)

  detectedAt: string;
  systemScope: SystemType | 'cross-system';
}

/** Configuration for gap detection */
export interface GapDetectionConfig {
  minFrequency: number;         // Minimum occurrences to report (default: 1)
  minMateriality: number;       // Minimum materiality score (default: 0.0)
  lookbackDays: number;         // How far back to analyze (default: 365)
  includeDesignGaps: boolean;
  includeComplianceGaps: boolean;
  includeShadowGaps: boolean;
}

export const DEFAULT_GAP_CONFIG: GapDetectionConfig = {
  minFrequency: 1,
  minMateriality: 0.0,
  lookbackDays: 365,
  includeDesignGaps: true,
  includeComplianceGaps: true,
  includeShadowGaps: true,
};

/** Result of a gap detection run */
export interface GapDetectionResult {
  designGaps: GapFinding[];
  complianceGaps: GapFinding[];
  shadowGaps: GapFinding[];
  totalCasesAnalyzed: number;
  totalEventsAnalyzed: number;
  duration: number;
}
