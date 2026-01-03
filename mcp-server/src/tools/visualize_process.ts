/**
 * Tool: visualize_process
 *
 * Generates process flow visualizations for SAP documents.
 * Supports both O2C (Order-to-Cash) and P2P (Purchase-to-Pay) processes.
 * Output formats: Mermaid flowcharts, DOT (Graphviz), and SVG.
 * Includes bottleneck highlighting and timing annotations.
 *
 * Phase 4 - SAP Workflow Mining v2.0 Roadmap
 */

import { z } from 'zod';
import { SAPAdapter } from '../adapters/adapter.js';
import { createAuditContext } from '../logging/audit.js';
import { withTimeout, getPolicyConfig } from '../policies/limits.js';
import { DocFlowResult } from '../types/sap.js';
import { BPITrace } from '../adapters/bpi/index.js';
import {
  visualizeProcess as visualizeP2PProcess,
  Trace as VisualizationTrace,
  VisualizationOptions,
} from '../visualization/index.js';

/**
 * Visualization output structure
 */
interface VisualizationResult {
  /** Output format used */
  format: 'mermaid' | 'dot' | 'svg';
  /** The generated diagram code/markup */
  diagram: string;
  /** Process statistics */
  statistics: {
    total_documents: number;
    total_steps: number;
    avg_cycle_time_hours: number;
    bottlenecks: Array<{
      step: string;
      avg_duration_hours: number;
      severity: 'low' | 'medium' | 'high';
    }>;
  };
  /** Document numbers included in visualization */
  included_documents: string[];
}

/**
 * Process step timing information
 */
interface StepTiming {
  from_step: string;
  to_step: string;
  avg_duration_hours: number;
  min_duration_hours: number;
  max_duration_hours: number;
  count: number;
}

/**
 * Node information for graph building
 */
interface ProcessNode {
  id: string;
  label: string;
  doc_type: string;
  doc_category: string;
  timestamp: Date;
  is_bottleneck: boolean;
  bottleneck_severity?: 'low' | 'medium' | 'high';
}

/**
 * Edge information for graph building
 */
interface ProcessEdge {
  from: string;
  to: string;
  duration_hours: number;
  label?: string;
}

/**
 * Zod schema for input validation
 */
export const VisualizeProcessSchema = z.object({
  doc_numbers: z
    .array(z.string().min(1))
    .optional()
    .describe('Document numbers to visualize (required for O2C, optional for P2P)'),
  format: z.enum(['mermaid', 'dot', 'svg']).default('mermaid'),
  include_timing: z.boolean().default(true),
  highlight_bottlenecks: z.boolean().default(true),
  max_traces: z
    .number()
    .int()
    .min(1)
    .max(10000)
    .default(100)
    .describe('Maximum traces to analyze (for P2P mode)'),
  main_path_only: z
    .boolean()
    .default(false)
    .describe('Only show the main process path (most frequent transitions)'),
  min_edge_frequency: z
    .number()
    .min(0)
    .max(1)
    .default(0.01)
    .describe('Minimum edge frequency to include (0-1)'),
});

export type VisualizeProcessInput = z.infer<typeof VisualizeProcessSchema>;

/**
 * Tool definition for MCP registration
 */
export const visualizeProcessTool = {
  name: 'visualize_process',
  description: `Generate process flow visualizations for SAP documents.

Supports both O2C (Order-to-Cash) and P2P (Purchase-to-Pay) processes.
Auto-detects process type based on the adapter in use.

Output Formats:
- mermaid: Mermaid flowchart syntax (renderable in markdown, docs, Mermaid Live)
- dot: GraphViz DOT format (use with 'dot -Tsvg' or GraphViz tools)
- svg: Simple inline SVG (for O2C) or DOT with instructions (for P2P)

Features:
- Bottleneck highlighting with color-coded severity:
  - Green: Healthy (no delays)
  - Yellow: Minor to moderate delays
  - Orange: High delays
  - Red: Critical bottlenecks
- Frequency annotations showing activity counts
- Timing annotations showing average durations
- Main path highlighting for dominant process variants

Use Cases:
- Visualize actual process flows from SAP data
- Identify bottlenecks and delays
- Compare process variants
- Generate documentation and reports
- Present findings to stakeholders

Parameters:
- doc_numbers: Document numbers for O2C visualization (optional for P2P)
- format: 'mermaid' (default), 'dot', or 'svg'
- include_timing: Show timing information (default: true)
- highlight_bottlenecks: Color-code bottlenecks (default: true)
- max_traces: Maximum traces for P2P analysis (default: 100)
- main_path_only: Only show most common path (default: false)
- min_edge_frequency: Filter infrequent paths (default: 0.01)`,
  inputSchema: {
    type: 'object' as const,
    properties: {
      doc_numbers: {
        type: 'array',
        items: { type: 'string' },
        description: 'Document numbers for O2C (optional for P2P)',
      },
      format: {
        type: 'string',
        enum: ['mermaid', 'dot', 'svg'],
        description: 'Output format: mermaid (default), dot, or svg',
      },
      include_timing: {
        type: 'boolean',
        description: 'Show timing information (default: true)',
      },
      highlight_bottlenecks: {
        type: 'boolean',
        description: 'Color-code bottlenecks (default: true)',
      },
      max_traces: {
        type: 'number',
        description: 'Max traces for P2P analysis (default: 100)',
      },
      main_path_only: {
        type: 'boolean',
        description: 'Only show main path (default: false)',
      },
      min_edge_frequency: {
        type: 'number',
        description: 'Min edge frequency to include (default: 0.01)',
      },
    },
    required: [],
  },
};

/**
 * Parse SAP date and time to JavaScript Date
 */
function parseSAPDateTime(date: string, time: string): Date {
  const cleanDate = date.replace(/-/g, '');
  const cleanTime = time.replace(/:/g, '');

  const year = parseInt(cleanDate.substring(0, 4), 10);
  const month = parseInt(cleanDate.substring(4, 6), 10) - 1;
  const day = parseInt(cleanDate.substring(6, 8), 10);
  const hour = parseInt(cleanTime.substring(0, 2) || '0', 10);
  const minute = parseInt(cleanTime.substring(2, 4) || '0', 10);
  const second = parseInt(cleanTime.substring(4, 6) || '0', 10);

  return new Date(year, month, day, hour, minute, second);
}

/**
 * Calculate duration in hours between two dates
 */
function calculateDurationHours(from: Date, to: Date): number {
  const diffMs = to.getTime() - from.getTime();
  return Math.max(0, diffMs / (1000 * 60 * 60));
}

/**
 * Determine bottleneck severity based on duration thresholds
 * Thresholds are based on typical SAP O2C process benchmarks
 */
function getBottleneckSeverity(
  durationHours: number,
  stepType: string
): 'low' | 'medium' | 'high' | null {
  // Define thresholds by step type (in hours)
  const thresholds: Record<string, { medium: number; high: number }> = {
    order_to_delivery: { medium: 24, high: 72 }, // 1-3 days typical
    delivery_to_gi: { medium: 8, high: 24 }, // Same day to 1 day
    gi_to_invoice: { medium: 24, high: 48 }, // 1-2 days typical
    default: { medium: 24, high: 72 },
  };

  const threshold = thresholds[stepType] ?? thresholds['default']!;

  if (durationHours >= threshold.high) {
    return 'high';
  } else if (durationHours >= threshold.medium) {
    return 'medium';
  } else if (durationHours > threshold.medium * 0.5) {
    return 'low';
  }
  return null;
}

/**
 * Get display label for document category
 */
function getDocCategoryLabel(category: string, docType: string): string {
  const labels: Record<string, string> = {
    C: 'Sales Order',
    J: 'Delivery',
    M: 'Invoice',
    O: 'Credit Memo',
    P: 'Debit Memo',
    B: 'Quotation',
    G: 'Contract',
    H: 'Returns',
  };

  return labels[category] || docType || 'Document';
}

/**
 * Build process nodes and edges from document flows
 */
function buildProcessGraph(
  flows: DocFlowResult[],
  highlightBottlenecks: boolean
): { nodes: ProcessNode[]; edges: ProcessEdge[]; timings: StepTiming[] } {
  const nodes: Map<string, ProcessNode> = new Map();
  const edges: ProcessEdge[] = [];
  const timingMap: Map<string, number[]> = new Map();

  for (const flow of flows) {
    // Sort flow documents by timestamp
    const sortedDocs = [...flow.flow].sort((a, b) => {
      const dateA = parseSAPDateTime(a.created_date, a.created_time);
      const dateB = parseSAPDateTime(b.created_date, b.created_time);
      return dateA.getTime() - dateB.getTime();
    });

    // Create nodes for each document
    for (const doc of sortedDocs) {
      const nodeId = `${doc.doc_category}_${doc.doc_number}`;
      if (!nodes.has(nodeId)) {
        nodes.set(nodeId, {
          id: nodeId,
          label: `${getDocCategoryLabel(doc.doc_category, doc.doc_type)}\\n${doc.doc_number}`,
          doc_type: doc.doc_type,
          doc_category: doc.doc_category,
          timestamp: parseSAPDateTime(doc.created_date, doc.created_time),
          is_bottleneck: false,
        });
      }
    }

    // Create edges between consecutive documents
    for (let i = 0; i < sortedDocs.length - 1; i++) {
      const fromDoc = sortedDocs[i]!;
      const toDoc = sortedDocs[i + 1]!;

      const fromId = `${fromDoc.doc_category}_${fromDoc.doc_number}`;
      const toId = `${toDoc.doc_category}_${toDoc.doc_number}`;

      const fromTime = parseSAPDateTime(fromDoc.created_date, fromDoc.created_time);
      const toTime = parseSAPDateTime(toDoc.created_date, toDoc.created_time);
      const durationHours = calculateDurationHours(fromTime, toTime);

      edges.push({
        from: fromId,
        to: toId,
        duration_hours: durationHours,
      });

      // Track timing statistics
      const stepKey = `${fromDoc.doc_category}_to_${toDoc.doc_category}`;
      if (!timingMap.has(stepKey)) {
        timingMap.set(stepKey, []);
      }
      timingMap.get(stepKey)!.push(durationHours);
    }
  }

  // Calculate timing statistics
  const timings: StepTiming[] = [];
  for (const [stepKey, durations] of timingMap) {
    const parts = stepKey.split('_');
    const fromCat = parts[0] ?? '';
    const toCat = parts[2] ?? '';
    const avgDuration = durations.reduce((a, b) => a + b, 0) / durations.length;
    const minDuration = Math.min(...durations);
    const maxDuration = Math.max(...durations);

    timings.push({
      from_step: getDocCategoryLabel(fromCat, ''),
      to_step: getDocCategoryLabel(toCat, ''),
      avg_duration_hours: Math.round(avgDuration * 100) / 100,
      min_duration_hours: Math.round(minDuration * 100) / 100,
      max_duration_hours: Math.round(maxDuration * 100) / 100,
      count: durations.length,
    });

    // Mark bottlenecks
    if (highlightBottlenecks) {
      const severity = getBottleneckSeverity(avgDuration, stepKey);
      if (severity) {
        // Mark the target node as bottleneck
        for (const node of nodes.values()) {
          if (node.doc_category === toCat && !node.is_bottleneck) {
            node.is_bottleneck = true;
            node.bottleneck_severity = severity;
          }
        }
      }
    }
  }

  return {
    nodes: Array.from(nodes.values()),
    edges,
    timings,
  };
}

/**
 * Generate Mermaid flowchart
 */
function generateMermaidDiagram(
  nodes: ProcessNode[],
  edges: ProcessEdge[],
  includeTiming: boolean,
  highlightBottlenecks: boolean
): string {
  const lines: string[] = ['flowchart LR'];

  // Add style definitions for bottlenecks
  if (highlightBottlenecks) {
    lines.push('  %% Bottleneck styles');
    lines.push('  classDef bottleneckLow fill:#fff3cd,stroke:#ffc107,stroke-width:2px');
    lines.push('  classDef bottleneckMedium fill:#ffe5d0,stroke:#fd7e14,stroke-width:2px');
    lines.push('  classDef bottleneckHigh fill:#f8d7da,stroke:#dc3545,stroke-width:3px');
    lines.push('  classDef normal fill:#d4edda,stroke:#28a745,stroke-width:1px');
    lines.push('');
  }

  // Add nodes
  lines.push('  %% Process nodes');
  for (const node of nodes) {
    const safeId = node.id.replace(/[^a-zA-Z0-9_]/g, '_');
    const label = node.label.replace(/"/g, "'");
    lines.push(`  ${safeId}["${label}"]`);
  }
  lines.push('');

  // Add edges with optional timing labels
  lines.push('  %% Process flow edges');
  for (const edge of edges) {
    const fromId = edge.from.replace(/[^a-zA-Z0-9_]/g, '_');
    const toId = edge.to.replace(/[^a-zA-Z0-9_]/g, '_');

    if (includeTiming && edge.duration_hours > 0) {
      const durationLabel = formatDuration(edge.duration_hours);
      lines.push(`  ${fromId} -->|"${durationLabel}"| ${toId}`);
    } else {
      lines.push(`  ${fromId} --> ${toId}`);
    }
  }

  // Apply bottleneck classes
  if (highlightBottlenecks) {
    lines.push('');
    lines.push('  %% Apply bottleneck highlighting');

    const bottleneckNodes = {
      low: nodes.filter(n => n.bottleneck_severity === 'low'),
      medium: nodes.filter(n => n.bottleneck_severity === 'medium'),
      high: nodes.filter(n => n.bottleneck_severity === 'high'),
      normal: nodes.filter(n => !n.is_bottleneck),
    };

    if (bottleneckNodes.low.length > 0) {
      const ids = bottleneckNodes.low.map(n => n.id.replace(/[^a-zA-Z0-9_]/g, '_')).join(',');
      lines.push(`  class ${ids} bottleneckLow`);
    }
    if (bottleneckNodes.medium.length > 0) {
      const ids = bottleneckNodes.medium.map(n => n.id.replace(/[^a-zA-Z0-9_]/g, '_')).join(',');
      lines.push(`  class ${ids} bottleneckMedium`);
    }
    if (bottleneckNodes.high.length > 0) {
      const ids = bottleneckNodes.high.map(n => n.id.replace(/[^a-zA-Z0-9_]/g, '_')).join(',');
      lines.push(`  class ${ids} bottleneckHigh`);
    }
    if (bottleneckNodes.normal.length > 0) {
      const ids = bottleneckNodes.normal.map(n => n.id.replace(/[^a-zA-Z0-9_]/g, '_')).join(',');
      lines.push(`  class ${ids} normal`);
    }
  }

  return lines.join('\n');
}

/**
 * Generate DOT (Graphviz) diagram
 */
function generateDotDiagram(
  nodes: ProcessNode[],
  edges: ProcessEdge[],
  includeTiming: boolean,
  highlightBottlenecks: boolean
): string {
  const lines: string[] = [
    'digraph O2CProcess {',
    '  rankdir=LR;',
    '  node [shape=box, style="rounded,filled", fontname="Arial"];',
    '  edge [fontname="Arial", fontsize=10];',
    '',
  ];

  // Define colors for bottleneck severity
  const getNodeColor = (node: ProcessNode): string => {
    if (!highlightBottlenecks || !node.is_bottleneck) {
      return '#d4edda'; // Normal green
    }
    switch (node.bottleneck_severity) {
      case 'low':
        return '#fff3cd'; // Yellow
      case 'medium':
        return '#ffe5d0'; // Orange
      case 'high':
        return '#f8d7da'; // Red
      default:
        return '#d4edda';
    }
  };

  const getBorderColor = (node: ProcessNode): string => {
    if (!highlightBottlenecks || !node.is_bottleneck) {
      return '#28a745';
    }
    switch (node.bottleneck_severity) {
      case 'low':
        return '#ffc107';
      case 'medium':
        return '#fd7e14';
      case 'high':
        return '#dc3545';
      default:
        return '#28a745';
    }
  };

  // Add nodes
  lines.push('  // Process nodes');
  for (const node of nodes) {
    const safeId = node.id.replace(/[^a-zA-Z0-9_]/g, '_');
    const label = node.label.replace(/\\/g, '\\n');
    const fillColor = getNodeColor(node);
    const borderColor = getBorderColor(node);
    const penWidth = node.is_bottleneck && node.bottleneck_severity === 'high' ? 3 : 1;

    lines.push(
      `  ${safeId} [label="${label}", fillcolor="${fillColor}", color="${borderColor}", penwidth=${penWidth}];`
    );
  }
  lines.push('');

  // Add edges
  lines.push('  // Process flow edges');
  for (const edge of edges) {
    const fromId = edge.from.replace(/[^a-zA-Z0-9_]/g, '_');
    const toId = edge.to.replace(/[^a-zA-Z0-9_]/g, '_');

    if (includeTiming && edge.duration_hours > 0) {
      const durationLabel = formatDuration(edge.duration_hours);
      lines.push(`  ${fromId} -> ${toId} [label="${durationLabel}"];`);
    } else {
      lines.push(`  ${fromId} -> ${toId};`);
    }
  }

  lines.push('}');
  return lines.join('\n');
}

/**
 * Generate SVG diagram (simple inline SVG)
 */
function generateSvgDiagram(
  nodes: ProcessNode[],
  edges: ProcessEdge[],
  includeTiming: boolean,
  highlightBottlenecks: boolean
): string {
  const nodeWidth = 140;
  const nodeHeight = 60;
  const nodeSpacing = 80;
  const startX = 50;
  const startY = 100;

  // Calculate positions (simple left-to-right layout)
  const nodePositions: Map<string, { x: number; y: number }> = new Map();
  let currentX = startX;

  // Sort nodes by timestamp for layout
  const sortedNodes = [...nodes].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

  for (const node of sortedNodes) {
    nodePositions.set(node.id, { x: currentX, y: startY });
    currentX += nodeWidth + nodeSpacing;
  }

  const svgWidth = currentX + 50;
  const svgHeight = startY + nodeHeight + 100;

  const getNodeColor = (node: ProcessNode): string => {
    if (!highlightBottlenecks || !node.is_bottleneck) {
      return '#d4edda';
    }
    switch (node.bottleneck_severity) {
      case 'low':
        return '#fff3cd';
      case 'medium':
        return '#ffe5d0';
      case 'high':
        return '#f8d7da';
      default:
        return '#d4edda';
    }
  };

  const getBorderColor = (node: ProcessNode): string => {
    if (!highlightBottlenecks || !node.is_bottleneck) {
      return '#28a745';
    }
    switch (node.bottleneck_severity) {
      case 'low':
        return '#ffc107';
      case 'medium':
        return '#fd7e14';
      case 'high':
        return '#dc3545';
      default:
        return '#28a745';
    }
  };

  const lines: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${svgWidth} ${svgHeight}" width="${svgWidth}" height="${svgHeight}">`,
    '  <defs>',
    '    <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">',
    '      <polygon points="0 0, 10 3.5, 0 7" fill="#666"/>',
    '    </marker>',
    '  </defs>',
    '  <style>',
    '    .node-text { font-family: Arial, sans-serif; font-size: 11px; text-anchor: middle; }',
    '    .edge-text { font-family: Arial, sans-serif; font-size: 9px; fill: #666; }',
    '  </style>',
    '',
  ];

  // Draw edges first (so they appear behind nodes)
  lines.push('  <!-- Edges -->');
  for (const edge of edges) {
    const fromPos = nodePositions.get(edge.from);
    const toPos = nodePositions.get(edge.to);

    if (fromPos && toPos) {
      const x1 = fromPos.x + nodeWidth;
      const y1 = fromPos.y + nodeHeight / 2;
      const x2 = toPos.x;
      const y2 = toPos.y + nodeHeight / 2;

      lines.push(
        `  <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#666" stroke-width="2" marker-end="url(#arrowhead)"/>`
      );

      if (includeTiming && edge.duration_hours > 0) {
        const midX = (x1 + x2) / 2;
        const midY = (y1 + y2) / 2 - 10;
        const durationLabel = formatDuration(edge.duration_hours);
        lines.push(
          `  <text x="${midX}" y="${midY}" class="edge-text" text-anchor="middle">${durationLabel}</text>`
        );
      }
    }
  }

  // Draw nodes
  lines.push('  <!-- Nodes -->');
  for (const node of sortedNodes) {
    const pos = nodePositions.get(node.id);
    if (!pos) continue;

    const fillColor = getNodeColor(node);
    const borderColor = getBorderColor(node);
    const strokeWidth = node.is_bottleneck && node.bottleneck_severity === 'high' ? 3 : 1;

    lines.push(
      `  <rect x="${pos.x}" y="${pos.y}" width="${nodeWidth}" height="${nodeHeight}" rx="8" fill="${fillColor}" stroke="${borderColor}" stroke-width="${strokeWidth}"/>`
    );

    // Split label for multi-line text
    const labelParts = node.label.split('\\n');
    const textY = pos.y + nodeHeight / 2 - (labelParts.length - 1) * 7;

    for (let i = 0; i < labelParts.length; i++) {
      const part = labelParts[i] ?? '';
      lines.push(
        `  <text x="${pos.x + nodeWidth / 2}" y="${textY + i * 14}" class="node-text">${escapeXml(part)}</text>`
      );
    }
  }

  // Add legend if highlighting bottlenecks
  if (highlightBottlenecks) {
    lines.push('  <!-- Legend -->');
    lines.push('  <g transform="translate(10, 10)">');
    lines.push(
      '    <text x="0" y="12" style="font-family: Arial; font-size: 10px; font-weight: bold;">Legend:</text>'
    );
    lines.push('    <rect x="0" y="20" width="15" height="15" fill="#d4edda" stroke="#28a745"/>');
    lines.push('    <text x="20" y="32" style="font-family: Arial; font-size: 9px;">Normal</text>');
    lines.push('    <rect x="60" y="20" width="15" height="15" fill="#fff3cd" stroke="#ffc107"/>');
    lines.push('    <text x="80" y="32" style="font-family: Arial; font-size: 9px;">Low</text>');
    lines.push('    <rect x="110" y="20" width="15" height="15" fill="#ffe5d0" stroke="#fd7e14"/>');
    lines.push(
      '    <text x="130" y="32" style="font-family: Arial; font-size: 9px;">Medium</text>'
    );
    lines.push(
      '    <rect x="175" y="20" width="15" height="15" fill="#f8d7da" stroke="#dc3545" stroke-width="2"/>'
    );
    lines.push('    <text x="195" y="32" style="font-family: Arial; font-size: 9px;">High</text>');
    lines.push('  </g>');
  }

  lines.push('</svg>');
  return lines.join('\n');
}

/**
 * Format duration in human-readable form
 */
function formatDuration(hours: number): string {
  if (hours < 1) {
    return `${Math.round(hours * 60)}m`;
  } else if (hours < 24) {
    return `${Math.round(hours * 10) / 10}h`;
  } else {
    const days = Math.floor(hours / 24);
    const remainingHours = Math.round(hours % 24);
    if (remainingHours === 0) {
      return `${days}d`;
    }
    return `${days}d ${remainingHours}h`;
  }
}

/**
 * Escape XML special characters
 */
function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Check if adapter is a BPI adapter (P2P)
 */
function isBPIAdapter(adapter: SAPAdapter): adapter is SAPAdapter & { getTraces(): BPITrace[] } {
  return (
    adapter.name === 'BPI Challenge 2019' &&
    typeof (adapter as unknown as { getTraces?: () => BPITrace[] }).getTraces === 'function'
  );
}

/**
 * Convert BPI traces to visualization trace format
 */
function convertBPITraces(bpiTraces: BPITrace[]): VisualizationTrace[] {
  return bpiTraces.map(trace => ({
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
}

/**
 * Execute P2P visualization using BPI adapter
 */
async function executeP2PVisualization(
  adapter: SAPAdapter & { getTraces(): BPITrace[] },
  input: VisualizeProcessInput,
  auditContext: ReturnType<typeof createAuditContext>
): Promise<VisualizationResult> {
  // Get traces from BPI adapter
  const bpiTraces = adapter.getTraces();
  const traces = convertBPITraces(bpiTraces.slice(0, input.max_traces));

  // Build visualization options
  const options: VisualizationOptions = {
    format: input.format,
    showFrequency: true,
    showTiming: input.include_timing,
    highlightBottlenecks: input.highlight_bottlenecks,
    minEdgeFrequency: input.min_edge_frequency,
    mainPathOnly: input.main_path_only,
  };

  // Generate visualization
  const result = visualizeP2PProcess(traces, options);

  // Log success
  auditContext.success(traces.length);

  // Convert to our result format
  return {
    format: input.format,
    diagram: result.content,
    statistics: {
      total_documents: result.metadata.totalCases,
      total_steps: result.metadata.nodesCount,
      avg_cycle_time_hours: result.stats.avgCaseDuration,
      bottlenecks: [], // Would need to extract from graph
    },
    included_documents: [],
  };
}

/**
 * Execute O2C visualization using standard SAP adapter
 */
async function executeO2CVisualization(
  adapter: SAPAdapter,
  input: VisualizeProcessInput,
  auditContext: ReturnType<typeof createAuditContext>
): Promise<VisualizationResult> {
  const config = getPolicyConfig();
  const flows: DocFlowResult[] = [];
  const includedDocuments: string[] = [];

  if (!input.doc_numbers || input.doc_numbers.length === 0) {
    throw new Error('doc_numbers is required for O2C visualization');
  }

  // Fetch document flows for each document number
  for (const docNum of input.doc_numbers) {
    try {
      const flow = await withTimeout(
        adapter.getDocFlow({ vbeln: docNum }),
        config.defaultTimeoutMs,
        'visualize_process:getDocFlow'
      );

      if (flow && flow.flow.length > 0) {
        flows.push(flow);
        includedDocuments.push(docNum);
      }
    } catch (err) {
      // Log but continue with other documents
      console.warn(`Failed to fetch flow for document ${docNum}:`, err);
    }
  }

  if (flows.length === 0) {
    throw new Error('No valid document flows found for the provided document numbers');
  }

  // Build process graph
  const { nodes, edges } = buildProcessGraph(flows, input.highlight_bottlenecks);

  // Generate diagram based on format
  let diagram: string;
  switch (input.format) {
    case 'dot':
      diagram = generateDotDiagram(nodes, edges, input.include_timing, input.highlight_bottlenecks);
      break;
    case 'svg':
      diagram = generateSvgDiagram(nodes, edges, input.include_timing, input.highlight_bottlenecks);
      break;
    case 'mermaid':
    default:
      diagram = generateMermaidDiagram(
        nodes,
        edges,
        input.include_timing,
        input.highlight_bottlenecks
      );
      break;
  }

  // Calculate statistics
  const totalCycleTime = edges.reduce((sum, e) => sum + e.duration_hours, 0);
  const avgCycleTime = edges.length > 0 ? totalCycleTime / edges.length : 0;

  const bottlenecks = nodes
    .filter(n => n.is_bottleneck)
    .map(n => {
      // Find average incoming edge duration
      const incomingEdges = edges.filter(e => e.to === n.id);
      const avgDuration =
        incomingEdges.length > 0
          ? incomingEdges.reduce((sum, e) => sum + e.duration_hours, 0) / incomingEdges.length
          : 0;

      return {
        step: `${getDocCategoryLabel(n.doc_category, n.doc_type)} (${n.id.split('_').pop()})`,
        avg_duration_hours: Math.round(avgDuration * 100) / 100,
        severity: n.bottleneck_severity!,
      };
    });

  const result: VisualizationResult = {
    format: input.format,
    diagram,
    statistics: {
      total_documents: includedDocuments.length,
      total_steps: nodes.length,
      avg_cycle_time_hours: Math.round(avgCycleTime * 100) / 100,
      bottlenecks,
    },
    included_documents: includedDocuments,
  };

  // Log success
  auditContext.success(nodes.length);

  return result;
}

/**
 * Execute the visualize_process tool
 */
export async function executeVisualizeProcess(
  adapter: SAPAdapter,
  rawInput: unknown
): Promise<VisualizationResult> {
  // Validate input
  const input = VisualizeProcessSchema.parse(rawInput);

  // Create audit context
  const auditContext = createAuditContext(
    'visualize_process',
    input as Record<string, unknown>,
    adapter.name
  );

  try {
    // Detect adapter type and route to appropriate implementation
    if (isBPIAdapter(adapter)) {
      // P2P visualization using new visualization module
      return await executeP2PVisualization(adapter, input, auditContext);
    } else {
      // O2C visualization using legacy implementation
      return await executeO2CVisualization(adapter, input, auditContext);
    }
  } catch (error) {
    auditContext.error(error as Error);
    throw error;
  }
}
