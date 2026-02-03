/**
 * Integration test: Full FI/CO forensic pipeline
 *
 * Exercises the complete Extract → Load → Analyze → Report workflow:
 * 1. Load real SAP IDES CSV data via CSVAdapter
 * 2. Run journal entry analysis
 * 3. Run segregation of duties analysis
 * 4. Run GL balance analysis
 * 5. Generate full assessment report
 *
 * Uses real data extracted from sap.sqlite (7,059 BKPF + 28,567 BSEG rows).
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { CSVAdapter, getFICoDataset } from '../adapters/csv/index.js';
import { executeAnalyzeJournalEntries } from '../tools/analyze-journal-entries.js';
import { executeAnalyzeSoD } from '../tools/analyze-sod.js';
import { executeAnalyzeGLBalances } from '../tools/analyze-gl-balances.js';
import { executeGenerateFIAssessment } from '../tools/generate-fi-assessment.js';

// ESM-compatible __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Fixture paths — real SAP IDES data exported from sap.sqlite
const FIXTURE_DIR = resolve(__dirname, '../../test/fixtures');
const CSV_FILES = [
  `${FIXTURE_DIR}/bkpf.csv`,
  `${FIXTURE_DIR}/bseg.csv`,
  `${FIXTURE_DIR}/ska1.csv`,
  `${FIXTURE_DIR}/skat.csv`,
  `${FIXTURE_DIR}/t001.csv`,
];

describe('FI/CO Integration: Extract → Load → Analyze → Report', () => {
  let csvAdapter: CSVAdapter;

  beforeAll(async () => {
    csvAdapter = new CSVAdapter(CSV_FILES);
    await csvAdapter.initialize();
  }, 30_000); // 30s timeout for loading large CSVs

  afterAll(async () => {
    await csvAdapter.shutdown();
  });

  // ========================================================================
  // Phase 1: Data Loading
  // ========================================================================

  describe('Phase 1: CSV Data Loading', () => {
    it('should load all 5 CSV files into the dataset', () => {
      const dataset = csvAdapter.getDataset();
      expect(dataset).toBeTruthy();
      expect(dataset.bkpf.length).toBeGreaterThan(0);
      expect(dataset.bseg.length).toBeGreaterThan(0);
      expect(dataset.ska1.length).toBeGreaterThan(0);
      expect(dataset.skat.length).toBeGreaterThan(0);
      expect(dataset.t001.length).toBeGreaterThan(0);
    });

    it('should load expected record counts from IDES data', () => {
      const dataset = csvAdapter.getDataset();
      // Real IDES data: BKPF=7059, BSEG=28567, SKA1=14409, SKAT=41527, T001=157
      expect(dataset.bkpf.length).toBeGreaterThanOrEqual(7000);
      expect(dataset.bseg.length).toBeGreaterThanOrEqual(28000);
      expect(dataset.ska1.length).toBeGreaterThanOrEqual(14000);
      expect(dataset.skat.length).toBeGreaterThanOrEqual(41000);
      expect(dataset.t001.length).toBeGreaterThanOrEqual(100);
    });

    it('should set activeDataset accessible via getFICoDataset()', () => {
      const dataset = getFICoDataset();
      expect(dataset).not.toBeNull();
      expect(dataset!.bkpf.length).toBeGreaterThan(0);
    });

    it('should parse BKPF records with expected fields', () => {
      const doc = csvAdapter.getDataset().bkpf[0]!;
      expect(doc.BUKRS).toBeDefined();
      expect(doc.BELNR).toBeDefined();
      expect(doc.GJAHR).toBeDefined();
      expect(doc.BLART).toBeDefined();
      expect(doc.USNAM).toBeDefined();
    });

    it('should parse BSEG records with numeric amounts', () => {
      const dataset = csvAdapter.getDataset();
      const withAmounts = dataset.bseg.filter(li => li.DMBTR > 0 || li.WRBTR > 0);
      expect(withAmounts.length).toBeGreaterThan(0);
      // Amounts should be real numbers, not NaN or strings
      expect(typeof withAmounts[0]!.DMBTR).toBe('number');
      expect(Number.isFinite(withAmounts[0]!.DMBTR)).toBe(true);
    });
  });

  // ========================================================================
  // Phase 2: Forensic Analysis Tools
  // ========================================================================

  describe('Phase 2: Journal Entry Analysis', () => {
    it('should detect anomalies in IDES journal entries', async () => {
      const result = await executeAnalyzeJournalEntries(csvAdapter as any, {
        company_code: '1000',
      });

      expect(result).toBeTruthy();
      expect(result.anomalies).toBeDefined();
      expect(Array.isArray(result.anomalies)).toBe(true);

      // IDES data spans fiscal year 1997 with real entries — should find some anomalies
      expect(result.summary).toBeDefined();
      expect(result.summary.total_documents_analyzed).toBeGreaterThan(0);
    }, 30_000);

    it('should categorize anomalies by type', async () => {
      const result = await executeAnalyzeJournalEntries(csvAdapter as any, {
        company_code: '1000',
      });

      // Each anomaly should have required fields
      for (const anomaly of result.anomalies.slice(0, 5)) {
        expect(anomaly.anomaly_type).toBeDefined();
        expect(anomaly.severity).toBeDefined();
        expect(anomaly.document_key).toBeDefined();
        expect(['critical', 'high', 'medium', 'low']).toContain(anomaly.severity);
      }
    }, 30_000);
  });

  describe('Phase 2: Segregation of Duties Analysis', () => {
    it('should analyze SoD conflicts', async () => {
      const result = await executeAnalyzeSoD(csvAdapter as any, {
        company_code: '1000',
      });

      expect(result).toBeTruthy();
      expect(result.conflicts).toBeDefined();
      expect(Array.isArray(result.conflicts)).toBe(true);
      expect(result.summary).toBeDefined();
      expect(result.summary.unique_users_with_conflicts).toBeGreaterThanOrEqual(0);
    }, 30_000);
  });

  describe('Phase 2: GL Balance Analysis', () => {
    it('should analyze GL balances', async () => {
      const result = await executeAnalyzeGLBalances(csvAdapter as any, {
        company_code: '1000',
      });

      expect(result).toBeTruthy();
      expect(result.trial_balance).toBeDefined();
      expect(Array.isArray(result.trial_balance)).toBe(true);
      expect(result.trial_balance.length).toBeGreaterThan(0);
      expect(result.total_accounts).toBeGreaterThan(0);
    }, 30_000);

    it('should produce trial balance entries with debit/credit amounts', async () => {
      const result = await executeAnalyzeGLBalances(csvAdapter as any, {
        company_code: '1000',
      });

      const entry = result.trial_balance[0]!;
      expect(entry.account).toBeDefined();
      expect(typeof entry.total_debit).toBe('number');
      expect(typeof entry.total_credit).toBe('number');
    }, 30_000);
  });

  // ========================================================================
  // Phase 3: Full Assessment Report
  // ========================================================================

  describe('Phase 3: Assessment Report Generation', () => {
    it('should generate a complete markdown assessment report', async () => {
      const result = await executeGenerateFIAssessment(csvAdapter as any, {
        company_code: '1000',
        format: 'markdown',
      });

      expect(result).toBeTruthy();
      expect('report' in result).toBe(true);
      const reportResult = result as { report: string; format: string };
      expect(reportResult.format).toBe('markdown');

      // Report should contain all major sections
      const report = reportResult.report;
      expect(report).toContain('Executive Summary');
      expect(report).toContain('Journal Entry');
      expect(report).toContain('General Ledger');
      expect(report.length).toBeGreaterThan(500); // Non-trivial report
    }, 60_000);

    it('should generate JSON assessment when requested', async () => {
      const result = await executeGenerateFIAssessment(csvAdapter as any, {
        company_code: '1000',
        format: 'json',
      });

      expect(result).toBeTruthy();
      // JSON format returns the raw assessment object
      expect('executive_summary' in result || 'report' in result).toBe(true);
    }, 60_000);
  });
});
