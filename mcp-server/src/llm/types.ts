// ═══════════════════════════════════════════════════════════════════════════
// LLM TYPES - Type definitions for LLM integration
// ═══════════════════════════════════════════════════════════════════════════

export interface LLMConfig {
  provider: 'ollama' | 'openai' | 'anthropic';
  model: string;
  apiKey?: string;
  baseUrl?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface LLMResponse {
  content: string;
  model: string;
  usage?: LLMUsage | undefined;
}

export interface ProcessQueryContext {
  // Summary statistics about the data
  orderCount: number;
  deliveryCount: number;
  invoiceCount: number;
  dateRange: { from: string; to: string };
  salesOrgs: string[];

  // Recent pattern discoveries
  patterns?: Array<{
    name: string;
    description: string;
    occurrence: number;
    confidence: string;
  }>;

  // Specific data for the query (populated dynamically)
  relevantData?: Record<string, unknown>;
}

export interface ProcessQueryResult {
  answer: string;
  confidence: 'high' | 'medium' | 'low';
  evidence: Array<{
    source: string;
    snippet: string;
    docKeys?: string[];
  }>;
  recommendations?: string[];
  followUpQuestions?: string[];
}

export interface LLMProvider {
  name: string;
  generate(messages: LLMMessage[]): Promise<LLMResponse>;
  isAvailable(): Promise<boolean>;
}

// Default configuration
export const DEFAULT_LLM_CONFIG: LLMConfig = {
  provider: 'ollama',
  model: 'llama3',
  temperature: 0.3,
  maxTokens: 2000,
};
