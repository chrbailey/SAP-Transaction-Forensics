/**
 * Tool 5: get_sales_doc_items
 *
 * Retrieve all line items for a specific sales order.
 * Returns material, quantity, pricing, and schedule information.
 */

import { z } from 'zod';
import { SAPAdapter } from '../adapters/adapter.js';
import { SalesDocItemsParams, SalesDocItem } from '../types/sap.js';
import { createAuditContext } from '../logging/audit.js';
import { enforceRowLimit, withTimeout, getPolicyConfig } from '../policies/limits.js';

/**
 * Zod schema for input validation
 */
export const GetSalesDocItemsSchema = z.object({
  vbeln: z.string().min(1, 'Sales order number is required'),
});

export type GetSalesDocItemsInput = z.infer<typeof GetSalesDocItemsSchema>;

/**
 * Tool definition for MCP registration
 */
export const getSalesDocItemsTool = {
  name: 'get_sales_doc_items',
  description: `Retrieve all line items for a specific sales order.

Returns array of items with:
- Item number (POSNR)
- Material (MATNR) and description
- Plant and storage location
- Order quantity and unit
- Net value and currency
- Item category
- Schedule line dates (if available)

Use this tool to:
- View all products/materials on an order
- Check quantities and values per line item
- See delivery schedules

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
 * Execute the get_sales_doc_items tool
 */
export async function executeGetSalesDocItems(
  adapter: SAPAdapter,
  rawInput: unknown
): Promise<SalesDocItem[]> {
  // Validate input
  const input = GetSalesDocItemsSchema.parse(rawInput);

  // Create audit context
  const auditContext = createAuditContext(
    'get_sales_doc_items',
    input as Record<string, unknown>,
    adapter.name
  );

  try {
    // Build params
    const params: SalesDocItemsParams = {
      vbeln: input.vbeln,
    };

    // Execute with timeout
    const config = getPolicyConfig();
    const results = await withTimeout(
      adapter.getSalesDocItems(params),
      config.defaultTimeoutMs,
      'get_sales_doc_items'
    );

    // Enforce row limit (though items per order rarely exceed 200)
    const limitedResults = enforceRowLimit(results, 200, auditContext);

    // Log success
    auditContext.success(limitedResults.length);

    return limitedResults;
  } catch (error) {
    auditContext.error(error as Error);
    throw error;
  }
}
