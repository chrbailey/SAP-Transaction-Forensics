#!/usr/bin/env npx tsx
/**
 * Demo: SALT Adapter
 *
 * This demo shows how to use real SAP ERP data from the SALT dataset
 * published on HuggingFace by SAP.
 *
 * Prerequisites:
 *   1. Python 3 with datasets package: pip install datasets pyarrow
 *   2. Download SALT data: python scripts/download-salt.py
 *
 * Usage:
 *   cd mcp-server
 *   npx tsx ../demos/salt_adapter_demo.ts
 */

import { SaltAdapter } from '../mcp-server/src/adapters/salt/index.js';

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
  printHeader('SAP Workflow Mining - SALT Adapter Demo');

  console.log(`${colors.dim}The SALT dataset contains real SAP ERP sales order data${colors.reset}`);
  console.log(`${colors.dim}published by SAP on HuggingFace.${colors.reset}\n`);

  // Create SALT adapter
  console.log(`${colors.bright}Initializing SALT adapter...${colors.reset}`);
  console.log(`${colors.dim}This will download data from HuggingFace on first run.${colors.reset}\n`);

  const adapter = new SaltAdapter({
    maxDocuments: 1000, // Limit for demo
  });

  try {
    await adapter.initialize();
    console.log(`${colors.green}✓ Adapter initialized${colors.reset}\n`);
  } catch (error) {
    const err = error as Error;
    console.error(`${colors.red}Failed to initialize adapter:${colors.reset}`);
    console.error(err.message);
    console.log(`\n${colors.yellow}To fix this:${colors.reset}`);
    console.log(`  1. Install Python datasets: ${colors.cyan}pip install datasets pyarrow${colors.reset}`);
    console.log(`  2. Or pre-download data: ${colors.cyan}python scripts/download-salt.py${colors.reset}`);
    process.exit(1);
  }

  // Show statistics
  printHeader('Dataset Statistics');

  const stats = adapter.getStats();
  if (stats) {
    console.log(`${colors.bright}Records Loaded:${colors.reset}`);
    console.log(`  Sales Documents:      ${colors.cyan}${stats.salesDocuments.toLocaleString()}${colors.reset}`);
    console.log(`  Sales Document Items: ${colors.cyan}${stats.salesDocumentItems.toLocaleString()}${colors.reset}`);
    console.log(`  Customers:            ${colors.cyan}${stats.customers.toLocaleString()}${colors.reset}`);
    console.log(`  Addresses:            ${colors.cyan}${stats.addresses.toLocaleString()}${colors.reset}`);
    console.log();
    console.log(`${colors.bright}Data Dimensions:${colors.reset}`);
    console.log(`  Unique Sales Orgs: ${colors.magenta}${stats.uniqueSalesOrgs}${colors.reset}`);
    console.log(`  Unique Plants:     ${colors.magenta}${stats.uniquePlants}${colors.reset}`);
    console.log(`  Date Range:        ${colors.dim}${stats.dateRange.earliest} to ${stats.dateRange.latest}${colors.reset}`);
  }

  // Show unique sales orgs
  printHeader('Sales Organizations in Dataset');

  const salesOrgs = adapter.getUniqueSalesOrgs();
  console.log(`Found ${colors.cyan}${salesOrgs.length}${colors.reset} unique sales organizations:\n`);
  for (const org of salesOrgs.slice(0, 10)) {
    const docs = adapter.getDocumentsBySalesOrg(org);
    console.log(`  ${colors.bright}${org}${colors.reset}: ${docs.length} documents`);
  }
  if (salesOrgs.length > 10) {
    console.log(`  ${colors.dim}... and ${salesOrgs.length - 10} more${colors.reset}`);
  }

  // Sample document lookup
  printHeader('Sample Document Lookup');

  const docNumbers = adapter.getAllSalesDocNumbers();
  if (docNumbers.length > 0) {
    const sampleDoc = docNumbers[0];
    console.log(`${colors.bright}Looking up document: ${sampleDoc}${colors.reset}\n`);

    // Get header
    const header = await adapter.getSalesDocHeader({ vbeln: sampleDoc });
    if (header) {
      console.log(`${colors.bright}Header:${colors.reset}`);
      console.log(`  Document Type:    ${colors.cyan}${header.AUART}${colors.reset}`);
      console.log(`  Sales Org:        ${colors.cyan}${header.VKORG}${colors.reset}`);
      console.log(`  Dist Channel:     ${colors.cyan}${header.VTWEG}${colors.reset}`);
      console.log(`  Division:         ${colors.cyan}${header.SPART}${colors.reset}`);
      console.log(`  Customer:         ${colors.cyan}${header.KUNNR}${colors.reset}`);
      console.log(`  Created:          ${colors.dim}${header.ERDAT}${colors.reset}`);
    }

    // Get items
    const items = await adapter.getSalesDocItems({ vbeln: sampleDoc });
    console.log(`\n${colors.bright}Items (${items.length}):${colors.reset}`);
    for (const item of items.slice(0, 5)) {
      console.log(`  ${colors.dim}${item.POSNR}${colors.reset} - Material: ${item.MATNR}, Qty: ${item.KWMENG} ${item.VRKME}, Value: ${item.NETWR} ${item.WAERK}`);
    }
    if (items.length > 5) {
      console.log(`  ${colors.dim}... and ${items.length - 5} more items${colors.reset}`);
    }

    // Get document flow
    const flow = await adapter.getDocFlow({ vbeln: sampleDoc });
    console.log(`\n${colors.bright}Document Flow:${colors.reset}`);
    console.log(`  ${colors.dim}(SALT only contains sales orders, no deliveries/invoices)${colors.reset}`);
    for (const doc of flow.flow) {
      console.log(`  ${colors.cyan}${doc.doc_type}${colors.reset}: ${doc.doc_number}`);
    }
  }

  // Search demonstration
  printHeader('Search Demonstration');

  const searchResults = await adapter.searchDocText({
    pattern: '.*',
    limit: 5,
  });

  console.log(`${colors.bright}Sample search results:${colors.reset}\n`);
  for (const result of searchResults) {
    console.log(`  ${colors.cyan}${result.doc_key}${colors.reset} - ${result.snippet}`);
    console.log(`    ${colors.dim}Org: ${result.org_keys.VKORG}, Created: ${result.dates.created}${colors.reset}`);
  }

  // Customer lookup
  printHeader('Customer Master Data');

  if (docNumbers.length > 0) {
    const firstHeader = await adapter.getSalesDocHeader({ vbeln: docNumbers[0] });
    if (firstHeader) {
      const customer = await adapter.getMasterStub({
        entity_type: 'customer',
        id: firstHeader.KUNNR,
      });

      if (customer) {
        console.log(`${colors.bright}Customer: ${customer.ID}${colors.reset}`);
        console.log(`  Region:   ${colors.cyan}${customer.REGION || 'N/A'}${colors.reset}`);
        console.log(`  Industry: ${colors.cyan}${customer.INDUSTRY || 'N/A'}${colors.reset}`);
        console.log(`  Category: ${colors.cyan}${customer.CATEGORY || 'N/A'}${colors.reset}`);
      }
    }
  }

  // Shutdown
  await adapter.shutdown();

  printHeader('Demo Complete');
  console.log('The SALT adapter provides real SAP ERP data for:');
  console.log(`  ${colors.dim}• Testing process mining features with authentic patterns${colors.reset}`);
  console.log(`  ${colors.dim}• Validating ML models on real business data${colors.reset}`);
  console.log(`  ${colors.dim}• Demonstrating capabilities to stakeholders${colors.reset}`);
  console.log();
  console.log(`${colors.yellow}Note:${colors.reset} SALT contains sales orders only.`);
  console.log('For full O2C testing (deliveries, invoices), use synthetic adapter.\n');
}

runDemo().catch(console.error);
