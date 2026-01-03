// ═══════════════════════════════════════════════════════════════════════════
// MERMAID DIAGRAM GENERATOR
// Generates Mermaid flowchart diagrams from process graphs
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
 * Generate a Mermaid flowchart from a process graph
 */
export function generateMermaidDiagram(
  graph: ProcessGraph,
  options: VisualizationOptions = { format: 'mermaid' }
): VisualizationResult {
  const {
    showFrequency = true,
    showTiming = true,
    highlightBottlenecks = true,
    minEdgeFrequency = 0.01,
    mainPathOnly = false,
  } = options;

  const lines: string[] = [];

  // Start with flowchart direction (top to bottom)
  lines.push('flowchart TB');
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

  // Add node definitions with styling
  lines.push('    %% Node definitions');
  const nodeMap = new Map<string, ActivityNode>();
  for (const node of graph.nodes) {
    nodeMap.set(node.id, node);
  }

  for (const node of graph.nodes) {
    if (!usedNodeIds.has(node.id)) continue;

    const safeId = sanitizeId(node.id);
    let label = node.name;

    // Add frequency to label
    if (showFrequency) {
      label += `\\n(${node.frequency})`;
    }

    // Add timing to label
    if (showTiming && node.avgDuration !== undefined) {
      label += `\\n${formatDuration(node.avgDuration)}`;
    }

    // Determine node shape
    let nodeShape: string;
    if (node.isStart) {
      nodeShape = `([${label}])`; // Stadium shape for start
    } else if (node.isEnd) {
      nodeShape = `[[${label}]]`; // Subroutine shape for end
    } else {
      nodeShape = `[${label}]`; // Rectangle for normal nodes
    }

    lines.push(`    ${safeId}${nodeShape}`);
  }

  lines.push('');

  // Add edge definitions
  lines.push('    %% Transitions');
  for (const edge of filteredEdges) {
    const fromId = sanitizeId(edge.from);
    const toId = sanitizeId(edge.to);

    let edgeLabel = '';
    if (showFrequency || showTiming) {
      const parts: string[] = [];
      if (showFrequency && edge.percentage >= 1) {
        parts.push(`${Math.round(edge.percentage)}%`);
      }
      if (showTiming && edge.avgTime !== undefined) {
        parts.push(formatDuration(edge.avgTime));
      }
      if (parts.length > 0) {
        edgeLabel = parts.join(', ');
      }
    }

    // Edge style based on frequency
    let arrow = '-->';
    if (edge.isMainPath) {
      arrow = '==>';  // Thick arrow for main path
    }

    if (edgeLabel) {
      lines.push(`    ${fromId} ${arrow}|${edgeLabel}| ${toId}`);
    } else {
      lines.push(`    ${fromId} ${arrow} ${toId}`);
    }
  }

  // Add styling for bottleneck highlighting
  if (highlightBottlenecks) {
    lines.push('');
    lines.push('    %% Bottleneck styling');

    // Group nodes by severity
    const severityGroups = new Map<BottleneckSeverity, string[]>();
    for (const node of graph.nodes) {
      if (!usedNodeIds.has(node.id)) continue;
      if (!severityGroups.has(node.bottleneckSeverity)) {
        severityGroups.set(node.bottleneckSeverity, []);
      }
      severityGroups.get(node.bottleneckSeverity)!.push(sanitizeId(node.id));
    }

    // Add class definitions
    for (const [severity, color] of Object.entries(BOTTLENECK_COLORS)) {
      const textColor = severity === 'none' || severity === 'low' ? '#000' : '#fff';
      lines.push(`    classDef ${severity} fill:${color},stroke:#333,stroke-width:2px,color:${textColor}`);
    }

    // Apply classes to nodes
    for (const [severity, nodeIds] of severityGroups) {
      if (nodeIds.length > 0) {
        lines.push(`    class ${nodeIds.join(',')} ${severity}`);
      }
    }
  }

  // Add legend
  lines.push('');
  lines.push('    %% Legend');
  lines.push('    subgraph Legend');
  lines.push('        direction LR');
  lines.push('        L1[Healthy]:::none');
  lines.push('        L2[Minor Delay]:::low');
  lines.push('        L3[Moderate]:::medium');
  lines.push('        L4[High]:::high');
  lines.push('        L5[Critical]:::critical');
  lines.push('    end');

  const content = lines.join('\n');

  return {
    format: 'mermaid',
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
 * Sanitize node ID for Mermaid (remove special characters)
 */
function sanitizeId(id: string): string {
  return id
    .replace(/[^a-zA-Z0-9_]/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_');
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
