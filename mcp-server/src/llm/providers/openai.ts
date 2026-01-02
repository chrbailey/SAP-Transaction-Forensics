// ═══════════════════════════════════════════════════════════════════════════
// OPENAI PROVIDER - OpenAI API integration
// ═══════════════════════════════════════════════════════════════════════════

import { LLMProvider, LLMMessage, LLMResponse, LLMConfig, LLMUsage } from '../types.js';

interface OpenAIResponse {
  choices?: Array<{ message?: { content?: string } }>;
  model?: string;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

export class OpenAIProvider implements LLMProvider {
  name = 'openai';
  private apiKey: string;
  private baseUrl: string;
  private model: string;
  private temperature: number;
  private maxTokens: number;

  constructor(config: LLMConfig) {
    this.apiKey = config.apiKey || process.env.OPENAI_API_KEY || '';
    this.baseUrl = config.baseUrl || 'https://api.openai.com/v1';
    this.model = config.model || 'gpt-4';
    this.temperature = config.temperature ?? 0.3;
    this.maxTokens = config.maxTokens ?? 2000;
  }

  async isAvailable(): Promise<boolean> {
    if (!this.apiKey) return false;
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${this.apiKey}` },
        signal: AbortSignal.timeout(5000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async generate(messages: LLMMessage[]): Promise<LLMResponse> {
    if (!this.apiKey) {
      throw new Error('OpenAI API key not configured. Set OPENAI_API_KEY environment variable.');
    }

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: messages.map(m => ({
          role: m.role,
          content: m.content,
        })),
        temperature: this.temperature,
        max_tokens: this.maxTokens,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI API error: ${response.status} - ${error}`);
    }

    const data = (await response.json()) as OpenAIResponse;
    const choice = data.choices?.[0];

    let usage: LLMUsage | undefined;
    if (data.usage) {
      usage = {
        promptTokens: data.usage.prompt_tokens || 0,
        completionTokens: data.usage.completion_tokens || 0,
        totalTokens: data.usage.total_tokens || 0,
      };
    }

    return {
      content: choice?.message?.content || '',
      model: data.model || this.model,
      usage,
    };
  }
}
