/**
 * Tool 7: get_invoice_timing
 *
 * Retrieve timing and posting information for an invoice.
 * Includes links to accounting documents and source documents.
 */

import { z } from 'zod';
import { SAPAdapter } from '../adapters/adapter.js';
import { InvoiceTimingParams, InvoiceTimingResult } from '../types/sap.js';
import { createAuditContext } from '../logging/audit.js';
import { withTimeout, getPolicyConfig } from '../policies/limits.js';

/**
 * Zod schema for input validation
 */
export const GetInvoiceTimingSchema = z.object({
  vbeln: z.string().min(1, 'Invoice number is required'),
});

export type GetInvoiceTimingInput = z.infer<typeof GetInvoiceTimingSchema>;

/**
 * Tool definition for MCP registration
 */
export const getInvoiceTimingTool = {
  name: 'get_invoice_timing',
  description: `Retrieve timing and posting information for an invoice.
Includes creation dates, posting dates, and links to source documents.

Returns:
- Invoice number
- Billing date
- Posting date (to accounting)
- Creation date/time
- Accounting document reference
- Linked deliveries and sales orders

Use this tool to:
- Track invoice processing timing
- Find the accounting document
- Trace back to source documents
- Analyze billing cycle times

Parameters:
- vbeln: Invoice/billing document number (required)`,
  inputSchema: {
    type: 'object' as const,
    properties: {
      vbeln: {
        type: 'string',
        description: 'Invoice/billing document number (VBELN)',
      },
    },
    required: ['vbeln'],
  },
};

/**
 * Execute the get_invoice_timing tool
 */
export async function executeGetInvoiceTiming(
  adapter: SAPAdapter,
  rawInput: unknown
): Promise<InvoiceTimingResult | null> {
  // Validate input
  const input = GetInvoiceTimingSchema.parse(rawInput);

  // Create audit context
  const auditContext = createAuditContext(
    'get_invoice_timing',
    input as Record<string, unknown>,
    adapter.name
  );

  try {
    // Build params
    const params: InvoiceTimingParams = {
      vbeln: input.vbeln,
    };

    // Execute with timeout
    const config = getPolicyConfig();
    const result = await withTimeout(
      adapter.getInvoiceTiming(params),
      config.defaultTimeoutMs,
      'get_invoice_timing'
    );

    // Log success
    auditContext.success(result ? 1 : 0);

    return result;
  } catch (error) {
    auditContext.error(error as Error);
    throw error;
  }
}
