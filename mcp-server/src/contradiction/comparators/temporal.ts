/**
 * Temporal Comparators — Date Conflict & Temporal Impossibility Detection
 *
 * Two comparators for cross-system date conflicts and logically
 * impossible event sequences (e.g., invoice before delivery).
 */

// ---------------------------------------------------------------------------
// Types (local definitions — matches contradiction module interface)
// ---------------------------------------------------------------------------

type SystemType = 'SAP' | 'NetSuite' | 'Salesforce';
type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';

type ContradictionType = 'DATE_CONFLICT' | 'TEMPORAL_IMPOSSIBILITY';

interface ContradictionFinding {
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
  resolutionStatus: 'open' | 'confirmed' | 'explained' | 'false_positive';
  reviewerNotes: string;
}

interface ContradictionConfig {
  amountDivergencePercent: number;
  amountDivergenceMinAbsolute: number;
  dateConflictDays: number;
  dateConflictHighDays: number;
  approvalThreshold: number;
  stalePeriodDays: number;
  retroactiveDays: number;
}

interface ComparisonPair {
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

interface Comparator {
  readonly type: ContradictionType;
  compare(
    pair: ComparisonPair,
    config: ContradictionConfig,
  ): ContradictionFinding | null;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MS_PER_DAY = 86_400_000;

/** SAP date fields (transaction, document, posting, change dates). */
const SAP_DATE_FIELDS = new Set([
  'ERDAT', 'AEDAT', 'FKDAT', 'BUDAT', 'BLDAT', 'CPUDT', 'LFDAT', 'WADAT',
]);

/** Salesforce standard date fields. */
const SFDC_DATE_FIELDS = new Set([
  'CloseDate', 'CreatedDate', 'LastModifiedDate', 'ActivityDate',
]);

/** Regex to detect date-suffixed field names. */
const DATE_SUFFIX_RE = /(?:_date|_DATE|Date)$/;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse a date string in any of the common cross-system formats:
 *   - YYYYMMDD       (SAP internal)
 *   - YYYY-MM-DD     (ISO date)
 *   - DD.MM.YYYY     (SAP European display)
 *   - Full ISO 8601  (with optional time component)
 *
 * Returns `null` for unparseable or clearly invalid input.
 */
export function parseFlexibleDate(value: string): Date | null {
  if (!value || typeof value !== 'string') return null;

  const trimmed = value.trim();
  if (trimmed.length === 0) return null;

  // YYYYMMDD — SAP internal (must be exactly 8 digits)
  if (/^\d{8}$/.test(trimmed)) {
    const y = Number(trimmed.slice(0, 4));
    const m = Number(trimmed.slice(4, 6)) - 1;
    const d = Number(trimmed.slice(6, 8));
    const date = new Date(Date.UTC(y, m, d));
    if (
      date.getUTCFullYear() === y &&
      date.getUTCMonth() === m &&
      date.getUTCDate() === d
    ) {
      return date;
    }
    return null;
  }

  // DD.MM.YYYY — SAP European display
  const euMatch = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(trimmed);
  if (euMatch) {
    const d = Number(euMatch[1]);
    const m = Number(euMatch[2]) - 1;
    const y = Number(euMatch[3]);
    const date = new Date(Date.UTC(y, m, d));
    if (
      date.getUTCFullYear() === y &&
      date.getUTCMonth() === m &&
      date.getUTCDate() === d
    ) {
      return date;
    }
    return null;
  }

  // ISO 8601 date or datetime (YYYY-MM-DD or YYYY-MM-DDTHH:mm:ss...)
  const isoMatch =
    /^(\d{4})-(\d{2})-(\d{2})(?:T\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?$/.exec(
      trimmed,
    );
  if (isoMatch) {
    const parsed = new Date(trimmed);
    if (!isNaN(parsed.getTime())) {
      return parsed;
    }
    return null;
  }

  return null;
}

/** True when `fieldName` is a recognised date field. */
function isDateField(fieldName: string): boolean {
  return (
    SAP_DATE_FIELDS.has(fieldName) ||
    SFDC_DATE_FIELDS.has(fieldName) ||
    DATE_SUFFIX_RE.test(fieldName)
  );
}

/** Return all date-field names present in a record. */
function dateFieldsIn(fields: Record<string, string>): string[] {
  return Object.keys(fields).filter(isDateField);
}

/** Absolute day gap between two dates. */
function dayGap(a: Date, b: Date): number {
  return Math.abs(a.getTime() - b.getTime()) / MS_PER_DAY;
}

/** Generate a unique finding ID. */
function findingId(type: string, leftId: string, rightId: string): string {
  return `${type}:${leftId}:${rightId}:${Date.now()}`;
}

// ---------------------------------------------------------------------------
// DateConflictComparator
// ---------------------------------------------------------------------------

/**
 * Detects date divergences between matching records in different systems.
 *
 * Compares recognised date fields on both sides, flags any pair whose gap
 * exceeds `config.dateConflictDays`, and applies a direction weight when
 * the SAP date is chronologically *after* the Salesforce date (which is
 * operationally more suspicious — order recorded after the deal closed).
 */
export class DateConflictComparator implements Comparator {
  readonly type = 'DATE_CONFLICT' as const;

  compare(
    pair: ComparisonPair,
    config: ContradictionConfig,
  ): ContradictionFinding | null {
    const leftDateFields = dateFieldsIn(pair.left.fields);
    const rightDateFields = dateFieldsIn(pair.right.fields);

    // Try every combination; return the first finding that exceeds threshold.
    for (const lf of leftDateFields) {
      const lDate = parseFlexibleDate(pair.left.fields[lf]!);
      if (!lDate) continue;

      for (const rf of rightDateFields) {
        const rDate = parseFlexibleDate(pair.right.fields[rf]!);
        if (!rDate) continue;

        const gap = dayGap(lDate, rDate);
        if (gap <= config.dateConflictDays) continue;

        // Direction weight: SAP date AFTER SFDC date is worse
        let directionWeight = 1;
        if (
          pair.left.system === 'SAP' &&
          pair.right.system === 'Salesforce' &&
          lDate.getTime() > rDate.getTime()
        ) {
          directionWeight = 1.5;
        } else if (
          pair.right.system === 'SAP' &&
          pair.left.system === 'Salesforce' &&
          rDate.getTime() > lDate.getTime()
        ) {
          directionWeight = 1.5;
        }

        // Severity
        let severity: Severity;
        const effectiveGap = gap * directionWeight;
        if (effectiveGap > config.dateConflictHighDays) {
          severity = 'HIGH';
        } else {
          severity = 'MEDIUM';
        }

        return {
          id: findingId(this.type, pair.left.recordId, pair.right.recordId),
          type: this.type,
          severity,
          confidence: 0.85,
          description:
            `Date conflict: ${pair.left.system}.${lf} (${pair.left.fields[lf]!}) ` +
            `vs ${pair.right.system}.${rf} (${pair.right.fields[rf]!}) — ` +
            `${Math.round(gap)} day gap`,
          leftSystem: pair.left.system,
          leftTable: pair.left.table,
          leftRecordId: pair.left.recordId,
          leftField: lf,
          leftValue: pair.left.fields[lf]!,
          leftExtractionId: pair.left.extractionId,
          rightSystem: pair.right.system,
          rightTable: pair.right.table,
          rightRecordId: pair.right.recordId,
          rightField: rf,
          rightValue: pair.right.fields[rf]!,
          rightExtractionId: pair.right.extractionId,
          scoringDetails: {
            gapDays: gap,
            leftDate: lDate.getTime(),
            rightDate: rDate.getTime(),
            directionWeight,
          },
          detectedAt: new Date().toISOString(),
          resolutionStatus: 'open',
          reviewerNotes: '',
        };
      }
    }

    return null;
  }
}

// ---------------------------------------------------------------------------
// TemporalImpossibilityComparator
// ---------------------------------------------------------------------------

/**
 * Known causal sequences: each entry says "the field in `before` must have
 * a date that is chronologically <= the field in `after`".
 */
interface CausalRule {
  before: string;
  after: string;
  label: string;
}

const CAUSAL_RULES: CausalRule[] = [
  { before: 'ERDAT', after: 'LFDAT', label: 'order before delivery' },
  { before: 'ERDAT', after: 'WADAT_IST', label: 'order before delivery' },
  { before: 'WADAT_IST', after: 'FKDAT', label: 'delivery before invoice' },
  { before: 'LFDAT', after: 'FKDAT', label: 'delivery before invoice' },
  { before: 'FKDAT', after: 'BUDAT', label: 'invoice before payment' },
  { before: 'ERDAT', after: 'BUDAT', label: 'PO date before goods receipt' },
  { before: 'CreatedDate', after: 'CloseDate', label: 'create before close' },
];

/**
 * Detects logically impossible date sequences within a single record or
 * across matched records — e.g., an invoice dated before the goods were
 * delivered.
 *
 * All findings are CRITICAL (a temporal impossibility is a hard data error)
 * with confidence 0.95.
 */
export class TemporalImpossibilityComparator implements Comparator {
  readonly type = 'TEMPORAL_IMPOSSIBILITY' as const;

  compare(
    pair: ComparisonPair,
    _config: ContradictionConfig,
  ): ContradictionFinding | null {
    // Merge fields from both sides so we can check cross-system sequences
    const merged: Record<string, { value: string; side: 'left' | 'right' }> =
      {};

    for (const [k, v] of Object.entries(pair.left.fields)) {
      merged[k] = { value: v, side: 'left' };
    }
    for (const [k, v] of Object.entries(pair.right.fields)) {
      // Right side wins on collision — both will be checked anyway
      if (!(k in merged)) {
        merged[k] = { value: v, side: 'right' };
      }
    }

    for (const rule of CAUSAL_RULES) {
      const beforeEntry = merged[rule.before];
      const afterEntry = merged[rule.after];
      if (!beforeEntry || !afterEntry) continue;

      const beforeDate = parseFlexibleDate(beforeEntry.value);
      const afterDate = parseFlexibleDate(afterEntry.value);
      if (!beforeDate || !afterDate) continue;

      // Impossible: the "before" event has a LATER date than the "after" event
      if (beforeDate.getTime() > afterDate.getTime()) {
        const impossibleGapDays = dayGap(beforeDate, afterDate);

        const beforeSide =
          beforeEntry.side === 'left' ? pair.left : pair.right;
        const afterSide = afterEntry.side === 'left' ? pair.left : pair.right;

        return {
          id: findingId(
            this.type,
            pair.left.recordId,
            pair.right.recordId,
          ),
          type: this.type,
          severity: 'CRITICAL',
          confidence: 0.95,
          description:
            `Temporal impossibility: ${rule.before} (${beforeEntry.value}) is after ` +
            `${rule.after} (${afterEntry.value}) — violates expected ${rule.label}`,
          leftSystem: beforeSide.system,
          leftTable: beforeSide.table,
          leftRecordId: beforeSide.recordId,
          leftField: rule.before,
          leftValue: beforeEntry.value,
          leftExtractionId: beforeSide.extractionId,
          rightSystem: afterSide.system,
          rightTable: afterSide.table,
          rightRecordId: afterSide.recordId,
          rightField: rule.after,
          rightValue: afterEntry.value,
          rightExtractionId: afterSide.extractionId,
          scoringDetails: {
            impossibleGapDays,
            expectedOrder: 1, // encoded as 1 = A_before_B
          },
          detectedAt: new Date().toISOString(),
          resolutionStatus: 'open',
          reviewerNotes: '',
        };
      }
    }

    return null;
  }
}
