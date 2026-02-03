/**
 * SAP FI/CO (Financial Accounting & Controlling) Type Definitions
 *
 * These interfaces mirror SAP's standard FI/CO document structures
 * using SAP Data Dictionary (SE11) field naming conventions.
 *
 * Tables covered:
 * - BKPF: Accounting Document Header
 * - BSEG: Accounting Document Line Items
 * - SKA1: GL Account Master (Chart of Accounts)
 * - SKAT: GL Account Descriptions
 * - CSKS: Cost Center Master Data
 * - COEP: CO Line Items (Controlling)
 * - T001: Company Codes
 */

// ============================================================================
// Accounting Document Header (BKPF)
// ============================================================================

/**
 * Accounting Document Header (based on BKPF table)
 *
 * BKPF is the central table for all FI postings. Every journal entry
 * creates exactly one BKPF record with one or more BSEG line items.
 */
export interface BKPF {
  /** Company Code (4 chars) */
  BUKRS: string;
  /** Accounting Document Number (10 chars) */
  BELNR: string;
  /** Fiscal Year (4 chars) */
  GJAHR: string;
  /** Document Type (2 chars, e.g., 'SA' for GL, 'KR' for vendor invoice) */
  BLART: string;
  /** Document Date (YYYYMMDD) */
  BLDAT: string;
  /** Posting Date (YYYYMMDD) */
  BUDAT: string;
  /** Entry Date / Creation Date (YYYYMMDD) */
  CPUDT: string;
  /** Entry Time (HHMMSS) */
  CPUTM?: string;
  /** Posting Period */
  MONAT: string;
  /** Currency Key (3 chars) */
  WAERS: string;
  /** Reference Document Number */
  XBLNR?: string;
  /** Document Header Text */
  BKTXT?: string;
  /** User Name (creator) */
  USNAM: string;
  /** Transaction Code used (e.g., FB01, F-02, MIRO) */
  TCODE?: string;
  /** Reference Key (links to originating document) */
  AWKEY?: string;
  /** Reference Transaction (e.g., 'RMRP' for invoice verification) */
  AWTYP?: string;
  /** Reversal Document Number */
  STBLG?: string;
  /** Reversal Fiscal Year */
  STJAH?: string;
  /** Parked By (user who parked the document) */
  PPNAM?: string;
}

// ============================================================================
// Accounting Document Line Items (BSEG)
// ============================================================================

/**
 * Accounting Document Line Item (based on BSEG table)
 *
 * BSEG contains the individual debit/credit line items for each
 * accounting document. Each BKPF record has 2+ BSEG items that
 * must balance (total debits = total credits).
 */
export interface BSEG {
  /** Company Code */
  BUKRS: string;
  /** Accounting Document Number */
  BELNR: string;
  /** Fiscal Year */
  GJAHR: string;
  /** Line Item Number (3 chars, e.g., '001') */
  BUZEI: string;
  /** Posting Key (2 chars, determines debit/credit and account type) */
  BSCHL?: string;
  /** Account Type: S=GL, D=Customer, K=Vendor, A=Asset, M=Material */
  KOART: string;
  /** GL Account Number (10 chars) */
  HKONT: string;
  /** Amount in Document Currency */
  WRBTR: number;
  /** Amount in Local Currency */
  DMBTR: number;
  /** Debit/Credit Indicator: S=Debit, H=Credit */
  SHKZG: 'S' | 'H';
  /** Tax Code */
  MWSKZ?: string;
  /** Cost Center (10 chars) */
  KOSTL?: string;
  /** Profit Center (10 chars) */
  PRCTR?: string;
  /** Assignment Number (free-form reference) */
  ZUONR?: string;
  /** Line Item Text */
  SGTXT?: string;
  /** Customer Number (for KOART='D') */
  KUNNR?: string;
  /** Vendor Number (for KOART='K') */
  LIFNR?: string;
  /** Clearing Document Number */
  AUGBL?: string;
  /** Clearing Date (YYYYMMDD) */
  AUGDT?: string;
  /** Due Date for Payment */
  ZFBDT?: string;
  /** Baseline Date for Payment Terms */
  ZTERM?: string;
  /** Business Area */
  GSBER?: string;
  /** Trading Partner (for intercompany) */
  VBUND?: string;
}

// ============================================================================
// GL Account Master (SKA1 / SKAT)
// ============================================================================

/**
 * GL Account Master Record (based on SKA1 table)
 * Chart of Accounts level — defines the account structure
 */
export interface SKA1 {
  /** Chart of Accounts (4 chars) */
  KTOPL: string;
  /** GL Account Number (10 chars) */
  SAKNR: string;
  /** Account Group (4 chars) */
  KTOKS?: string;
  /** GL Account Type: X=Balance Sheet, blank=P&L */
  XBILK?: string;
  /** Short Description */
  TXT20?: string;
  /** Long Description */
  TXT50?: string;
}

/**
 * GL Account Description (based on SKAT table)
 * Language-dependent account descriptions
 */
export interface SKAT {
  /** Language Key */
  SPRAS: string;
  /** Chart of Accounts */
  KTOPL: string;
  /** GL Account Number */
  SAKNR: string;
  /** Short Text (20 chars) */
  TXT20: string;
  /** Long Text (50 chars) */
  TXT50: string;
}

// ============================================================================
// Cost Center Master (CSKS)
// ============================================================================

/**
 * Cost Center Master Data (based on CSKS table)
 */
export interface CSKS {
  /** Controlling Area (4 chars) */
  KOKRS: string;
  /** Cost Center Number (10 chars) */
  KOSTL: string;
  /** Valid From Date */
  DATAB: string;
  /** Valid To Date */
  DATBI: string;
  /** Cost Center Category */
  KOSAR?: string;
  /** Person Responsible */
  VERAK?: string;
  /** Description */
  KTEXT?: string;
  /** Company Code */
  BUKRS?: string;
  /** Profit Center */
  PRCTR?: string;
}

// ============================================================================
// CO Line Items (COEP)
// ============================================================================

/**
 * CO Line Items — Actual Postings (based on COEP table)
 * Controlling line items for cost center accounting, internal orders, etc.
 */
export interface COEP {
  /** Controlling Area */
  KOKRS: string;
  /** Accounting Document Number */
  BELNR: string;
  /** Fiscal Year */
  GJAHR: string;
  /** Line Item Number */
  BUZEI: string;
  /** Object Number (cost center, internal order, etc.) */
  OBJNR: string;
  /** Cost Element (GL account used as cost element) */
  KSTAR: string;
  /** Value Type (actual, plan, etc.) */
  WRTTP: string;
  /** Total Amount in Object Currency */
  WKGBTR: number;
  /** Total Amount in Controlling Area Currency */
  WOGBTR?: number;
  /** Posting Date */
  BUDAT: string;
  /** Period */
  PERIO: string;
  /** Sender Cost Center (for allocations) */
  SKOSTL?: string;
  /** Receiver Cost Center */
  EKOSTL?: string;
}

// ============================================================================
// Company Codes (T001)
// ============================================================================

/**
 * Company Code Master (based on T001 table)
 */
export interface T001 {
  /** Company Code (4 chars) */
  BUKRS: string;
  /** Company Name */
  BUTXT: string;
  /** Country Key */
  LAND1: string;
  /** Currency */
  WAERS: string;
  /** Chart of Accounts */
  KTOPL: string;
  /** Fiscal Year Variant */
  PERIV?: string;
}

// ============================================================================
// Forensic Analysis Result Types
// ============================================================================

/**
 * Severity levels for forensic findings
 */
export type ForensicSeverity = 'critical' | 'high' | 'medium' | 'low';

/**
 * Categories of journal entry anomalies
 */
export type AnomalyType =
  | 'weekend_posting'
  | 'holiday_posting'
  | 'round_amount'
  | 'backdated_entry'
  | 'period_end_spike'
  | 'manual_entry'
  | 'unusual_posting_key'
  | 'split_below_threshold'
  | 'large_amount'
  | 'unusual_time'
  | 'reversal_pattern';

/**
 * Individual journal entry anomaly finding
 */
export interface JournalEntryAnomaly {
  /** Anomaly type classification */
  anomaly_type: AnomalyType;
  /** Severity rating */
  severity: ForensicSeverity;
  /** Human-readable description */
  description: string;
  /** Affected document: BUKRS + BELNR + GJAHR */
  document_key: string;
  /** Company Code */
  bukrs: string;
  /** Document Number */
  belnr: string;
  /** Fiscal Year */
  gjahr: string;
  /** Posting Date */
  budat: string;
  /** Entry/Creation Date */
  cpudt: string;
  /** Amount involved (absolute value) */
  amount: number;
  /** Currency */
  currency: string;
  /** User who created the entry */
  user: string;
  /** Transaction code used */
  tcode?: string | undefined;
  /** Supporting evidence details */
  evidence: Record<string, unknown>;
  /** Risk score (0-100) */
  risk_score: number;
}

/**
 * SoD conflict types
 */
export type SoDConflictType =
  | 'post_and_approve'
  | 'create_and_pay'
  | 'park_and_post'
  | 'vendor_master_and_payment'
  | 'create_and_modify'
  | 'post_and_reverse';

/**
 * Segregation of Duties conflict finding
 */
export interface SoDConflict {
  /** Conflict type */
  conflict_type: SoDConflictType;
  /** Severity rating */
  severity: ForensicSeverity;
  /** Human-readable description */
  description: string;
  /** User involved in the conflict */
  user: string;
  /** First conflicting action */
  action_1: {
    description: string;
    tcode?: string | undefined;
    document_key?: string | undefined;
    date?: string | undefined;
  };
  /** Second conflicting action */
  action_2: {
    description: string;
    tcode?: string | undefined;
    document_key?: string | undefined;
    date?: string | undefined;
  };
  /** Number of occurrences */
  occurrence_count: number;
  /** Risk rating based on frequency and type */
  risk_rating: ForensicSeverity;
  /** Sample document keys demonstrating the conflict */
  sample_documents: string[];
}

/**
 * GL Balance analysis result for a single account
 */
export interface GLBalanceEntry {
  /** GL Account Number */
  account: string;
  /** Account Description */
  account_description?: string | undefined;
  /** Account Type: BS=Balance Sheet, PL=Profit & Loss */
  account_type: 'BS' | 'PL';
  /** Total Debit Amount */
  total_debit: number;
  /** Total Credit Amount */
  total_credit: number;
  /** Net Balance (Debit - Credit) */
  balance: number;
  /** Currency */
  currency: string;
  /** Number of postings */
  posting_count: number;
}

/**
 * GL Balance analysis result
 */
export interface GLBalanceResult {
  /** Company Code analyzed */
  company_code: string;
  /** Fiscal Year */
  fiscal_year: string;
  /** Period range analyzed */
  period_range: { from: string; to: string };
  /** Total accounts analyzed */
  total_accounts: number;
  /** Trial balance (all accounts) */
  trial_balance: GLBalanceEntry[];
  /** Variance analysis: significant month-over-month changes */
  variances: Array<{
    account: string;
    account_description?: string | undefined;
    period: string;
    prior_balance: number;
    current_balance: number;
    variance_amount: number;
    variance_percent: number;
    severity: ForensicSeverity;
  }>;
  /** Suspense accounts with unexpected balances */
  suspense_flags: Array<{
    account: string;
    account_description?: string | undefined;
    balance: number;
    currency: string;
    reason: string;
  }>;
  /** Intercompany balance mismatches */
  intercompany_mismatches: Array<{
    company_1: string;
    company_2: string;
    account: string;
    balance_1: number;
    balance_2: number;
    difference: number;
  }>;
  /** Open items aging summary */
  aging_summary?:
    | {
        current: number;
        days_30: number;
        days_60: number;
        days_90: number;
        over_90: number;
      }
    | undefined;
}

/**
 * Complete FI document view (header + line items)
 */
export interface FIDocumentResult {
  /** Document Header */
  header: BKPF;
  /** Line Items with debit/credit formatting */
  line_items: Array<
    BSEG & {
      /** Formatted debit amount (null if credit) */
      debit_amount: number | null;
      /** Formatted credit amount (null if debit) */
      credit_amount: number | null;
      /** GL Account description (if available) */
      account_description?: string | undefined;
    }
  >;
  /** Total debit amount */
  total_debit: number;
  /** Total credit amount */
  total_credit: number;
  /** Whether document balances (should always be true) */
  is_balanced: boolean;
  /** Cross-reference to originating document (from AWKEY) */
  origin_document?:
    | {
        type: string;
        document_number: string;
      }
    | undefined;
}

/**
 * Loaded FI/CO dataset (used by CSV adapter and forensic tools)
 */
export interface FICoDataset {
  /** BKPF records (document headers) */
  bkpf: BKPF[];
  /** BSEG records (line items) */
  bseg: BSEG[];
  /** SKA1 records (GL account master) */
  ska1: SKA1[];
  /** SKAT records (GL account descriptions) */
  skat: SKAT[];
  /** CSKS records (cost centers) */
  csks: CSKS[];
  /** COEP records (CO line items) */
  coep: COEP[];
  /** T001 records (company codes) */
  t001: T001[];
  /** Metadata about the loaded dataset */
  metadata: {
    source: string;
    loaded_at: string;
    record_counts: Record<string, number>;
  };
}

/**
 * Configuration for forensic analysis thresholds
 */
export interface ForensicConfig {
  /** Amount threshold for "round amount" flagging (e.g., 1000 = flag amounts ending in 000+) */
  round_amount_threshold: number;
  /** Days threshold for "backdated" flagging (BUDAT before CPUDT by this many days) */
  backdate_days_threshold: number;
  /** Approval threshold for split-below-threshold detection */
  approval_threshold: number;
  /** Currency for the approval threshold */
  approval_threshold_currency: string;
  /** Number of period-end days to flag (e.g., 3 = last 3 days of period) */
  period_end_days: number;
  /** Holiday calendar (array of YYYYMMDD dates) */
  holidays: string[];
  /** Working hours range (24h format) */
  working_hours: { start: number; end: number };
  /** Minimum variance percentage to flag in GL analysis */
  variance_threshold_percent: number;
  /** Suspense account prefixes (accounts to monitor) */
  suspense_account_prefixes: string[];
}

/**
 * Default forensic configuration
 */
export const DEFAULT_FORENSIC_CONFIG: ForensicConfig = {
  round_amount_threshold: 1000,
  backdate_days_threshold: 15,
  approval_threshold: 50000,
  approval_threshold_currency: 'USD',
  period_end_days: 3,
  holidays: [],
  working_hours: { start: 7, end: 19 },
  variance_threshold_percent: 25,
  suspense_account_prefixes: ['1990', '2990', '9999'],
};

/**
 * Complete forensic assessment result
 */
export interface ForensicAssessment {
  /** Assessment metadata */
  metadata: {
    generated_at: string;
    company_code: string;
    fiscal_year: string;
    period_range: string;
    total_documents_analyzed: number;
    total_line_items_analyzed: number;
    config_used: ForensicConfig;
  };
  /** Executive summary */
  executive_summary: {
    overall_risk_rating: ForensicSeverity;
    total_anomalies: number;
    critical_findings: number;
    high_findings: number;
    medium_findings: number;
    low_findings: number;
    key_concerns: string[];
  };
  /** Journal entry anomalies */
  journal_entry_anomalies: JournalEntryAnomaly[];
  /** SoD conflicts */
  sod_conflicts: SoDConflict[];
  /** GL balance analysis */
  gl_analysis: GLBalanceResult;
  /** Recommendations */
  recommendations: Array<{
    priority: ForensicSeverity;
    category: string;
    recommendation: string;
    affected_items: number;
  }>;
}
