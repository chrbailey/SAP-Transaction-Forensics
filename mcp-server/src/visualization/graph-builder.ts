// ═══════════════════════════════════════════════════════════════════════════
// PROCESS GRAPH BUILDER
// Constructs process graphs from event traces for visualization
// ═══════════════════════════════════════════════════════════════════════════

import {
  ProcessGraph,
  ActivityNode,
  ActivityEdge,
  ProcessStats,
  ProcessType,
  BottleneckSeverity,
} from './types.js';

/**
 * Event in a trace
 */
export interface TraceEvent {
  activity: string;
  timestamp: string;
  attributes?: Record<string, unknown>;
}

/**
 * Process trace (case)
 */
export interface Trace {
  caseId: string;
  events: TraceEvent[];
}

/**
 * Build a process graph from traces
 */
export function buildProcessGraph(traces: Trace[], processType: ProcessType = 'O2C'): ProcessGraph {
  // Count activity frequencies
  const activityFrequencies = new Map<string, number>();
  const activityDurations = new Map<string, number[]>();

  // Count edge frequencies
  const edgeFrequencies = new Map<string, number>();
  const edgeTimes = new Map<string, number[]>();

  // Track variants
  const variants = new Map<string, number>();

  // Track case durations
  const caseDurations: number[] = [];

  // Track start and end activities
  const startActivities = new Map<string, number>();
  const endActivities = new Map<string, number>();

  for (const trace of traces) {
    if (trace.events.length === 0) continue;

    // Build variant signature
    const variantKey = trace.events.map(e => e.activity).join(' -> ');
    variants.set(variantKey, (variants.get(variantKey) || 0) + 1);

    // Track start activity
    const firstEvent = trace.events[0]!;
    startActivities.set(firstEvent.activity, (startActivities.get(firstEvent.activity) || 0) + 1);

    // Track end activity
    const lastEvent = trace.events[trace.events.length - 1]!;
    endActivities.set(lastEvent.activity, (endActivities.get(lastEvent.activity) || 0) + 1);

    // Calculate case duration
    const startTime = new Date(firstEvent.timestamp).getTime();
    const endTime = new Date(lastEvent.timestamp).getTime();
    const caseDurationHours = (endTime - startTime) / (1000 * 60 * 60);
    if (!isNaN(caseDurationHours) && caseDurationHours >= 0) {
      caseDurations.push(caseDurationHours);
    }

    // Process each event
    for (let i = 0; i < trace.events.length; i++) {
      const event = trace.events[i]!;
      const activity = event.activity;

      // Count activity frequency
      activityFrequencies.set(activity, (activityFrequencies.get(activity) || 0) + 1);

      // Calculate activity duration (time until next event)
      if (i < trace.events.length - 1) {
        const nextEvent = trace.events[i + 1]!;
        const currentTime = new Date(event.timestamp).getTime();
        const nextTime = new Date(nextEvent.timestamp).getTime();
        const durationHours = (nextTime - currentTime) / (1000 * 60 * 60);

        if (!isNaN(durationHours) && durationHours >= 0) {
          if (!activityDurations.has(activity)) {
            activityDurations.set(activity, []);
          }
          activityDurations.get(activity)!.push(durationHours);
        }

        // Count edge frequency
        const edgeKey = `${activity}|${nextEvent.activity}`;
        edgeFrequencies.set(edgeKey, (edgeFrequencies.get(edgeKey) || 0) + 1);

        // Store edge time
        if (!edgeTimes.has(edgeKey)) {
          edgeTimes.set(edgeKey, []);
        }
        edgeTimes.get(edgeKey)!.push(durationHours);
      }
    }
  }

  // Calculate average durations per activity
  const avgDurations = new Map<string, number>();
  for (const [activity, durations] of activityDurations) {
    const avg = durations.reduce((a, b) => a + b, 0) / durations.length;
    avgDurations.set(activity, avg);
  }

  // Calculate bottleneck severity based on duration percentiles
  const allDurations = Array.from(avgDurations.values()).filter(d => d > 0);
  const p50 = percentile(allDurations, 50);
  const p75 = percentile(allDurations, 75);
  const p90 = percentile(allDurations, 90);

  function getBottleneckSeverity(duration: number | undefined): BottleneckSeverity {
    if (duration === undefined || duration <= 0) return 'none';
    if (duration >= p90) return 'critical';
    if (duration >= p75) return 'high';
    if (duration >= p50) return 'medium';
    if (duration > 0) return 'low';
    return 'none';
  }

  // Build nodes
  const nodes: ActivityNode[] = [];
  const maxStartCount = Math.max(...startActivities.values(), 0);
  const maxEndCount = Math.max(...endActivities.values(), 0);

  for (const [activity, frequency] of activityFrequencies) {
    const avgDuration = avgDurations.get(activity);
    const startCount = startActivities.get(activity) || 0;
    const endCount = endActivities.get(activity) || 0;

    const node: ActivityNode = {
      id: activity,
      name: formatActivityName(activity),
      frequency,
      bottleneckSeverity: getBottleneckSeverity(avgDuration),
    };
    if (avgDuration !== undefined) node.avgDuration = avgDuration;
    if (startCount > 0 && startCount === maxStartCount) node.isStart = true;
    if (endCount > 0 && endCount === maxEndCount) node.isEnd = true;

    nodes.push(node);
  }

  // Sort nodes by frequency (most frequent first)
  nodes.sort((a, b) => b.frequency - a.frequency);

  // Build edges
  const edges: ActivityEdge[] = [];
  const totalEdges = Array.from(edgeFrequencies.values()).reduce((a, b) => a + b, 0);

  for (const [edgeKey, frequency] of edgeFrequencies) {
    const [from, to] = edgeKey.split('|') as [string, string];
    const times = edgeTimes.get(edgeKey) || [];
    const avgTime = times.length > 0 ? times.reduce((a, b) => a + b, 0) / times.length : undefined;
    const percentage = totalEdges > 0 ? (frequency / totalEdges) * 100 : 0;

    const edge: ActivityEdge = {
      from,
      to,
      frequency,
      percentage: Math.round(percentage * 100) / 100,
      isMainPath: percentage > 10, // More than 10% of transitions
    };
    if (avgTime !== undefined) edge.avgTime = avgTime;

    edges.push(edge);
  }

  // Sort edges by frequency
  edges.sort((a, b) => b.frequency - a.frequency);

  // Calculate stats
  const sortedCaseDurations = [...caseDurations].sort((a, b) => a - b);
  const avgCaseDuration =
    caseDurations.length > 0 ? caseDurations.reduce((a, b) => a + b, 0) / caseDurations.length : 0;
  const medianCaseDuration = percentile(sortedCaseDurations, 50);

  // Find dominant variant
  let maxVariantCount = 0;
  for (const count of variants.values()) {
    if (count > maxVariantCount) maxVariantCount = count;
  }
  const dominantVariantPercentage = traces.length > 0 ? (maxVariantCount / traces.length) * 100 : 0;

  const stats: ProcessStats = {
    avgCaseDuration: Math.round(avgCaseDuration * 100) / 100,
    medianCaseDuration: Math.round(medianCaseDuration * 100) / 100,
    totalActivities: nodes.length,
    totalTransitions: edges.length,
    dominantVariantPercentage: Math.round(dominantVariantPercentage * 100) / 100,
  };

  return {
    processType,
    nodes,
    edges,
    totalCases: traces.length,
    uniqueVariants: variants.size,
    stats,
  };
}

/**
 * Calculate percentile of an array
 */
function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const index = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower]!;
  return sorted[lower]! + (sorted[upper]! - sorted[lower]!) * (index - lower);
}

/**
 * Format activity name for display
 */
function formatActivityName(activity: string): string {
  // Convert snake_case or camelCase to Title Case
  return activity
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, c => c.toUpperCase());
}
