/**
 * Contradiction Engine — central orchestrator
 *
 * Accepts registered comparators, runs them against paired records from
 * different systems, collects ContradictionFindings, and returns scored
 * results.  If a comparator throws, the engine logs the error and
 * continues — one bad comparator never kills the whole run.
 */

import { randomUUID as _randomUUID } from 'node:crypto';

// ---------------------------------------------------------------------------
// Type definitions (shared contract across the contradiction subsystem)
// ---------------------------------------------------------------------------

export type SystemType = 'SAP' | 'NetSuite' | 'Salesforce';

export type ContradictionType =
  | 'AMOUNT_DIVERGENCE'
  | 'DATE_CONFLICT'
  | 'STATUS_INCOMPATIBLE'
  | 'ENTITY_MISMATCH'
  | 'QUANTITY_DIVERGENCE'
  | 'APPROVAL_BYPASS'
  | 'TEMPORAL_IMPOSSIBILITY'
  | 'DUPLICATE_REFERENCE'
  | 'ORPHAN_RECORD'
  | 'RETROACTIVE_CHANGE'
  | 'SOD_VIOLATION'
  | 'SCHEMA_GHOST';

export type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';

export type ResolutionStatus = 'open' | 'confirmed' | 'explained' | 'false_positive';

export interface ContradictionFinding {
  id: string;
  type: ContradictionType;
  severity: Severity;
  confidence: number;
  description: string;
  leftSystem: SystemType;
  leftTable: string;
  leftRecordId: string;
  leftField: string;
  leftValue: string;
  leftExtractionId: string;
  rightSystem: SystemType;
  rightTable: string;
  rightRecordId: string;
  rightField: string;
  rightValue: string;
  rightExtractionId: string;
  scoringDetails: Record<string, number>;
  detectedAt: string;
  resolutionStatus: ResolutionStatus;
  reviewerNotes: string;
}

export interface ContradictionConfig {
  amountDivergencePercent: number;
  amountDivergenceMinAbsolute: number;
  dateConflictDays: number;
  dateConflictHighDays: number;
  approvalThreshold: number;
  stalePeriodDays: number;
  retroactiveDays: number;
}

export interface ComparisonPair {
  left: {
    system: SystemType;
    table: string;
    recordId: string;
    fields: Record<string, string>;
    extractionId: string;
  };
  right: {
    system: SystemType;
    table: string;
    recordId: string;
    fields: Record<string, string>;
    extractionId: string;
  };
}

export interface ComparisonResult {
  contradictions: ContradictionFinding[];
  recordsCompared: number;
  comparisonsRun: number;
  duration: number;
  errors?: Array<{ comparatorType: ContradictionType; error: string }>;
}

export interface Comparator {
  readonly type: ContradictionType;
  compare(pair: ComparisonPair, config: ContradictionConfig): ContradictionFinding | null;
}

// ---------------------------------------------------------------------------
// Default configuration
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: ContradictionConfig = {
  amountDivergencePercent: 0.05,
  amountDivergenceMinAbsolute: 10,
  dateConflictDays: 7,
  dateConflictHighDays: 30,
  approvalThreshold: 10_000,
  stalePeriodDays: 90,
  retroactiveDays: 14,
};

// ---------------------------------------------------------------------------
// Severity ranking (for sorting — lower index = higher priority)
// ---------------------------------------------------------------------------

const SEVERITY_RANK: Record<Severity, number> = {
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
  INFO: 4,
};

// ---------------------------------------------------------------------------
// ContradictionEngine
// ---------------------------------------------------------------------------

export class ContradictionEngine {
  private comparators: Comparator[] = [];
  private config: ContradictionConfig;

  constructor(config?: Partial<ContradictionConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /** Register a single comparator. */
  registerComparator(comparator: Comparator): void {
    this.comparators.push(comparator);
  }

  /** Register multiple comparators at once. */
  registerAll(comparators: Comparator[]): void {
    for (const c of comparators) {
      this.comparators.push(c);
    }
  }

  /** Run all registered comparators against a single pair. */
  analyzePair(pair: ComparisonPair): ContradictionFinding[] {
    const findings: ContradictionFinding[] = [];

    for (const comparator of this.comparators) {
      try {
        const finding = comparator.compare(pair, this.config);
        if (finding) {
          findings.push(finding);
        }
      } catch (err: unknown) {
        // Log but don't crash — one bad comparator must not kill the run
        const message = err instanceof Error ? err.message : String(err);
        console.error(
          `[ContradictionEngine] Comparator ${comparator.type} threw: ${message}`,
        );
      }
    }

    return this.sortFindings(findings);
  }

  /** Run all comparators against an array of pairs. */
  analyzeAll(pairs: ComparisonPair[]): ComparisonResult {
    const start = performance.now();
    const allFindings: ContradictionFinding[] = [];
    const errors: Array<{ comparatorType: ContradictionType; error: string }> = [];
    let comparisonsRun = 0;

    for (const pair of pairs) {
      for (const comparator of this.comparators) {
        comparisonsRun++;
        try {
          const finding = comparator.compare(pair, this.config);
          if (finding) {
            allFindings.push(finding);
          }
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          errors.push({ comparatorType: comparator.type, error: message });
          console.error(
            `[ContradictionEngine] Comparator ${comparator.type} threw: ${message}`,
          );
        }
      }
    }

    const duration = performance.now() - start;

    return {
      contradictions: this.sortFindings(allFindings),
      recordsCompared: pairs.length,
      comparisonsRun,
      duration,
      ...(errors.length > 0 ? { errors } : {}),
    };
  }

  /** Run only the specified comparator types against all pairs. */
  analyzeWithTypes(
    pairs: ComparisonPair[],
    types: ContradictionType[],
  ): ComparisonResult {
    const start = performance.now();
    const allFindings: ContradictionFinding[] = [];
    const errors: Array<{ comparatorType: ContradictionType; error: string }> = [];
    const typeSet = new Set(types);
    const filtered = this.comparators.filter((c) => typeSet.has(c.type));
    let comparisonsRun = 0;

    for (const pair of pairs) {
      for (const comparator of filtered) {
        comparisonsRun++;
        try {
          const finding = comparator.compare(pair, this.config);
          if (finding) {
            allFindings.push(finding);
          }
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          errors.push({ comparatorType: comparator.type, error: message });
          console.error(
            `[ContradictionEngine] Comparator ${comparator.type} threw: ${message}`,
          );
        }
      }
    }

    const duration = performance.now() - start;

    return {
      contradictions: this.sortFindings(allFindings),
      recordsCompared: pairs.length,
      comparisonsRun,
      duration,
      ...(errors.length > 0 ? { errors } : {}),
    };
  }

  /** Return the ContradictionType of every registered comparator. */
  getRegisteredTypes(): ContradictionType[] {
    return this.comparators.map((c) => c.type);
  }

  /** Merge partial config updates into the current configuration. */
  updateConfig(config: Partial<ContradictionConfig>): void {
    this.config = { ...this.config, ...config };
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  /** Sort findings by severity (CRITICAL first) then by confidence descending. */
  private sortFindings(findings: ContradictionFinding[]): ContradictionFinding[] {
    return findings.sort((a, b) => {
      const sevDiff = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
      if (sevDiff !== 0) return sevDiff;
      return b.confidence - a.confidence; // higher confidence first
    });
  }
}
