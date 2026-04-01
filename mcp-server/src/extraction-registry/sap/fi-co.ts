/**
 * SAP FI/CO Extraction Paths
 *
 * Deterministic extraction path definitions for SAP Financial Accounting
 * and Controlling. Each path targets specific forensic analysis scenarios:
 *
 * - Journal entry headers (BKPF) — weekend/holiday, backdating, reversal patterns
 * - Line items (BSEG) — round amounts, split-below-threshold, unusual posting keys
 * - Segregation of Duties — same-user conflicting transactions on same document
 * - GL balances — trial balance, suspense account detection
 */

import type { ExtractionPath } from '../types.js';

// ============================================================================
// Path 1: Journal Entry Headers (BKPF)
// ============================================================================

const journalEntries: ExtractionPath = {
  id: 'sap.fi-co.journal-entries',
  version: '1.0',
  name: 'Journal Entry Headers',
  description:
    'Extract journal entry headers for forensic analysis — weekend/holiday posting, backdating, reversal pattern, period-end spike detection',
  systemType: 'SAP',
  domain: 'fi-co',
  queryType: 'sql',
  query:
    'SELECT BUKRS, BELNR, GJAHR, BLART, BLDAT, BUDAT, MONAT, CPUDT, CPUTM, USNAM, TCODE, BKTXT, WAERS, STBLG, STJAH FROM BKPF WHERE BUKRS = :bukrs AND GJAHR = :gjahr AND MONAT BETWEEN :period_from AND :period_to',
  parameters: [
    { name: 'bukrs', type: 'string', required: true, description: 'Company code (4 chars)' },
    { name: 'gjahr', type: 'string', required: true, description: 'Fiscal year (4 chars)' },
    { name: 'period_from', type: 'string', required: false, description: 'Starting posting period', defaultValue: '01' },
    { name: 'period_to', type: 'string', required: false, description: 'Ending posting period', defaultValue: '12' },
  ],
  expectedFields: [
    { name: 'BUKRS', type: 'string', sapFieldName: 'BUKRS', description: 'Company Code' },
    { name: 'BELNR', type: 'string', sapFieldName: 'BELNR', description: 'Accounting Document Number' },
    { name: 'GJAHR', type: 'string', sapFieldName: 'GJAHR', description: 'Fiscal Year' },
    { name: 'BLART', type: 'string', sapFieldName: 'BLART', description: 'Document Type' },
    { name: 'BLDAT', type: 'date', sapFieldName: 'BLDAT', description: 'Document Date' },
    { name: 'BUDAT', type: 'date', sapFieldName: 'BUDAT', description: 'Posting Date' },
    { name: 'MONAT', type: 'string', sapFieldName: 'MONAT', description: 'Posting Period' },
    { name: 'CPUDT', type: 'date', sapFieldName: 'CPUDT', description: 'Entry Date / Creation Date' },
    { name: 'CPUTM', type: 'string', sapFieldName: 'CPUTM', description: 'Entry Time (HHMMSS)' },
    { name: 'USNAM', type: 'string', sapFieldName: 'USNAM', description: 'User Name (creator)' },
    { name: 'TCODE', type: 'string', sapFieldName: 'TCODE', description: 'Transaction Code' },
    { name: 'BKTXT', type: 'string', sapFieldName: 'BKTXT', description: 'Document Header Text' },
    { name: 'WAERS', type: 'string', sapFieldName: 'WAERS', description: 'Currency Key' },
    { name: 'STBLG', type: 'string', sapFieldName: 'STBLG', description: 'Reversal Document Number' },
    { name: 'STJAH', type: 'string', sapFieldName: 'STJAH', description: 'Reversal Fiscal Year' },
  ],
  testData: {
    inputParams: { bukrs: '1000', gjahr: '2024', period_from: '01', period_to: '12' },
    expectedRowCount: 500,
    description: 'Full-year journal entries for company code 1000',
  },
};

// ============================================================================
// Path 2: Line Items (BSEG)
// ============================================================================

const lineItems: ExtractionPath = {
  id: 'sap.fi-co.line-items',
  version: '1.0',
  name: 'Journal Entry Line Items',
  description:
    'Extract line items for a journal entry — round amount detection, split-below-threshold, unusual posting key analysis',
  systemType: 'SAP',
  domain: 'fi-co',
  queryType: 'sql',
  query:
    'SELECT BUKRS, BELNR, GJAHR, BUZEI, BSCHL, KOART, HKONT, SHKZG, DMBTR, WRBTR, WAERS, KOSTL, AUFNR, SGTXT, ZUONR FROM BSEG WHERE BUKRS = :bukrs AND BELNR = :belnr AND GJAHR = :gjahr',
  parameters: [
    { name: 'bukrs', type: 'string', required: true, description: 'Company code (4 chars)' },
    { name: 'belnr', type: 'string', required: true, description: 'Accounting document number (10 chars)' },
    { name: 'gjahr', type: 'string', required: true, description: 'Fiscal year (4 chars)' },
  ],
  expectedFields: [
    { name: 'BUKRS', type: 'string', sapFieldName: 'BUKRS', description: 'Company Code' },
    { name: 'BELNR', type: 'string', sapFieldName: 'BELNR', description: 'Accounting Document Number' },
    { name: 'GJAHR', type: 'string', sapFieldName: 'GJAHR', description: 'Fiscal Year' },
    { name: 'BUZEI', type: 'string', sapFieldName: 'BUZEI', description: 'Line Item Number' },
    { name: 'BSCHL', type: 'string', sapFieldName: 'BSCHL', description: 'Posting Key' },
    { name: 'KOART', type: 'string', sapFieldName: 'KOART', description: 'Account Type (S/D/K/A/M)' },
    { name: 'HKONT', type: 'string', sapFieldName: 'HKONT', description: 'GL Account Number' },
    { name: 'SHKZG', type: 'string', sapFieldName: 'SHKZG', description: 'Debit/Credit Indicator (S=Debit, H=Credit)' },
    { name: 'DMBTR', type: 'amount', sapFieldName: 'DMBTR', description: 'Amount in Local Currency' },
    { name: 'WRBTR', type: 'amount', sapFieldName: 'WRBTR', description: 'Amount in Document Currency' },
    { name: 'WAERS', type: 'string', sapFieldName: 'WAERS', description: 'Currency Key' },
    { name: 'KOSTL', type: 'string', sapFieldName: 'KOSTL', description: 'Cost Center' },
    { name: 'AUFNR', type: 'string', sapFieldName: 'AUFNR', description: 'Internal Order Number' },
    { name: 'SGTXT', type: 'string', sapFieldName: 'SGTXT', description: 'Line Item Text' },
    { name: 'ZUONR', type: 'string', sapFieldName: 'ZUONR', description: 'Assignment Number' },
  ],
  testData: {
    inputParams: { bukrs: '1000', belnr: '0100000001', gjahr: '2024' },
    expectedRowCount: 4,
    description: 'Line items for a single journal entry',
  },
};

// ============================================================================
// Path 3: Segregation of Duties — Same User Conflicting Transactions
// ============================================================================

const sodUsers: ExtractionPath = {
  id: 'sap.fi-co.sod-users',
  version: '1.0',
  name: 'Segregation of Duties — Conflicting User Actions',
  description:
    'Detect same-user performing conflicting transactions on the same document — post_and_approve, create_and_pay, park_and_post patterns',
  systemType: 'SAP',
  domain: 'fi-co',
  queryType: 'sql',
  query:
    'SELECT DISTINCT A.USNAM AS USER_A, A.TCODE AS TCODE_A, B.USNAM AS USER_B, B.TCODE AS TCODE_B, A.BUKRS, A.BELNR, A.GJAHR FROM BKPF A INNER JOIN BKPF B ON A.BUKRS = B.BUKRS AND A.BELNR = B.BELNR AND A.GJAHR = B.GJAHR AND A.USNAM = B.USNAM AND A.TCODE <> B.TCODE WHERE A.BUKRS = :bukrs AND A.GJAHR = :gjahr',
  parameters: [
    { name: 'bukrs', type: 'string', required: true, description: 'Company code (4 chars)' },
    { name: 'gjahr', type: 'string', required: true, description: 'Fiscal year (4 chars)' },
  ],
  expectedFields: [
    { name: 'USER_A', type: 'string', sapFieldName: 'USNAM', description: 'User performing first action' },
    { name: 'TCODE_A', type: 'string', sapFieldName: 'TCODE', description: 'Transaction code of first action' },
    { name: 'USER_B', type: 'string', sapFieldName: 'USNAM', description: 'User performing second action (same user)' },
    { name: 'TCODE_B', type: 'string', sapFieldName: 'TCODE', description: 'Transaction code of second action' },
    { name: 'BUKRS', type: 'string', sapFieldName: 'BUKRS', description: 'Company Code' },
    { name: 'BELNR', type: 'string', sapFieldName: 'BELNR', description: 'Accounting Document Number' },
    { name: 'GJAHR', type: 'string', sapFieldName: 'GJAHR', description: 'Fiscal Year' },
  ],
  testData: {
    inputParams: { bukrs: '1000', gjahr: '2024' },
    expectedRowCount: 25,
    description: 'SoD conflicts for company code 1000 in fiscal year 2024',
  },
};

// ============================================================================
// Path 4: GL Account Balances (aggregated from BSEG)
// ============================================================================

const glBalances: ExtractionPath = {
  id: 'sap.fi-co.gl-balances',
  version: '1.0',
  name: 'GL Account Balance Summary',
  description:
    'GL account balance summary for trial balance analysis and suspense account detection',
  systemType: 'SAP',
  domain: 'fi-co',
  queryType: 'sql',
  query:
    "SELECT HKONT, SUM(CASE WHEN SHKZG = 'S' THEN DMBTR ELSE 0 END) AS DEBIT_TOTAL, SUM(CASE WHEN SHKZG = 'H' THEN DMBTR ELSE 0 END) AS CREDIT_TOTAL, COUNT(*) AS POSTING_COUNT, COUNT(DISTINCT BELNR) AS DOC_COUNT FROM BSEG WHERE BUKRS = :bukrs AND GJAHR = :gjahr GROUP BY HKONT ORDER BY DEBIT_TOTAL DESC",
  parameters: [
    { name: 'bukrs', type: 'string', required: true, description: 'Company code (4 chars)' },
    { name: 'gjahr', type: 'string', required: true, description: 'Fiscal year (4 chars)' },
  ],
  expectedFields: [
    { name: 'HKONT', type: 'string', sapFieldName: 'HKONT', description: 'GL Account Number' },
    { name: 'DEBIT_TOTAL', type: 'amount', description: 'Total debit amount for the account' },
    { name: 'CREDIT_TOTAL', type: 'amount', description: 'Total credit amount for the account' },
    { name: 'POSTING_COUNT', type: 'number', description: 'Number of line item postings' },
    { name: 'DOC_COUNT', type: 'number', description: 'Number of distinct documents' },
  ],
  testData: {
    inputParams: { bukrs: '1000', gjahr: '2024' },
    expectedRowCount: 120,
    description: 'GL balance summary for company code 1000',
  },
};

// ============================================================================
// Export
// ============================================================================

export const SAP_FICO_PATHS: ExtractionPath[] = [
  journalEntries,
  lineItems,
  sodUsers,
  glBalances,
];
