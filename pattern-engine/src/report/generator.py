"""
Report Generator Module for Transaction Forensics.

Generates output in various formats:
- JSON for programmatic use
- Markdown for human reading

Includes timestamp, version, and reproducibility information.
"""

import json
from datetime import datetime
from typing import Any, Dict, List, Optional

from .pattern_card import PatternCard
from .. import __version__


class ReportGenerator:
    """
    Generates reports from pattern cards in various formats.
    """

    def __init__(
        self,
        output_format: str = "json",
        random_seed: int = 42,
        include_metadata: bool = True,
    ):
        """
        Initialize the report generator.

        Args:
            output_format: Output format ('json' or 'markdown')
            random_seed: Random seed used in analysis
            include_metadata: Include generation metadata
        """
        self.output_format = output_format
        self.random_seed = random_seed
        self.include_metadata = include_metadata

    def generate(self, pattern_cards: List[PatternCard]) -> str:
        """
        Generate a report from pattern cards.

        Args:
            pattern_cards: List of PatternCard objects

        Returns:
            Formatted report string
        """
        if self.output_format == 'markdown':
            return self._generate_markdown(pattern_cards)
        else:
            return self._generate_json(pattern_cards)

    def _generate_json(self, pattern_cards: List[PatternCard]) -> str:
        """Generate JSON report."""
        report = {
            'metadata': self._generate_metadata(pattern_cards),
            'summary': self._generate_summary(pattern_cards),
            'pattern_cards': [card.to_dict() for card in pattern_cards],
        }

        return json.dumps(report, indent=2, default=str)

    def _generate_markdown(self, pattern_cards: List[PatternCard]) -> str:
        """Generate Markdown report."""
        lines = []

        # Title and metadata
        lines.append("# Transaction Forensics Pattern Report")
        lines.append("")
        lines.append(f"**Generated**: {datetime.utcnow().isoformat()}Z")
        lines.append(f"**Version**: {__version__}")
        lines.append(f"**Random Seed**: {self.random_seed}")
        lines.append("")

        # Summary
        lines.append("## Summary")
        lines.append("")
        summary = self._generate_summary(pattern_cards)
        lines.append(f"- **Total Patterns**: {summary['total_patterns']}")
        lines.append(f"- **Notable Patterns**: {summary['notable_patterns']}")
        lines.append(f"- **Total Documents**: {summary['total_documents']}")
        lines.append(f"- **Average Confidence**: {summary['average_confidence']:.0%}")
        lines.append("")

        # Notable patterns first
        notable = [c for c in pattern_cards if c.is_notable]
        regular = [c for c in pattern_cards if not c.is_notable]

        if notable:
            lines.append("## Notable Patterns")
            lines.append("")
            lines.append("These patterns show statistically significant effects on outcomes.")
            lines.append("")

            for card in notable:
                lines.append(card.to_markdown())
                lines.append("")
                lines.append("---")
                lines.append("")

        if regular:
            lines.append("## Other Patterns")
            lines.append("")

            for card in regular:
                lines.append(card.to_markdown())
                lines.append("")
                lines.append("---")
                lines.append("")

        # Appendix with reproducibility info
        lines.append("## Appendix: Reproducibility")
        lines.append("")
        lines.append("To reproduce this analysis:")
        lines.append("")
        lines.append("```bash")
        lines.append(f"python -m src.main --seed {self.random_seed} run \\")
        lines.append("    --input-dir ./data --output-dir ./output")
        lines.append("```")
        lines.append("")
        lines.append("### Parameters Used")
        lines.append("")

        if pattern_cards and pattern_cards[0].evidence.reproducibility:
            repro = pattern_cards[0].evidence.reproducibility
            lines.append(f"- Clustering Algorithm: {repro.clustering_algorithm}")
            lines.append(f"- Embedding Model: {repro.embedding_model}")
            lines.append(f"- Number of Clusters: {repro.n_clusters}")
            lines.append(f"- Minimum Cluster Size: {repro.min_cluster_size}")
            lines.append(f"- Delay Threshold: {repro.delay_threshold_days} days")

        return '\n'.join(lines)

    def _generate_metadata(self, pattern_cards: List[PatternCard]) -> Dict[str, Any]:
        """Generate report metadata."""
        return {
            'generated_at': datetime.utcnow().isoformat() + 'Z',
            'version': __version__,
            'random_seed': self.random_seed,
            'n_patterns': len(pattern_cards),
        }

    def _generate_summary(self, pattern_cards: List[PatternCard]) -> Dict[str, Any]:
        """Generate report summary."""
        notable = sum(1 for c in pattern_cards if c.is_notable)
        total_docs = sum(c.sample_size for c in pattern_cards)
        avg_confidence = (
            sum(c.confidence for c in pattern_cards) / len(pattern_cards)
            if pattern_cards else 0
        )

        # Count effects by type
        significant_effects = 0
        large_effects = 0

        for card in pattern_cards:
            for effect in card.effect_sizes.values():
                if effect.is_significant:
                    significant_effects += 1
                if effect.effect_interpretation in ('medium', 'large'):
                    large_effects += 1

        return {
            'total_patterns': len(pattern_cards),
            'notable_patterns': notable,
            'total_documents': total_docs,
            'average_confidence': avg_confidence,
            'significant_effects': significant_effects,
            'large_effects': large_effects,
        }


def generate_json_report(
    pattern_cards: List[PatternCard],
    random_seed: int = 42
) -> str:
    """Convenience function for JSON report generation."""
    generator = ReportGenerator(output_format='json', random_seed=random_seed)
    return generator.generate(pattern_cards)


def generate_markdown_report(
    pattern_cards: List[PatternCard],
    random_seed: int = 42
) -> str:
    """Convenience function for Markdown report generation."""
    generator = ReportGenerator(output_format='markdown', random_seed=random_seed)
    return generator.generate(pattern_cards)
