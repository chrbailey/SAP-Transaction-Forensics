/**
 * Entity, Reference, and Orphan Comparators
 *
 * Cross-system comparators that validate entity matches produced by the
 * EntityResolver (proximity strategy), detect duplicate cross-references,
 * and flag orphan records with no counterpart in the other system.
 */

import { randomUUID } from 'node:crypto';

// ---------------------------------------------------------------------------
// Local type definitions (shared contract with the engine / amount.ts)
// ---------------------------------------------------------------------------

export type SystemType = 'SAP' | 'NetSuite' | 'Salesforce';

export type ContradictionType = 'ENTITY_MISMATCH' | 'DUPLICATE_REFERENCE' | 'ORPHAN_RECORD';

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

// ---------------------------------------------------------------------------
// Entity-specific input types
// ---------------------------------------------------------------------------

/** A pair produced by EntityResolver with its match confidence and strategy. */
export interface MatchedEntityPair extends ComparisonPair {
  matchConfidence: number;
  matchStrategy: 'explicit_id' | 'proximity' | 'temporal';
}

/** Input for DuplicateReferenceComparator: the full set of matched pairs. */
export type MatchedEntityPairSet = MatchedEntityPair[];

/** Input for OrphanRecordComparator: a single record + candidate matches. */
export interface OrphanCheckInput {
  record: {
    system: SystemType;
    table: string;
    recordId: string;
    fields: Record<string, string>;
    extractionId: string;
  };
  /** Potential counterparts found by EntityResolver. Empty = orphan candidate. */
  potentialMatches: Array<{
    system: SystemType;
    table: string;
    recordId: string;
    fields: Record<string, string>;
    extractionId: string;
  }>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Levenshtein similarity normalised to [0, 1].
 * 0 = completely different, 1 = identical.
 * Both empty strings → 1.0 (identical by definition).
 */
export function levenshteinSimilarity(a: string, b: string): number {
  const la = a.toLowerCase();
  const lb = b.toLowerCase();

  const maxLen = Math.max(la.length, lb.length);
  if (maxLen === 0) return 1.0;

  const dist = levenshteinDistance(la, lb);
  return 1 - dist / maxLen;
}

/**
 * Standard Levenshtein edit distance — O(m*n) DP.
 * Kept private; the public API is levenshteinSimilarity.
 */
function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  // Use shorter string for the row to minimise memory
  if (a.length > b.length) {
    [a, b] = [b, a];
  }

  const m = a.length;
  const n = b.length;

  let prev: number[] = Array.from({ length: m + 1 }, (_, i) => i);
  let curr: number[] = new Array<number>(m + 1);

  for (let j = 1; j <= n; j++) {
    curr[0] = j;
    for (let i = 1; i <= m; i++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[i] = Math.min((prev[i] ?? 0) + 1, (curr[i - 1] ?? 0) + 1, (prev[i - 1] ?? 0) + cost);
    }
    [prev, curr] = [curr, prev];
  }

  return prev[m] ?? 0;
}

/** Well-known name fields per system. */
const NAME_FIELDS_LEFT = ['KUNNR', 'NAME1', 'customer_name', 'KUNNR_NAME1'];
const NAME_FIELDS_RIGHT = ['AccountName', 'account_name', 'Account_Name'];

/** Currency field names. */
const CURRENCY_FIELDS = ['WAERK', 'CurrencyIsoCode', 'currency', 'Currency'];

/** Reference fields that link one system to another. */
const REFERENCE_FIELDS = ['sap_order_number', 'BSTNK', 'EBELN', 'sap_reference', 'external_ref'];

/**
 * Find the first matching field value from a list of known names.
 */
function findField(fields: Record<string, string>, names: string[]): string | undefined {
  for (const name of names) {
    const val = fields[name];
    if (val !== undefined && val.trim() !== '') return val;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// EntityMismatchComparator
// ---------------------------------------------------------------------------

export class EntityMismatchComparator {
  readonly type = 'ENTITY_MISMATCH' as const;

  /**
   * Validates that a proximity-matched pair actually has agreeing key fields.
   * Returns a finding if name similarity is low or currencies disagree.
   */
  compare(pair: MatchedEntityPair, _config: ContradictionConfig): ContradictionFinding | null {
    // Only meaningful for proximity matches — explicit ID matches are trusted
    if (pair.matchStrategy === 'explicit_id') return null;

    const leftName = findField(pair.left.fields, NAME_FIELDS_LEFT) ?? '';
    const rightName = findField(pair.right.fields, NAME_FIELDS_RIGHT) ?? '';

    const nameSim = levenshteinSimilarity(leftName, rightName);

    const leftCurrency = findField(pair.left.fields, CURRENCY_FIELDS);
    const rightCurrency = findField(pair.right.fields, CURRENCY_FIELDS);
    const currencyMatch =
      leftCurrency !== undefined && rightCurrency !== undefined
        ? leftCurrency.toUpperCase() === rightCurrency.toUpperCase()
          ? 1
          : 0
        : 1; // If either is missing, don't penalise — no data to contradict

    // Trigger on low name similarity
    if (nameSim >= 0.5 && currencyMatch === 1) return null;

    const confidence = Math.min(1.0, Math.max(0.0, 1.0 - pair.matchConfidence));
    const severity = this.scoreSeverity(pair.matchConfidence, currencyMatch);

    const reasons: string[] = [];
    if (nameSim < 0.5) reasons.push(`name similarity ${nameSim.toFixed(2)}`);
    if (currencyMatch === 0)
      reasons.push(`currency mismatch (${leftCurrency} vs ${rightCurrency})`);

    return {
      id: randomUUID(),
      type: this.type,
      severity,
      confidence,
      description:
        `Entity mismatch between ${pair.left.system} ${pair.left.recordId} and ` +
        `${pair.right.system} ${pair.right.recordId}: ${reasons.join(', ')}`,
      leftSystem: pair.left.system,
      leftTable: pair.left.table,
      leftRecordId: pair.left.recordId,
      leftField: 'NAME1',
      leftValue: leftName,
      leftExtractionId: pair.left.extractionId,
      rightSystem: pair.right.system,
      rightTable: pair.right.table,
      rightRecordId: pair.right.recordId,
      rightField: 'AccountName',
      rightValue: rightName,
      rightExtractionId: pair.right.extractionId,
      scoringDetails: {
        nameSimilarity: nameSim,
        matchConfidence: pair.matchConfidence,
        currencyMatch,
      },
      detectedAt: new Date().toISOString(),
      resolutionStatus: 'open',
      reviewerNotes: '',
    };
  }

  private scoreSeverity(matchConfidence: number, currencyMatch: number): Severity {
    // Lower match confidence → higher severity (the resolver was already uncertain)
    if (currencyMatch === 0) return 'HIGH';
    if (matchConfidence < 0.55) return 'HIGH';
    if (matchConfidence < 0.65) return 'MEDIUM';
    return 'LOW';
  }
}

// ---------------------------------------------------------------------------
// DuplicateReferenceComparator
// ---------------------------------------------------------------------------

export class DuplicateReferenceComparator {
  readonly type = 'DUPLICATE_REFERENCE' as const;

  /**
   * Scans the full set of matched pairs for duplicate cross-references:
   * two or more records in one system referencing the same record in another.
   */
  compare(pairs: MatchedEntityPairSet, _config: ContradictionConfig): ContradictionFinding[] {
    const findings: ContradictionFinding[] = [];

    // Index: reference value → list of pairs that carry it
    const refIndex = new Map<string, MatchedEntityPair[]>();

    for (const pair of pairs) {
      // Check left side for reference fields pointing to right system
      for (const fieldName of REFERENCE_FIELDS) {
        const leftRef = pair.left.fields[fieldName];
        if (leftRef !== undefined && leftRef.trim() !== '') {
          const key = `left:${fieldName}:${leftRef}`;
          const list = refIndex.get(key) ?? [];
          list.push(pair);
          refIndex.set(key, list);
        }

        const rightRef = pair.right.fields[fieldName];
        if (rightRef !== undefined && rightRef.trim() !== '') {
          const key = `right:${fieldName}:${rightRef}`;
          const list = refIndex.get(key) ?? [];
          list.push(pair);
          refIndex.set(key, list);
        }
      }
    }

    // Emit findings for any reference that appears more than once
    for (const [key, group] of refIndex.entries()) {
      if (group.length < 2) continue;

      const [_side, fieldName, refValue] = key.split(':') as [string, string, string];
      const first = group[0]!;
      const second = group[1]!;

      findings.push({
        id: randomUUID(),
        type: this.type,
        severity: 'HIGH',
        confidence: 0.8,
        description:
          `Duplicate reference: ${group.length} records reference ` +
          `${fieldName}="${refValue}" — possible duplicate bookings or amendments`,
        leftSystem: first.left.system,
        leftTable: first.left.table,
        leftRecordId: first.left.recordId,
        leftField: fieldName ?? '',
        leftValue: refValue ?? '',
        leftExtractionId: first.left.extractionId,
        rightSystem: second.left.system,
        rightTable: second.left.table,
        rightRecordId: second.left.recordId,
        rightField: fieldName ?? '',
        rightValue: refValue ?? '',
        rightExtractionId: second.left.extractionId,
        scoringDetails: {
          duplicateCount: group.length,
          confidence: 0.8,
        },
        detectedAt: new Date().toISOString(),
        resolutionStatus: 'open',
        reviewerNotes: '',
      });
    }

    return findings;
  }
}

// ---------------------------------------------------------------------------
// OrphanRecordComparator
// ---------------------------------------------------------------------------

export class OrphanRecordComparator {
  readonly type = 'ORPHAN_RECORD' as const;

  /**
   * Detects records in one system with no counterpart in the other.
   * For SFDC: Closed Won opportunities without a matching SAP order.
   * For SAP: orders with BSTNK (external PO ref) whose referenced PO is missing.
   */
  compare(input: OrphanCheckInput, _config: ContradictionConfig): ContradictionFinding | null {
    // If there are potential matches, not an orphan
    if (input.potentialMatches.length > 0) return null;

    const { record } = input;
    const fields = record.fields;

    // SFDC path: Closed Won opportunity with no SAP match
    const stage = fields['StageName'] ?? fields['stage'] ?? fields['Stage'];
    const isSfdcClosedWon = record.system === 'Salesforce' && stage === 'Closed Won';

    // SAP path: order with BSTNK (customer PO reference) but no match for that PO
    const bstnk = fields['BSTNK'] ?? '';
    const isSapWithExternalRef = record.system === 'SAP' && bstnk.trim() !== '';

    // Only flag if one of the meaningful conditions is met
    if (!isSfdcClosedWon && !isSapWithExternalRef) return null;

    const amount = parseFloat(fields['Amount'] ?? fields['amount'] ?? fields['NETWR'] ?? '0');
    const dateStr = fields['CloseDate'] ?? fields['close_date'] ?? fields['ERDAT'] ?? '';
    const ageDays = this.computeAgeDays(dateStr);
    const hasExternalRef = isSapWithExternalRef ? 1 : 0;

    const severity = this.scoreSeverity(ageDays, amount);

    return {
      id: randomUUID(),
      type: this.type,
      severity,
      confidence: 0.7,
      description:
        `Orphan record: ${record.system} ${record.recordId} ` +
        (isSfdcClosedWon
          ? `(Closed Won, $${amount.toFixed(0)}) has no matching SAP order`
          : `has external ref BSTNK="${bstnk}" with no counterpart`),
      leftSystem: record.system,
      leftTable: record.table,
      leftRecordId: record.recordId,
      leftField: isSfdcClosedWon ? 'StageName' : 'BSTNK',
      leftValue: isSfdcClosedWon ? 'Closed Won' : bstnk,
      leftExtractionId: record.extractionId,
      // Right side is the "missing" system — placeholder values
      rightSystem: record.system === 'Salesforce' ? 'SAP' : 'Salesforce',
      rightTable: record.system === 'Salesforce' ? 'VBAK' : 'Opportunity',
      rightRecordId: '',
      rightField: '',
      rightValue: '',
      rightExtractionId: '',
      scoringDetails: {
        ageDays,
        amount: isNaN(amount) ? 0 : amount,
        hasExternalRef,
      },
      detectedAt: new Date().toISOString(),
      resolutionStatus: 'open',
      reviewerNotes: '',
    };
  }

  private computeAgeDays(dateStr: string): number {
    if (!dateStr) return 0;

    let d: Date;
    // SAP YYYYMMDD format
    if (/^\d{8}$/.test(dateStr)) {
      const year = parseInt(dateStr.slice(0, 4), 10);
      const month = parseInt(dateStr.slice(4, 6), 10) - 1;
      const day = parseInt(dateStr.slice(6, 8), 10);
      d = new Date(year, month, day);
    } else {
      d = new Date(dateStr);
    }

    if (isNaN(d.getTime())) return 0;

    const now = new Date();
    return Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
  }

  private scoreSeverity(ageDays: number, amount: number): Severity {
    // Recent + large = HIGH, old + small = LOW
    const isRecent = ageDays < 90;
    const isLarge = amount >= 50000;

    if (isRecent && isLarge) return 'HIGH';
    if (isRecent || isLarge) return 'MEDIUM';
    return 'LOW';
  }
}
