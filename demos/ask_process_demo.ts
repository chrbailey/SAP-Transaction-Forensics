#!/usr/bin/env npx tsx
/**
 * Demo: ask_process Tool
 *
 * This demo shows how the natural language interface works for querying
 * SAP process data. It uses the synthetic adapter so no SAP connection is needed.
 *
 * Prerequisites:
 *   - Set LLM_PROVIDER environment variable (ollama, openai, or anthropic)
 *   - For Ollama: Ensure Ollama is running locally (ollama serve)
 *   - For OpenAI/Anthropic: Set LLM_API_KEY environment variable
 *
 * Usage:
 *   cd mcp-server
 *   npx tsx ../demos/ask_process_demo.ts
 *
 *   # Or with specific provider:
 *   LLM_PROVIDER=ollama npx tsx ../demos/ask_process_demo.ts
 *   LLM_PROVIDER=openai LLM_API_KEY=sk-... npx tsx ../demos/ask_process_demo.ts
 */

import { executeAskProcess } from '../mcp-server/src/tools/ask_process.js';
import { SyntheticAdapter } from '../mcp-server/src/adapters/synthetic/index.js';

// Sample questions to demonstrate the tool
const DEMO_QUESTIONS = [
  "Why are orders from sales org 1000 taking longer to ship?",
  "Which customers have the most credit holds?",
  "What patterns correlate with delivery delays?",
  "How does our order-to-cash cycle time compare across regions?",
  "What are the main bottlenecks in our fulfillment process?",
];

// ANSI colors for terminal output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
};

function printHeader(text: string): void {
  console.log(`\n${colors.bright}${colors.cyan}${'═'.repeat(70)}${colors.reset}`);
  console.log(`${colors.bright}${colors.cyan}  ${text}${colors.reset}`);
  console.log(`${colors.cyan}${'═'.repeat(70)}${colors.reset}\n`);
}

function printSection(title: string, content: string): void {
  console.log(`${colors.bright}${colors.yellow}${title}:${colors.reset}`);
  console.log(`${colors.dim}${content}${colors.reset}\n`);
}

function printQuestion(question: string): void {
  console.log(`${colors.bright}${colors.blue}Q: ${question}${colors.reset}\n`);
}

function printEvidence(evidence: Array<{ source: string; snippet: string }>): void {
  if (evidence.length === 0) return;

  console.log(`${colors.bright}${colors.magenta}Evidence:${colors.reset}`);
  for (const e of evidence) {
    console.log(`  ${colors.dim}• [${e.source}] ${e.snippet}${colors.reset}`);
  }
  console.log();
}

function printRecommendations(recommendations: string[]): void {
  if (recommendations.length === 0) return;

  console.log(`${colors.bright}${colors.green}Recommendations:${colors.reset}`);
  for (const rec of recommendations) {
    console.log(`  ${colors.dim}• ${rec}${colors.reset}`);
  }
  console.log();
}

function printFollowUp(questions: string[]): void {
  if (questions.length === 0) return;

  console.log(`${colors.bright}${colors.cyan}Follow-up Questions:${colors.reset}`);
  for (const q of questions) {
    console.log(`  ${colors.dim}? ${q}${colors.reset}`);
  }
  console.log();
}

async function runDemo(): Promise<void> {
  printHeader('Transaction Forensics - ask_process Demo');

  // Check LLM configuration
  const provider = process.env.LLM_PROVIDER || 'ollama';
  console.log(`${colors.dim}LLM Provider: ${provider}${colors.reset}`);
  console.log(`${colors.dim}Model: ${process.env.LLM_MODEL || '(default)'}${colors.reset}\n`);

  // Create synthetic adapter (no SAP connection needed)
  console.log(`${colors.dim}Creating synthetic SAP adapter...${colors.reset}`);
  const adapter = new SyntheticAdapter();
  await adapter.initialize();
  console.log(`${colors.green}✓ Adapter ready${colors.reset}\n`);

  // Select a random question for the demo
  const question = DEMO_QUESTIONS[Math.floor(Math.random() * DEMO_QUESTIONS.length)]!;

  printHeader('Natural Language Query');
  printQuestion(question);

  console.log(`${colors.dim}Processing with ${provider}...${colors.reset}\n`);

  try {
    const startTime = Date.now();

    const result = await executeAskProcess(adapter, {
      question,
      include_patterns: true,
      include_sample_data: true,
    });

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    printHeader('Response');

    // Print the answer
    console.log(`${result.answer}\n`);

    // Print confidence
    const confidenceColor =
      result.confidence.toLowerCase() === 'high' ? colors.green :
      result.confidence.toLowerCase() === 'medium' ? colors.yellow : colors.dim;
    console.log(`${colors.bright}Confidence:${colors.reset} ${confidenceColor}${result.confidence}${colors.reset}\n`);

    // Print evidence, recommendations, follow-up questions
    printEvidence(result.evidence);
    printRecommendations(result.recommendations);
    printFollowUp(result.follow_up_questions);

    // Print metadata
    console.log(`${colors.dim}─────────────────────────────────────${colors.reset}`);
    console.log(`${colors.dim}LLM Provider: ${result.llm_provider}${colors.reset}`);
    console.log(`${colors.dim}Response Time: ${duration}s${colors.reset}`);

  } catch (error) {
    console.error(`\n${colors.bright}\x1b[31mError:${colors.reset}`, error);

    if (provider === 'ollama') {
      console.log(`\n${colors.yellow}Hint: Make sure Ollama is running:${colors.reset}`);
      console.log(`  ${colors.dim}ollama serve${colors.reset}`);
      console.log(`  ${colors.dim}ollama pull llama3${colors.reset}`);
    } else {
      console.log(`\n${colors.yellow}Hint: Check your LLM_API_KEY environment variable${colors.reset}`);
    }

    process.exit(1);
  }

  printHeader('Demo Complete');
  console.log('Try your own questions by modifying DEMO_QUESTIONS in this script,');
  console.log('or integrate ask_process into your application.\n');
}

// Interactive mode - ask multiple questions
async function runInteractive(): Promise<void> {
  const readline = await import('readline');

  printHeader('Transaction Forensics - Interactive Mode');

  const provider = process.env.LLM_PROVIDER || 'ollama';
  console.log(`${colors.dim}LLM Provider: ${provider}${colors.reset}\n`);

  const adapter = new SyntheticAdapter();
  await adapter.initialize();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log('Enter your questions about SAP processes. Type "exit" to quit.\n');
  console.log(`${colors.dim}Example questions:${colors.reset}`);
  for (const q of DEMO_QUESTIONS.slice(0, 3)) {
    console.log(`  ${colors.dim}• ${q}${colors.reset}`);
  }
  console.log();

  const askQuestion = (): void => {
    rl.question(`${colors.bright}${colors.blue}You: ${colors.reset}`, async (input) => {
      const question = input.trim();

      if (question.toLowerCase() === 'exit' || question.toLowerCase() === 'quit') {
        console.log(`\n${colors.dim}Goodbye!${colors.reset}\n`);
        rl.close();
        return;
      }

      if (question.length < 10) {
        console.log(`${colors.yellow}Please enter a more detailed question (at least 10 characters).${colors.reset}\n`);
        askQuestion();
        return;
      }

      try {
        console.log(`\n${colors.dim}Thinking...${colors.reset}\n`);

        const result = await executeAskProcess(adapter, {
          question,
          include_patterns: true,
          include_sample_data: true,
        });

        console.log(`${colors.bright}${colors.green}Assistant:${colors.reset}\n${result.answer}\n`);

        if (result.recommendations.length > 0) {
          printRecommendations(result.recommendations);
        }

        console.log(`${colors.dim}[${result.confidence} confidence | ${result.llm_provider}]${colors.reset}\n`);

      } catch (error) {
        console.error(`\n${colors.bright}\x1b[31mError:${colors.reset}`, (error as Error).message);
      }

      askQuestion();
    });
  };

  askQuestion();
}

// Main entry point
const args = process.argv.slice(2);

if (args.includes('--interactive') || args.includes('-i')) {
  runInteractive();
} else {
  runDemo();
}
