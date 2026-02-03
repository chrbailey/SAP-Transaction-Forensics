/**
 * Tool: generate_fi_assessment
 *
 * Orchestrates all FI/CO forensic analysis tools and produces a
 * unified assessment report in markdown format.
 *
 * This is the primary entry point for client-facing SAP pre-migration
 * assessments. It runs journal entry analysis, SoD checks, and GL
 * balance analysis, then generates a structured report.
 */

import { z } from 'zod';
import { SAPAdapter } from '../adapters/adapter.js';
import { createAuditContext } from '../logging/audit.js';
import { getFICoDataset } from '../adapters/csv/index.js';
import { DEFAULT_FORENSIC_CONFIG, ForensicConfig } from '../types/fi-co.js';
import { executeAnalyzeJournalEntries } from './analyze-journal-entries.js';
import { executeAnalyzeSoD } from './analyze-sod.js';
import { executeAnalyzeGLBalances } from './analyze-gl-balances.js';
import { buildAssessment, renderAssessmentReport } from '../reports/fi-assessment.js';

// ============================================================================
// Zod Schema
// ============================================================================

export const GenerateFIAssessmentSchema = z.object({
  company_code: z
    .string()
    .optional()
    .describe('Company code to analyze (defaults to first found in data)'),
  fiscal_year: z
    .string()
    .optional()
    .describe('Fiscal year to analyze (defaults to most common in data)'),
  csv_file: z.string().optional().describe('Path to CSV file to load (if data not already loaded)'),
  round_amount_threshold: z
    .number()
    .optional()
    .describe('Threshold for round amount flagging (default: 1000)'),
  backdate_days_threshold: z
    .number()
    .optional()
    .describe('Days threshold for backdated entry flagging (default: 15)'),
  approval_threshold: z
    .number()
    .optional()
    .describe('Approval threshold for split-below detection (default: 50000)'),
  format: z
    .enum(['markdown', 'json'])
    .optional()
    .describe('Output format: markdown (default) or json'),
});

export type GenerateFIAssessmentInput = z.infer<typeof GenerateFIAssessmentSchema>;

// ============================================================================
// Tool Definition
// ============================================================================

export const generateFIAssessmentTool = {
  name: 'generate_fi_assessment',
  description: `Generate a comprehensive FI/CO forensic assessment report.

Runs all forensic analysis tools (journal entries, SoD, GL balances) and
produces a unified report suitable for client delivery.

The report includes:
- Executive summary with overall risk rating
- Journal entry anomalies (weekend postings, round amounts, backdated entries, etc.)
- Segregation of duties conflicts
- GL balance analysis (trial balance, variances, suspense accounts)
- Prioritized recommendations

Output can be markdown (default) or structured JSON.

Requires FI/CO data to be loaded via CSV adapter or csv_file parameter.`,
  inputSchema: {
    type: 'object' as const,
    properties: {
      company_code: { type: 'string', description: 'Company code (optional)' },
      fiscal_year: { type: 'string', description: 'Fiscal year (optional)' },
      csv_file: { type: 'string', description: 'CSV file path (optional)' },
      round_amount_threshold: { type: 'number', description: 'Round amount threshold' },
      backdate_days_threshold: { type: 'number', description: 'Backdate days threshold' },
      approval_threshold: { type: 'number', description: 'Approval threshold' },
      format: { type: 'string', enum: ['markdown', 'json'], description: 'Output format' },
    },
    required: [],
  },
};

// ============================================================================
// Tool Executor
// ============================================================================

export async function executeGenerateFIAssessment(
  adapter: SAPAdapter,
  rawInput: unknown
): Promise<{ report: string; format: string } | Record<string, unknown>> {
  const input = GenerateFIAssessmentSchema.parse(rawInput);

  const auditContext = createAuditContext(
    'generate_fi_assessment',
    input as Record<string, unknown>,
    'csv'
  );

  try {
    // Build config from input overrides
    const config: ForensicConfig = {
      ...DEFAULT_FORENSIC_CONFIG,
      ...(input.round_amount_threshold !== undefined && {
        round_amount_threshold: input.round_amount_threshold,
      }),
      ...(input.backdate_days_threshold !== undefined && {
        backdate_days_threshold: input.backdate_days_threshold,
      }),
      ...(input.approval_threshold !== undefined && {
        approval_threshold: input.approval_threshold,
      }),
    };

    // Determine company code and fiscal year
    let dataset = getFICoDataset();
    if (!dataset && input.csv_file) {
      const { CSVAdapter } = await import('../adapters/csv/index.js');
      const csvAdapter = new CSVAdapter(input.csv_file);
      await csvAdapter.initialize();
      dataset = csvAdapter.getDataset();
    }

    if (!dataset || dataset.bkpf.length === 0) {
      throw new Error(
        'No FI/CO data loaded. Provide a csv_file parameter or load data via the CSV adapter first.'
      );
    }

    const companyCode = input.company_code || dataset.bkpf[0]?.BUKRS || '1000';

    // Find most common fiscal year if not specified
    const fiscalYear =
      input.fiscal_year ||
      (() => {
        const yearCounts = new Map<string, number>();
        for (const doc of dataset!.bkpf) {
          yearCounts.set(doc.GJAHR, (yearCounts.get(doc.GJAHR) || 0) + 1);
        }
        let maxYear = dataset!.bkpf[0]?.GJAHR || '2024';
        let maxCount = 0;
        for (const [year, count] of yearCounts) {
          if (count > maxCount) {
            maxYear = year;
            maxCount = count;
          }
        }
        return maxYear;
      })();

    // Run all three analyses in parallel
    const [journalResult, sodResult, glResult] = await Promise.all([
      executeAnalyzeJournalEntries(adapter, {
        company_code: companyCode,
        fiscal_year: fiscalYear,
        round_amount_threshold: config.round_amount_threshold,
        backdate_days_threshold: config.backdate_days_threshold,
        approval_threshold: config.approval_threshold,
      }),
      executeAnalyzeSoD(adapter, {
        company_code: companyCode,
        fiscal_year: fiscalYear,
      }),
      executeAnalyzeGLBalances(adapter, {
        company_code: companyCode,
        fiscal_year: fiscalYear,
      }),
    ]);

    // Build assessment
    const assessment = buildAssessment(
      dataset,
      journalResult.anomalies,
      sodResult.conflicts,
      glResult,
      config
    );

    auditContext.success(assessment.executive_summary.total_anomalies);

    // Return in requested format
    if (input.format === 'json') {
      return assessment as unknown as Record<string, unknown>;
    }

    return {
      report: renderAssessmentReport(assessment),
      format: 'markdown',
    };
  } catch (error) {
    auditContext.error(error as Error);
    throw error;
  }
}
