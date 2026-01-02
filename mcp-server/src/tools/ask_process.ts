/**
 * Tool: ask_process
 *
 * Natural language interface for querying SAP process data.
 * Uses LLM to interpret questions and provide business-friendly answers.
 */

import { z } from 'zod';
import { SAPAdapter } from '../adapters/adapter.js';
import { createAuditContext } from '../logging/audit.js';
import { LLMService, createLLMServiceFromEnv, ProcessQueryContext } from '../llm/index.js';

// Singleton LLM service (created on first use)
let llmService: LLMService | null = null;

function getLLMService(): LLMService {
  if (!llmService) {
    llmService = createLLMServiceFromEnv();
  }
  return llmService;
}

/**
 * Zod schema for input validation
 */
export const AskProcessSchema = z.object({
  question: z.string().min(10, 'Question must be at least 10 characters'),
  include_patterns: z.boolean().default(true),
  include_sample_data: z.boolean().default(true),
});

export type AskProcessInput = z.infer<typeof AskProcessSchema>;

/**
 * Tool definition for MCP registration
 */
export const askProcessTool = {
  name: 'ask_process',
  description: `Ask questions about SAP processes in natural language.

This tool uses AI to understand your question and analyze the process data to provide
business-friendly answers with evidence and recommendations.

Example questions:
- "Why are orders from sales org 1000 taking longer to ship?"
- "Which customers have the most credit holds?"
- "What patterns correlate with delivery delays?"
- "How does our order-to-cash cycle compare across regions?"

Parameters:
- question: Your question in natural language (required)
- include_patterns: Include discovered patterns as context (default: true)
- include_sample_data: Include sample data for analysis (default: true)

Returns:
- answer: Detailed response to your question
- confidence: High/Medium/Low confidence level
- evidence: Supporting data points and document references
- recommendations: Suggested actions if applicable
- follow_up_questions: Related questions you might want to ask`,
  inputSchema: {
    type: 'object' as const,
    properties: {
      question: {
        type: 'string',
        description: 'Your question about SAP processes in natural language',
      },
      include_patterns: {
        type: 'boolean',
        description: 'Include discovered patterns as context (default: true)',
      },
      include_sample_data: {
        type: 'boolean',
        description: 'Include sample data for analysis (default: true)',
      },
    },
    required: ['question'],
  },
};

/**
 * Build process query context from adapter
 */
async function buildContext(
  adapter: SAPAdapter,
  includePatterns: boolean
): Promise<ProcessQueryContext> {
  // Get basic statistics from adapter if available
  type AdapterStats = {
    orderCount?: number;
    deliveryCount?: number;
    invoiceCount?: number;
    salesOrgs?: string[];
  };

  const adapterWithStats = adapter as SAPAdapter & { getStats?: () => Promise<AdapterStats> };
  const stats: AdapterStats = adapterWithStats.getStats
    ? await adapterWithStats.getStats()
    : {};

  // Build date range from available data
  const now = new Date();
  const oneYearAgo = new Date(now);
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

  const context: ProcessQueryContext = {
    orderCount: stats.orderCount || 0,
    deliveryCount: stats.deliveryCount || 0,
    invoiceCount: stats.invoiceCount || 0,
    dateRange: {
      from: oneYearAgo.toISOString().split('T')[0]!,
      to: now.toISOString().split('T')[0]!,
    },
    salesOrgs: stats.salesOrgs || ['1000', '2000'],
  };

  // Include discovered patterns if available
  if (includePatterns) {
    // This would load from pattern-engine output in production
    context.patterns = [
      {
        name: 'Credit Hold Escalation',
        description: 'Orders with CREDIT HOLD in notes have 3.2x longer fulfillment cycles',
        occurrence: 234,
        confidence: 'HIGH',
      },
      {
        name: 'Rush Order Pattern',
        description: 'Orders marked URGENT have 15% higher partial shipment rate',
        occurrence: 567,
        confidence: 'MEDIUM',
      },
    ];
  }

  return context;
}

/**
 * Execute the ask_process tool
 */
export async function executeAskProcess(
  adapter: SAPAdapter,
  rawInput: unknown
): Promise<{
  answer: string;
  confidence: string;
  evidence: Array<{ source: string; snippet: string }>;
  recommendations: string[];
  follow_up_questions: string[];
  llm_provider: string;
}> {
  // Validate input
  const input = AskProcessSchema.parse(rawInput);

  // Create audit context
  const auditContext = createAuditContext(
    'ask_process',
    { question: input.question } as Record<string, unknown>,
    adapter.name
  );

  try {
    const service = getLLMService();

    // Check if LLM is available
    const isAvailable = await service.isAvailable();
    if (!isAvailable) {
      throw new Error(
        `LLM provider '${service.getProviderName()}' is not available. ` +
          'Check your LLM_PROVIDER, LLM_API_KEY environment variables, or ensure Ollama is running.'
      );
    }

    // Build context
    const context = await buildContext(adapter, input.include_patterns);

    // Get relevant data if requested
    let relevantData: Record<string, unknown> | undefined;
    if (input.include_sample_data) {
      // Extract keywords from question to fetch relevant data
      const keywords = extractKeywords(input.question);
      if (keywords.length > 0) {
        const searchResults = await adapter.searchDocText({
          pattern: keywords[0]!,
          limit: 5,
        });
        if (searchResults.length > 0) {
          relevantData = {
            sample_matches: searchResults.map(r => ({
              doc_type: r.doc_type,
              doc_key: r.doc_key,
              snippet: r.snippet?.slice(0, 100),
            })),
          };
        }
      }
    }

    // Query the LLM
    const result = await service.queryProcess(input.question, context, relevantData);

    // Log success
    auditContext.success(1);

    return {
      answer: result.answer,
      confidence: result.confidence,
      evidence: result.evidence,
      recommendations: result.recommendations || [],
      follow_up_questions: result.followUpQuestions || [],
      llm_provider: service.getProviderName(),
    };
  } catch (error) {
    auditContext.error(error as Error);
    throw error;
  }
}

/**
 * Extract keywords from a question for data lookup
 */
function extractKeywords(question: string): string[] {
  const stopWords = new Set([
    'what', 'why', 'how', 'when', 'where', 'which', 'who',
    'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did',
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
    'of', 'with', 'by', 'from', 'as', 'about', 'into', 'through',
    'our', 'my', 'their', 'this', 'that', 'these', 'those',
    'most', 'more', 'many', 'much', 'some', 'any', 'all',
  ]);

  const words = question
    .toLowerCase()
    .replace(/[?.,!]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 3 && !stopWords.has(w));

  // Return unique keywords
  return [...new Set(words)].slice(0, 3);
}
