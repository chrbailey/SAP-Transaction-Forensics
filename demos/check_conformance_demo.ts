#!/usr/bin/env npx tsx
/**
 * Demo: check_conformance Tool
 *
 * This demo shows how to check SAP Order-to-Cash processes against
 * the expected reference model and detect deviations.
 *
 * Prerequisites:
 *   - No external dependencies - uses synthetic adapter
 *
 * Usage:
 *   cd mcp-server
 *   npx tsx ../demos/check_conformance_demo.ts
 */

import { executeCheckConformance } from '../mcp-server/src/tools/check_conformance.js';
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

function getSeverityColor(severity: string): string {
  switch (severity.toLowerCase()) {
    case 'critical': return colors.red;
    case 'major': return colors.yellow;
    case 'minor': return colors.blue;
    default: return colors.dim;
  }
}

async function runDemo(): Promise<void> {
  printHeader('Transaction Forensics - check_conformance Demo');

  // Create synthetic adapter
  console.log(`${colors.dim}Creating synthetic SAP adapter...${colors.reset}`);
  const adapter = new SyntheticAdapter();
  await adapter.initialize();
  console.log(`${colors.green}✓ Adapter ready${colors.reset}\n`);

  printHeader('Conformance Checking');

  console.log(`${colors.dim}Checking Order-to-Cash processes against reference model...${colors.reset}\n`);
  console.log(`${colors.bright}Expected O2C Flow:${colors.reset}`);
  console.log(`  ${colors.cyan}Order Created${colors.reset} → ${colors.cyan}Delivery Created${colors.reset} → ${colors.cyan}Goods Issued${colors.reset} → ${colors.cyan}Invoice Created${colors.reset}\n`);

  try {
    const startTime = Date.now();

    const result = await executeCheckConformance(adapter, {
      include_deviations: true,
      severity_filter: 'all',
    });

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    // Display conformance summary
    console.log(`${colors.bright}Conformance Summary:${colors.reset}`);
    console.log(`${colors.dim}─────────────────────────────────────${colors.reset}`);

    const conformanceRate = result.conformance_rate;
    const rateColor = conformanceRate >= 90 ? colors.green :
                      conformanceRate >= 70 ? colors.yellow : colors.red;
    console.log(`  Conformance Rate: ${rateColor}${conformanceRate.toFixed(1)}%${colors.reset}`);
    console.log(`  Total Cases Checked: ${colors.cyan}${result.total_cases}${colors.reset}`);
    console.log(`  Conforming Cases: ${colors.green}${result.conforming_cases}${colors.reset}`);
    console.log(`  Non-Conforming Cases: ${colors.red}${result.non_conforming_cases}${colors.reset}`);

    // Display deviation breakdown by type
    if (result.deviation_type_summary) {
      console.log(`\n${colors.bright}Deviation Breakdown by Type:${colors.reset}`);
      console.log(`${colors.dim}─────────────────────────────────────${colors.reset}`);

      for (const [type, count] of Object.entries(result.deviation_type_summary)) {
        if (count > 0) {
          console.log(`  ${colors.magenta}${type}:${colors.reset} ${count}`);
        }
      }
    }

    // Display severity breakdown
    if (result.severity_summary) {
      console.log(`\n${colors.bright}By Severity:${colors.reset}`);
      const { critical, major, minor } = result.severity_summary;
      if (critical > 0) console.log(`  ${colors.red}critical:${colors.reset} ${critical}`);
      if (major > 0) console.log(`  ${colors.yellow}major:${colors.reset} ${major}`);
      if (minor > 0) console.log(`  ${colors.blue}minor:${colors.reset} ${minor}`);
    }

    // Show sample deviations
    if (result.deviations && result.deviations.length > 0) {
      console.log(`\n${colors.bright}Sample Deviations:${colors.reset}`);
      console.log(`${colors.dim}─────────────────────────────────────${colors.reset}`);

      // Show up to 5 deviations
      for (const dev of result.deviations.slice(0, 5)) {
        const color = getSeverityColor(dev.severity);
        console.log(`  ${color}[${dev.severity}]${colors.reset} ${dev.deviation_type}: ${dev.description}`);
        console.log(`    ${colors.dim}Case: ${dev.case_id} | Activity: ${dev.activity || 'N/A'}${colors.reset}`);
      }
    }

    console.log(`\n${colors.dim}─────────────────────────────────────${colors.reset}`);
    console.log(`${colors.dim}Analysis Time: ${duration}s${colors.reset}`);

  } catch (error) {
    console.error(`\n${colors.bright}\x1b[31mError:${colors.reset}`, error);
    process.exit(1);
  }

  printHeader('Demo Complete');
  console.log('Conformance checking helps identify:');
  console.log(`  ${colors.dim}• Skipped steps (e.g., delivery without order)${colors.reset}`);
  console.log(`  ${colors.dim}• Wrong order (e.g., invoice before delivery)${colors.reset}`);
  console.log(`  ${colors.dim}• Missing activities${colors.reset}`);
  console.log(`  ${colors.dim}• Process compliance issues${colors.reset}\n`);
}

runDemo();
