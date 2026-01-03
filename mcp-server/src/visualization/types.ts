// ═══════════════════════════════════════════════════════════════════════════
// VISUALIZATION TYPES
// Types for process flow visualization and bottleneck highlighting
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Supported output formats for process visualization
 */
export type OutputFormat = 'mermaid' | 'dot' | 'svg';

/**
 * Process types supported
 */
export type ProcessType = 'O2C' | 'P2P';

/**
 * Severity levels for bottleneck highlighting
 */
export type BottleneckSeverity = 'none' | 'low' | 'medium' | 'high' | 'critical';

/**
 * Color scheme for bottleneck visualization
 */
export const BOTTLENECK_COLORS = {
  none: '#4CAF50', // Green - healthy
  low: '#8BC34A', // Light green - minor delays
  medium: '#FFC107', // Yellow/amber - moderate delays
  high: '#FF9800', // Orange - significant delays
  critical: '#F44336', // Red - critical bottlenecks
} as const;

/**
 * Activity node in the process graph
 */
export interface ActivityNode {
  /** Unique activity identifier */
  id: string;
  /** Human-readable activity name */
  name: string;
  /** Number of times this activity occurred */
  frequency: number;
  /** Average duration at this activity (in hours) */
  avgDuration?: number;
  /** Bottleneck severity based on waiting time */
  bottleneckSeverity: BottleneckSeverity;
  /** Whether this is a start activity */
  isStart?: boolean;
  /** Whether this is an end activity */
  isEnd?: boolean;
}

/**
 * Edge/transition between activities
 */
export interface ActivityEdge {
  /** Source activity ID */
  from: string;
  /** Target activity ID */
  to: string;
  /** Number of times this transition occurred */
  frequency: number;
  /** Average time for this transition (in hours) */
  avgTime?: number;
  /** Percentage of cases taking this path */
  percentage: number;
  /** Whether this is a main path (>50% of cases) */
  isMainPath: boolean;
}

/**
 * Process graph structure
 */
export interface ProcessGraph {
  /** Process type */
  processType: ProcessType;
  /** All activity nodes */
  nodes: ActivityNode[];
  /** All edges between activities */
  edges: ActivityEdge[];
  /** Total number of cases analyzed */
  totalCases: number;
  /** Number of unique variants */
  uniqueVariants: number;
  /** Process statistics */
  stats: ProcessStats;
}

/**
 * Process statistics for summary
 */
export interface ProcessStats {
  /** Average case duration (in hours) */
  avgCaseDuration: number;
  /** Median case duration (in hours) */
  medianCaseDuration: number;
  /** Total number of activities */
  totalActivities: number;
  /** Total number of transitions */
  totalTransitions: number;
  /** Most common variant percentage */
  dominantVariantPercentage: number;
}

/**
 * Visualization result
 */
export interface VisualizationResult {
  /** Output format */
  format: OutputFormat;
  /** The generated diagram/code */
  content: string;
  /** Process statistics */
  stats: ProcessStats;
  /** Metadata about the visualization */
  metadata: {
    generatedAt: string;
    processType: ProcessType;
    totalCases: number;
    nodesCount: number;
    edgesCount: number;
  };
}

/**
 * Options for visualization generation
 */
export interface VisualizationOptions {
  /** Output format */
  format: OutputFormat;
  /** Show frequency counts on nodes */
  showFrequency?: boolean;
  /** Show timing information */
  showTiming?: boolean;
  /** Highlight bottlenecks with colors */
  highlightBottlenecks?: boolean;
  /** Minimum edge frequency to include (0-1) */
  minEdgeFrequency?: number;
  /** Include only main path (>50% cases) */
  mainPathOnly?: boolean;
}
