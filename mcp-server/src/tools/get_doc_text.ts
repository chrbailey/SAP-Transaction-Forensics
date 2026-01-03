/**
 * Tool 2: get_doc_text
 *
 * Retrieve all text entries for a specific document.
 * Returns both header-level and item-level texts with metadata.
 */

import { z } from 'zod';
import { SAPAdapter } from '../adapters/adapter.js';
import { DocTextParams, DocTextResult } from '../types/sap.js';
import { createAuditContext } from '../logging/audit.js';
import { withTimeout, getPolicyConfig } from '../policies/limits.js';

/**
 * Zod schema for input validation
 */
export const GetDocTextSchema = z.object({
  doc_type: z.enum(['sales', 'delivery', 'invoice']),
  doc_key: z.string().min(1, 'Document key is required'),
});

export type GetDocTextInput = z.infer<typeof GetDocTextSchema>;

/**
 * Tool definition for MCP registration
 */
export const getDocTextTool = {
  name: 'get_doc_text',
  description: `Retrieve all text entries for a specific SAP document.
Returns header texts and item texts with text IDs, language, and change timestamps.

Use this tool to:
- Get all notes and comments on a sales order
- Read delivery instructions
- View invoice text annotations

Parameters:
- doc_type: Type of document (sales, delivery, invoice)
- doc_key: Document number (e.g., sales order number)`,
  inputSchema: {
    type: 'object' as const,
    properties: {
      doc_type: {
        type: 'string',
        enum: ['sales', 'delivery', 'invoice'],
        description: 'Type of document',
      },
      doc_key: {
        type: 'string',
        description: 'Document number (VBELN)',
      },
    },
    required: ['doc_type', 'doc_key'],
  },
};

/**
 * Execute the get_doc_text tool
 */
export async function executeGetDocText(
  adapter: SAPAdapter,
  rawInput: unknown
): Promise<DocTextResult> {
  // Validate input
  const input = GetDocTextSchema.parse(rawInput);

  // Create audit context
  const auditContext = createAuditContext(
    'get_doc_text',
    input as Record<string, unknown>,
    adapter.name
  );

  try {
    // Build params
    const params: DocTextParams = {
      doc_type: input.doc_type,
      doc_key: input.doc_key,
    };

    // Execute with timeout
    const config = getPolicyConfig();
    const result = await withTimeout(
      adapter.getDocText(params),
      config.defaultTimeoutMs,
      'get_doc_text'
    );

    // Count total texts returned
    const textCount = result.header_texts.length + result.item_texts.length;

    // Log success
    auditContext.success(textCount);

    return result;
  } catch (error) {
    auditContext.error(error as Error);
    throw error;
  }
}
