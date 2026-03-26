// mcp-server/src/cross-system/entity-resolver.ts
// Entity matching: SFDC Opportunities ↔ SAP Sales Orders
// Three strategies: explicit_id, proximity, temporal (reserved)

// ============================================================================
// Interfaces
// ============================================================================

export interface MatchCandidate {
  sfdc_id: string;
  sap_id: string;
  confidence: number;
  strategy: 'explicit_id' | 'proximity' | 'temporal';
  details: Record<string, unknown>;
}

export interface SFDCMatchRecord {
  opportunity_id: string;
  account_name: string;
  amount: number;
  close_date: string; // ISO date string e.g. '2024-03-15'
  sap_order_number: string | null;
}

export interface SAPMatchRecord {
  vbeln: string;
  customer_name: string;
  netwr: number;
  erdat: string; // YYYYMMDD
}

export interface ProximityOptions {
  nameThreshold: number; // Max normalized Levenshtein distance (0-1)
  amountTolerance: number; // Max relative difference (0-1)
  maxDateGapDays: number;
}

const DEFAULT_PROXIMITY_OPTIONS: ProximityOptions = {
  nameThreshold: 0.3,
  amountTolerance: 0.1,
  maxDateGapDays: 45,
};

// ============================================================================
// Levenshtein Distance
// ============================================================================

/**
 * Compute the Levenshtein (edit) distance between two strings.
 * Standard DP implementation, O(m*n) time and O(min(m,n)) space.
 */
export function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  // Use shorter string as the "row" to minimise memory
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
      curr[i] = Math.min(
        (prev[i] ?? 0) + 1, // deletion
        (curr[i - 1] ?? 0) + 1, // insertion
        (prev[i - 1] ?? 0) + cost // substitution
      );
    }
    [prev, curr] = [curr, prev];
  }

  return prev[m] ?? 0;
}

// ============================================================================
// Internal helpers
// ============================================================================

/**
 * Normalized Levenshtein similarity (0=no similarity, 1=identical).
 * Normalised against the length of the longer string.
 */
function nameSimilarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  const dist = levenshteinDistance(a.toLowerCase(), b.toLowerCase());
  return 1 - dist / maxLen;
}

/**
 * Amount similarity clamped to [0,1].
 * Returns 1 when amounts are identical, 0 when relative diff >= 1.
 */
function amountSimilarity(a: number, b: number): number {
  if (a === 0 && b === 0) return 1;
  const ref = Math.max(Math.abs(a), Math.abs(b));
  if (ref === 0) return 1;
  const relDiff = Math.abs(a - b) / ref;
  return Math.max(0, 1 - relDiff);
}

/**
 * Parse SAP YYYYMMDD date string to a Date object.
 */
function parseSAPDate(erdat: string): Date {
  const year = parseInt(erdat.slice(0, 4), 10);
  const month = parseInt(erdat.slice(4, 6), 10) - 1; // 0-indexed
  const day = parseInt(erdat.slice(6, 8), 10);
  return new Date(year, month, day);
}

/**
 * Date similarity: 1 at 0-day gap, decays linearly to 0 at maxGapDays.
 */
function dateSimilarity(isoDate: string, erdat: string, maxGapDays: number): number {
  if (maxGapDays <= 0) return 0;
  const d1 = new Date(isoDate);
  const d2 = parseSAPDate(erdat);
  const gapDays = Math.abs(d1.getTime() - d2.getTime()) / (1000 * 60 * 60 * 24);
  return Math.max(0, 1 - gapDays / maxGapDays);
}

// ============================================================================
// EntityResolver
// ============================================================================

export class EntityResolver {
  /**
   * Strategy 1 — Explicit ID match.
   * Matches where sfdc.sap_order_number === sap.vbeln.
   * Returns confidence 0.99.
   */
  resolveExplicitId(sfdc: SFDCMatchRecord[], sap: SAPMatchRecord[]): MatchCandidate[] {
    const sapIndex = new Map<string, SAPMatchRecord>();
    for (const record of sap) {
      sapIndex.set(record.vbeln, record);
    }

    const candidates: MatchCandidate[] = [];
    for (const opp of sfdc) {
      if (opp.sap_order_number === null) continue;
      const sapRecord = sapIndex.get(opp.sap_order_number);
      if (!sapRecord) continue;

      candidates.push({
        sfdc_id: opp.opportunity_id,
        sap_id: sapRecord.vbeln,
        confidence: 0.99,
        strategy: 'explicit_id',
        details: {
          matched_field: 'sap_order_number',
          sap_order_number: opp.sap_order_number,
        },
      });
    }

    return candidates;
  }

  /**
   * Strategy 2 — Proximity match.
   * Scores by weighted combination of name similarity, amount tolerance, and date proximity.
   * Confidence = 0.4*nameSim + 0.3*amountSim + 0.3*dateSim. Min threshold: 0.50.
   */
  resolveByProximity(
    sfdc: SFDCMatchRecord[],
    sap: SAPMatchRecord[],
    options?: Partial<ProximityOptions>
  ): MatchCandidate[] {
    const opts: ProximityOptions = { ...DEFAULT_PROXIMITY_OPTIONS, ...options };

    const candidates: MatchCandidate[] = [];

    for (const opp of sfdc) {
      let best: MatchCandidate | null = null;

      for (const sapRecord of sap) {
        const ns = nameSimilarity(opp.account_name, sapRecord.customer_name);
        const normalizedNameDist = 1 - ns;

        // Gate on name threshold first (normalised distance)
        if (normalizedNameDist > opts.nameThreshold) continue;

        // Gate on amount tolerance
        const maxRef = Math.max(Math.abs(opp.amount), Math.abs(sapRecord.netwr));
        const relAmountDiff = maxRef > 0 ? Math.abs(opp.amount - sapRecord.netwr) / maxRef : 0;
        if (relAmountDiff > opts.amountTolerance) continue;

        const as = amountSimilarity(opp.amount, sapRecord.netwr);
        const ds = dateSimilarity(opp.close_date, sapRecord.erdat, opts.maxDateGapDays);

        const confidence = 0.4 * ns + 0.3 * as + 0.3 * ds;
        if (confidence < 0.5) continue;

        if (!best || confidence > best.confidence) {
          best = {
            sfdc_id: opp.opportunity_id,
            sap_id: sapRecord.vbeln,
            confidence,
            strategy: 'proximity',
            details: {
              nameSim: ns,
              amountSim: as,
              dateSim: ds,
            },
          };
        }
      }

      if (best) candidates.push(best);
    }

    return candidates;
  }

  /**
   * Run all strategies and deduplicate.
   * Deduplication rules:
   *   1. Per SFDC id: keep highest confidence candidate.
   *   2. Per SAP id: keep highest confidence candidate (prevents one SAP order
   *      being claimed by multiple SFDC opportunities).
   */
  resolveAll(
    sfdc: SFDCMatchRecord[],
    sap: SAPMatchRecord[],
    proximityOptions?: Partial<ProximityOptions>
  ): MatchCandidate[] {
    const explicit = this.resolveExplicitId(sfdc, sap);
    const proximity = this.resolveByProximity(sfdc, sap, proximityOptions);

    // Merge: proximity first, then explicit overwrites (explicit always preferred)
    const bySFDC = new Map<string, MatchCandidate>();

    // Phase 1 — proximity (lower priority)
    for (const candidate of proximity) {
      const existing = bySFDC.get(candidate.sfdc_id);
      if (!existing || candidate.confidence > existing.confidence) {
        bySFDC.set(candidate.sfdc_id, candidate);
      }
    }

    // Phase 2 — explicit always wins regardless of numeric confidence
    for (const candidate of explicit) {
      bySFDC.set(candidate.sfdc_id, candidate);
    }

    // Deduplicate by SAP id (explicit_id beats proximity; otherwise highest confidence wins)
    const bySAP = new Map<string, MatchCandidate>();
    for (const candidate of bySFDC.values()) {
      const existing = bySAP.get(candidate.sap_id);
      if (!existing) {
        bySAP.set(candidate.sap_id, candidate);
      } else if (candidate.strategy === 'explicit_id' && existing.strategy !== 'explicit_id') {
        bySAP.set(candidate.sap_id, candidate);
      } else if (
        existing.strategy !== 'explicit_id' &&
        candidate.confidence > existing.confidence
      ) {
        bySAP.set(candidate.sap_id, candidate);
      }
    }

    return Array.from(bySAP.values());
  }
}
