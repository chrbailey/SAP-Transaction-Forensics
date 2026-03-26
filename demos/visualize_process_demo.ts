#!/usr/bin/env npx tsx
/**
 * Demo: visualize_process Tool
 *
 * This demo shows how to generate process flow visualizations
 * with bottleneck highlighting and timing annotations.
 *
 * Prerequisites:
 *   - No external dependencies - uses synthetic adapter
 *
 * Usage:
 *   cd mcp-server
 *   npx tsx ../demos/visualize_process_demo.ts
 */

import { executeVisualizeProcess } from '../mcp-server/src/tools/visualize_process.js';
import { SyntheticAdapter } from '../mcp-server/src/adapters/synthetic/index.js';

// ANSI colors for terminal output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
};

function printHeader(text: string): void {
  console.log(`\n${colors.bright}${colors.cyan}${'═'.repeat(70)}${colors.reset}`);
  console.log(`${colors.bright}${colors.cyan}  ${text}${colors.reset}`);
  console.log(`${colors.cyan}${'═'.repeat(70)}${colors.reset}\n`);
}

async function runDemo(): Promise<void> {
  printHeader('Transaction Forensics - visualize_process Demo');

  // Create synthetic adapter
  console.log(`${colors.dim}Creating synthetic SAP adapter...${colors.reset}`);
  const adapter = new SyntheticAdapter();
  await adapter.initialize();
  console.log(`${colors.green}✓ Adapter ready${colors.reset}\n`);

  // Get some document numbers to visualize
  const docNumbers = ['0000000001', '0000000002', '0000000003'];

  printHeader('Mermaid Flowchart');

  console.log(`${colors.dim}Generating process visualization for ${docNumbers.length} orders...${colors.reset}\n`);

  try {
    const startTime = Date.now();

    const result = await executeVisualizeProcess(adapter, {
      doc_numbers: docNumbers,
      format: 'mermaid',
      include_timing: true,
      highlight_bottlenecks: true,
    });

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    // Display the diagram
    console.log(`${colors.bright}Generated Mermaid Diagram:${colors.reset}`);
    console.log(`${colors.dim}─────────────────────────────────────${colors.reset}\n`);

    // Print the mermaid diagram with syntax highlighting
    const lines = result.diagram.split('\n');
    for (const line of lines) {
      if (line.includes('style') && line.includes('#')) {
        // Bottleneck styling lines
        if (line.includes('ff6b6b') || line.includes('red')) {
          console.log(`${colors.red}${line}${colors.reset}`);
        } else if (line.includes('ffd93d') || line.includes('yellow')) {
          console.log(`${colors.yellow}${line}${colors.reset}`);
        } else if (line.includes('6bcb77') || line.includes('green')) {
          console.log(`${colors.green}${line}${colors.reset}`);
        } else {
          console.log(`${colors.dim}${line}${colors.reset}`);
        }
      } else if (line.includes('-->')) {
        // Transition lines
        console.log(`${colors.cyan}${line}${colors.reset}`);
      } else if (line.startsWith('graph') || line.startsWith('flowchart')) {
        console.log(`${colors.bright}${line}${colors.reset}`);
      } else {
        console.log(`${colors.dim}${line}${colors.reset}`);
      }
    }

    // Display statistics
    console.log(`\n${colors.dim}─────────────────────────────────────${colors.reset}`);
    console.log(`${colors.bright}Statistics:${colors.reset}`);
    console.log(`  Format: ${colors.cyan}${result.format}${colors.reset}`);
    console.log(`  Documents Analyzed: ${colors.cyan}${result.statistics.total_documents}${colors.reset}`);
    console.log(`  Total Steps: ${colors.cyan}${result.statistics.total_steps}${colors.reset}`);
    console.log(`  Avg Cycle Time: ${colors.cyan}${result.statistics.avg_cycle_time_hours.toFixed(1)} hours${colors.reset}`);

    if (result.statistics.bottlenecks && result.statistics.bottlenecks.length > 0) {
      console.log(`\n${colors.bright}Bottlenecks Detected:${colors.reset}`);
      for (const bottleneck of result.statistics.bottlenecks) {
        const color = bottleneck.severity === 'high' ? colors.red :
                      bottleneck.severity === 'medium' ? colors.yellow : colors.green;
        console.log(`  ${color}•${colors.reset} ${bottleneck.step}: ${bottleneck.avg_duration_hours.toFixed(1)}h (${bottleneck.severity})`);
      }
    }

    console.log(`\n${colors.bright}Included Documents:${colors.reset}`);
    console.log(`  ${colors.dim}${result.included_documents.join(', ')}${colors.reset}`);

    console.log(`\n${colors.dim}Generation Time: ${duration}s${colors.reset}`);

  } catch (error) {
    console.error(`\n${colors.bright}\x1b[31mError:${colors.reset}`, error);
    process.exit(1);
  }

  printHeader('Demo Complete');
  console.log('The generated diagram can be rendered with:');
  console.log(`  ${colors.dim}• Mermaid Live Editor: https://mermaid.live${colors.reset}`);
  console.log(`  ${colors.dim}• GitHub Markdown (native support)${colors.reset}`);
  console.log(`  ${colors.dim}• VS Code Mermaid extension${colors.reset}`);
  console.log(`  ${colors.dim}• Any Mermaid-compatible tool${colors.reset}\n`);
  console.log('Other formats available: dot (GraphViz), svg\n');
}

runDemo();
