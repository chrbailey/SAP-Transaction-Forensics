/**
 * Tool 4: get_sales_doc_header
 *
 * Retrieve header data for a specific sales order.
 * Returns organizational data, parties, dates, and status.
 */

import { z } from 'zod';
import { SAPAdapter } from '../adapters/adapter.js';
import { SalesDocHeaderParams, SalesDocHeader } from '../types/sap.js';
import { createAuditContext } from '../logging/audit.js';
import { withTimeout, getPolicyConfig } from '../policies/limits.js';

/**
 * Zod schema for input validation
 */
export const GetSalesDocHeaderSchema = z.object({
  vbeln: z.string().min(1, 'Sales order number is required'),
});

export type GetSalesDocHeaderInput = z.infer<typeof GetSalesDocHeaderSchema>;

/**
 * Tool definition for MCP registration
 */
export const getSalesDocHeaderTool = {
  name: 'get_sales_doc_header',
  description: `Retrieve header data for a specific sales order.

Returns:
- Document identifiers (VBELN, AUART)
- Organizational data (sales_org, distr_chan, division)
- Partner references (sold_to, ship_to)
- Dates (doc_date, req_deliv_date, created_at)
- Created by user
- Net value and currency

Use this tool to:
- Get overview information about a sales order
- Check organizational assignment
- View partner and date information

Parameters:
- vbeln: Sales order number (required)`,
  inputSchema: {
    type: 'object' as const,
    properties: {
      vbeln: {
        type: 'string',
        description: 'Sales order number (VBELN)',
      },
    },
    required: ['vbeln'],
  },
};

/**
 * Execute the get_sales_doc_header tool
 */
export async function executeGetSalesDocHeader(
  adapter: SAPAdapter,
  rawInput: unknown
): Promise<SalesDocHeader | null> {
  // Validate input
  const input = GetSalesDocHeaderSchema.parse(rawInput);

  // Create audit context
  const auditContext = createAuditContext(
    'get_sales_doc_header',
    input as Record<string, unknown>,
    adapter.name
  );

  try {
    // Build params
    const params: SalesDocHeaderParams = {
      vbeln: input.vbeln,
    };

    // Execute with timeout
    const config = getPolicyConfig();
    const result = await withTimeout(
      adapter.getSalesDocHeader(params),
      config.defaultTimeoutMs,
      'get_sales_doc_header'
    );

    // Log success (1 row if found, 0 if not)
    auditContext.success(result ? 1 : 0);

    return result;
  } catch (error) {
    auditContext.error(error as Error);
    throw error;
  }
}
