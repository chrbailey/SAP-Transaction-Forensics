/**
 * Tests for visualize_process tool
 *
 * Tests process flow visualization generation for SAP Order-to-Cash documents.
 * Uses Jest with ESM support.
 */

import {
  VisualizeProcessSchema,
  visualizeProcessTool,
} from '../tools/visualize_process.js';

describe('VisualizeProcessSchema', () => {
  describe('input validation', () => {
    it('should accept valid input with all fields', () => {
      const input = {
        doc_numbers: ['0000012345', '0000012346'],
        format: 'mermaid' as const,
        include_timing: true,
        highlight_bottlenecks: true,
      };

      const result = VisualizeProcessSchema.parse(input);

      expect(result.doc_numbers).toEqual(['0000012345', '0000012346']);
      expect(result.format).toBe('mermaid');
      expect(result.include_timing).toBe(true);
      expect(result.highlight_bottlenecks).toBe(true);
    });

    it('should apply defaults for optional fields', () => {
      const input = {
        doc_numbers: ['0000012345'],
      };

      const result = VisualizeProcessSchema.parse(input);

      expect(result.format).toBe('mermaid');
      expect(result.include_timing).toBe(true);
      expect(result.highlight_bottlenecks).toBe(true);
    });

    it('should accept dot format', () => {
      const input = {
        doc_numbers: ['0000012345'],
        format: 'dot',
      };

      const result = VisualizeProcessSchema.parse(input);
      expect(result.format).toBe('dot');
    });

    it('should accept svg format', () => {
      const input = {
        doc_numbers: ['0000012345'],
        format: 'svg',
      };

      const result = VisualizeProcessSchema.parse(input);
      expect(result.format).toBe('svg');
    });

    it('should reject invalid format', () => {
      const input = {
        doc_numbers: ['0000012345'],
        format: 'png', // Invalid
      };

      expect(() => VisualizeProcessSchema.parse(input)).toThrow();
    });

    it('should accept empty doc_numbers array for P2P mode', () => {
      const input = {
        doc_numbers: [],
      };

      // Empty array is now allowed (for P2P mode)
      const result = VisualizeProcessSchema.parse(input);
      expect(result.doc_numbers).toEqual([]);
    });

    it('should accept missing doc_numbers for P2P mode', () => {
      const input = {
        format: 'mermaid',
      };

      // Missing doc_numbers is now allowed (for P2P mode)
      const result = VisualizeProcessSchema.parse(input);
      expect(result.doc_numbers).toBeUndefined();
    });

    it('should reject empty string in doc_numbers', () => {
      const input = {
        doc_numbers: ['0000012345', ''],
      };

      expect(() => VisualizeProcessSchema.parse(input)).toThrow();
    });

    it('should reject non-boolean include_timing', () => {
      const input = {
        doc_numbers: ['0000012345'],
        include_timing: 'yes',
      };

      expect(() => VisualizeProcessSchema.parse(input)).toThrow();
    });

    it('should accept multiple document numbers', () => {
      const input = {
        doc_numbers: ['0000012345', '0000012346', '0000012347'],
      };

      const result = VisualizeProcessSchema.parse(input);
      expect(result.doc_numbers?.length).toBe(3);
    });
  });
});

describe('visualizeProcessTool', () => {
  it('should have correct tool definition', () => {
    expect(visualizeProcessTool.name).toBe('visualize_process');
    expect(visualizeProcessTool.description).toContain('visualization');
    // doc_numbers is now optional for P2P mode
    expect(visualizeProcessTool.inputSchema.required).toEqual([]);
    expect(visualizeProcessTool.inputSchema.properties).toHaveProperty('format');
    expect(visualizeProcessTool.inputSchema.properties).toHaveProperty('include_timing');
    expect(visualizeProcessTool.inputSchema.properties).toHaveProperty('highlight_bottlenecks');
  });

  it('should have array type for doc_numbers property', () => {
    expect(visualizeProcessTool.inputSchema.properties.doc_numbers.type).toBe('array');
  });

  it('should have enum for format property', () => {
    expect(visualizeProcessTool.inputSchema.properties.format.enum).toContain('mermaid');
    expect(visualizeProcessTool.inputSchema.properties.format.enum).toContain('dot');
    expect(visualizeProcessTool.inputSchema.properties.format.enum).toContain('svg');
  });

  it('should have boolean type for include_timing property', () => {
    expect(visualizeProcessTool.inputSchema.properties.include_timing.type).toBe('boolean');
  });

  it('should have boolean type for highlight_bottlenecks property', () => {
    expect(visualizeProcessTool.inputSchema.properties.highlight_bottlenecks.type).toBe('boolean');
  });

  it('should describe bottleneck highlighting', () => {
    expect(visualizeProcessTool.description).toContain('bottleneck');
  });
});

describe('Mermaid Diagram Generation', () => {
  interface ProcessNode {
    id: string;
    label: string;
    type: string;
  }

  interface ProcessEdge {
    from: string;
    to: string;
    label?: string;
  }

  function generateMermaidDiagram(
    nodes: ProcessNode[],
    edges: ProcessEdge[],
    includeTimingLabels: boolean
  ): string {
    let diagram = 'flowchart LR\n';

    // Add node definitions
    for (const node of nodes) {
      diagram += `    ${node.id}["${node.label}"]\n`;
    }

    // Add edges
    for (const edge of edges) {
      if (includeTimingLabels && edge.label) {
        diagram += `    ${edge.from} -->|${edge.label}| ${edge.to}\n`;
      } else {
        diagram += `    ${edge.from} --> ${edge.to}\n`;
      }
    }

    return diagram;
  }

  it('should generate flowchart direction', () => {
    const diagram = generateMermaidDiagram([], [], false);
    expect(diagram).toContain('flowchart LR');
  });

  it('should generate node definitions', () => {
    const nodes: ProcessNode[] = [
      { id: 'order', label: 'Order Created', type: 'order' },
    ];
    const diagram = generateMermaidDiagram(nodes, [], false);
    expect(diagram).toContain('order["Order Created"]');
  });

  it('should generate edges without labels', () => {
    const nodes: ProcessNode[] = [
      { id: 'order', label: 'Order', type: 'order' },
      { id: 'delivery', label: 'Delivery', type: 'delivery' },
    ];
    const edges: ProcessEdge[] = [
      { from: 'order', to: 'delivery' },
    ];
    const diagram = generateMermaidDiagram(nodes, edges, false);
    expect(diagram).toContain('order --> delivery');
  });

  it('should generate edges with timing labels', () => {
    const nodes: ProcessNode[] = [
      { id: 'order', label: 'Order', type: 'order' },
      { id: 'delivery', label: 'Delivery', type: 'delivery' },
    ];
    const edges: ProcessEdge[] = [
      { from: 'order', to: 'delivery', label: '2d' },
    ];
    const diagram = generateMermaidDiagram(nodes, edges, true);
    expect(diagram).toContain('order -->|2d| delivery');
  });

  it('should not include timing labels when disabled', () => {
    const nodes: ProcessNode[] = [
      { id: 'order', label: 'Order', type: 'order' },
      { id: 'delivery', label: 'Delivery', type: 'delivery' },
    ];
    const edges: ProcessEdge[] = [
      { from: 'order', to: 'delivery', label: '2d' },
    ];
    const diagram = generateMermaidDiagram(nodes, edges, false);
    expect(diagram).not.toContain('|2d|');
    expect(diagram).toContain('order --> delivery');
  });
});

describe('DOT Diagram Generation', () => {
  interface ProcessNode {
    id: string;
    label: string;
    isBottleneck?: boolean;
  }

  interface ProcessEdge {
    from: string;
    to: string;
    label?: string;
  }

  function generateDOTDiagram(
    nodes: ProcessNode[],
    edges: ProcessEdge[],
    highlightBottlenecks: boolean
  ): string {
    let diagram = 'digraph O2CProcess {\n';
    diagram += '    rankdir=LR;\n';
    diagram += '    node [shape=box, style=filled];\n';

    // Add nodes
    for (const node of nodes) {
      const color = highlightBottlenecks && node.isBottleneck ? '#f8d7da' : '#d4edda';
      diagram += `    ${node.id} [label="${node.label}", fillcolor="${color}"];\n`;
    }

    // Add edges
    for (const edge of edges) {
      if (edge.label) {
        diagram += `    ${edge.from} -> ${edge.to} [label="${edge.label}"];\n`;
      } else {
        diagram += `    ${edge.from} -> ${edge.to};\n`;
      }
    }

    diagram += '}\n';
    return diagram;
  }

  it('should generate digraph declaration', () => {
    const diagram = generateDOTDiagram([], [], false);
    expect(diagram).toContain('digraph O2CProcess');
  });

  it('should set left-to-right direction', () => {
    const diagram = generateDOTDiagram([], [], false);
    expect(diagram).toContain('rankdir=LR');
  });

  it('should generate node with normal color', () => {
    const nodes: ProcessNode[] = [
      { id: 'order', label: 'Order', isBottleneck: false },
    ];
    const diagram = generateDOTDiagram(nodes, [], false);
    expect(diagram).toContain('#d4edda');
  });

  it('should highlight bottleneck nodes', () => {
    const nodes: ProcessNode[] = [
      { id: 'delivery', label: 'Delivery', isBottleneck: true },
    ];
    const diagram = generateDOTDiagram(nodes, [], true);
    expect(diagram).toContain('#f8d7da');
  });

  it('should not highlight bottlenecks when disabled', () => {
    const nodes: ProcessNode[] = [
      { id: 'delivery', label: 'Delivery', isBottleneck: true },
    ];
    const diagram = generateDOTDiagram(nodes, [], false);
    expect(diagram).toContain('#d4edda');
    expect(diagram).not.toContain('#f8d7da');
  });

  it('should generate edges with labels', () => {
    const edges: ProcessEdge[] = [
      { from: 'order', to: 'delivery', label: '24h' },
    ];
    const diagram = generateDOTDiagram([], edges, false);
    expect(diagram).toContain('order -> delivery [label="24h"]');
  });
});

describe('SVG Diagram Generation', () => {
  function generateBasicSVG(width: number, height: number): string {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"></svg>`;
  }

  function generateRectElement(
    x: number,
    y: number,
    width: number,
    height: number,
    fill: string
  ): string {
    return `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${fill}" rx="5"/>`;
  }

  function generateLineElement(
    x1: number,
    y1: number,
    x2: number,
    y2: number
  ): string {
    return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#666" stroke-width="2" marker-end="url(#arrowhead)"/>`;
  }

  it('should generate SVG with namespace', () => {
    const svg = generateBasicSVG(800, 400);
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
  });

  it('should generate SVG with dimensions', () => {
    const svg = generateBasicSVG(800, 400);
    expect(svg).toContain('width="800"');
    expect(svg).toContain('height="400"');
  });

  it('should generate rect elements', () => {
    const rect = generateRectElement(10, 20, 100, 50, '#d4edda');
    expect(rect).toContain('<rect');
    expect(rect).toContain('x="10"');
    expect(rect).toContain('y="20"');
    expect(rect).toContain('fill="#d4edda"');
  });

  it('should generate line elements', () => {
    const line = generateLineElement(100, 50, 200, 50);
    expect(line).toContain('<line');
    expect(line).toContain('x1="100"');
    expect(line).toContain('x2="200"');
    expect(line).toContain('marker-end="url(#arrowhead)"');
  });

  it('should include rounded corners on rectangles', () => {
    const rect = generateRectElement(10, 20, 100, 50, '#d4edda');
    expect(rect).toContain('rx="5"');
  });
});

describe('Time Duration Formatting', () => {
  function formatDuration(hours: number): string {
    if (hours < 1) {
      return `${Math.round(hours * 60)}m`;
    } else if (hours < 24) {
      return `${Math.round(hours)}h`;
    } else {
      const days = hours / 24;
      return `${Math.round(days * 10) / 10}d`;
    }
  }

  it('should format minutes for durations under 1 hour', () => {
    expect(formatDuration(0.5)).toBe('30m');
    expect(formatDuration(0.25)).toBe('15m');
  });

  it('should format hours for durations under 24 hours', () => {
    expect(formatDuration(1)).toBe('1h');
    expect(formatDuration(12)).toBe('12h');
    expect(formatDuration(23)).toBe('23h');
  });

  it('should format days for durations over 24 hours', () => {
    expect(formatDuration(24)).toBe('1d');
    expect(formatDuration(48)).toBe('2d');
    expect(formatDuration(36)).toBe('1.5d');
  });

  it('should round appropriately', () => {
    expect(formatDuration(0.1)).toBe('6m');
    expect(formatDuration(1.5)).toBe('2h');
    expect(formatDuration(30)).toBe('1.3d');
  });
});

describe('Bottleneck Detection', () => {
  interface ProcessStep {
    id: string;
    durationHours: number;
  }

  function detectBottlenecks(
    steps: ProcessStep[],
    thresholdMultiplier: number = 2
  ): string[] {
    if (steps.length < 2) return [];

    const avgDuration = steps.reduce((sum, s) => sum + s.durationHours, 0) / steps.length;
    const threshold = avgDuration * thresholdMultiplier;

    return steps
      .filter(s => s.durationHours > threshold)
      .map(s => s.id);
  }

  it('should detect steps significantly above average', () => {
    const steps: ProcessStep[] = [
      { id: 'order', durationHours: 2 },
      { id: 'delivery', durationHours: 48 },
      { id: 'invoice', durationHours: 2 },
    ];

    const bottlenecks = detectBottlenecks(steps);
    expect(bottlenecks).toContain('delivery');
  });

  it('should not detect normal steps as bottlenecks', () => {
    const steps: ProcessStep[] = [
      { id: 'order', durationHours: 2 },
      { id: 'delivery', durationHours: 3 },
      { id: 'invoice', durationHours: 2 },
    ];

    const bottlenecks = detectBottlenecks(steps);
    expect(bottlenecks).toHaveLength(0);
  });

  it('should handle single step', () => {
    const steps: ProcessStep[] = [
      { id: 'order', durationHours: 100 },
    ];

    const bottlenecks = detectBottlenecks(steps);
    expect(bottlenecks).toHaveLength(0);
  });

  it('should detect multiple bottlenecks', () => {
    const steps: ProcessStep[] = [
      { id: 'order', durationHours: 1 },
      { id: 'approval', durationHours: 72 },
      { id: 'delivery', durationHours: 48 },
      { id: 'invoice', durationHours: 1 },
    ];

    const bottlenecks = detectBottlenecks(steps);
    expect(bottlenecks.length).toBeGreaterThan(0);
  });

  it('should respect custom threshold multiplier', () => {
    const steps: ProcessStep[] = [
      { id: 'order', durationHours: 2 },
      { id: 'delivery', durationHours: 8 },
      { id: 'invoice', durationHours: 2 },
    ];

    const strictBottlenecks = detectBottlenecks(steps, 3);
    const looseBottlenecks = detectBottlenecks(steps, 1.5);

    expect(looseBottlenecks.length).toBeGreaterThanOrEqual(strictBottlenecks.length);
  });
});

describe('Visualization Statistics', () => {
  interface VisualizationStats {
    total_documents: number;
    total_steps: number;
    avg_cycle_time_hours: number;
    bottlenecks: string[];
  }

  function calculateStats(
    docCount: number,
    steps: number[],
    bottleneckThresholdMultiplier: number = 2
  ): VisualizationStats {
    const totalSteps = steps.length;
    const totalTime = steps.reduce((sum, s) => sum + s, 0);
    const avgCycleTime = totalSteps > 0 ? totalTime / docCount : 0;

    const avgStepTime = totalSteps > 0 ? totalTime / totalSteps : 0;
    const bottleneckThreshold = avgStepTime * bottleneckThresholdMultiplier;

    const bottlenecks = steps
      .map((duration, idx) => ({ idx, duration }))
      .filter(s => s.duration > bottleneckThreshold)
      .map(s => `step_${s.idx}`);

    return {
      total_documents: docCount,
      total_steps: totalSteps,
      avg_cycle_time_hours: Math.round(avgCycleTime * 100) / 100,
      bottlenecks,
    };
  }

  it('should calculate total documents', () => {
    const stats = calculateStats(5, [10, 20, 30]);
    expect(stats.total_documents).toBe(5);
  });

  it('should calculate total steps', () => {
    const stats = calculateStats(5, [10, 20, 30, 40]);
    expect(stats.total_steps).toBe(4);
  });

  it('should calculate average cycle time', () => {
    const stats = calculateStats(2, [10, 20, 30]);
    expect(stats.avg_cycle_time_hours).toBe(30); // (10+20+30) / 2
  });

  it('should identify bottlenecks', () => {
    const stats = calculateStats(1, [2, 2, 50, 2]);
    expect(stats.bottlenecks.length).toBeGreaterThan(0);
  });

  it('should handle empty steps', () => {
    const stats = calculateStats(1, []);
    expect(stats.total_steps).toBe(0);
    expect(stats.avg_cycle_time_hours).toBe(0);
    expect(stats.bottlenecks).toHaveLength(0);
  });
});
