/**
 * Amount and Quantity Divergence Comparators
 *
 * Cross-system comparators that detect mismatches in monetary amounts
 * and item quantities between ERP / CRM records.
 */

import { randomUUID } from 'node:crypto';

// ---------------------------------------------------------------------------
// Local type definitions (shared contract with the engine in Task 1)
// ---------------------------------------------------------------------------

export type SystemType = 'SAP' | 'NetSuite' | 'Salesforce';

export type ContradictionType = 'AMOUNT_DIVERGENCE' | 'QUANTITY_DIVERGENCE';

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

export interface Comparator {
  readonly type: ContradictionType;
  compare(pair: ComparisonPair, config: ContradictionConfig): ContradictionFinding | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Well-known SAP / CRM amount field names. */
const AMOUNT_FIELDS = ['NETWR', 'Amount', 'amount', 'DMBTR', 'WRBTR', 'RMWWR'];

/** Regex for loose matching of amount-like field names. */
const AMOUNT_PATTERN = /amount|price/i;

/** Well-known SAP quantity field names. */
const QUANTITY_FIELDS = ['KWMENG', 'LFIMG', 'FKIMG', 'MENGE', 'Quantity', 'quantity'];

/**
 * Parse a numeric string, handling European format (1.234,56 → 1234.56).
 * Returns NaN for unparseable values.
 */
export function parseNumericValue(raw: string): number {
  const trimmed = raw.trim();

  // European format detection: contains a comma that looks like a decimal separator.
  // Pattern: optional thousands separators (dots) followed by comma + decimals.
  if (/^\d{1,3}(\.\d{3})*(,\d+)$/.test(trimmed)) {
    // Remove thousand-separator dots, swap decimal comma → dot
    return Number(trimmed.replace(/\./g, '').replace(',', '.'));
  }

  // Also handle mixed case: digits with comma as decimal, no thousand sep
  if (/^\d+(,\d+)$/.test(trimmed)) {
    return Number(trimmed.replace(',', '.'));
  }

  return Number(trimmed);
}

/**
 * Detect the first field in `fields` that matches one of the known names
 * or the loose pattern.  Returns `[fieldName, rawValue]` or `undefined`.
 */
function detectField(
  fields: Record<string, string>,
  knownNames: string[],
  pattern?: RegExp
): [string, string] | undefined {
  // Exact match first
  for (const name of knownNames) {
    const val = fields[name];
    if (val !== undefined) return [name, val];
  }
  // Fuzzy match second
  if (pattern) {
    for (const [key, val] of Object.entries(fields)) {
      if (pattern.test(key)) return [key, val];
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// AmountDivergenceComparator
// ---------------------------------------------------------------------------

export class AmountDivergenceComparator implements Comparator {
  readonly type = 'AMOUNT_DIVERGENCE' as const;

  compare(pair: ComparisonPair, config: ContradictionConfig): ContradictionFinding | null {
    const leftHit = detectField(pair.left.fields, AMOUNT_FIELDS, AMOUNT_PATTERN);
    const rightHit = detectField(pair.right.fields, AMOUNT_FIELDS, AMOUNT_PATTERN);

    if (!leftHit || !rightHit) return null;

    const [leftField, leftRaw] = leftHit;
    const [rightField, rightRaw] = rightHit;

    const leftAmount = parseNumericValue(leftRaw);
    const rightAmount = parseNumericValue(rightRaw);

    if (Number.isNaN(leftAmount) || Number.isNaN(rightAmount)) return null;

    const absoluteDivergence = Math.abs(leftAmount - rightAmount);
    const maxAbs = Math.max(Math.abs(leftAmount), Math.abs(rightAmount));
    const percentDivergence = maxAbs === 0 ? 0 : absoluteDivergence / maxAbs;

    if (
      percentDivergence <= config.amountDivergencePercent ||
      absoluteDivergence <= config.amountDivergenceMinAbsolute
    ) {
      return null;
    }

    const severity = this.scoreSeverity(percentDivergence);
    const confidence = this.scoreConfidence(percentDivergence);

    return {
      id: randomUUID(),
      type: this.type,
      severity,
      confidence,
      description:
        `Amount divergence of ${(percentDivergence * 100).toFixed(1)}% ` +
        `($${absoluteDivergence.toFixed(2)}) between ` +
        `${pair.left.system}.${leftField} and ${pair.right.system}.${rightField}`,
      leftSystem: pair.left.system,
      leftTable: pair.left.table,
      leftRecordId: pair.left.recordId,
      leftField,
      leftValue: leftRaw,
      leftExtractionId: pair.left.extractionId,
      rightSystem: pair.right.system,
      rightTable: pair.right.table,
      rightRecordId: pair.right.recordId,
      rightField,
      rightValue: rightRaw,
      rightExtractionId: pair.right.extractionId,
      scoringDetails: {
        percentDivergence,
        absoluteDivergence,
        leftAmount,
        rightAmount,
      },
      detectedAt: new Date().toISOString(),
      resolutionStatus: 'open',
      reviewerNotes: '',
    };
  }

  private scoreSeverity(pct: number): Severity {
    if (pct > 0.2) return 'CRITICAL';
    if (pct > 0.1) return 'HIGH';
    if (pct > 0.05) return 'MEDIUM';
    return 'LOW';
  }

  /**
   * Confidence is *inverse* of divergence: a small but real mismatch is
   * more likely a genuine data issue than a huge one that might just be a
   * unit / currency conversion artefact.
   */
  private scoreConfidence(pct: number): number {
    // Map 0–1 percent → 1.0–0.3 confidence (clamped)
    return Math.max(0.3, Math.min(1.0, 1.0 - pct));
  }
}

// ---------------------------------------------------------------------------
// QuantityDivergenceComparator
// ---------------------------------------------------------------------------

export class QuantityDivergenceComparator implements Comparator {
  readonly type = 'QUANTITY_DIVERGENCE' as const;

  compare(pair: ComparisonPair, config: ContradictionConfig): ContradictionFinding | null {
    const leftHit = detectField(pair.left.fields, QUANTITY_FIELDS);
    const rightHit = detectField(pair.right.fields, QUANTITY_FIELDS);

    if (!leftHit || !rightHit) return null;

    const [leftField, leftRaw] = leftHit;
    const [rightField, rightRaw] = rightHit;

    const leftQty = parseNumericValue(leftRaw);
    const rightQty = parseNumericValue(rightRaw);

    if (Number.isNaN(leftQty) || Number.isNaN(rightQty)) return null;

    const absoluteDivergence = Math.abs(leftQty - rightQty);
    const maxAbs = Math.max(Math.abs(leftQty), Math.abs(rightQty));
    const percentDivergence = maxAbs === 0 ? 0 : absoluteDivergence / maxAbs;

    if (percentDivergence <= config.amountDivergencePercent) {
      return null;
    }

    const severity = this.scoreSeverity(percentDivergence);
    const confidence = this.scoreConfidence(percentDivergence);

    return {
      id: randomUUID(),
      type: this.type,
      severity,
      confidence,
      description:
        `Quantity divergence of ${(percentDivergence * 100).toFixed(1)}% ` +
        `(${absoluteDivergence.toFixed(1)} units) between ` +
        `${pair.left.system}.${leftField} and ${pair.right.system}.${rightField}`,
      leftSystem: pair.left.system,
      leftTable: pair.left.table,
      leftRecordId: pair.left.recordId,
      leftField,
      leftValue: leftRaw,
      leftExtractionId: pair.left.extractionId,
      rightSystem: pair.right.system,
      rightTable: pair.right.table,
      rightRecordId: pair.right.recordId,
      rightField,
      rightValue: rightRaw,
      rightExtractionId: pair.right.extractionId,
      scoringDetails: {
        percentDivergence,
        absoluteDivergence,
        leftQuantity: leftQty,
        rightQuantity: rightQty,
      },
      detectedAt: new Date().toISOString(),
      resolutionStatus: 'open',
      reviewerNotes: '',
    };
  }

  private scoreSeverity(pct: number): Severity {
    if (pct > 0.5) return 'CRITICAL';
    if (pct > 0.2) return 'HIGH';
    if (pct > 0.05) return 'MEDIUM';
    return 'LOW';
  }

  private scoreConfidence(pct: number): number {
    return Math.max(0.3, Math.min(1.0, 1.0 - pct));
  }
}
