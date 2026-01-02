// ═══════════════════════════════════════════════════════════════════════════
// LLM SERVICE - Unified interface for LLM providers
// ═══════════════════════════════════════════════════════════════════════════

import {
  LLMConfig,
  LLMProvider,
  LLMMessage,
  LLMResponse,
  ProcessQueryContext,
  ProcessQueryResult,
  DEFAULT_LLM_CONFIG,
} from './types.js';
import { OllamaProvider, OpenAIProvider, AnthropicProvider } from './providers/index.js';
import { getSystemPrompt, formatUserQuery, parseResponse } from './prompts/process-query.js';

export class LLMService {
  private provider: LLMProvider;
  private config: LLMConfig;

  constructor(config?: Partial<LLMConfig>) {
    this.config = { ...DEFAULT_LLM_CONFIG, ...config };
    this.provider = this.createProvider(this.config);
  }

  private createProvider(config: LLMConfig): LLMProvider {
    switch (config.provider) {
      case 'ollama':
        return new OllamaProvider(config);
      case 'openai':
        return new OpenAIProvider(config);
      case 'anthropic':
        return new AnthropicProvider(config);
      default:
        throw new Error(`Unknown LLM provider: ${config.provider}`);
    }
  }

  /**
   * Check if the LLM service is available
   */
  async isAvailable(): Promise<boolean> {
    return this.provider.isAvailable();
  }

  /**
   * Get the current provider name
   */
  getProviderName(): string {
    return this.provider.name;
  }

  /**
   * Generate a raw LLM response
   */
  async generate(messages: LLMMessage[]): Promise<LLMResponse> {
    return this.provider.generate(messages);
  }

  /**
   * Answer a process mining question with context
   */
  async queryProcess(
    question: string,
    context: ProcessQueryContext,
    relevantData?: Record<string, unknown>
  ): Promise<ProcessQueryResult> {
    const systemPrompt = getSystemPrompt(context);
    const userMessage = formatUserQuery(question, relevantData);

    const messages: LLMMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ];

    const response = await this.provider.generate(messages);
    const parsed = parseResponse(response.content);

    return {
      answer: parsed.answer,
      confidence: parsed.confidence,
      evidence: parsed.evidence,
      recommendations: parsed.recommendations,
      followUpQuestions: this.suggestFollowUps(question, context),
    };
  }

  /**
   * Suggest follow-up questions based on the query
   */
  private suggestFollowUps(question: string, context: ProcessQueryContext): string[] {
    const followUps: string[] = [];
    const q = question.toLowerCase();

    if (q.includes('delay') || q.includes('late')) {
      followUps.push('Which customers are most affected by these delays?');
      followUps.push('What is the financial impact of these delays?');
    }

    if (q.includes('credit') || q.includes('hold')) {
      followUps.push('How long do orders typically remain on credit hold?');
      followUps.push('Which sales organizations have the most credit holds?');
    }

    if (q.includes('sales org') || q.includes('organization')) {
      followUps.push('How do fulfillment times compare across all sales organizations?');
    }

    if (context.patterns && context.patterns.length > 0) {
      followUps.push('Which of the discovered patterns has the highest business impact?');
    }

    return followUps.slice(0, 3);
  }

  /**
   * Update configuration
   */
  setConfig(config: Partial<LLMConfig>): void {
    this.config = { ...this.config, ...config };
    this.provider = this.createProvider(this.config);
  }

  /**
   * Get current configuration (without sensitive data)
   */
  getConfig(): Omit<LLMConfig, 'apiKey'> {
    const { apiKey: _, ...safeConfig } = this.config;
    return safeConfig;
  }
}

/**
 * Create an LLM service from environment variables
 */
export function createLLMServiceFromEnv(): LLMService {
  const provider = (process.env.LLM_PROVIDER as LLMConfig['provider']) || 'ollama';
  const model = process.env.LLM_MODEL;
  const apiKey = process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY;

  return new LLMService({
    provider,
    ...(model ? { model } : {}),
    ...(apiKey ? { apiKey } : {}),
  });
}

// Re-export types
export * from './types.js';
