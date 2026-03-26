#!/usr/bin/env npx tsx
/**
 * Demo: predict_outcome Tool
 *
 * This demo shows how to use ML-based predictions for SAP Order-to-Cash
 * processes to identify high-risk orders and predict outcomes.
 *
 * Prerequisites:
 *   - No external dependencies - uses synthetic adapter
 *
 * Usage:
 *   cd mcp-server
 *   npx tsx ../demos/predict_outcome_demo.ts
 */

import { executePredictOutcome } from '../mcp-server/src/tools/predict_outcome.js';
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

function getRiskColor(risk: number): string {
  if (risk >= 0.7) return colors.red;
  if (risk >= 0.4) return colors.yellow;
  return colors.green;
}

function formatProbability(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

async function runDemo(): Promise<void> {
  printHeader('Transaction Forensics - predict_outcome Demo');

  // Create synthetic adapter
  console.log(`${colors.dim}Creating synthetic SAP adapter...${colors.reset}`);
  const adapter = new SyntheticAdapter();
  await adapter.initialize();
  console.log(`${colors.green}✓ Adapter ready${colors.reset}\n`);

  // Get some document numbers to predict
  const docNumbers = ['0000000001', '0000000002', '0000000003', '0000000004', '0000000005'];

  printHeader('Predictive Analysis');

  console.log(`${colors.dim}Running ML predictions for ${docNumbers.length} orders...${colors.reset}\n`);
  console.log(`${colors.bright}Prediction Types:${colors.reset}`);
  console.log(`  ${colors.cyan}•${colors.reset} Late Delivery - Probability of delivery delays`);
  console.log(`  ${colors.cyan}•${colors.reset} Credit Hold - Likelihood of credit blocks`);
  console.log(`  ${colors.cyan}•${colors.reset} Completion Time - Estimated days to complete O2C cycle\n`);

  try {
    const startTime = Date.now();

    const result = await executePredictOutcome(adapter, {
      doc_numbers: docNumbers,
      prediction_type: 'all',
      alert_threshold: 0.7,
    });

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    // Display predictions
    console.log(`${colors.bright}Predictions:${colors.reset}`);
    console.log(`${colors.dim}─────────────────────────────────────${colors.reset}\n`);

    if (result.predictions && result.predictions.length > 0) {
      // Group predictions by document
      const byDoc = new Map<string, typeof result.predictions>();
      for (const pred of result.predictions) {
        if (!byDoc.has(pred.doc_number)) {
          byDoc.set(pred.doc_number, []);
        }
        byDoc.get(pred.doc_number)!.push(pred);
      }

      for (const [docNum, preds] of byDoc) {
        console.log(`${colors.bright}Order: ${docNum}${colors.reset}`);

        for (const pred of preds) {
          const color = getRiskColor(pred.probability);
          const indicator = pred.probability >= 0.7 ? ' [HIGH RISK]' : '';

          if (pred.prediction_type === 'late_delivery') {
            console.log(`  Late Delivery Risk:   ${color}${formatProbability(pred.probability)}${indicator}${colors.reset}`);
          } else if (pred.prediction_type === 'credit_hold') {
            console.log(`  Credit Hold Risk:     ${color}${formatProbability(pred.probability)}${indicator}${colors.reset}`);
          } else if (pred.prediction_type === 'completion_time') {
            const days = typeof pred.predicted_value === 'number' ? pred.predicted_value : 0;
            console.log(`  Est. Completion:      ${colors.cyan}${days.toFixed(1)} days${colors.reset}`);
          }

          console.log(`  ${colors.dim}Risk Level: ${pred.risk_level}${colors.reset}`);
        }
        console.log();
      }
    }

    // Display alerts
    if (result.alerts && result.alerts.length > 0) {
      console.log(`${colors.bright}${colors.red}Alerts (High Risk):${colors.reset}`);
      console.log(`${colors.dim}─────────────────────────────────────${colors.reset}`);

      for (const alert of result.alerts) {
        console.log(`  ${colors.red}!${colors.reset} ${alert.doc_number}: ${alert.alert_type} - ${formatProbability(alert.probability)}`);
        console.log(`    ${colors.dim}${alert.message}${colors.reset}`);
        if (alert.recommended_actions && alert.recommended_actions.length > 0) {
          console.log(`    ${colors.dim}→ ${alert.recommended_actions[0]}${colors.reset}`);
        }
      }
      console.log();
    }

    // Display summary
    console.log(`${colors.bright}Summary:${colors.reset}`);
    console.log(`${colors.dim}─────────────────────────────────────${colors.reset}`);
    console.log(`  Documents Analyzed: ${colors.cyan}${result.summary.total_documents}${colors.reset}`);
    console.log(`  Predictions Made: ${colors.cyan}${result.predictions?.length || 0}${colors.reset}`);
    console.log(`  High-Risk Count: ${colors.red}${result.summary.high_risk_count}${colors.reset}`);
    console.log(`  Average Risk Score: ${colors.cyan}${(result.summary.average_risk_score * 100).toFixed(1)}%${colors.reset}`);

    if (result.model_info) {
      console.log(`\n${colors.bright}Model Info:${colors.reset}`);
      console.log(`  Type: ${colors.dim}${result.model_info.model_type}${colors.reset}`);
      console.log(`  Accuracy: ${colors.dim}${(result.model_info.accuracy * 100).toFixed(1)}%${colors.reset}`);
      console.log(`  Features: ${colors.dim}${result.model_info.features.length} features${colors.reset}`);
    }

    console.log(`\n${colors.dim}Prediction Time: ${duration}s${colors.reset}`);

  } catch (error) {
    console.error(`\n${colors.bright}\x1b[31mError:${colors.reset}`, error);
    process.exit(1);
  }

  printHeader('Demo Complete');
  console.log('Predictive monitoring helps with:');
  console.log(`  ${colors.dim}• Identifying high-risk orders that need attention${colors.reset}`);
  console.log(`  ${colors.dim}• Proactively managing delivery schedules${colors.reset}`);
  console.log(`  ${colors.dim}• Preventing credit holds before they happen${colors.reset}`);
  console.log(`  ${colors.dim}• Estimating process completion times${colors.reset}\n`);
}

runDemo();
