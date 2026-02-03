/**
 * Tool: analyze_journal_entries
 *
 * Forensic analysis of FI journal entries (BKPF/BSEG) to detect anomalies.
 *
 * Detection patterns:
 * - Weekend/holiday postings
 * - Round amount flagging
 * - Backdated entries (BUDAT before CPUDT)
 * - Period-end volume spikes
 * - Manual vs automated entries (TCODE analysis)
 * - Unusual posting keys
 * - Split-just-below-threshold patterns
 * - Unusual posting times
 *
 * Input: FI/CO dataset loaded via CSV adapter
 * Output: Ranked anomaly list with severity, evidence, and risk scores
 */

import { z } from 'zod';
import { SAPAdapter } from '../adapters/adapter.js';
import { createAuditContext } from '../logging/audit.js';
import { getFICoDataset } from '../adapters/csv/index.js';
import {
  BKPF,
  BSEG,
  JournalEntryAnomaly,
  ForensicSeverity,
  ForensicConfig,
  DEFAULT_FORENSIC_CONFIG,
  FICoDataset,
} from '../types/fi-co.js';

// ============================================================================
// Zod Schema
// ============================================================================

export const AnalyzeJournalEntriesSchema = z.object({
  company_code: z
    .string()
    .optional()
    .describe('Filter by company code (BUKRS). If omitted, analyzes all.'),
  fiscal_year: z
    .string()
    .optional()
    .describe('Filter by fiscal year (GJAHR). If omitted, analyzes all.'),
  period_from: z.string().optional().describe('Start posting period (e.g., "001" for January)'),
  period_to: z.string().optional().describe('End posting period (e.g., "012" for December)'),
  round_amount_threshold: z
    .number()
    .optional()
    .describe('Threshold for round amount detection (default: 1000, flags amounts ending in 000+)'),
  backdate_days_threshold: z
    .number()
    .optional()
    .describe('Days threshold for backdating detection (default: 15)'),
  approval_threshold: z
    .number()
    .optional()
    .describe('Amount threshold for split-below-threshold detection (default: 50000)'),
  include_low_severity: z
    .boolean()
    .default(false)
    .describe('Include low-severity findings (default: false, shows medium+ only)'),
  max_results: z
    .number()
    .int()
    .min(1)
    .max(1000)
    .default(200)
    .describe('Maximum anomalies to return (default: 200)'),
  csv_file: z
    .string()
    .optional()
    .describe('Path to CSV file to load (if data not already loaded via adapter)'),
});

export type AnalyzeJournalEntriesInput = z.infer<typeof AnalyzeJournalEntriesSchema>;

// ============================================================================
// Tool Definition
// ============================================================================

export const analyzeJournalEntriesTool = {
  name: 'analyze_journal_entries',
  description: `Forensic analysis of SAP FI journal entries to detect accounting anomalies.

Analyzes BKPF (document headers) and BSEG (line items) data for red flags
commonly examined during financial audits and pre-migration assessments.

Detection patterns:
- Weekend/holiday postings — entries created on non-business days
- Round amounts — entries with suspiciously round amounts (configurable threshold)
- Backdated entries — posting date (BUDAT) significantly before creation date (CPUDT)
- Period-end spikes — unusual volume in last 3 days of posting period
- Manual entries — documents created via FB01/F-02 vs automated batch postings
- Unusual posting keys — rare BSCHL values for the account type
- Split-below-threshold — multiple entries by same user summing near approval limit
- Unusual times — postings outside normal business hours

Risk scoring: Each anomaly receives a 0-100 risk score based on type and context.

Data source: Load FI/CO data via CSV adapter (SE16/SE16N exports) or provide csv_file path.

Returns: Ranked list of anomalies with document references and evidence.`,
  inputSchema: {
    type: 'object' as const,
    properties: {
      company_code: {
        type: 'string',
        description: 'Filter by company code (BUKRS)',
      },
      fiscal_year: {
        type: 'string',
        description: 'Filter by fiscal year (GJAHR)',
      },
      period_from: {
        type: 'string',
        description: 'Start posting period (e.g., "001")',
      },
      period_to: {
        type: 'string',
        description: 'End posting period (e.g., "012")',
      },
      round_amount_threshold: {
        type: 'number',
        description: 'Round amount threshold (default: 1000)',
      },
      backdate_days_threshold: {
        type: 'number',
        description: 'Backdating threshold in days (default: 15)',
      },
      approval_threshold: {
        type: 'number',
        description: 'Approval limit for split detection (default: 50000)',
      },
      include_low_severity: {
        type: 'boolean',
        description: 'Include low-severity findings (default: false)',
      },
      max_results: {
        type: 'number',
        description: 'Maximum results (default: 200)',
      },
      csv_file: {
        type: 'string',
        description: 'Path to CSV file to load',
      },
    },
    required: [],
  },
};

// ============================================================================
// Date Utilities
// ============================================================================

/**
 * Parse YYYYMMDD date string to Date object
 */
function parseDate(yyyymmdd: string): Date | null {
  if (!yyyymmdd || yyyymmdd.length !== 8) return null;
  const year = parseInt(yyyymmdd.substring(0, 4));
  const month = parseInt(yyyymmdd.substring(4, 6)) - 1;
  const day = parseInt(yyyymmdd.substring(6, 8));
  const date = new Date(year, month, day);
  if (isNaN(date.getTime())) return null;
  return date;
}

/**
 * Get day of week: 0=Sunday, 6=Saturday
 */
function isWeekend(yyyymmdd: string): boolean {
  const date = parseDate(yyyymmdd);
  if (!date) return false;
  const day = date.getDay();
  return day === 0 || day === 6;
}

/**
 * Calculate days between two YYYYMMDD dates
 */
function daysBetween(date1: string, date2: string): number {
  const d1 = parseDate(date1);
  const d2 = parseDate(date2);
  if (!d1 || !d2) return 0;
  return Math.round((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24));
}

/**
 * Check if a date is in the last N days of its month
 */
function isLastNDaysOfMonth(yyyymmdd: string, n: number): boolean {
  const date = parseDate(yyyymmdd);
  if (!date) return false;
  const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  return date.getDate() > lastDay - n;
}

/**
 * Parse HHMMSS time to hour number
 */
function parseHour(hhmmss: string): number {
  if (!hhmmss || hhmmss.length < 2) return -1;
  return parseInt(hhmmss.substring(0, 2));
}

// ============================================================================
// Detection Rules
// ============================================================================

/**
 * Detect weekend/holiday postings
 */
function detectWeekendPostings(
  bkpf: BKPF[],
  bsegMap: Map<string, BSEG[]>,
  config: ForensicConfig
): JournalEntryAnomaly[] {
  const anomalies: JournalEntryAnomaly[] = [];
  const holidays = new Set(config.holidays);

  for (const doc of bkpf) {
    const postingDate = doc.BUDAT;
    const isWeekendDay = isWeekend(postingDate);
    const isHoliday = holidays.has(postingDate);

    if (isWeekendDay || isHoliday) {
      const lineItems = bsegMap.get(`${doc.BUKRS}|${doc.BELNR}|${doc.GJAHR}`) || [];
      const totalAmount = lineItems
        .filter(li => li.SHKZG === 'S')
        .reduce((sum, li) => sum + (li.WRBTR || 0), 0);

      anomalies.push({
        anomaly_type: isHoliday ? 'holiday_posting' : 'weekend_posting',
        severity: totalAmount > 100000 ? 'high' : 'medium',
        description: `Journal entry posted on ${isHoliday ? 'holiday' : 'weekend'} (${postingDate})`,
        document_key: `${doc.BUKRS}-${doc.BELNR}-${doc.GJAHR}`,
        bukrs: doc.BUKRS,
        belnr: doc.BELNR,
        gjahr: doc.GJAHR,
        budat: doc.BUDAT,
        cpudt: doc.CPUDT,
        amount: totalAmount,
        currency: doc.WAERS,
        user: doc.USNAM,
        tcode: doc.TCODE,
        evidence: {
          day_of_week: parseDate(postingDate)?.toLocaleDateString('en-US', { weekday: 'long' }),
          is_holiday: isHoliday,
          line_item_count: lineItems.length,
        },
        risk_score: isHoliday ? 70 : totalAmount > 100000 ? 65 : 45,
      });
    }
  }

  return anomalies;
}

/**
 * Detect round amount entries
 */
function detectRoundAmounts(
  bkpf: BKPF[],
  bsegMap: Map<string, BSEG[]>,
  config: ForensicConfig
): JournalEntryAnomaly[] {
  const anomalies: JournalEntryAnomaly[] = [];
  const threshold = config.round_amount_threshold;

  for (const doc of bkpf) {
    const lineItems = bsegMap.get(`${doc.BUKRS}|${doc.BELNR}|${doc.GJAHR}`) || [];

    for (const li of lineItems) {
      const amount = Math.abs(li.WRBTR || 0);
      if (amount >= threshold && amount % threshold === 0) {
        // Check how "round" it is — more zeros = more suspicious
        const zeros = Math.floor(Math.log10(amount / (amount % 1 || 1)));
        const severity: ForensicSeverity =
          amount >= 1000000 ? 'high' : amount >= 100000 ? 'medium' : 'low';

        anomalies.push({
          anomaly_type: 'round_amount',
          severity,
          description: `Exactly round amount: ${amount.toLocaleString()} ${doc.WAERS} (line ${li.BUZEI})`,
          document_key: `${doc.BUKRS}-${doc.BELNR}-${doc.GJAHR}`,
          bukrs: doc.BUKRS,
          belnr: doc.BELNR,
          gjahr: doc.GJAHR,
          budat: doc.BUDAT,
          cpudt: doc.CPUDT,
          amount,
          currency: doc.WAERS,
          user: doc.USNAM,
          tcode: doc.TCODE,
          evidence: {
            line_item: li.BUZEI,
            account: li.HKONT,
            posting_key: li.BSCHL,
            trailing_zeros: zeros,
            debit_credit: li.SHKZG,
          },
          risk_score: severity === 'high' ? 55 : severity === 'medium' ? 40 : 25,
        });
      }
    }
  }

  return anomalies;
}

/**
 * Detect backdated entries (BUDAT significantly before CPUDT)
 */
function detectBackdatedEntries(
  bkpf: BKPF[],
  bsegMap: Map<string, BSEG[]>,
  config: ForensicConfig
): JournalEntryAnomaly[] {
  const anomalies: JournalEntryAnomaly[] = [];

  for (const doc of bkpf) {
    if (!doc.BUDAT || !doc.CPUDT) continue;

    const gapDays = daysBetween(doc.BUDAT, doc.CPUDT);

    if (gapDays > config.backdate_days_threshold) {
      const lineItems = bsegMap.get(`${doc.BUKRS}|${doc.BELNR}|${doc.GJAHR}`) || [];
      const totalAmount = lineItems
        .filter(li => li.SHKZG === 'S')
        .reduce((sum, li) => sum + (li.WRBTR || 0), 0);

      const severity: ForensicSeverity =
        gapDays > 90 ? 'critical' : gapDays > 30 ? 'high' : 'medium';

      anomalies.push({
        anomaly_type: 'backdated_entry',
        severity,
        description: `Entry backdated by ${gapDays} days (posted ${doc.BUDAT}, created ${doc.CPUDT})`,
        document_key: `${doc.BUKRS}-${doc.BELNR}-${doc.GJAHR}`,
        bukrs: doc.BUKRS,
        belnr: doc.BELNR,
        gjahr: doc.GJAHR,
        budat: doc.BUDAT,
        cpudt: doc.CPUDT,
        amount: totalAmount,
        currency: doc.WAERS,
        user: doc.USNAM,
        tcode: doc.TCODE,
        evidence: {
          gap_days: gapDays,
          posting_period: doc.MONAT,
          document_type: doc.BLART,
          header_text: doc.BKTXT,
        },
        risk_score: severity === 'critical' ? 90 : severity === 'high' ? 75 : 55,
      });
    }
  }

  return anomalies;
}

/**
 * Detect period-end posting spikes
 */
function detectPeriodEndSpikes(
  bkpf: BKPF[],
  bsegMap: Map<string, BSEG[]>,
  config: ForensicConfig
): JournalEntryAnomaly[] {
  const anomalies: JournalEntryAnomaly[] = [];

  // Group documents by period
  const periodGroups = new Map<string, BKPF[]>();
  for (const doc of bkpf) {
    const periodKey = `${doc.GJAHR}-${doc.MONAT}`;
    if (!periodGroups.has(periodKey)) {
      periodGroups.set(periodKey, []);
    }
    periodGroups.get(periodKey)!.push(doc);
  }

  for (const [periodKey, docs] of periodGroups) {
    const periodEndDocs = docs.filter(d => isLastNDaysOfMonth(d.BUDAT, config.period_end_days));
    const nonPeriodEndDocs = docs.filter(d => !isLastNDaysOfMonth(d.BUDAT, config.period_end_days));

    if (nonPeriodEndDocs.length === 0) continue;

    // Calculate daily average excluding period-end
    const periodDate = parseDate(docs[0]!.BUDAT);
    if (!periodDate) continue;
    const daysInMonth = new Date(periodDate.getFullYear(), periodDate.getMonth() + 1, 0).getDate();
    const nonPeriodEndDays = daysInMonth - config.period_end_days;
    const dailyAvg = nonPeriodEndDocs.length / Math.max(nonPeriodEndDays, 1);
    const periodEndDaily = periodEndDocs.length / config.period_end_days;

    // Flag if period-end volume is 3x+ the daily average
    if (periodEndDaily > dailyAvg * 3 && periodEndDocs.length >= 5) {
      // Calculate total amount in period-end entries
      let periodEndAmount = 0;
      for (const doc of periodEndDocs) {
        const lineItems = bsegMap.get(`${doc.BUKRS}|${doc.BELNR}|${doc.GJAHR}`) || [];
        periodEndAmount += lineItems
          .filter(li => li.SHKZG === 'S')
          .reduce((sum, li) => sum + (li.WRBTR || 0), 0);
      }

      anomalies.push({
        anomaly_type: 'period_end_spike',
        severity: periodEndDaily > dailyAvg * 5 ? 'high' : 'medium',
        description: `Period ${periodKey}: ${periodEndDocs.length} entries in last ${config.period_end_days} days vs ${dailyAvg.toFixed(1)}/day average`,
        document_key: `Period-${periodKey}`,
        bukrs: docs[0]!.BUKRS,
        belnr: 'PERIOD',
        gjahr: docs[0]!.GJAHR,
        budat: periodEndDocs[0]?.BUDAT || '',
        cpudt: periodEndDocs[0]?.CPUDT || '',
        amount: periodEndAmount,
        currency: docs[0]!.WAERS,
        user: 'MULTIPLE',
        evidence: {
          period: periodKey,
          period_end_entries: periodEndDocs.length,
          total_period_entries: docs.length,
          daily_average: Math.round(dailyAvg * 10) / 10,
          period_end_daily: Math.round(periodEndDaily * 10) / 10,
          spike_ratio: Math.round((periodEndDaily / dailyAvg) * 10) / 10,
          unique_users: [...new Set(periodEndDocs.map(d => d.USNAM))],
        },
        risk_score: periodEndDaily > dailyAvg * 5 ? 65 : 45,
      });
    }
  }

  return anomalies;
}

/**
 * Detect manual vs automated entries
 */
function detectManualEntries(
  bkpf: BKPF[],
  bsegMap: Map<string, BSEG[]>,
  _config: ForensicConfig
): JournalEntryAnomaly[] {
  const anomalies: JournalEntryAnomaly[] = [];

  // Manual transaction codes (user-initiated postings)
  const manualTCodes = new Set([
    'FB01',
    'F-02',
    'F-01',
    'FB50',
    'FBS1',
    'FB05',
    'FV50',
    'FV60',
    'FBV1', // Parked documents
  ]);

  for (const doc of bkpf) {
    if (doc.TCODE && manualTCodes.has(doc.TCODE)) {
      const lineItems = bsegMap.get(`${doc.BUKRS}|${doc.BELNR}|${doc.GJAHR}`) || [];
      const totalAmount = lineItems
        .filter(li => li.SHKZG === 'S')
        .reduce((sum, li) => sum + (li.WRBTR || 0), 0);

      // Only flag significant manual entries
      if (totalAmount > 10000) {
        anomalies.push({
          anomaly_type: 'manual_entry',
          severity: totalAmount > 500000 ? 'high' : totalAmount > 100000 ? 'medium' : 'low',
          description: `Manual journal entry via ${doc.TCODE}: ${totalAmount.toLocaleString()} ${doc.WAERS}`,
          document_key: `${doc.BUKRS}-${doc.BELNR}-${doc.GJAHR}`,
          bukrs: doc.BUKRS,
          belnr: doc.BELNR,
          gjahr: doc.GJAHR,
          budat: doc.BUDAT,
          cpudt: doc.CPUDT,
          amount: totalAmount,
          currency: doc.WAERS,
          user: doc.USNAM,
          tcode: doc.TCODE,
          evidence: {
            document_type: doc.BLART,
            header_text: doc.BKTXT,
            line_item_count: lineItems.length,
            accounts_touched: [...new Set(lineItems.map(li => li.HKONT))],
          },
          risk_score: totalAmount > 500000 ? 60 : totalAmount > 100000 ? 40 : 20,
        });
      }
    }
  }

  return anomalies;
}

/**
 * Detect unusual posting keys
 */
function detectUnusualPostingKeys(
  bkpf: BKPF[],
  bsegMap: Map<string, BSEG[]>,
  _config: ForensicConfig
): JournalEntryAnomaly[] {
  const anomalies: JournalEntryAnomaly[] = [];

  // Count posting key frequency per account type
  const postingKeyFreq = new Map<string, Map<string, number>>();

  for (const doc of bkpf) {
    const lineItems = bsegMap.get(`${doc.BUKRS}|${doc.BELNR}|${doc.GJAHR}`) || [];
    for (const li of lineItems) {
      if (!li.BSCHL) continue; // Skip if no posting key available
      const accountType = li.KOART || 'S';
      if (!postingKeyFreq.has(accountType)) {
        postingKeyFreq.set(accountType, new Map());
      }
      const freqMap = postingKeyFreq.get(accountType)!;
      freqMap.set(li.BSCHL, (freqMap.get(li.BSCHL) || 0) + 1);
    }
  }

  // Find posting keys used less than 1% of the time for their account type
  for (const doc of bkpf) {
    const lineItems = bsegMap.get(`${doc.BUKRS}|${doc.BELNR}|${doc.GJAHR}`) || [];
    for (const li of lineItems) {
      if (!li.BSCHL) continue; // Skip if no posting key available
      const accountType = li.KOART || 'S';
      const freqMap = postingKeyFreq.get(accountType);
      if (!freqMap) continue;

      const total = Array.from(freqMap.values()).reduce((sum, v) => sum + v, 0);
      const keyCount = freqMap.get(li.BSCHL) || 0;
      const frequency = keyCount / total;

      if (frequency < 0.01 && total > 100) {
        anomalies.push({
          anomaly_type: 'unusual_posting_key',
          severity: 'medium',
          description: `Rare posting key ${li.BSCHL} for account type ${accountType} (${(frequency * 100).toFixed(2)}% usage)`,
          document_key: `${doc.BUKRS}-${doc.BELNR}-${doc.GJAHR}`,
          bukrs: doc.BUKRS,
          belnr: doc.BELNR,
          gjahr: doc.GJAHR,
          budat: doc.BUDAT,
          cpudt: doc.CPUDT,
          amount: Math.abs(li.WRBTR || 0),
          currency: doc.WAERS,
          user: doc.USNAM,
          tcode: doc.TCODE,
          evidence: {
            posting_key: li.BSCHL,
            account_type: accountType,
            account: li.HKONT,
            frequency_percent: Math.round(frequency * 10000) / 100,
            total_postings_for_type: total,
          },
          risk_score: 50,
        });
      }
    }
  }

  return anomalies;
}

/**
 * Detect split-below-threshold patterns
 */
function detectSplitBelowThreshold(
  bkpf: BKPF[],
  bsegMap: Map<string, BSEG[]>,
  config: ForensicConfig
): JournalEntryAnomaly[] {
  const anomalies: JournalEntryAnomaly[] = [];
  const threshold = config.approval_threshold;

  // Group documents by user and posting date
  const userDateGroups = new Map<string, BKPF[]>();
  for (const doc of bkpf) {
    const key = `${doc.USNAM}|${doc.BUDAT}`;
    if (!userDateGroups.has(key)) {
      userDateGroups.set(key, []);
    }
    userDateGroups.get(key)!.push(doc);
  }

  for (const [key, docs] of userDateGroups) {
    if (docs.length < 2) continue;

    // Calculate per-document debit totals
    const docAmounts: Array<{ doc: BKPF; amount: number }> = [];
    for (const doc of docs) {
      const lineItems = bsegMap.get(`${doc.BUKRS}|${doc.BELNR}|${doc.GJAHR}`) || [];
      const totalDebit = lineItems
        .filter(li => li.SHKZG === 'S')
        .reduce((sum, li) => sum + (li.WRBTR || 0), 0);

      if (totalDebit > 0 && totalDebit < threshold) {
        docAmounts.push({ doc, amount: totalDebit });
      }
    }

    if (docAmounts.length < 2) continue;

    // Check if combined amount exceeds threshold
    const combinedAmount = docAmounts.reduce((sum, da) => sum + da.amount, 0);
    const allBelowThreshold = docAmounts.every(da => da.amount < threshold);
    const withinRange = combinedAmount >= threshold * 0.8 && combinedAmount <= threshold * 1.5;

    if (allBelowThreshold && withinRange) {
      const [user, date] = key.split('|');
      anomalies.push({
        anomaly_type: 'split_below_threshold',
        severity: 'high',
        description: `${docAmounts.length} entries by ${user} on ${date} total ${combinedAmount.toLocaleString()} (threshold: ${threshold.toLocaleString()})`,
        document_key: docAmounts
          .map(da => `${da.doc.BUKRS}-${da.doc.BELNR}-${da.doc.GJAHR}`)
          .join(', '),
        bukrs: docAmounts[0]!.doc.BUKRS,
        belnr: docAmounts[0]!.doc.BELNR,
        gjahr: docAmounts[0]!.doc.GJAHR,
        budat: date || '',
        cpudt: docAmounts[0]!.doc.CPUDT,
        amount: combinedAmount,
        currency: docAmounts[0]!.doc.WAERS,
        user: user || '',
        tcode: docAmounts[0]!.doc.TCODE,
        evidence: {
          individual_amounts: docAmounts.map(da => da.amount),
          combined_amount: combinedAmount,
          approval_threshold: threshold,
          ratio_to_threshold: Math.round((combinedAmount / threshold) * 100) / 100,
          document_count: docAmounts.length,
          document_keys: docAmounts.map(da => `${da.doc.BUKRS}-${da.doc.BELNR}-${da.doc.GJAHR}`),
        },
        risk_score: 80,
      });
    }
  }

  return anomalies;
}

/**
 * Detect unusual posting times
 */
function detectUnusualTimes(
  bkpf: BKPF[],
  bsegMap: Map<string, BSEG[]>,
  config: ForensicConfig
): JournalEntryAnomaly[] {
  const anomalies: JournalEntryAnomaly[] = [];

  for (const doc of bkpf) {
    if (!doc.CPUTM) continue;

    const hour = parseHour(doc.CPUTM);
    if (hour < 0) continue;

    if (hour < config.working_hours.start || hour >= config.working_hours.end) {
      const lineItems = bsegMap.get(`${doc.BUKRS}|${doc.BELNR}|${doc.GJAHR}`) || [];
      const totalAmount = lineItems
        .filter(li => li.SHKZG === 'S')
        .reduce((sum, li) => sum + (li.WRBTR || 0), 0);

      if (totalAmount > 10000) {
        anomalies.push({
          anomaly_type: 'unusual_time',
          severity: 'low',
          description: `Entry created at ${doc.CPUTM.substring(0, 2)}:${doc.CPUTM.substring(2, 4)} (outside ${config.working_hours.start}:00-${config.working_hours.end}:00)`,
          document_key: `${doc.BUKRS}-${doc.BELNR}-${doc.GJAHR}`,
          bukrs: doc.BUKRS,
          belnr: doc.BELNR,
          gjahr: doc.GJAHR,
          budat: doc.BUDAT,
          cpudt: doc.CPUDT,
          amount: totalAmount,
          currency: doc.WAERS,
          user: doc.USNAM,
          tcode: doc.TCODE,
          evidence: {
            entry_time: `${doc.CPUTM.substring(0, 2)}:${doc.CPUTM.substring(2, 4)}:${doc.CPUTM.substring(4, 6)}`,
            hour,
            working_hours: config.working_hours,
          },
          risk_score: 30,
        });
      }
    }
  }

  return anomalies;
}

// ============================================================================
// Main Analysis Function
// ============================================================================

function runJournalEntryAnalysis(
  dataset: FICoDataset,
  input: AnalyzeJournalEntriesInput,
  config: ForensicConfig
): JournalEntryAnomaly[] {
  // Filter BKPF records
  let filteredBKPF = dataset.bkpf;

  if (input.company_code) {
    filteredBKPF = filteredBKPF.filter(d => d.BUKRS === input.company_code);
  }
  if (input.fiscal_year) {
    filteredBKPF = filteredBKPF.filter(d => d.GJAHR === input.fiscal_year);
  }
  if (input.period_from) {
    filteredBKPF = filteredBKPF.filter(d => d.MONAT >= input.period_from!);
  }
  if (input.period_to) {
    filteredBKPF = filteredBKPF.filter(d => d.MONAT <= input.period_to!);
  }

  if (filteredBKPF.length === 0) {
    return [];
  }

  // Build BSEG lookup map: "BUKRS|BELNR|GJAHR" → BSEG[]
  const bsegMap = new Map<string, BSEG[]>();
  for (const li of dataset.bseg) {
    const key = `${li.BUKRS}|${li.BELNR}|${li.GJAHR}`;
    if (!bsegMap.has(key)) {
      bsegMap.set(key, []);
    }
    bsegMap.get(key)!.push(li);
  }

  // Run all detection rules
  const allAnomalies: JournalEntryAnomaly[] = [
    ...detectWeekendPostings(filteredBKPF, bsegMap, config),
    ...detectRoundAmounts(filteredBKPF, bsegMap, config),
    ...detectBackdatedEntries(filteredBKPF, bsegMap, config),
    ...detectPeriodEndSpikes(filteredBKPF, bsegMap, config),
    ...detectManualEntries(filteredBKPF, bsegMap, config),
    ...detectUnusualPostingKeys(filteredBKPF, bsegMap, config),
    ...detectSplitBelowThreshold(filteredBKPF, bsegMap, config),
    ...detectUnusualTimes(filteredBKPF, bsegMap, config),
  ];

  // Filter by severity
  let filtered = allAnomalies;
  if (!input.include_low_severity) {
    filtered = allAnomalies.filter(a => a.severity !== 'low');
  }

  // Sort by risk score (highest first), then by severity
  const severityOrder: Record<ForensicSeverity, number> = {
    critical: 0,
    high: 1,
    medium: 2,
    low: 3,
  };

  filtered.sort((a, b) => {
    if (b.risk_score !== a.risk_score) return b.risk_score - a.risk_score;
    return severityOrder[a.severity] - severityOrder[b.severity];
  });

  // Limit results
  return filtered.slice(0, input.max_results);
}

// ============================================================================
// Tool Executor
// ============================================================================

export async function executeAnalyzeJournalEntries(
  _adapter: SAPAdapter,
  rawInput: unknown
): Promise<{
  anomalies: JournalEntryAnomaly[];
  summary: {
    total_documents_analyzed: number;
    total_anomalies: number;
    by_severity: Record<ForensicSeverity, number>;
    by_type: Record<string, number>;
    top_users: Array<{ user: string; anomaly_count: number }>;
  };
}> {
  const input = AnalyzeJournalEntriesSchema.parse(rawInput);

  const auditContext = createAuditContext(
    'analyze_journal_entries',
    input as Record<string, unknown>,
    'csv'
  );

  try {
    // Get or load dataset
    let dataset = getFICoDataset();

    if (!dataset && input.csv_file) {
      // Dynamically load CSV file
      const { CSVAdapter } = await import('../adapters/csv/index.js');
      const adapter = new CSVAdapter(input.csv_file);
      await adapter.initialize();
      dataset = adapter.getDataset();
    }

    if (!dataset || (dataset.bkpf.length === 0 && dataset.bseg.length === 0)) {
      throw new Error(
        'No FI/CO data loaded. Load data via CSV adapter or provide csv_file parameter.'
      );
    }

    // Build config with overrides
    const config: ForensicConfig = {
      ...DEFAULT_FORENSIC_CONFIG,
      ...(input.round_amount_threshold !== undefined
        ? { round_amount_threshold: input.round_amount_threshold }
        : {}),
      ...(input.backdate_days_threshold !== undefined
        ? { backdate_days_threshold: input.backdate_days_threshold }
        : {}),
      ...(input.approval_threshold !== undefined
        ? { approval_threshold: input.approval_threshold }
        : {}),
    };

    // Run analysis
    const anomalies = runJournalEntryAnalysis(dataset, input, config);

    // Build summary
    const bySeverity: Record<ForensicSeverity, number> = {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
    };
    const byType: Record<string, number> = {};
    const userCounts = new Map<string, number>();

    for (const a of anomalies) {
      bySeverity[a.severity]++;
      byType[a.anomaly_type] = (byType[a.anomaly_type] || 0) + 1;
      userCounts.set(a.user, (userCounts.get(a.user) || 0) + 1);
    }

    const topUsers = Array.from(userCounts.entries())
      .map(([user, count]) => ({ user, anomaly_count: count }))
      .sort((a, b) => b.anomaly_count - a.anomaly_count)
      .slice(0, 10);

    const result = {
      anomalies,
      summary: {
        total_documents_analyzed: dataset.bkpf.length,
        total_anomalies: anomalies.length,
        by_severity: bySeverity,
        by_type: byType,
        top_users: topUsers,
      },
    };

    auditContext.success(anomalies.length);
    return result;
  } catch (error) {
    auditContext.error(error as Error);
    throw error;
  }
}
