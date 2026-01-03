// ═══════════════════════════════════════════════════════════════════════════
// GRAPHVIZ DOT GENERATOR
// Generates GraphViz DOT format diagrams from process graphs
// ═══════════════════════════════════════════════════════════════════════════

import {
  ProcessGraph,
  ActivityNode,
  ActivityEdge,
  VisualizationOptions,
  VisualizationResult,
  BOTTLENECK_COLORS,
  BottleneckSeverity,
} from './types.js';

/**
 * Generate a GraphViz DOT diagram from a process graph
 */
export function generateDotDiagram(
  graph: ProcessGraph,
  options: VisualizationOptions = { format: 'dot' }
): VisualizationResult {
  const {
    showFrequency = true,
    showTiming = true,
    highlightBottlenecks = true,
    minEdgeFrequency = 0.01,
    mainPathOnly = false,
  } = options;

  const lines: string[] = [];

  // Start digraph
  lines.push('digraph ProcessMap {');
  lines.push('    // Graph settings');
  lines.push('    rankdir=TB;');
  lines.push('    splines=ortho;');
  lines.push('    nodesep=0.8;');
  lines.push('    ranksep=0.6;');
  lines.push('    fontname="Arial";');
  lines.push('    node [fontname="Arial", fontsize=11];');
  lines.push('    edge [fontname="Arial", fontsize=9];');
  lines.push('');

  // Filter edges based on options
  let filteredEdges = graph.edges;
  if (mainPathOnly) {
    filteredEdges = filteredEdges.filter(e => e.isMainPath);
  } else if (minEdgeFrequency > 0) {
    const totalFreq = filteredEdges.reduce((sum, e) => sum + e.frequency, 0);
    filteredEdges = filteredEdges.filter(e => e.frequency / totalFreq >= minEdgeFrequency);
  }

  // Get nodes that are actually used in edges
  const usedNodeIds = new Set<string>();
  for (const edge of filteredEdges) {
    usedNodeIds.add(edge.from);
    usedNodeIds.add(edge.to);
  }

  // Create node map
  const nodeMap = new Map<string, ActivityNode>();
  for (const node of graph.nodes) {
    nodeMap.set(node.id, node);
  }

  // Add node definitions
  lines.push('    // Nodes');
  for (const node of graph.nodes) {
    if (!usedNodeIds.has(node.id)) continue;

    const safeId = sanitizeId(node.id);
    const attrs: string[] = [];

    // Build label
    let label = escapeLabel(node.name);
    if (showFrequency) {
      label += `\\n(${node.frequency})`;
    }
    if (showTiming && node.avgDuration !== undefined) {
      label += `\\n${formatDuration(node.avgDuration)}`;
    }
    attrs.push(`label="${label}"`);

    // Node shape
    if (node.isStart) {
      attrs.push('shape=ellipse');
      attrs.push('style="filled,bold"');
    } else if (node.isEnd) {
      attrs.push('shape=doubleoctagon');
      attrs.push('style="filled,bold"');
    } else {
      attrs.push('shape=box');
      attrs.push('style="filled,rounded"');
    }

    // Bottleneck coloring
    if (highlightBottlenecks) {
      const color = BOTTLENECK_COLORS[node.bottleneckSeverity];
      const fontColor = getFontColor(node.bottleneckSeverity);
      attrs.push(`fillcolor="${color}"`);
      attrs.push(`fontcolor="${fontColor}"`);
    } else {
      attrs.push('fillcolor="#E3F2FD"');
    }

    lines.push(`    ${safeId} [${attrs.join(', ')}];`);
  }

  lines.push('');

  // Add edge definitions
  lines.push('    // Transitions');
  for (const edge of filteredEdges) {
    const fromId = sanitizeId(edge.from);
    const toId = sanitizeId(edge.to);
    const attrs: string[] = [];

    // Build label
    const labelParts: string[] = [];
    if (showFrequency && edge.percentage >= 1) {
      labelParts.push(`${Math.round(edge.percentage)}%`);
    }
    if (showTiming && edge.avgTime !== undefined) {
      labelParts.push(formatDuration(edge.avgTime));
    }
    if (labelParts.length > 0) {
      attrs.push(`label="${labelParts.join('\\n')}"`);
    }

    // Edge styling based on frequency
    if (edge.isMainPath) {
      attrs.push('penwidth=2.5');
      attrs.push('color="#1976D2"');
    } else {
      const opacity = Math.max(0.3, Math.min(1, edge.percentage / 20));
      attrs.push(`penwidth=1`);
      attrs.push(`color="#666666${Math.round(opacity * 255).toString(16).padStart(2, '0')}"`);
    }

    if (attrs.length > 0) {
      lines.push(`    ${fromId} -> ${toId} [${attrs.join(', ')}];`);
    } else {
      lines.push(`    ${fromId} -> ${toId};`);
    }
  }

  // Add legend subgraph
  if (highlightBottlenecks) {
    lines.push('');
    lines.push('    // Legend');
    lines.push('    subgraph cluster_legend {');
    lines.push('        label="Bottleneck Severity";');
    lines.push('        labeljust=l;');
    lines.push('        style=rounded;');
    lines.push('        color="#BDBDBD";');
    lines.push('        bgcolor="#FAFAFA";');
    lines.push('');
    lines.push(`        legend_none [label="Healthy", shape=box, style="filled,rounded", fillcolor="${BOTTLENECK_COLORS.none}", fontcolor="${getFontColor('none')}"];`);
    lines.push(`        legend_low [label="Minor", shape=box, style="filled,rounded", fillcolor="${BOTTLENECK_COLORS.low}", fontcolor="${getFontColor('low')}"];`);
    lines.push(`        legend_medium [label="Moderate", shape=box, style="filled,rounded", fillcolor="${BOTTLENECK_COLORS.medium}", fontcolor="${getFontColor('medium')}"];`);
    lines.push(`        legend_high [label="High", shape=box, style="filled,rounded", fillcolor="${BOTTLENECK_COLORS.high}", fontcolor="${getFontColor('high')}"];`);
    lines.push(`        legend_critical [label="Critical", shape=box, style="filled,rounded", fillcolor="${BOTTLENECK_COLORS.critical}", fontcolor="${getFontColor('critical')}"];`);
    lines.push('');
    lines.push('        legend_none -> legend_low -> legend_medium -> legend_high -> legend_critical [style=invis];');
    lines.push('    }');
  }

  // Add statistics as a comment
  lines.push('');
  lines.push('    // Statistics');
  lines.push(`    // Total cases: ${graph.totalCases}`);
  lines.push(`    // Unique variants: ${graph.uniqueVariants}`);
  lines.push(`    // Avg case duration: ${graph.stats.avgCaseDuration}h`);
  lines.push(`    // Dominant variant: ${graph.stats.dominantVariantPercentage}%`);

  lines.push('}');

  const content = lines.join('\n');

  return {
    format: 'dot',
    content,
    stats: graph.stats,
    metadata: {
      generatedAt: new Date().toISOString(),
      processType: graph.processType,
      totalCases: graph.totalCases,
      nodesCount: usedNodeIds.size,
      edgesCount: filteredEdges.length,
    },
  };
}

/**
 * Sanitize node ID for DOT (must be valid identifier)
 */
function sanitizeId(id: string): string {
  return id
    .replace(/[^a-zA-Z0-9_]/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_')
    .replace(/^(\d)/, 'n$1'); // Prefix with 'n' if starts with number
}

/**
 * Escape special characters in labels
 */
function escapeLabel(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n');
}

/**
 * Get appropriate font color for bottleneck severity
 */
function getFontColor(severity: BottleneckSeverity): string {
  switch (severity) {
    case 'none':
    case 'low':
      return '#000000';
    case 'medium':
      return '#000000';
    case 'high':
    case 'critical':
      return '#FFFFFF';
    default:
      return '#000000';
  }
}

/**
 * Format duration in human-readable format
 */
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
