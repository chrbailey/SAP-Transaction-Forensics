/**
 * Demo: Process Visualization with BPI Challenge 2019 Data
 *
 * This demo shows how to generate visual process maps from P2P data.
 * Outputs Mermaid and GraphViz DOT formats with bottleneck highlighting.
 *
 * Usage:
 *   npx tsx demos/visualize_process_bpi_demo.ts [max_traces] [format]
 *
 * Arguments:
 *   max_traces - Maximum number of traces to analyze (default: 50)
 *   format - Output format: mermaid or dot (default: mermaid)
 */

import { BPIAdapter } from '../mcp-server/src/adapters/bpi/index.js';
import {
  visualizeProcess,
  buildProcessGraph,
  Trace,
  VisualizationOptions,
} from '../mcp-server/src/visualization/index.js';
import { writeFileSync } from 'fs';

async function main() {
  const maxTraces = parseInt(process.argv[2] || '50', 10);
  const format = (process.argv[3] || 'mermaid') as 'mermaid' | 'dot';

  console.log('═══════════════════════════════════════════════════════════════════════');
  console.log('  PROCESS VISUALIZATION DEMO - BPI Challenge 2019 P2P Data');
  console.log('═══════════════════════════════════════════════════════════════════════');
  console.log();
  console.log(`Format: ${format.toUpperCase()}`);
  console.log(`Max traces: ${maxTraces}`);
  console.log();

  // Load BPI data via adapter
  console.log('Loading BPI Challenge 2019 data...');
  const adapter = new BPIAdapter({ dataDir: 'data/bpi' });
  await adapter.initialize();

  const stats = adapter.getStats();
  if (stats) {
    console.log(`Loaded ${stats.processed_cases} traces with ${stats.total_events} events`);
  }
  console.log();

  // Get traces from adapter
  const bpiTraces = adapter.getTraces();
  console.log(`Processing ${Math.min(maxTraces, bpiTraces.length)} traces...`);

  // Convert to visualization trace format
  const traces: Trace[] = bpiTraces.slice(0, maxTraces).map(trace => ({
    caseId: trace.case_id,
    events: trace.events.map(event => ({
      activity: event.activity,
      timestamp: event.timestamp,
      attributes: {
        user: event.user,
        org: event.org,
      },
    })),
  }));

  // Build process graph
  console.log('Building process graph...');
  const graph = buildProcessGraph(traces, 'P2P');

  console.log();
  console.log('─────────────────────────────────────────────────────────────────────────');
  console.log('  Process Graph Statistics');
  console.log('─────────────────────────────────────────────────────────────────────────');
  console.log(`  Total cases: ${graph.totalCases}`);
  console.log(`  Unique variants: ${graph.uniqueVariants}`);
  console.log(`  Activities (nodes): ${graph.nodes.length}`);
  console.log(`  Transitions (edges): ${graph.edges.length}`);
  console.log(`  Avg case duration: ${graph.stats.avgCaseDuration}h`);
  console.log(`  Median case duration: ${graph.stats.medianCaseDuration}h`);
  console.log(`  Dominant variant: ${graph.stats.dominantVariantPercentage}%`);
  console.log();

  // Show top activities
  console.log('Top 10 Activities by Frequency:');
  for (const node of graph.nodes.slice(0, 10)) {
    const severity = node.bottleneckSeverity;
    const severityLabel = severity !== 'none' ? ` [${severity.toUpperCase()}]` : '';
    const durationLabel = node.avgDuration ? ` (${formatDuration(node.avgDuration)})` : '';
    console.log(`  ${node.frequency.toString().padStart(5)}x  ${node.name}${durationLabel}${severityLabel}`);
  }
  console.log();

  // Show top transitions
  console.log('Top 10 Transitions by Frequency:');
  for (const edge of graph.edges.slice(0, 10)) {
    const timeLabel = edge.avgTime ? ` [${formatDuration(edge.avgTime)}]` : '';
    const mainPath = edge.isMainPath ? ' *' : '';
    console.log(`  ${edge.frequency.toString().padStart(5)}x  ${edge.from} → ${edge.to} (${edge.percentage}%)${timeLabel}${mainPath}`);
  }
  console.log();

  // Generate visualization
  console.log('─────────────────────────────────────────────────────────────────────────');
  console.log(`  Generating ${format.toUpperCase()} Diagram`);
  console.log('─────────────────────────────────────────────────────────────────────────');
  console.log();

  const options: VisualizationOptions = {
    format,
    showFrequency: true,
    showTiming: true,
    highlightBottlenecks: true,
    minEdgeFrequency: 0.02, // Show edges with at least 2% frequency
    mainPathOnly: false,
  };

  const result = visualizeProcess(traces, options);

  console.log('Visualization generated:');
  console.log(`  Format: ${result.format}`);
  console.log(`  Nodes: ${result.metadata.nodesCount}`);
  console.log(`  Edges: ${result.metadata.edgesCount}`);
  console.log(`  Generated at: ${result.metadata.generatedAt}`);
  console.log();

  // Save to file
  const ext = format === 'mermaid' ? 'mmd' : 'dot';
  const filename = `output/process_map_${maxTraces}.${ext}`;
  writeFileSync(filename, result.content);
  console.log(`Diagram saved to: ${filename}`);
  console.log();

  // Also generate main path only version
  console.log('Generating main path only version...');
  const mainPathOptions: VisualizationOptions = {
    ...options,
    mainPathOnly: true,
  };
  const mainPathResult = visualizeProcess(traces, mainPathOptions);
  const mainPathFilename = `output/process_map_main_path_${maxTraces}.${ext}`;
  writeFileSync(mainPathFilename, mainPathResult.content);
  console.log(`Main path diagram saved to: ${mainPathFilename}`);
  console.log();

  // Show sample of the diagram
  console.log('─────────────────────────────────────────────────────────────────────────');
  console.log('  Diagram Preview (first 50 lines)');
  console.log('─────────────────────────────────────────────────────────────────────────');
  console.log();
  const previewLines = result.content.split('\n').slice(0, 50);
  console.log(previewLines.join('\n'));
  if (result.content.split('\n').length > 50) {
    console.log('... (truncated)');
  }

  console.log();
  console.log('═══════════════════════════════════════════════════════════════════════');
  console.log('  Demo Complete');
  console.log('═══════════════════════════════════════════════════════════════════════');

  // Cleanup
  await adapter.shutdown();
}

function formatDuration(hours: number): string {
  if (hours < 1) {
    const minutes = Math.round(hours * 60);
    return `${minutes}m`;
  } else if (hours < 24) {
    return `${Math.round(hours * 10) / 10}h`;
  } else {
    const days = Math.round(hours / 24 * 10) / 10;
    return `${days}d`;
  }
}

main().catch(console.error);
