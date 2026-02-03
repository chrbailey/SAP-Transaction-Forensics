/**
 * Tool: analyze_gl_balances
 *
 * GL Balance Analysis for SAP FI/CO
 *
 * Capabilities:
 * - Trial balance reconstruction from BSEG line items
 * - Month-over-month balance variance analysis
 * - Suspense account monitoring
 * - Intercompany balance reconciliation
 * - Open item aging (BSEG.AUGDT analysis)
 */

import { z } from 'zod';
import { SAPAdapter } from '../adapters/adapter.js';
import { createAuditContext } from '../logging/audit.js';
import { getFICoDataset } from '../adapters/csv/index.js';
import {
  BSEG,
  GLBalanceResult,
  GLBalanceEntry,
  ForensicSeverity,
  ForensicConfig,
  DEFAULT_FORENSIC_CONFIG,
  FICoDataset,
} from '../types/fi-co.js';

// ============================================================================
// Zod Schema
// ============================================================================

export const AnalyzeGLBalancesSchema = z.object({
  company_code: z.string().optional().describe('Filter by company code (BUKRS)'),
  fiscal_year: z
    .string()
    .optional()
    .describe('Fiscal year (GJAHR). If omitted, uses the most recent year in data.'),
  period_from: z.string().optional().describe('Start period (e.g., "001")'),
  period_to: z.string().optional().describe('End period (e.g., "012")'),
  account_from: z.string().optional().describe('Start account number (e.g., "0001000000")'),
  account_to: z.string().optional().describe('End account number (e.g., "9999999999")'),
  variance_threshold_percent: z
    .number()
    .optional()
    .describe('Minimum variance % to flag (default: 25)'),
  include_aging: z
    .boolean()
    .default(true)
    .describe('Include open item aging analysis (default: true)'),
  suspense_prefixes: z
    .array(z.string())
    .optional()
    .describe('Account prefixes to monitor as suspense accounts'),
  csv_file: z.string().optional().describe('Path to CSV file to load'),
});

export type AnalyzeGLBalancesInput = z.infer<typeof AnalyzeGLBalancesSchema>;

// ============================================================================
// Tool Definition
// ============================================================================

export const analyzeGLBalancesTool = {
  name: 'analyze_gl_balances',
  description: `GL (General Ledger) balance analysis for SAP FI/CO data.

Reconstructs trial balances from BSEG line items and detects financial anomalies:

- Trial Balance: Complete debit/credit summary per GL account
- Variance Analysis: Month-over-month balance fluctuations exceeding threshold
- Suspense Monitoring: Accounts with unexpected balances (clearing accounts, suspense)
- Intercompany Reconciliation: Balance mismatches between company codes
- Open Item Aging: Distribution of uncleared items by age bucket

Use this for:
- Pre-migration data validation (do balances carry over correctly?)
- Audit support (are suspense accounts being cleared timely?)
- Financial health assessment (unusual balance movements?)

Data source: BSEG line items and SKA1/SKAT account master from FI/CO dataset.`,
  inputSchema: {
    type: 'object' as const,
    properties: {
      company_code: { type: 'string', description: 'Company code (BUKRS)' },
      fiscal_year: { type: 'string', description: 'Fiscal year (GJAHR)' },
      period_from: { type: 'string', description: 'Start period' },
      period_to: { type: 'string', description: 'End period' },
      account_from: { type: 'string', description: 'Start account number' },
      account_to: { type: 'string', description: 'End account number' },
      variance_threshold_percent: { type: 'number', description: 'Variance threshold %' },
      include_aging: { type: 'boolean', description: 'Include aging analysis' },
      suspense_prefixes: {
        type: 'array',
        items: { type: 'string' },
        description: 'Suspense account prefixes',
      },
      csv_file: { type: 'string', description: 'CSV file path' },
    },
    required: [],
  },
};

// ============================================================================
// Analysis Functions
// ============================================================================

/**
 * Build trial balance from BSEG line items
 */
function buildTrialBalance(lineItems: BSEG[], dataset: FICoDataset): GLBalanceEntry[] {
  // Build account description lookup
  const accountDescriptions = new Map<string, string>();
  for (const skat of dataset.skat) {
    if (skat.SPRAS === 'E' || skat.SPRAS === 'EN') {
      accountDescriptions.set(skat.SAKNR, skat.TXT50 || skat.TXT20);
    }
  }
  // Fallback to SKA1 descriptions
  for (const ska1 of dataset.ska1) {
    if (!accountDescriptions.has(ska1.SAKNR)) {
      accountDescriptions.set(ska1.SAKNR, ska1.TXT50 || ska1.TXT20 || '');
    }
  }

  // Build BS/PL classification
  const accountTypes = new Map<string, 'BS' | 'PL'>();
  for (const ska1 of dataset.ska1) {
    accountTypes.set(ska1.SAKNR, ska1.XBILK === 'X' ? 'BS' : 'PL');
  }

  // Aggregate by account
  const accountBalances = new Map<
    string,
    { debit: number; credit: number; count: number; currency: string }
  >();

  for (const li of lineItems) {
    const account = li.HKONT;
    if (!accountBalances.has(account)) {
      accountBalances.set(account, { debit: 0, credit: 0, count: 0, currency: '' });
    }
    const bal = accountBalances.get(account)!;
    const amount = Math.abs(li.WRBTR || li.DMBTR || 0);

    if (li.SHKZG === 'S') {
      bal.debit += amount;
    } else {
      bal.credit += amount;
    }
    bal.count++;
    if (!bal.currency) bal.currency = li.BUKRS; // Will be overridden by doc header
  }

  // Convert to GLBalanceEntry array
  const entries: GLBalanceEntry[] = [];
  for (const [account, bal] of accountBalances) {
    entries.push({
      account,
      account_description: accountDescriptions.get(account),
      account_type: accountTypes.get(account) || 'PL',
      total_debit: Math.round(bal.debit * 100) / 100,
      total_credit: Math.round(bal.credit * 100) / 100,
      balance: Math.round((bal.debit - bal.credit) * 100) / 100,
      currency: bal.currency,
      posting_count: bal.count,
    });
  }

  // Sort by account number
  entries.sort((a, b) => a.account.localeCompare(b.account));
  return entries;
}

/**
 * Analyze month-over-month variances
 */
function analyzeVariances(
  lineItems: BSEG[],
  bkpfMap: Map<string, { MONAT: string; WAERS: string }>,
  dataset: FICoDataset,
  thresholdPercent: number
): GLBalanceResult['variances'] {
  // Build account descriptions
  const accountDescriptions = new Map<string, string>();
  for (const skat of dataset.skat) {
    if (skat.SPRAS === 'E' || skat.SPRAS === 'EN') {
      accountDescriptions.set(skat.SAKNR, skat.TXT50 || skat.TXT20);
    }
  }

  // Group balances by account + period
  const periodBalances = new Map<string, Map<string, number>>();

  for (const li of lineItems) {
    const docKey = `${li.BUKRS}|${li.BELNR}|${li.GJAHR}`;
    const doc = bkpfMap.get(docKey);
    const period = doc?.MONAT || '001';
    const account = li.HKONT;
    const accountPeriodKey = account;

    if (!periodBalances.has(accountPeriodKey)) {
      periodBalances.set(accountPeriodKey, new Map());
    }

    const periods = periodBalances.get(accountPeriodKey)!;
    const amount = li.SHKZG === 'S' ? Math.abs(li.WRBTR || 0) : -Math.abs(li.WRBTR || 0);

    periods.set(period, (periods.get(period) || 0) + amount);
  }

  // Find significant variances
  const variances: GLBalanceResult['variances'] = [];

  for (const [account, periods] of periodBalances) {
    const sortedPeriods = Array.from(periods.entries()).sort(([a], [b]) => a.localeCompare(b));

    for (let i = 1; i < sortedPeriods.length; i++) {
      const [_priorPeriod, priorBalance] = sortedPeriods[i - 1]!;
      const [currentPeriod, currentBalance] = sortedPeriods[i]!;

      if (Math.abs(priorBalance) < 100) continue; // Skip trivial amounts

      const varianceAmount = currentBalance - priorBalance;
      const variancePercent =
        priorBalance !== 0
          ? Math.round((Math.abs(varianceAmount) / Math.abs(priorBalance)) * 100 * 100) / 100
          : currentBalance !== 0
            ? 100
            : 0;

      if (variancePercent >= thresholdPercent) {
        const severity: ForensicSeverity =
          variancePercent >= 100 ? 'high' : variancePercent >= 50 ? 'medium' : 'low';

        variances.push({
          account,
          account_description: accountDescriptions.get(account),
          period: currentPeriod,
          prior_balance: Math.round(priorBalance * 100) / 100,
          current_balance: Math.round(currentBalance * 100) / 100,
          variance_amount: Math.round(varianceAmount * 100) / 100,
          variance_percent: variancePercent,
          severity,
        });
      }
    }
  }

  // Sort by variance percent descending
  variances.sort((a, b) => b.variance_percent - a.variance_percent);
  return variances.slice(0, 50);
}

/**
 * Monitor suspense accounts
 */
function monitorSuspenseAccounts(
  trialBalance: GLBalanceEntry[],
  prefixes: string[]
): GLBalanceResult['suspense_flags'] {
  const flags: GLBalanceResult['suspense_flags'] = [];

  for (const entry of trialBalance) {
    const isSuspense = prefixes.some(prefix => entry.account.startsWith(prefix));
    if (isSuspense && Math.abs(entry.balance) > 0.01) {
      flags.push({
        account: entry.account,
        account_description: entry.account_description,
        balance: entry.balance,
        currency: entry.currency,
        reason:
          Math.abs(entry.balance) > 10000
            ? `Suspense account has significant balance: ${entry.balance.toLocaleString()}`
            : `Suspense account has residual balance: ${entry.balance.toLocaleString()}`,
      });
    }
  }

  return flags;
}

/**
 * Check intercompany balances
 */
function checkIntercompanyBalances(lineItems: BSEG[]): GLBalanceResult['intercompany_mismatches'] {
  // Group by trading partner (VBUND)
  const icBalances = new Map<string, Map<string, number>>();

  for (const li of lineItems) {
    if (!li.VBUND) continue;

    const pairKey = [li.BUKRS, li.VBUND].sort().join('↔');
    if (!icBalances.has(pairKey)) {
      icBalances.set(pairKey, new Map());
    }

    const accountMap = icBalances.get(pairKey)!;
    const amount = li.SHKZG === 'S' ? li.WRBTR || 0 : -(li.WRBTR || 0);
    const companyKey = `${li.BUKRS}|${li.HKONT}`;
    accountMap.set(companyKey, (accountMap.get(companyKey) || 0) + amount);
  }

  const mismatches: GLBalanceResult['intercompany_mismatches'] = [];

  for (const [pairKey, accountMap] of icBalances) {
    const [company1, company2] = pairKey.split('↔');
    if (!company1 || !company2) continue;

    // Sum all IC balances for each company in the pair
    let balance1 = 0;
    let balance2 = 0;

    for (const [companyKey, amount] of accountMap) {
      if (companyKey.startsWith(company1 + '|')) {
        balance1 += amount;
      } else {
        balance2 += amount;
      }
    }

    const difference = Math.abs(balance1 + balance2);
    if (difference > 0.01) {
      mismatches.push({
        company_1: company1,
        company_2: company2,
        account: 'IC Summary',
        balance_1: Math.round(balance1 * 100) / 100,
        balance_2: Math.round(balance2 * 100) / 100,
        difference: Math.round(difference * 100) / 100,
      });
    }
  }

  return mismatches;
}

/**
 * Analyze open item aging
 */
function analyzeAging(lineItems: BSEG[]): GLBalanceResult['aging_summary'] {
  const today = new Date();
  const buckets = { current: 0, days_30: 0, days_60: 0, days_90: 0, over_90: 0 };

  for (const li of lineItems) {
    // Open items have no clearing date
    if (li.AUGDT && li.AUGDT !== '' && li.AUGDT !== '00000000') continue;

    // Only count receivables (D) and payables (K)
    if (li.KOART !== 'D' && li.KOART !== 'K') continue;

    const dueDate = li.ZFBDT || li.AUGDT;
    if (!dueDate || dueDate.length !== 8) continue;

    const due = new Date(
      parseInt(dueDate.substring(0, 4)),
      parseInt(dueDate.substring(4, 6)) - 1,
      parseInt(dueDate.substring(6, 8))
    );

    const daysPast = Math.floor((today.getTime() - due.getTime()) / (1000 * 60 * 60 * 24));
    const amount = Math.abs(li.WRBTR || 0);

    if (daysPast <= 0) buckets.current += amount;
    else if (daysPast <= 30) buckets.days_30 += amount;
    else if (daysPast <= 60) buckets.days_60 += amount;
    else if (daysPast <= 90) buckets.days_90 += amount;
    else buckets.over_90 += amount;
  }

  return {
    current: Math.round(buckets.current * 100) / 100,
    days_30: Math.round(buckets.days_30 * 100) / 100,
    days_60: Math.round(buckets.days_60 * 100) / 100,
    days_90: Math.round(buckets.days_90 * 100) / 100,
    over_90: Math.round(buckets.over_90 * 100) / 100,
  };
}

// ============================================================================
// Tool Executor
// ============================================================================

export async function executeAnalyzeGLBalances(
  _adapter: SAPAdapter,
  rawInput: unknown
): Promise<GLBalanceResult> {
  const input = AnalyzeGLBalancesSchema.parse(rawInput);

  const auditContext = createAuditContext(
    'analyze_gl_balances',
    input as Record<string, unknown>,
    'csv'
  );

  try {
    let dataset = getFICoDataset();

    if (!dataset && input.csv_file) {
      const { CSVAdapter } = await import('../adapters/csv/index.js');
      const adapter = new CSVAdapter(input.csv_file);
      await adapter.initialize();
      dataset = adapter.getDataset();
    }

    if (!dataset || dataset.bseg.length === 0) {
      throw new Error('No BSEG data loaded. Load FI/CO data via CSV adapter.');
    }

    // Filter line items
    let filteredBSEG = dataset.bseg;

    if (input.company_code) {
      filteredBSEG = filteredBSEG.filter(li => li.BUKRS === input.company_code);
    }
    if (input.fiscal_year) {
      filteredBSEG = filteredBSEG.filter(li => li.GJAHR === input.fiscal_year);
    }
    if (input.account_from) {
      filteredBSEG = filteredBSEG.filter(li => li.HKONT >= input.account_from!);
    }
    if (input.account_to) {
      filteredBSEG = filteredBSEG.filter(li => li.HKONT <= input.account_to!);
    }

    // Build BKPF lookup for period info
    const bkpfMap = new Map<string, { MONAT: string; WAERS: string }>();
    for (const doc of dataset.bkpf) {
      bkpfMap.set(`${doc.BUKRS}|${doc.BELNR}|${doc.GJAHR}`, {
        MONAT: doc.MONAT,
        WAERS: doc.WAERS,
      });
    }

    // Filter by period
    if (input.period_from || input.period_to) {
      filteredBSEG = filteredBSEG.filter(li => {
        const docKey = `${li.BUKRS}|${li.BELNR}|${li.GJAHR}`;
        const doc = bkpfMap.get(docKey);
        if (!doc) return true;
        if (input.period_from && doc.MONAT < input.period_from) return false;
        if (input.period_to && doc.MONAT > input.period_to) return false;
        return true;
      });
    }

    const config: ForensicConfig = {
      ...DEFAULT_FORENSIC_CONFIG,
      ...(input.variance_threshold_percent !== undefined
        ? { variance_threshold_percent: input.variance_threshold_percent }
        : {}),
      ...(input.suspense_prefixes ? { suspense_account_prefixes: input.suspense_prefixes } : {}),
    };

    // Run analyses
    const trialBalance = buildTrialBalance(filteredBSEG, dataset);
    const variances = analyzeVariances(
      filteredBSEG,
      bkpfMap,
      dataset,
      config.variance_threshold_percent
    );
    const suspenseFlags = monitorSuspenseAccounts(trialBalance, config.suspense_account_prefixes);
    const intercompanyMismatches = checkIntercompanyBalances(filteredBSEG);
    const agingSummary = input.include_aging ? analyzeAging(filteredBSEG) : undefined;

    // Determine company code and fiscal year
    const companyCode = input.company_code || filteredBSEG[0]?.BUKRS || 'ALL';
    const fiscalYear = input.fiscal_year || filteredBSEG[0]?.GJAHR || 'ALL';

    const result: GLBalanceResult = {
      company_code: companyCode,
      fiscal_year: fiscalYear,
      period_range: {
        from: input.period_from || '001',
        to: input.period_to || '012',
      },
      total_accounts: trialBalance.length,
      trial_balance: trialBalance,
      variances,
      suspense_flags: suspenseFlags,
      intercompany_mismatches: intercompanyMismatches,
      aging_summary: agingSummary,
    };

    auditContext.success(trialBalance.length);
    return result;
  } catch (error) {
    auditContext.error(error as Error);
    throw error;
  }
}
