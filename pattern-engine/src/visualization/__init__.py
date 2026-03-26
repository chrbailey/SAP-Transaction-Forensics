"""
Visualization Module for Transaction Forensics (Phase 4).

This module provides process flow visualization capabilities for SAP Order-to-Cash
workflows, including:
- Mermaid flowchart generation for Markdown-based documentation
- GraphViz DOT format generation for complex process graphs
- Bottleneck highlighting with color-coded performance indicators

The visualizations support:
- SAP O2C flow: Order -> Delivery -> Invoice
- Timing annotations on edges (average duration between steps)
- Bottleneck detection based on cycle time percentiles
- Multiple output formats: Mermaid markdown, DOT (GraphViz), and SVG

Example usage:
    from visualization import (
        MermaidGenerator,
        GraphVizGenerator,
        BottleneckAnalyzer,
        generate_process_diagram,
    )

    # Generate Mermaid diagram from event sequences
    generator = MermaidGenerator()
    mermaid_code = generator.generate(events, include_timing=True)

    # Generate GraphViz diagram with bottleneck highlighting
    bottleneck = BottleneckAnalyzer()
    analysis = bottleneck.analyze(events)
    gv_generator = GraphVizGenerator()
    dot_code = gv_generator.generate(events, bottleneck_analysis=analysis)

    # Or use convenience function
    diagram = generate_process_diagram(events, format="mermaid")
"""

from .mermaid import (
    MermaidGenerator,
    generate_mermaid_diagram,
)

from .graphviz import (
    GraphVizGenerator,
    generate_dot_diagram,
    generate_svg_diagram,
)

from .bottleneck import (
    BottleneckAnalyzer,
    BottleneckLevel,
    TransitionMetrics,
    BottleneckAnalysis,
    analyze_bottlenecks,
)


def generate_process_diagram(
    events: list,
    format: str = "mermaid",
    include_timing: bool = True,
    include_bottlenecks: bool = True,
    percentile_thresholds: tuple = (50, 85),
) -> str:
    """
    Convenience function to generate a process diagram in the specified format.

    Args:
        events: List of event dictionaries with 'type', 'timestamp', and 'case_id'
        format: Output format - 'mermaid', 'dot', or 'svg'
        include_timing: Include timing annotations on edges
        include_bottlenecks: Color-code edges based on bottleneck analysis
        percentile_thresholds: (medium_percentile, slow_percentile) for coloring

    Returns:
        Diagram in the specified format as a string
    """
    # Analyze bottlenecks if requested
    bottleneck_analysis = None
    if include_bottlenecks:
        analyzer = BottleneckAnalyzer(percentile_thresholds=percentile_thresholds)
        bottleneck_analysis = analyzer.analyze(events)

    if format == "mermaid":
        generator = MermaidGenerator()
        return generator.generate(
            events,
            include_timing=include_timing,
            bottleneck_analysis=bottleneck_analysis,
        )
    elif format == "dot":
        generator = GraphVizGenerator()
        return generator.generate(
            events,
            include_timing=include_timing,
            bottleneck_analysis=bottleneck_analysis,
        )
    elif format == "svg":
        generator = GraphVizGenerator()
        return generator.generate_svg(
            events,
            include_timing=include_timing,
            bottleneck_analysis=bottleneck_analysis,
        )
    else:
        raise ValueError(f"Unsupported format: {format}. Use 'mermaid', 'dot', or 'svg'.")


__all__ = [
    # Mermaid generation
    "MermaidGenerator",
    "generate_mermaid_diagram",
    # GraphViz generation
    "GraphVizGenerator",
    "generate_dot_diagram",
    "generate_svg_diagram",
    # Bottleneck analysis
    "BottleneckAnalyzer",
    "BottleneckLevel",
    "TransitionMetrics",
    "BottleneckAnalysis",
    "analyze_bottlenecks",
    # Convenience function
    "generate_process_diagram",
]
