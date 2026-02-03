/**
 * Tool: get_fi_document
 *
 * Retrieve a complete FI accounting document (header + all line items)
 * in audit-friendly format with debit/credit columns.
 *
 * Cross-references to originating MM/SD documents via BKPF.AWKEY.
 */

import { z } from 'zod';
import { SAPAdapter } from '../adapters/adapter.js';
import { createAuditContext } from '../logging/audit.js';
import { getFICoDataset } from '../adapters/csv/index.js';
import { FIDocumentResult } from '../types/fi-co.js';

// ============================================================================
// Zod Schema
// ============================================================================

export const GetFIDocumentSchema = z.object({
  company_code: z.string().describe('Company code (BUKRS)'),
  document_number: z.string().describe('Accounting document number (BELNR)'),
  fiscal_year: z.string().describe('Fiscal year (GJAHR)'),
  csv_file: z.string().optional().describe('Path to CSV file to load (if data not already loaded)'),
});

export type GetFIDocumentInput = z.infer<typeof GetFIDocumentSchema>;

// ============================================================================
// Tool Definition
// ============================================================================

export const getFIDocumentTool = {
  name: 'get_fi_document',
  description: `Retrieve a complete FI accounting document with all line items.

Returns the document header (BKPF) and all line items (BSEG) in an
audit-friendly format with separate debit and credit columns.

Also resolves:
- GL account descriptions (from SKA1/SKAT)
- Cross-reference to originating document (AWKEY → MM invoice, SD billing doc, etc.)
- Balance verification (total debits should equal total credits)

Use this to drill down into specific documents flagged by other forensic tools.

Required parameters: company_code, document_number, fiscal_year`,
  inputSchema: {
    type: 'object' as const,
    properties: {
      company_code: { type: 'string', description: 'Company code (BUKRS)' },
      document_number: { type: 'string', description: 'Document number (BELNR)' },
      fiscal_year: { type: 'string', description: 'Fiscal year (GJAHR)' },
      csv_file: { type: 'string', description: 'CSV file path' },
    },
    required: ['company_code', 'document_number', 'fiscal_year'],
  },
};

// ============================================================================
// Document Resolution
// ============================================================================

/**
 * Parse AWKEY to determine originating document
 */
function parseAWKEY(
  awkey: string | undefined,
  awtyp: string | undefined
): { type: string; document_number: string } | undefined {
  if (!awkey || awkey.trim() === '') return undefined;

  const typeDescriptions: Record<string, string> = {
    RMRP: 'Invoice Verification (MIRO)',
    MKPF: 'Material Document',
    VBRK: 'Billing Document',
    BKPF: 'Accounting Document',
    KOAH: 'CO Settlement',
    AFKO: 'Production Order',
    PRFI: 'Profitability Analysis',
    ASSET: 'Asset Posting',
  };

  return {
    type: (awtyp && typeDescriptions[awtyp]) || awtyp || 'Unknown',
    document_number: awkey.trim(),
  };
}

// ============================================================================
// Tool Executor
// ============================================================================

export async function executeGetFIDocument(
  _adapter: SAPAdapter,
  rawInput: unknown
): Promise<FIDocumentResult> {
  const input = GetFIDocumentSchema.parse(rawInput);

  const auditContext = createAuditContext(
    'get_fi_document',
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

    if (!dataset) {
      throw new Error('No FI/CO data loaded.');
    }

    // Find the document header
    const header = dataset.bkpf.find(
      d =>
        d.BUKRS === input.company_code &&
        d.BELNR === input.document_number &&
        d.GJAHR === input.fiscal_year
    );

    if (!header) {
      throw new Error(
        `Document not found: ${input.company_code}-${input.document_number}-${input.fiscal_year}`
      );
    }

    // Find all line items
    const lineItems = dataset.bseg.filter(
      li =>
        li.BUKRS === input.company_code &&
        li.BELNR === input.document_number &&
        li.GJAHR === input.fiscal_year
    );

    // Build account description lookup
    const accountDescriptions = new Map<string, string>();
    for (const skat of dataset.skat) {
      if (skat.SPRAS === 'E' || skat.SPRAS === 'EN') {
        accountDescriptions.set(skat.SAKNR, skat.TXT50 || skat.TXT20);
      }
    }
    for (const ska1 of dataset.ska1) {
      if (!accountDescriptions.has(ska1.SAKNR)) {
        accountDescriptions.set(ska1.SAKNR, ska1.TXT50 || ska1.TXT20 || '');
      }
    }

    // Format line items with debit/credit columns
    let totalDebit = 0;
    let totalCredit = 0;

    const formattedItems = lineItems
      .sort((a, b) => a.BUZEI.localeCompare(b.BUZEI))
      .map(li => {
        const amount = Math.abs(li.WRBTR || 0);
        const isDebit = li.SHKZG === 'S';

        if (isDebit) totalDebit += amount;
        else totalCredit += amount;

        return {
          ...li,
          debit_amount: isDebit ? amount : null,
          credit_amount: isDebit ? null : amount,
          account_description: accountDescriptions.get(li.HKONT),
        };
      });

    totalDebit = Math.round(totalDebit * 100) / 100;
    totalCredit = Math.round(totalCredit * 100) / 100;

    const result: FIDocumentResult = {
      header,
      line_items: formattedItems,
      total_debit: totalDebit,
      total_credit: totalCredit,
      is_balanced: Math.abs(totalDebit - totalCredit) < 0.01,
      origin_document: parseAWKEY(header.AWKEY, header.AWTYP),
    };

    auditContext.success(formattedItems.length);
    return result;
  } catch (error) {
    auditContext.error(error as Error);
    throw error;
  }
}
