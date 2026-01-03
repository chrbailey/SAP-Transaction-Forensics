#!/usr/bin/env npx tsx
/**
 * BPI Adapter Demo
 *
 * Demonstrates loading and querying real SAP P2P process data
 * from the BPI Challenge 2019 dataset.
 */

import { BPIAdapter } from '../mcp-server/src/adapters/bpi/index.js';

async function main() {
  console.log('='.repeat(60));
  console.log('BPI Challenge 2019 Adapter Demo');
  console.log('='.repeat(60));

  const adapter = new BPIAdapter();

  try {
    // Initialize
    console.log('\n1. Initializing adapter...');
    await adapter.initialize();

    // Get stats
    console.log('\n2. Dataset Statistics:');
    const stats = adapter.getStats();
    if (stats) {
      console.log(`   Total cases: ${stats.total_cases.toLocaleString()}`);
      console.log(`   Processed cases: ${stats.processed_cases.toLocaleString()}`);
      console.log(`   Total events: ${stats.total_events.toLocaleString()}`);
      console.log(`   Unique activities: ${stats.unique_activities}`);
      console.log(`   Unique vendors: ${stats.unique_vendors.toLocaleString()}`);
      console.log(`   Unique PO documents: ${stats.unique_po_documents.toLocaleString()}`);
      console.log(`   Date range: ${stats.date_range.earliest} to ${stats.date_range.latest}`);
      console.log('\n   Activities:');
      stats.activities.slice(0, 10).forEach(a => console.log(`     - ${a}`));
      if (stats.activities.length > 10) {
        console.log(`     ... and ${stats.activities.length - 10} more`);
      }
    }

    // Get sample PO numbers
    const poNumbers = adapter.getAllPONumbers();
    console.log(`\n3. Sample PO Numbers (first 5 of ${poNumbers.length}):`);
    poNumbers.slice(0, 5).forEach(po => console.log(`   - ${po}`));

    // Search for documents
    console.log('\n4. Searching for "Marketing" documents...');
    const searchResults = await adapter.searchDocText({
      pattern: 'Marketing',
      limit: 5,
    });
    console.log(`   Found ${searchResults.length} results:`);
    searchResults.forEach(r => {
      console.log(`   - ${r.doc_key}: ${r.snippet}`);
    });

    // Get document flow for first PO
    if (poNumbers.length > 0) {
      const samplePO = poNumbers[0]!;
      console.log(`\n5. Document Flow for PO ${samplePO}:`);
      const flow = await adapter.getDocFlow({ vbeln: samplePO });
      console.log(`   Root: ${flow.root_document}`);
      console.log(`   Flow steps: ${flow.flow.length}`);
      flow.flow.slice(0, 10).forEach(step => {
        console.log(`   - ${step.created_date} ${step.doc_type}: ${step.status}`);
      });
      if (flow.flow.length > 10) {
        console.log(`   ... and ${flow.flow.length - 10} more steps`);
      }

      // Get header
      console.log(`\n6. Sales Doc Header (mapped from PO ${samplePO}):`);
      const header = await adapter.getSalesDocHeader({ vbeln: samplePO });
      if (header) {
        console.log(`   VBELN: ${header.VBELN}`);
        console.log(`   Type: ${header.AUART}`);
        console.log(`   Org: ${header.VKORG}`);
        console.log(`   Created: ${header.ERDAT}`);
        console.log(`   User: ${header.ERNAM}`);
      }

      // Get items
      console.log(`\n7. Sales Doc Items for PO ${samplePO}:`);
      const items = await adapter.getSalesDocItems({ vbeln: samplePO });
      console.log(`   Found ${items.length} items:`);
      items.slice(0, 5).forEach(item => {
        console.log(`   - Item ${item.POSNR}: ${item.PSTYV} - ${item.NETWR} EUR`);
      });

      // Get delivery timing
      console.log(`\n8. Delivery Timing for PO ${samplePO}:`);
      const delivery = await adapter.getDeliveryTiming({ vbeln: samplePO });
      if (delivery) {
        console.log(`   Delivery: ${delivery.delivery_number}`);
        console.log(`   GI Date: ${delivery.header_timing.actual_gi_date}`);
        console.log(`   Items: ${delivery.item_timing.length}`);
      } else {
        console.log('   No goods receipt found');
      }

      // Get invoice timing
      console.log(`\n9. Invoice Timing for PO ${samplePO}:`);
      const invoice = await adapter.getInvoiceTiming({ vbeln: samplePO });
      if (invoice) {
        console.log(`   Invoice: ${invoice.invoice_number}`);
        console.log(`   Billing Date: ${invoice.billing_date}`);
        console.log(`   Posting Date: ${invoice.posting_date || 'N/A'}`);
      } else {
        console.log('   No invoice found');
      }
    }

    // Shutdown
    await adapter.shutdown();
    console.log('\n' + '='.repeat(60));
    console.log('Demo completed successfully!');
    console.log('='.repeat(60));

  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

main();
