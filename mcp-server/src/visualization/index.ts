// ═══════════════════════════════════════════════════════════════════════════
// VISUALIZATION MODULE
// Process flow visualization and bottleneck highlighting
// ═══════════════════════════════════════════════════════════════════════════

export * from './types.js';
export * from './graph-builder.js';
export * from './mermaid-generator.js';
export * from './dot-generator.js';

import { ProcessGraph, VisualizationOptions, VisualizationResult } from './types.js';
import { generateMermaidDiagram } from './mermaid-generator.js';
import { generateDotDiagram } from './dot-generator.js';
import { buildProcessGraph, Trace } from './graph-builder.js';

/**
 * Generate a process visualization from traces
 */
export function visualizeProcess(
  traces: Trace[],
  options: VisualizationOptions
): VisualizationResult {
  // Build process graph from traces
  const graph = buildProcessGraph(traces);

  // Generate visualization based on format
  switch (options.format) {
    case 'mermaid':
      return generateMermaidDiagram(graph, options);
    case 'dot':
      return generateDotDiagram(graph, options);
    case 'svg': {
      // SVG generation would require additional tooling (e.g., calling graphviz)
      // For now, return DOT format with a note
      const dotResult = generateDotDiagram(graph, options);
      return {
        ...dotResult,
        format: 'svg',
        content: `<!-- SVG generation requires GraphViz. Use the DOT source below with 'dot -Tsvg' -->\n${dotResult.content}`,
      };
    }
    default:
      throw new Error(`Unsupported format: ${options.format}`);
  }
}

/**
 * Generate visualization from a pre-built process graph
 */
export function visualizeGraph(
  graph: ProcessGraph,
  options: VisualizationOptions
): VisualizationResult {
  switch (options.format) {
    case 'mermaid':
      return generateMermaidDiagram(graph, options);
    case 'dot':
      return generateDotDiagram(graph, options);
    case 'svg': {
      const dotResult = generateDotDiagram(graph, options);
      return {
        ...dotResult,
        format: 'svg',
        content: `<!-- SVG generation requires GraphViz. Use the DOT source below with 'dot -Tsvg' -->\n${dotResult.content}`,
      };
    }
    default:
      throw new Error(`Unsupported format: ${options.format}`);
  }
}
