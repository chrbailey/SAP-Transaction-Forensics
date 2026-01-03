/**
 * Tool 3: get_doc_flow
 *
 * Retrieve the complete document chain starting from a sales order.
 * Traces through deliveries, invoices, and related documents.
 */

import { z } from 'zod';
import { SAPAdapter } from '../adapters/adapter.js';
import { DocFlowParams, DocFlowResult } from '../types/sap.js';
import { createAuditContext } from '../logging/audit.js';
import { withTimeout, getPolicyConfig } from '../policies/limits.js';

/**
 * Zod schema for input validation
 */
export const GetDocFlowSchema = z.object({
  vbeln: z.string().min(1, 'Sales order number is required'),
});

export type GetDocFlowInput = z.infer<typeof GetDocFlowSchema>;

/**
 * Tool definition for MCP registration
 */
export const getDocFlowTool = {
  name: 'get_doc_flow',
  description: `Retrieve the complete document chain for a sales order.
Traces the order-to-cash flow: Sales Order -> Delivery -> Invoice.

Returns:
- Root document reference
- Linked documents with types, statuses, and timestamps
- Item-level references showing which items flow to which documents

Use this tool to:
- Trace the complete lifecycle of an order
- Find related deliveries and invoices
- Understand document relationships

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
 * Execute the get_doc_flow tool
 */
export async function executeGetDocFlow(
  adapter: SAPAdapter,
  rawInput: unknown
): Promise<DocFlowResult> {
  // Validate input
  const input = GetDocFlowSchema.parse(rawInput);

  // Create audit context
  const auditContext = createAuditContext(
    'get_doc_flow',
    input as Record<string, unknown>,
    adapter.name
  );

  try {
    // Build params
    const params: DocFlowParams = {
      vbeln: input.vbeln,
    };

    // Execute with timeout
    const config = getPolicyConfig();
    const result = await withTimeout(
      adapter.getDocFlow(params),
      config.defaultTimeoutMs,
      'get_doc_flow'
    );

    // Count documents in flow
    const docCount = result.flow.length;

    // Log success
    auditContext.success(docCount);

    return result;
  } catch (error) {
    auditContext.error(error as Error);
    throw error;
  }
}
