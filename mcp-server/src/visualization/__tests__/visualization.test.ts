/**
 * Visualization Module Tests
 */

import {
  buildProcessGraph,
  Trace,
  ProcessGraph,
  ActivityNode,
  ActivityEdge,
} from '../graph-builder.js';
import { generateMermaidDiagram } from '../mermaid-generator.js';
import { generateDotDiagram } from '../dot-generator.js';
import { visualizeProcess, visualizeGraph } from '../index.js';
import { VisualizationOptions, BOTTLENECK_COLORS } from '../types.js';

describe('Visualization Module', () => {
  describe('Graph Builder', () => {
    const sampleTraces: Trace[] = [
      {
        caseId: 'CASE-001',
        events: [
          { activity: 'order_created', timestamp: '2024-01-01T10:00:00' },
          { activity: 'delivery_created', timestamp: '2024-01-02T10:00:00' },
          { activity: 'goods_issued', timestamp: '2024-01-03T10:00:00' },
          { activity: 'invoice_created', timestamp: '2024-01-04T10:00:00' },
        ],
      },
      {
        caseId: 'CASE-002',
        events: [
          { activity: 'order_created', timestamp: '2024-01-01T10:00:00' },
          { activity: 'delivery_created', timestamp: '2024-01-02T10:00:00' },
          { activity: 'goods_issued', timestamp: '2024-01-03T10:00:00' },
          { activity: 'invoice_created', timestamp: '2024-01-04T10:00:00' },
        ],
      },
    ];

    it('should build a process graph from traces', () => {
      const graph = buildProcessGraph(sampleTraces);

      expect(graph).toBeDefined();
      expect(graph.nodes.length).toBeGreaterThan(0);
      expect(graph.edges.length).toBeGreaterThan(0);
      expect(graph.totalCases).toBe(2);
    });

    it('should count activity frequencies correctly', () => {
      const graph = buildProcessGraph(sampleTraces);

      // Each activity should appear twice (once per trace)
      for (const node of graph.nodes) {
        expect(node.frequency).toBe(2);
      }
    });

    it('should calculate edge frequencies', () => {
      const graph = buildProcessGraph(sampleTraces);

      // Each transition should appear twice
      for (const edge of graph.edges) {
        expect(edge.frequency).toBe(2);
      }
    });

    it('should identify start and end activities', () => {
      const graph = buildProcessGraph(sampleTraces);

      const startNode = graph.nodes.find(n => n.isStart);
      const endNode = graph.nodes.find(n => n.isEnd);

      expect(startNode?.id).toBe('order_created');
      expect(endNode?.id).toBe('invoice_created');
    });

    it('should calculate process statistics', () => {
      const graph = buildProcessGraph(sampleTraces);

      expect(graph.stats.totalActivities).toBe(4);
      expect(graph.stats.totalTransitions).toBe(3);
      expect(graph.stats.avgCaseDuration).toBeGreaterThan(0);
    });

    it('should count unique variants', () => {
      const graph = buildProcessGraph(sampleTraces);

      // Both traces have same variant
      expect(graph.uniqueVariants).toBe(1);
    });

    it('should handle different variants', () => {
      const differentVariants: Trace[] = [
        {
          caseId: 'CASE-001',
          events: [
            { activity: 'A', timestamp: '2024-01-01T10:00:00' },
            { activity: 'B', timestamp: '2024-01-02T10:00:00' },
          ],
        },
        {
          caseId: 'CASE-002',
          events: [
            { activity: 'A', timestamp: '2024-01-01T10:00:00' },
            { activity: 'C', timestamp: '2024-01-02T10:00:00' },
          ],
        },
      ];

      const graph = buildProcessGraph(differentVariants);
      expect(graph.uniqueVariants).toBe(2);
    });

    it('should assign bottleneck severity', () => {
      const graph = buildProcessGraph(sampleTraces);

      // All nodes should have a bottleneck severity assigned
      for (const node of graph.nodes) {
        expect(node.bottleneckSeverity).toBeDefined();
        expect(['none', 'low', 'medium', 'high', 'critical']).toContain(node.bottleneckSeverity);
      }
    });

    it('should calculate edge percentages', () => {
      const graph = buildProcessGraph(sampleTraces);

      // Total percentage should be close to 100
      const totalPercentage = graph.edges.reduce((sum, e) => sum + e.percentage, 0);
      expect(totalPercentage).toBeCloseTo(100, 0);
    });

    it('should handle empty traces', () => {
      const graph = buildProcessGraph([]);

      expect(graph.nodes).toHaveLength(0);
      expect(graph.edges).toHaveLength(0);
      expect(graph.totalCases).toBe(0);
    });
  });

  describe('Mermaid Generator', () => {
    const sampleGraph: ProcessGraph = {
      processType: 'O2C',
      nodes: [
        { id: 'order', name: 'Order Created', frequency: 10, bottleneckSeverity: 'none' },
        { id: 'delivery', name: 'Delivery Created', frequency: 10, avgDuration: 24, bottleneckSeverity: 'medium' },
        { id: 'invoice', name: 'Invoice Created', frequency: 10, avgDuration: 2, bottleneckSeverity: 'low', isEnd: true },
      ],
      edges: [
        { from: 'order', to: 'delivery', frequency: 10, percentage: 50, isMainPath: true },
        { from: 'delivery', to: 'invoice', frequency: 10, percentage: 50, avgTime: 24, isMainPath: true },
      ],
      totalCases: 10,
      uniqueVariants: 1,
      stats: {
        avgCaseDuration: 48,
        medianCaseDuration: 48,
        totalActivities: 3,
        totalTransitions: 2,
        dominantVariantPercentage: 100,
      },
    };

    it('should generate Mermaid flowchart', () => {
      const result = generateMermaidDiagram(sampleGraph);

      expect(result.format).toBe('mermaid');
      expect(result.content).toContain('flowchart TB');
    });

    it('should include node definitions', () => {
      const result = generateMermaidDiagram(sampleGraph);

      expect(result.content).toContain('order');
      expect(result.content).toContain('delivery');
      expect(result.content).toContain('invoice');
    });

    it('should include edge definitions', () => {
      const result = generateMermaidDiagram(sampleGraph);

      expect(result.content).toContain('order');
      // Main path edges use ==> instead of -->
      expect(result.content).toContain('==>');
      expect(result.content).toContain('delivery');
    });

    it('should show frequency when enabled', () => {
      const options: VisualizationOptions = {
        format: 'mermaid',
        showFrequency: true,
      };

      const result = generateMermaidDiagram(sampleGraph, options);

      expect(result.content).toContain('(10)');
    });

    it('should show timing when enabled', () => {
      const options: VisualizationOptions = {
        format: 'mermaid',
        showTiming: true,
      };

      const result = generateMermaidDiagram(sampleGraph, options);

      expect(result.content).toMatch(/\d+[hmd]/); // Should contain timing like "24h" or "1d"
    });

    it('should include bottleneck styling', () => {
      const options: VisualizationOptions = {
        format: 'mermaid',
        highlightBottlenecks: true,
      };

      const result = generateMermaidDiagram(sampleGraph, options);

      expect(result.content).toContain('classDef');
      expect(result.content).toContain('none');
      expect(result.content).toContain('medium');
    });

    it('should use thick arrows for main path', () => {
      const result = generateMermaidDiagram(sampleGraph);

      expect(result.content).toContain('==>');
    });

    it('should include legend', () => {
      const result = generateMermaidDiagram(sampleGraph);

      expect(result.content).toContain('Legend');
    });

    it('should include metadata', () => {
      const result = generateMermaidDiagram(sampleGraph);

      expect(result.metadata.processType).toBe('O2C');
      expect(result.metadata.totalCases).toBe(10);
      expect(result.metadata.generatedAt).toBeDefined();
    });
  });

  describe('DOT Generator', () => {
    const sampleGraph: ProcessGraph = {
      processType: 'P2P',
      nodes: [
        { id: 'po', name: 'PO Created', frequency: 10, bottleneckSeverity: 'none', isStart: true },
        { id: 'gr', name: 'Goods Receipt', frequency: 10, avgDuration: 24, bottleneckSeverity: 'high' },
        { id: 'invoice', name: 'Invoice', frequency: 10, bottleneckSeverity: 'low', isEnd: true },
      ],
      edges: [
        { from: 'po', to: 'gr', frequency: 10, percentage: 50, isMainPath: true },
        { from: 'gr', to: 'invoice', frequency: 10, percentage: 50, avgTime: 48, isMainPath: true },
      ],
      totalCases: 10,
      uniqueVariants: 1,
      stats: {
        avgCaseDuration: 72,
        medianCaseDuration: 72,
        totalActivities: 3,
        totalTransitions: 2,
        dominantVariantPercentage: 100,
      },
    };

    it('should generate DOT digraph', () => {
      const result = generateDotDiagram(sampleGraph);

      expect(result.format).toBe('dot');
      expect(result.content).toContain('digraph ProcessMap');
    });

    it('should set graph direction', () => {
      const result = generateDotDiagram(sampleGraph);

      expect(result.content).toContain('rankdir=TB');
    });

    it('should include node definitions', () => {
      const result = generateDotDiagram(sampleGraph);

      expect(result.content).toContain('po');
      expect(result.content).toContain('gr');
      expect(result.content).toContain('invoice');
    });

    it('should include edge definitions with arrows', () => {
      const result = generateDotDiagram(sampleGraph);

      expect(result.content).toContain('->');
    });

    it('should color bottleneck nodes', () => {
      const options: VisualizationOptions = {
        format: 'dot',
        highlightBottlenecks: true,
      };

      const result = generateDotDiagram(sampleGraph, options);

      expect(result.content).toContain(BOTTLENECK_COLORS.high);
    });

    it('should use ellipse shape for start node', () => {
      const result = generateDotDiagram(sampleGraph);

      expect(result.content).toContain('shape=ellipse');
    });

    it('should use doubleoctagon shape for end node', () => {
      const result = generateDotDiagram(sampleGraph);

      expect(result.content).toContain('shape=doubleoctagon');
    });

    it('should include legend subgraph', () => {
      const options: VisualizationOptions = {
        format: 'dot',
        highlightBottlenecks: true,
      };

      const result = generateDotDiagram(sampleGraph, options);

      expect(result.content).toContain('subgraph cluster_legend');
    });

    it('should include statistics as comments', () => {
      const result = generateDotDiagram(sampleGraph);

      expect(result.content).toContain('// Total cases: 10');
    });
  });

  describe('Integration', () => {
    const sampleTraces: Trace[] = [
      {
        caseId: 'CASE-001',
        events: [
          { activity: 'start', timestamp: '2024-01-01T10:00:00' },
          { activity: 'process', timestamp: '2024-01-02T10:00:00' },
          { activity: 'end', timestamp: '2024-01-03T10:00:00' },
        ],
      },
    ];

    it('should visualize process with Mermaid format', () => {
      const options: VisualizationOptions = {
        format: 'mermaid',
      };

      const result = visualizeProcess(sampleTraces, options);

      expect(result.format).toBe('mermaid');
      expect(result.content).toContain('flowchart');
    });

    it('should visualize process with DOT format', () => {
      const options: VisualizationOptions = {
        format: 'dot',
      };

      const result = visualizeProcess(sampleTraces, options);

      expect(result.format).toBe('dot');
      expect(result.content).toContain('digraph');
    });

    it('should filter by edge frequency', () => {
      // 80 traces go to 'frequent', 20 go to 'rare'
      const manyTraces: Trace[] = Array.from({ length: 100 }, (_, i) => ({
        caseId: `CASE-${i}`,
        events: [
          { activity: 'common', timestamp: '2024-01-01T10:00:00' },
          { activity: i < 80 ? 'frequent' : 'rare', timestamp: '2024-01-02T10:00:00' },
        ],
      }));

      const options: VisualizationOptions = {
        format: 'mermaid',
        minEdgeFrequency: 0.3, // Only show edges with >30% frequency (rare is 20%)
      };

      const result = visualizeProcess(manyTraces, options);

      expect(result.content).toContain('frequent');
      expect(result.content).not.toContain('rare');
    });

    it('should show main path only when enabled', () => {
      const options: VisualizationOptions = {
        format: 'mermaid',
        mainPathOnly: true,
      };

      const result = visualizeProcess(sampleTraces, options);

      expect(result.metadata.edgesCount).toBeLessThanOrEqual(result.metadata.nodesCount);
    });
  });

  describe('Bottleneck Colors', () => {
    it('should have all severity levels defined', () => {
      expect(BOTTLENECK_COLORS.none).toBeDefined();
      expect(BOTTLENECK_COLORS.low).toBeDefined();
      expect(BOTTLENECK_COLORS.medium).toBeDefined();
      expect(BOTTLENECK_COLORS.high).toBeDefined();
      expect(BOTTLENECK_COLORS.critical).toBeDefined();
    });

    it('should use green for healthy', () => {
      expect(BOTTLENECK_COLORS.none).toMatch(/#[4-5][A-Fa-f0-9]{5}/); // Green-ish
    });

    it('should use red for critical', () => {
      expect(BOTTLENECK_COLORS.critical).toMatch(/#[Ff][0-9A-Fa-f]{5}/); // Red-ish
    });
  });
});
