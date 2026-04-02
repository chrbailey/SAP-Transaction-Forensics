/**
 * Change & Compliance Comparators
 *
 * Detects retroactive changes to closed periods, segregation-of-duties
 * violations, and schema ghost fields (references to nonexistent columns).
 */

import { randomUUID } from 'node:crypto';

// ---------------------------------------------------------------------------
// Local type definitions (shared contract with the engine)
// ---------------------------------------------------------------------------

export type SystemType = 'SAP' | 'NetSuite' | 'Salesforce';

export type ChangeContradictionType = 'RETROACTIVE_CHANGE' | 'SOD_VIOLATION' | 'SCHEMA_GHOST';

export type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';

export type ResolutionStatus = 'open' | 'confirmed' | 'explained' | 'false_positive';

export interface ContradictionFinding {
  id: string;
  type: ChangeContradictionType;
  severity: Severity;
  confidence: number;
  description: string;
  system: SystemType;
  table: string;
  recordId: string;
  scoringDetails: Record<string, string | number>;
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

/** Input for pair-based comparators (RetroactiveChange, SoDViolation). */
export interface ChangeRecord {
  system: SystemType;
  table: string;
  recordId: string;
  fields: Record<string, string>;
}

/** Input for SchemaGhostComparator. */
export interface SchemaInput {
  system: SystemType;
  table: string;
  recordId: string;
  record: Record<string, string>;
  validFields: Set<string>;
}

// ---------------------------------------------------------------------------
// SoD conflict pair definitions
// ---------------------------------------------------------------------------

export interface SoDConflictPair {
  name: string;
  leftRole: string;
  rightRole: string;
  leftFields: string[];
  rightFields: string[];
}

const SOD_CONFLICT_PAIRS: SoDConflictPair[] = [
  {
    name: 'post_and_approve',
    leftRole: 'poster',
    rightRole: 'approver',
    leftFields: ['USNAM', 'BNAME', 'CreatedById'],
    rightFields: ['APPROVER', 'ApprovedById', 'FREIGEBER'],
  },
  {
    name: 'create_and_pay',
    leftRole: 'creator',
    rightRole: 'payer',
    leftFields: ['ERNAM', 'CreatedById'],
    rightFields: ['USNAM', 'PaymentProcessedBy', 'LAUFI'],
  },
  {
    name: 'park_and_post',
    leftRole: 'parker',
    rightRole: 'poster',
    leftFields: ['USNAM_PARK', 'ParkedBy'],
    rightFields: ['USNAM', 'PostedBy', 'BNAME'],
  },
  {
    name: 'vendor_master_and_payment',
    leftRole: 'vendor_maintainer',
    rightRole: 'payment_processor',
    leftFields: ['ERNAM', 'ChangedBy', 'AENAM'],
    rightFields: ['USNAM', 'PaymentProcessedBy', 'LAUFI'],
  },
  {
    name: 'create_and_modify',
    leftRole: 'creator',
    rightRole: 'modifier',
    leftFields: ['ERNAM', 'CreatedById'],
    rightFields: ['AENAM', 'LastModifiedById', 'USNAM'],
  },
  {
    name: 'post_and_reverse',
    leftRole: 'poster',
    rightRole: 'reverser',
    leftFields: ['USNAM', 'PostedBy', 'BNAME'],
    rightFields: ['STBLG_USER', 'ReversedBy', 'XSTOV_USER'],
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Known change-date field names. */
const CHANGE_DATE_FIELDS = ['AEDAT', 'CPUDT', 'LastModifiedDate', 'UPDDAT'];

/** Known posting-date field names. */
const POSTING_DATE_FIELDS = ['BUDAT', 'PostingDate'];

/**
 * Parse a SAP YYYYMMDD or ISO date string into { year, month }.
 * Returns undefined for unparseable values.
 */
export function parsePeriod(dateStr: string): { year: number; month: number } | undefined {
  const trimmed = dateStr.trim();

  // SAP YYYYMMDD format
  if (/^\d{8}$/.test(trimmed)) {
    const year = Number(trimmed.slice(0, 4));
    const month = Number(trimmed.slice(4, 6));
    if (year > 0 && month >= 1 && month <= 12) return { year, month };
    return undefined;
  }

  // ISO / standard date format (YYYY-MM-DD...)
  const d = new Date(trimmed);
  if (!Number.isNaN(d.getTime())) {
    return { year: d.getFullYear(), month: d.getMonth() + 1 };
  }

  return undefined;
}

/**
 * Compute period gap in months between two { year, month } objects.
 * Positive means `b` is later than `a`.
 */
function periodGap(a: { year: number; month: number }, b: { year: number; month: number }): number {
  return (b.year - a.year) * 12 + (b.month - a.month);
}

/**
 * Find the first field in `fields` whose name is in `knownNames` and has a
 * non-empty value. Returns `[fieldName, value]` or undefined.
 */
function findField(
  fields: Record<string, string>,
  knownNames: string[]
): [string, string] | undefined {
  for (const name of knownNames) {
    const val = fields[name];
    if (val !== undefined && val !== '') return [name, val];
  }
  return undefined;
}

/**
 * Find the first user-id value from `fields` that matches one of `names`.
 * Returns undefined when no match.
 */
function findUserId(fields: Record<string, string>, names: string[]): string | undefined {
  for (const name of names) {
    const val = fields[name];
    if (val !== undefined && val.trim() !== '') return val.trim();
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// RetroactiveChangeComparator
// ---------------------------------------------------------------------------

export class RetroactiveChangeComparator {
  readonly type = 'RETROACTIVE_CHANGE' as const;

  compare(record: ChangeRecord, _config: ContradictionConfig): ContradictionFinding | null {
    const { fields } = record;

    // Resolve posting period: prefer explicit MONAT/GJAHR, fall back to BUDAT
    let postingPeriod: { year: number; month: number } | undefined;
    let postingDateStr = '';

    const monat = fields['MONAT'];
    const gjahr = fields['GJAHR'];
    if (monat !== undefined && gjahr !== undefined) {
      const m = Number(monat);
      const y = Number(gjahr);
      if (m >= 1 && m <= 12 && y > 0) {
        postingPeriod = { year: y, month: m };
        postingDateStr = `${gjahr}/${monat}`;
      }
    }

    if (!postingPeriod) {
      const hit = findField(fields, POSTING_DATE_FIELDS);
      if (!hit) return null;
      postingDateStr = hit[1];
      postingPeriod = parsePeriod(hit[1]);
      if (!postingPeriod) return null;
    }

    // Resolve change date
    const changeHit = findField(fields, CHANGE_DATE_FIELDS);
    if (!changeHit) return null;
    const [changeDateField, changeDateStr] = changeHit;

    const changePeriod = parsePeriod(changeDateStr);
    if (!changePeriod) return null;

    // Compare periods
    const gap = periodGap(postingPeriod, changePeriod);
    if (gap <= 0) return null; // change is in same or earlier period — no issue

    const severity: Severity = gap > 1 ? 'CRITICAL' : 'HIGH';

    return {
      id: randomUUID(),
      type: this.type,
      severity,
      confidence: 0.9,
      description:
        `Retroactive change detected: record modified in period ` +
        `${changePeriod.year}/${String(changePeriod.month).padStart(2, '0')} ` +
        `but was posted in period ` +
        `${postingPeriod.year}/${String(postingPeriod.month).padStart(2, '0')} ` +
        `(${gap} period${gap > 1 ? 's' : ''} later via ${changeDateField})`,
      system: record.system,
      table: record.table,
      recordId: record.recordId,
      scoringDetails: {
        postingPeriod: postingPeriod.year * 100 + postingPeriod.month,
        changePeriod: changePeriod.year * 100 + changePeriod.month,
        periodGap: gap,
        changeDate: changeDateStr,
        postingDate: postingDateStr,
      },
      detectedAt: new Date().toISOString(),
      resolutionStatus: 'open',
      reviewerNotes: '',
    };
  }
}

// ---------------------------------------------------------------------------
// SoDViolationComparator
// ---------------------------------------------------------------------------

export class SoDViolationComparator {
  readonly type = 'SOD_VIOLATION' as const;

  /** Exposed for testing / extension. */
  static readonly CONFLICT_PAIRS: readonly SoDConflictPair[] = SOD_CONFLICT_PAIRS;

  compare(record: ChangeRecord, _config: ContradictionConfig): ContradictionFinding | null {
    const { fields } = record;

    for (const pair of SOD_CONFLICT_PAIRS) {
      const leftUser = findUserId(fields, pair.leftFields);
      const rightUser = findUserId(fields, pair.rightFields);

      if (!leftUser || !rightUser) continue;

      if (leftUser.toUpperCase() === rightUser.toUpperCase()) {
        return {
          id: randomUUID(),
          type: this.type,
          severity: 'HIGH',
          confidence: 0.95,
          description:
            `Segregation-of-duties violation: user "${leftUser}" performed both ` +
            `${pair.leftRole} and ${pair.rightRole} (${pair.name})`,
          system: record.system,
          table: record.table,
          recordId: record.recordId,
          scoringDetails: {
            userId: leftUser,
            conflictType: pair.name,
            leftAction: pair.leftRole,
            rightAction: pair.rightRole,
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
// SchemaGhostComparator
// ---------------------------------------------------------------------------

export class SchemaGhostComparator {
  readonly type = 'SCHEMA_GHOST' as const;

  compare(input: SchemaInput, _config: ContradictionConfig): ContradictionFinding | null {
    const { record, validFields, system, table, recordId } = input;

    for (const field of Object.keys(record)) {
      if (!validFields.has(field)) {
        return {
          id: randomUUID(),
          type: this.type,
          severity: 'CRITICAL',
          confidence: 1.0,
          description:
            `Schema ghost: field "${field}" on ${system}.${table} ` +
            `does not exist in the valid schema (${validFields.size} known fields)`,
          system,
          table,
          recordId,
          scoringDetails: {
            ghostField: field,
            table,
            validFieldCount: validFields.size,
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
