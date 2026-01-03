/**
 * Tool 1: search_doc_text
 *
 * Full-text search across document texts with regex pattern matching.
 * Returns matching documents with snippets and metadata.
 */

import { z } from 'zod';
import { SAPAdapter } from '../adapters/adapter.js';
import { SearchDocTextParams, SearchResult, OrgFilters } from '../types/sap.js';
import { createAuditContext } from '../logging/audit.js';
import {
  enforceRowLimit,
  enforceToolPolicies,
  withTimeout,
  getPolicyConfig,
} from '../policies/limits.js';

/**
 * Zod schema for input validation
 */
export const SearchDocTextSchema = z.object({
  pattern: z.string().min(2, 'Pattern must be at least 2 characters'),
  doc_type: z.enum(['sales', 'delivery', 'invoice']).optional(),
  date_from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD format')
    .optional(),
  date_to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD format')
    .optional(),
  org_filters: z
    .object({
      VKORG: z.string().optional(),
      VTWEG: z.string().optional(),
      SPART: z.string().optional(),
      WERKS: z.string().optional(),
    })
    .optional(),
  limit: z.number().int().min(1).max(200).default(200),
});

export type SearchDocTextInput = z.infer<typeof SearchDocTextSchema>;

/**
 * Tool definition for MCP registration
 */
export const searchDocTextTool = {
  name: 'search_doc_text',
  description: `Search document texts using regex patterns across SAP documents.
Returns matching documents with text snippets, match scores, and metadata.

Use this tool to:
- Find documents containing specific text patterns
- Search for error messages or keywords in order notes
- Locate documents with specific customer references

Parameters:
- pattern: Regex pattern to search for (required, minimum 2 characters)
- doc_type: Filter by document type (sales, delivery, invoice)
- date_from/date_to: Date range filter (YYYY-MM-DD format)
- org_filters: Filter by organization (VKORG, VTWEG, SPART, WERKS)
- limit: Maximum results (default 200, max 200)`,
  inputSchema: {
    type: 'object' as const,
    properties: {
      pattern: {
        type: 'string',
        description: 'Regex pattern to search for in document texts',
      },
      doc_type: {
        type: 'string',
        enum: ['sales', 'delivery', 'invoice'],
        description: 'Document type to search (optional)',
      },
      date_from: {
        type: 'string',
        description: 'Start date for filtering (YYYY-MM-DD)',
      },
      date_to: {
        type: 'string',
        description: 'End date for filtering (YYYY-MM-DD)',
      },
      org_filters: {
        type: 'object',
        properties: {
          VKORG: { type: 'string', description: 'Sales Organization' },
          VTWEG: { type: 'string', description: 'Distribution Channel' },
          SPART: { type: 'string', description: 'Division' },
          WERKS: { type: 'string', description: 'Plant' },
        },
        description: 'Organizational unit filters',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of results (default 200, max 200)',
      },
    },
    required: ['pattern'],
  },
};

/**
 * Execute the search_doc_text tool
 */
export async function executeSearchDocText(
  adapter: SAPAdapter,
  rawInput: unknown
): Promise<SearchResult[]> {
  // Validate input
  const input = SearchDocTextSchema.parse(rawInput);

  // Create audit context
  const auditContext = createAuditContext(
    'search_doc_text',
    input as Record<string, unknown>,
    adapter.name
  );

  try {
    // Enforce policies
    enforceToolPolicies('search_doc_text', input as Record<string, unknown>, auditContext);

    // Build params
    const params: SearchDocTextParams = {
      pattern: input.pattern,
      ...(input.doc_type ? { doc_type: input.doc_type } : {}),
      ...(input.date_from ? { date_from: input.date_from } : {}),
      ...(input.date_to ? { date_to: input.date_to } : {}),
      ...(input.org_filters ? { org_filters: input.org_filters as OrgFilters } : {}),
      ...(input.limit ? { limit: input.limit } : {}),
    };

    // Execute with timeout
    const config = getPolicyConfig();
    const results = await withTimeout(
      adapter.searchDocText(params),
      config.defaultTimeoutMs,
      'search_doc_text'
    );

    // Enforce row limit
    const limitedResults = enforceRowLimit(results, input.limit, auditContext);

    // Log success
    auditContext.success(limitedResults.length);

    return limitedResults;
  } catch (error) {
    auditContext.error(error as Error);
    throw error;
  }
}
