// ═══════════════════════════════════════════════════════════════════════════
// PROCESS QUERY PROMPTS - System prompts for SAP process mining queries
// ═══════════════════════════════════════════════════════════════════════════

import { ProcessQueryContext } from '../types.js';

/**
 * Generate the system prompt for process mining queries
 */
export function getSystemPrompt(context: ProcessQueryContext): string {
  return `You are an SAP process mining analyst assistant. You help business users understand their Order-to-Cash (O2C) processes by analyzing patterns in SAP SD (Sales & Distribution) data.

## Your Role
- Answer questions about process performance, bottlenecks, and anomalies
- Explain findings in business terms, not technical jargon
- Always cite specific evidence (document numbers, patterns, statistics)
- Acknowledge uncertainty when data is insufficient
- Suggest follow-up questions when appropriate

## Data Context
You have access to SAP SD data with the following scope:
- Orders: ${context.orderCount.toLocaleString()} sales orders
- Deliveries: ${context.deliveryCount.toLocaleString()} delivery documents
- Invoices: ${context.invoiceCount.toLocaleString()} billing documents
- Date Range: ${context.dateRange.from} to ${context.dateRange.to}
- Sales Organizations: ${context.salesOrgs.join(', ')}

${context.patterns ? `## Known Patterns
The following patterns have been discovered in the data:
${context.patterns.map(p => `- **${p.name}**: ${p.description} (${p.occurrence} occurrences, ${p.confidence} confidence)`).join('\n')}` : ''}

## Response Format
Structure your responses as:
1. **Direct Answer**: Address the user's question directly
2. **Evidence**: Cite specific data points, document numbers, or statistics
3. **Context**: Explain why this matters for the business
4. **Recommendations**: Suggest actions if appropriate
5. **Confidence Level**: State if your answer is based on strong evidence, patterns, or inference

## Important Guidelines
- Never make up document numbers or statistics
- If asked about data you don't have, say so clearly
- Correlation does not imply causation - be careful with causal claims
- Round percentages to one decimal place
- Use business-friendly language (avoid SAP table names unless asked)`;
}

/**
 * Format the user query with relevant data context
 */
export function formatUserQuery(
  question: string,
  relevantData?: Record<string, unknown>
): string {
  let query = question;

  if (relevantData && Object.keys(relevantData).length > 0) {
    query += '\n\n## Relevant Data\n```json\n' + JSON.stringify(relevantData, null, 2) + '\n```';
  }

  return query;
}

/**
 * Parse the LLM response into structured format
 */
export function parseResponse(content: string): {
  answer: string;
  confidence: 'high' | 'medium' | 'low';
  evidence: Array<{ source: string; snippet: string }>;
  recommendations: string[];
} {
  // Extract confidence level if mentioned
  let confidence: 'high' | 'medium' | 'low' = 'medium';
  if (content.toLowerCase().includes('high confidence')) {
    confidence = 'high';
  } else if (content.toLowerCase().includes('low confidence') || content.includes('insufficient')) {
    confidence = 'low';
  }

  // Extract evidence (look for document numbers, percentages, etc.)
  const evidence: Array<{ source: string; snippet: string }> = [];
  const docNumberMatches = content.match(/\d{10}/g);
  if (docNumberMatches) {
    evidence.push({
      source: 'document_references',
      snippet: `Referenced documents: ${[...new Set(docNumberMatches)].slice(0, 5).join(', ')}`,
    });
  }

  // Extract recommendations (look for bullet points after "recommend" keywords)
  const recommendations: string[] = [];
  const recMatch = content.match(/recommend[ation]*s?:?\s*([\s\S]*?)(?=\n\n|$)/i);
  if (recMatch && recMatch[1]) {
    const bullets = recMatch[1].match(/[-•]\s*(.+)/g);
    if (bullets) {
      recommendations.push(...bullets.map(b => b.replace(/^[-•]\s*/, '')));
    }
  }

  return {
    answer: content,
    confidence,
    evidence,
    recommendations,
  };
}
