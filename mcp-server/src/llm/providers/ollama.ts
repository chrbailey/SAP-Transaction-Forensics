// ═══════════════════════════════════════════════════════════════════════════
// OLLAMA PROVIDER - Local LLM via Ollama
// ═══════════════════════════════════════════════════════════════════════════

import { LLMProvider, LLMMessage, LLMResponse, LLMConfig, LLMUsage } from '../types.js';

interface OllamaResponse {
  message?: { content?: string };
  model?: string;
  eval_count?: number;
  prompt_eval_count?: number;
}

export class OllamaProvider implements LLMProvider {
  name = 'ollama';
  private baseUrl: string;
  private model: string;
  private temperature: number;

  constructor(config: LLMConfig) {
    this.baseUrl = config.baseUrl || process.env.OLLAMA_HOST || 'http://localhost:11434';
    this.model = config.model || 'llama3';
    this.temperature = config.temperature ?? 0.3;
  }

  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async generate(messages: LLMMessage[]): Promise<LLMResponse> {
    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        messages: messages.map(m => ({
          role: m.role,
          content: m.content,
        })),
        stream: false,
        options: {
          temperature: this.temperature,
        },
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Ollama API error: ${response.status} - ${error}`);
    }

    const data = (await response.json()) as OllamaResponse;

    let usage: LLMUsage | undefined;
    if (data.eval_count) {
      usage = {
        promptTokens: data.prompt_eval_count || 0,
        completionTokens: data.eval_count || 0,
        totalTokens: (data.prompt_eval_count || 0) + (data.eval_count || 0),
      };
    }

    return {
      content: data.message?.content || '',
      model: this.model,
      usage,
    };
  }
}
