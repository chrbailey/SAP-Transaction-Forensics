"""
Pattern Card Module for SAP Workflow Mining.

Generates evidence-backed pattern cards that describe discovered
text patterns and their correlation to business outcomes.
"""

import hashlib
import random
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

from .evidence_ledger import EvidenceLedger, create_evidence_ledger
from ..correlate.outcome_analyzer import EffectSize


@dataclass
class PatternCard:
    """
    A pattern card describing a discovered text pattern and its effects.

    Each card includes:
    - Identification and description
    - Confidence and sample size
    - Top phrases characterizing the pattern
    - Sample text snippets (redacted)
    - Effect sizes for various metrics
    - Caveats and limitations
    - Full evidence ledger
    """
    id: str
    title: str
    description: str
    confidence: float  # 0-1, based on statistical significance and effect size
    sample_size: int
    top_phrases: List[str]
    sample_snippets: List[str]  # redacted
    effect_sizes: Dict[str, EffectSize]
    caveats: List[str]
    evidence: EvidenceLedger
    cluster_id: int = -1
    created_at: str = ""
    is_notable: bool = False
    # Occurrence counts by category
    occurrence_by_sales_org: Dict[str, int] = field(default_factory=dict)
    occurrence_by_customer_industry: Dict[str, int] = field(default_factory=dict)

    def __post_init__(self):
        if not self.created_at:
            self.created_at = datetime.utcnow().isoformat() + 'Z'

    def to_dict(self) -> Dict[str, Any]:
        """
        Convert to dictionary for serialization.

        Output matches the required PatternCard structure:
        - id, title, description
        - top_phrases, sample_snippets (redacted)
        - occurrence: {count, by_sales_org, by_customer_industry}
        - effect: {metric, baseline, pattern_value, lift, p_value}
        - confidence: HIGH, MEDIUM, LOW
        - caveats
        - evidence: {doc_keys, fields_used, sample_size, total_population}
        """
        # Convert effect_sizes to the required effect format
        # EDGE CASE FIX: Handle division by zero explicitly with null instead of fake 1.0
        effects = []
        for metric, eff in self.effect_sizes.items():
            if eff.baseline_value == 0:
                # Baseline is zero - lift is undefined, not neutral
                if eff.cluster_value == 0:
                    lift = 1.0  # 0/0 is truly neutral
                    lift_undefined = False
                else:
                    lift = None  # Non-zero / zero is undefined (would be infinity)
                    lift_undefined = True
            else:
                lift = round(eff.cluster_value / eff.baseline_value, 3)
                lift_undefined = False

            effects.append({
                'metric': metric,
                'baseline': eff.baseline_value,
                'pattern_value': eff.cluster_value,
                'lift': lift,
                'lift_undefined': lift_undefined,  # Flag for downstream consumers
                'p_value': eff.p_value,
                'difference': eff.difference,
                'effect_size': eff.effect_size,
                'is_significant': eff.is_significant,
                'effect_interpretation': eff.effect_interpretation,
            })

        # Convert confidence float to categorical
        if self.confidence >= 0.7:
            confidence_cat = 'HIGH'
        elif self.confidence >= 0.4:
            confidence_cat = 'MEDIUM'
        else:
            confidence_cat = 'LOW'

        return {
            'id': self.id,
            'title': self.title,
            'description': self.description,
            'top_phrases': self.top_phrases,
            'sample_snippets': self.sample_snippets,
            'occurrence': {
                'count': self.sample_size,
                'by_sales_org': self._get_occurrence_by_field('sales_org'),
                'by_customer_industry': self._get_occurrence_by_field('customer_industry'),
            },
            'effect': effects[0] if effects else {},  # Primary effect
            'effects': effects,  # All effects
            'confidence': confidence_cat,
            'confidence_score': self.confidence,
            'caveats': self.caveats,
            'evidence': {
                'doc_keys': self.evidence.doc_keys,
                'fields_used': [f.field_name for f in self.evidence.field_usage],
                'sample_size': self.sample_size,
                'total_population': self.evidence.row_counts.get('total_documents', 0),
            },
            'cluster_id': self.cluster_id,
            'created_at': self.created_at,
            'is_notable': self.is_notable,
            # Keep full evidence for detailed analysis
            'full_evidence': self.evidence.to_dict(),
        }

    def _get_occurrence_by_field(self, field_name: str) -> Dict[str, int]:
        """Get occurrence counts by a specific field."""
        if field_name == 'sales_org':
            return self.occurrence_by_sales_org
        elif field_name == 'customer_industry':
            return self.occurrence_by_customer_industry
        return {}

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> 'PatternCard':
        """Create from dictionary."""
        effect_sizes = {
            k: EffectSize.from_dict(v)
            for k, v in d.get('effect_sizes', {}).items()
        }
        evidence = EvidenceLedger.from_dict(d.get('evidence', {}))

        return cls(
            id=d['id'],
            title=d['title'],
            description=d['description'],
            confidence=d['confidence'],
            sample_size=d['sample_size'],
            top_phrases=d['top_phrases'],
            sample_snippets=d['sample_snippets'],
            effect_sizes=effect_sizes,
            caveats=d['caveats'],
            evidence=evidence,
            cluster_id=d.get('cluster_id', -1),
            created_at=d.get('created_at', ''),
            is_notable=d.get('is_notable', False),
        )

    def to_markdown(self) -> str:
        """Generate markdown representation."""
        lines = []

        # Header
        lines.append(f"## {self.title}")
        lines.append("")
        lines.append(f"**ID**: {self.id}")
        lines.append(f"**Confidence**: {self.confidence:.0%}")
        lines.append(f"**Sample Size**: {self.sample_size} documents")
        lines.append("")

        # Description
        lines.append("### Description")
        lines.append(self.description)
        lines.append("")

        # Top Phrases
        lines.append("### Characteristic Phrases")
        for phrase in self.top_phrases[:5]:
            lines.append(f"- {phrase}")
        lines.append("")

        # Effect Sizes
        if self.effect_sizes:
            lines.append("### Effects")
            lines.append("")
            lines.append("| Metric | Cluster | Baseline | Difference | Effect |")
            lines.append("|--------|---------|----------|------------|--------|")

            for metric, effect in self.effect_sizes.items():
                metric_name = metric.replace('_', ' ').title()
                sig = "*" if effect.is_significant else ""
                lines.append(
                    f"| {metric_name} | {effect.cluster_value:.2f} | "
                    f"{effect.baseline_value:.2f} | {effect.difference:+.2f}{sig} | "
                    f"{effect.effect_interpretation} |"
                )
            lines.append("")
            lines.append("*Statistically significant (p < 0.05)")
            lines.append("")

        # Sample Snippets
        if self.sample_snippets:
            lines.append("### Sample Text (Redacted)")
            for i, snippet in enumerate(self.sample_snippets[:3], 1):
                lines.append(f"> {snippet[:200]}...")
            lines.append("")

        # Caveats
        lines.append("### Caveats")
        for caveat in self.caveats:
            lines.append(f"- {caveat}")
        lines.append("")

        # Evidence
        lines.append(self.evidence.to_markdown())

        return '\n'.join(lines)


class PatternCardGenerator:
    """
    Generates pattern cards from clustering and correlation results.
    """

    # Caveat templates
    CAVEAT_TEMPLATES = {
        'small_sample': "Based on only {n} documents; results may not generalize.",
        'no_significance': "No statistically significant effects detected.",
        'missing_timing': "Timing data incomplete for {pct:.0%} of documents.",
        'weak_effect': "Effect sizes are small; practical significance may be limited.",
        'observational': "Observational analysis only; correlation does not imply causation.",
        'text_based': "Patterns based on text similarity; may not capture all relevant factors.",
        'synthetic_data': "If using synthetic data, patterns may not reflect real-world behavior.",
    }

    def __init__(
        self,
        redaction_mode: str = "shareable",
        random_seed: int = 42,
        max_snippets: int = 5,
        max_phrases: int = 10,
    ):
        """
        Initialize the pattern card generator.

        Args:
            redaction_mode: Redaction mode for snippets
            random_seed: Random seed for reproducibility
            max_snippets: Maximum sample snippets per card
            max_phrases: Maximum top phrases per card
        """
        self.redaction_mode = redaction_mode
        self.random_seed = random_seed
        self.max_snippets = max_snippets
        self.max_phrases = max_phrases

        random.seed(random_seed)

    def generate_cards(
        self,
        documents: List[Dict[str, Any]],
        cluster_result: Dict[str, Any],
        correlations: Dict[str, Any]
    ) -> List[PatternCard]:
        """
        Generate pattern cards for all clusters.

        Args:
            documents: All documents with cluster assignments
            cluster_result: Result from TextClusterer
            correlations: Result from OutcomeAnalyzer

        Returns:
            List of PatternCard objects
        """
        cards = []
        labels = cluster_result.get('labels', [])
        top_phrases = cluster_result.get('top_phrases', {})
        cluster_correlations = correlations.get('clusters', {})

        unique_labels = set(l for l in labels if l >= 0)

        for cluster_id in sorted(unique_labels):
            # Get documents in this cluster
            cluster_docs = [
                doc for doc, label in zip(documents, labels)
                if label == cluster_id
            ]

            if not cluster_docs:
                continue

            # Get correlation data
            cluster_corr = cluster_correlations.get(str(cluster_id), {})

            # Generate the card
            card = self._generate_card(
                cluster_id=cluster_id,
                cluster_docs=cluster_docs,
                all_documents=documents,
                top_phrases=top_phrases.get(cluster_id, []),
                correlation=cluster_corr,
                cluster_result=cluster_result,
                correlations=correlations
            )

            cards.append(card)

        return cards

    def _generate_card(
        self,
        cluster_id: int,
        cluster_docs: List[Dict[str, Any]],
        all_documents: List[Dict[str, Any]],
        top_phrases: List[Tuple[str, float]],
        correlation: Dict[str, Any],
        cluster_result: Dict[str, Any],
        correlations: Dict[str, Any]
    ) -> PatternCard:
        """Generate a single pattern card."""

        # Generate unique ID
        card_id = self._generate_id(cluster_id, cluster_docs)

        # Extract top phrase strings
        phrase_strings = [phrase for phrase, _ in top_phrases[:self.max_phrases]]

        # Generate title from top phrases
        title = self._generate_title(phrase_strings, cluster_id)

        # Build effect sizes
        effect_sizes = self._build_effect_sizes(correlation)

        # Generate description
        description = self._generate_description(
            phrase_strings, effect_sizes, len(cluster_docs)
        )

        # Calculate confidence
        confidence = self._calculate_confidence(effect_sizes, len(cluster_docs))

        # Extract sample snippets
        snippets = self._extract_snippets(cluster_docs)

        # Generate caveats
        caveats = self._generate_caveats(
            n_docs=len(cluster_docs),
            effect_sizes=effect_sizes,
            cluster_docs=cluster_docs
        )

        # Build evidence ledger
        evidence = create_evidence_ledger(
            documents=all_documents,
            cluster_docs=cluster_docs,
            cluster_result=cluster_result,
            correlations=correlations
        )

        # Determine if notable
        is_notable = correlation.get('is_notable', False)

        # Calculate occurrence by sales_org and customer_industry
        occurrence_by_sales_org = self._count_by_field(cluster_docs, 'sales_org')
        occurrence_by_industry = self._count_by_field(cluster_docs, 'customer_industry')

        return PatternCard(
            id=card_id,
            title=title,
            description=description,
            confidence=confidence,
            sample_size=len(cluster_docs),
            top_phrases=phrase_strings,
            sample_snippets=snippets,
            effect_sizes=effect_sizes,
            caveats=caveats,
            evidence=evidence,
            cluster_id=cluster_id,
            is_notable=is_notable,
            occurrence_by_sales_org=occurrence_by_sales_org,
            occurrence_by_customer_industry=occurrence_by_industry,
        )

    def _count_by_field(self, docs: List[Dict], field_name: str) -> Dict[str, int]:
        """Count occurrences by a specific field value."""
        counts: Dict[str, int] = {}
        for doc in docs:
            value = doc.get(field_name, '')
            if value:
                counts[value] = counts.get(value, 0) + 1
        return counts

    def _generate_id(self, cluster_id: int, cluster_docs: List[Dict]) -> str:
        """Generate a unique, deterministic ID for the pattern card."""
        # Include cluster ID and first few doc keys for uniqueness
        doc_keys = sorted([d.get('doc_key', '') for d in cluster_docs[:5]])
        content = f"{cluster_id}:{':'.join(doc_keys)}"
        hash_bytes = hashlib.sha256(content.encode()).hexdigest()[:8]
        return f"PAT-{hash_bytes.upper()}"

    def _generate_title(self, phrases: List[str], cluster_id: int) -> str:
        """Generate a descriptive title from top phrases."""
        if not phrases:
            return f"Pattern {cluster_id}"

        # Use top 2-3 phrases for title
        title_phrases = phrases[:3]

        # Format as title case
        title = " / ".join(p.title() for p in title_phrases)

        # Truncate if too long
        if len(title) > 60:
            title = title[:57] + "..."

        return title

    def _generate_description(
        self,
        phrases: List[str],
        effect_sizes: Dict[str, EffectSize],
        n_docs: int
    ) -> str:
        """Generate a description of the pattern."""
        parts = []

        # Describe the pattern
        if phrases:
            phrase_list = ", ".join(f'"{p}"' for p in phrases[:3])
            parts.append(f"Documents in this cluster frequently contain {phrase_list}.")

        # Describe effects
        significant_effects = [
            (metric, effect) for metric, effect in effect_sizes.items()
            if effect.is_significant
        ]

        if significant_effects:
            for metric, effect in significant_effects[:2]:
                direction = "higher" if effect.difference > 0 else "lower"
                metric_name = metric.replace('_', ' ')
                parts.append(
                    f"These documents show significantly {direction} {metric_name} "
                    f"({effect.difference:+.1f} {effect.effect_interpretation} effect)."
                )
        else:
            parts.append("No statistically significant timing differences from baseline.")

        # Sample size
        parts.append(f"Based on analysis of {n_docs} documents.")

        return " ".join(parts)

    def _build_effect_sizes(self, correlation: Dict[str, Any]) -> Dict[str, EffectSize]:
        """Build EffectSize objects from correlation data."""
        effect_sizes = {}
        effect_data = correlation.get('effect_sizes', {})

        for metric, data in effect_data.items():
            if isinstance(data, dict):
                effect_sizes[metric] = EffectSize.from_dict(data)

        return effect_sizes

    def _calculate_confidence(
        self,
        effect_sizes: Dict[str, EffectSize],
        n_docs: int
    ) -> float:
        """
        Calculate overall confidence score (0-1).

        IMPORTANT: This is a HEURISTIC score, NOT a probability.

        This score reflects our confidence in the pattern based on:
        - Sample size (more samples = more confidence)
        - Number of statistically significant effects
        - Magnitude of effect sizes

        The score is bounded 0-1 for convenience but should NOT be interpreted
        as a probability or combined with actual probabilities in risk scoring.
        It's more like a "quality indicator" for the pattern.
        """
        # Base confidence on sample size
        # Rationale: 100+ docs is "fully confident" in sample size
        sample_confidence = min(1.0, n_docs / 100)

        # Adjust based on significant effects
        # Rationale: 4+ significant effects is "fully confident" in statistical evidence
        significant_count = sum(
            1 for effect in effect_sizes.values()
            if effect.is_significant
        )
        effect_confidence = min(1.0, significant_count / 4)

        # Adjust based on effect sizes
        # Rationale: 2+ medium/large effects is "fully confident" in practical significance
        large_effects = sum(
            1 for effect in effect_sizes.values()
            if effect.effect_interpretation in ('medium', 'large')
        )
        size_confidence = min(1.0, large_effects / 2)

        # Weighted average - this is a HEURISTIC combination
        # The 0.4/0.3/0.3 weights are arbitrary but reflect:
        # - Sample size is most important (replicability)
        # - Statistical and practical significance equally weighted
        confidence = (
            0.4 * sample_confidence +
            0.3 * effect_confidence +
            0.3 * size_confidence
        )

        return round(confidence, 2)

    def _extract_snippets(self, cluster_docs: List[Dict]) -> List[str]:
        """Extract sample text snippets from cluster documents."""
        snippets = []

        # Shuffle for variety but maintain reproducibility
        docs = cluster_docs.copy()
        random.shuffle(docs)

        for doc in docs:
            text = doc.get('consolidated_text', '') or doc.get('normalized_text', '')
            if text and len(text.strip()) > 50:
                # Take a meaningful excerpt
                snippet = text.strip()[:300]
                snippets.append(snippet)

                if len(snippets) >= self.max_snippets:
                    break

        return snippets

    def _generate_caveats(
        self,
        n_docs: int,
        effect_sizes: Dict[str, EffectSize],
        cluster_docs: List[Dict]
    ) -> List[str]:
        """Generate caveats and limitations for the pattern card."""
        caveats = []

        # Always include observational caveat
        caveats.append(self.CAVEAT_TEMPLATES['observational'])

        # Always include text-based caveat
        caveats.append(self.CAVEAT_TEMPLATES['text_based'])

        # Small sample warning
        if n_docs < 30:
            caveats.append(
                self.CAVEAT_TEMPLATES['small_sample'].format(n=n_docs)
            )

        # No significance warning
        has_significant = any(e.is_significant for e in effect_sizes.values())
        if not has_significant:
            caveats.append(self.CAVEAT_TEMPLATES['no_significance'])

        # Weak effect warning
        all_small = all(
            e.effect_interpretation in ('negligible', 'small')
            for e in effect_sizes.values()
        )
        if all_small and effect_sizes:
            caveats.append(self.CAVEAT_TEMPLATES['weak_effect'])

        # Missing timing data
        n_with_timing = sum(
            1 for d in cluster_docs
            if d.get('timing', {}).get('order_to_delivery_days') is not None
        )
        if n_with_timing < n_docs * 0.8:
            pct_missing = 1 - (n_with_timing / n_docs)
            caveats.append(
                self.CAVEAT_TEMPLATES['missing_timing'].format(pct=pct_missing)
            )

        return caveats


def generate_pattern_cards(
    documents: List[Dict[str, Any]],
    cluster_result: Dict[str, Any],
    correlations: Dict[str, Any],
    random_seed: int = 42
) -> List[PatternCard]:
    """
    Convenience function to generate pattern cards.

    Args:
        documents: Documents with cluster assignments
        cluster_result: Clustering results
        correlations: Correlation analysis results
        random_seed: Random seed

    Returns:
        List of PatternCard objects
    """
    generator = PatternCardGenerator(random_seed=random_seed)
    return generator.generate_cards(documents, cluster_result, correlations)
