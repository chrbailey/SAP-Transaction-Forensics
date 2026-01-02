// ═══════════════════════════════════════════════════════════════════════════
// ANTHROPIC PROVIDER - Anthropic Claude API integration
// ═══════════════════════════════════════════════════════════════════════════

import { LLMProvider, LLMMessage, LLMResponse, LLMConfig, LLMUsage } from '../types.js';

interface AnthropicResponse {
  content?: Array<{ type: string; text?: string }>;
  model?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
}

export class AnthropicProvider implements LLMProvider {
  name = 'anthropic';
  private apiKey: string;
  private baseUrl: string;
  private model: string;
  private temperature: number;
  private maxTokens: number;

  constructor(config: LLMConfig) {
    this.apiKey = config.apiKey || process.env.ANTHROPIC_API_KEY || '';
    this.baseUrl = config.baseUrl || 'https://api.anthropic.com/v1';
    this.model = config.model || 'claude-3-sonnet-20240229';
    this.temperature = config.temperature ?? 0.3;
    this.maxTokens = config.maxTokens ?? 2000;
  }

  async isAvailable(): Promise<boolean> {
    // Anthropic doesn't have a simple health check endpoint
    // Just verify API key is present
    return !!this.apiKey;
  }

  async generate(messages: LLMMessage[]): Promise<LLMResponse> {
    if (!this.apiKey) {
      throw new Error(
        'Anthropic API key not configured. Set ANTHROPIC_API_KEY environment variable.'
      );
    }

    // Extract system message if present
    const systemMessage = messages.find(m => m.role === 'system');
    const chatMessages = messages.filter(m => m.role !== 'system');

    const response = await fetch(`${this.baseUrl}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: this.maxTokens,
        ...(systemMessage ? { system: systemMessage.content } : {}),
        messages: chatMessages.map(m => ({
          role: m.role,
          content: m.content,
        })),
        temperature: this.temperature,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Anthropic API error: ${response.status} - ${error}`);
    }

    const data = (await response.json()) as AnthropicResponse;
    const textContent = data.content?.find(c => c.type === 'text');

    let usage: LLMUsage | undefined;
    if (data.usage) {
      const inputTokens = data.usage.input_tokens || 0;
      const outputTokens = data.usage.output_tokens || 0;
      usage = {
        promptTokens: inputTokens,
        completionTokens: outputTokens,
        totalTokens: inputTokens + outputTokens,
      };
    }

    return {
      content: textContent?.text || '',
      model: data.model || this.model,
      usage,
    };
  }
}
