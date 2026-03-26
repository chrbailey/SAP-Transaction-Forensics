"""
Outcome Correlation Module for Transaction Forensics.

Correlates text clusters to business outcomes:
- Order-to-delivery lead time
- Probability of delay
- Invoice lag (delivery to invoice)
- Timing variance

Includes statistical significance testing and effect size calculations.
"""

import logging
import math
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
from scipy import stats

logger = logging.getLogger(__name__)


@dataclass
class EffectSize:
    """Represents an effect size with confidence interval."""
    metric: str
    cluster_value: float
    baseline_value: float
    difference: float
    effect_size: float  # Cohen's d or similar
    effect_interpretation: str  # "small", "medium", "large", "negligible"
    ci_lower: float
    ci_upper: float
    p_value: Optional[float]
    is_significant: bool
    n_cluster: int
    n_baseline: int

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            'metric': self.metric,
            'cluster_value': self.cluster_value,
            'baseline_value': self.baseline_value,
            'difference': self.difference,
            'effect_size': self.effect_size,
            'effect_interpretation': self.effect_interpretation,
            'ci_lower': self.ci_lower,
            'ci_upper': self.ci_upper,
            'p_value': self.p_value,
            'is_significant': self.is_significant,
            'n_cluster': self.n_cluster,
            'n_baseline': self.n_baseline,
        }

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> 'EffectSize':
        """Create from dictionary."""
        return cls(**d)


@dataclass
class ClusterCorrelation:
    """Correlation results for a single cluster."""
    cluster_id: int
    n_documents: int
    effect_sizes: Dict[str, EffectSize] = field(default_factory=dict)
    summary: str = ""
    is_notable: bool = False

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            'cluster_id': self.cluster_id,
            'n_documents': self.n_documents,
            'effect_sizes': {k: v.to_dict() for k, v in self.effect_sizes.items()},
            'summary': self.summary,
            'is_notable': self.is_notable,
        }


class OutcomeAnalyzer:
    """
    Analyzer for correlating text clusters to business outcomes.

    Calculates effect sizes, confidence intervals, and statistical
    significance for various timing metrics.
    """

    # Metrics to analyze
    # As per requirements:
    # - order_to_delivery_days: (actual_delivery_date - order_date)
    # - delivery_delay_days: (actual_delivery_date - requested_delivery_date)
    # - invoice_lag_days: (invoice_date - delivery_date)
    # - partial_delivery_rate: orders with multiple deliveries
    # - return_rate: orders with return documents
    METRICS = [
        'order_to_delivery_days',
        'delivery_delay_days',  # renamed from delay_from_requested_days
        'invoice_lag_days',     # renamed from delivery_to_invoice_days
        'order_to_invoice_days',
    ]

    # Rate-based metrics (calculated differently)
    RATE_METRICS = [
        'partial_delivery_rate',
        'return_rate',
    ]

    # Effect size thresholds (Cohen's d)
    EFFECT_THRESHOLDS = {
        'negligible': 0.2,
        'small': 0.5,
        'medium': 0.8,
        'large': float('inf'),
    }

    def __init__(
        self,
        delay_threshold_days: int = 7,
        confidence_level: float = 0.95,
        min_sample_size: int = 5,
    ):
        """
        Initialize the outcome analyzer.

        Args:
            delay_threshold_days: Days threshold for defining a delay
            confidence_level: Confidence level for intervals (default 0.95)
            min_sample_size: Minimum sample size for analysis
        """
        self.delay_threshold_days = delay_threshold_days
        self.confidence_level = confidence_level
        self.min_sample_size = min_sample_size
        self.alpha = 1 - confidence_level

    def analyze(
        self,
        documents: List[Dict[str, Any]],
        cluster_result: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        Analyze correlations between clusters and outcomes.

        Args:
            documents: List of document dictionaries with timing info
            cluster_result: Result from TextClusterer.fit_predict()

        Returns:
            Dictionary containing:
                - baseline: Baseline statistics for all documents
                - clusters: Per-cluster correlation results
                - summary: Overall summary
        """
        labels = cluster_result.get('labels', [])

        if len(documents) != len(labels):
            logger.error(f"Document count ({len(documents)}) doesn't match label count ({len(labels)})")
            return self._empty_result()

        # Calculate baseline statistics
        baseline = self._calculate_baseline(documents)

        if not baseline:
            logger.warning("Could not calculate baseline statistics")
            return self._empty_result()

        # Analyze each cluster
        cluster_correlations = {}
        unique_labels = set(l for l in labels if l >= 0)

        for cluster_id in unique_labels:
            cluster_docs = [
                doc for doc, label in zip(documents, labels)
                if label == cluster_id
            ]

            if len(cluster_docs) >= self.min_sample_size:
                correlation = self._analyze_cluster(
                    cluster_id=cluster_id,
                    cluster_docs=cluster_docs,
                    baseline=baseline
                )
                cluster_correlations[cluster_id] = correlation

        # Generate summary
        summary = self._generate_summary(baseline, cluster_correlations)

        return {
            'baseline': baseline,
            'clusters': {k: v.to_dict() for k, v in cluster_correlations.items()},
            'summary': summary,
            'parameters': {
                'delay_threshold_days': self.delay_threshold_days,
                'confidence_level': self.confidence_level,
                'min_sample_size': self.min_sample_size,
            },
            'n_documents': len(documents),
            'n_clusters_analyzed': len(cluster_correlations),
        }

    def _calculate_baseline(self, documents: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Calculate baseline statistics for all documents."""
        baseline = {}

        for metric in self.METRICS:
            values = self._extract_metric_values(documents, metric)

            if len(values) >= self.min_sample_size:
                baseline[metric] = {
                    'mean': float(np.mean(values)),
                    'std': float(np.std(values, ddof=1)) if len(values) > 1 else 0.0,
                    'median': float(np.median(values)),
                    'n': len(values),
                    'min': float(np.min(values)),
                    'max': float(np.max(values)),
                }

        # Calculate delay probability
        delay_values = self._extract_metric_values(documents, 'delivery_delay_days')
        if delay_values:
            delayed = sum(1 for v in delay_values if v > self.delay_threshold_days)
            baseline['delay_probability'] = {
                'value': delayed / len(delay_values),
                'n_delayed': delayed,
                'n_total': len(delay_values),
            }

        # Calculate partial_delivery_rate: orders with multiple deliveries
        # EDGE CASE FIX: Always include metric with explicit insufficient_data flag
        if documents:
            partial_count = sum(1 for doc in documents if doc.get('n_deliveries', 0) > 1)
            total_count = sum(1 for doc in documents if doc.get('n_deliveries', 0) >= 1)
            if total_count > 0:
                baseline['partial_delivery_rate'] = {
                    'value': partial_count / total_count,
                    'n_partial': partial_count,
                    'n_total': total_count,
                    'insufficient_data': False,
                }
            else:
                # Explicitly mark metric as having insufficient data rather than omitting
                baseline['partial_delivery_rate'] = {
                    'value': None,
                    'n_partial': 0,
                    'n_total': 0,
                    'insufficient_data': True,
                    'reason': 'No documents with delivery data',
                }
                logger.info("partial_delivery_rate: insufficient data (no deliveries)")

        # Calculate return_rate: orders with return documents
        # Check for return indicators in the data
        # EDGE CASE FIX: Always include metric for consistency
        if documents:
            return_count = sum(1 for doc in documents if self._has_return(doc))
            total_orders = len(documents)
            baseline['return_rate'] = {
                'value': return_count / total_orders if total_orders > 0 else None,
                'n_returns': return_count,
                'n_total': total_orders,
                'insufficient_data': total_orders == 0,
            }

        return baseline

    def _has_return(self, doc: Dict[str, Any]) -> bool:
        """Check if a document has return-related indicators."""
        # Check order data for return reasons
        order = doc.get('order', {})
        if order.get('reason_for_rejection') or order.get('return_reason'):
            return True

        # Check for return document flow
        # In SAP, returns are typically document category 'H' (returns) or 'K' (credit memo)
        doc_flow = doc.get('doc_flow', [])
        for flow in doc_flow:
            if flow.get('subsequent_category') in ('H', 'K', 'R'):
                return True

        # Check consolidated text for return keywords
        text = doc.get('consolidated_text', '').lower()
        return_keywords = ['return', 'rma', 'credit memo', 'refund', 'defective', 'damaged']
        if any(kw in text for kw in return_keywords):
            return True

        return False

    def _analyze_cluster(
        self,
        cluster_id: int,
        cluster_docs: List[Dict[str, Any]],
        baseline: Dict[str, Any]
    ) -> ClusterCorrelation:
        """Analyze a single cluster's correlation to outcomes."""
        effect_sizes = {}

        for metric in self.METRICS:
            if metric not in baseline:
                continue

            cluster_values = self._extract_metric_values(cluster_docs, metric)

            if len(cluster_values) < self.min_sample_size:
                continue

            effect = self._calculate_effect_size(
                metric=metric,
                cluster_values=cluster_values,
                baseline_mean=baseline[metric]['mean'],
                baseline_std=baseline[metric]['std'],
                baseline_n=baseline[metric]['n']
            )

            if effect:
                effect_sizes[metric] = effect

        # Calculate delay probability effect
        if 'delay_probability' in baseline:
            delay_values = self._extract_metric_values(cluster_docs, 'delivery_delay_days')
            if delay_values:
                delayed = sum(1 for v in delay_values if v > self.delay_threshold_days)
                cluster_delay_prob = delayed / len(delay_values)
                baseline_delay_prob = baseline['delay_probability']['value']

                effect = self._calculate_probability_effect(
                    metric='delay_probability',
                    cluster_prob=cluster_delay_prob,
                    cluster_n=len(delay_values),
                    baseline_prob=baseline_delay_prob,
                    baseline_n=baseline['delay_probability']['n_total']
                )

                if effect:
                    effect_sizes['delay_probability'] = effect

        # Calculate partial_delivery_rate effect
        if 'partial_delivery_rate' in baseline:
            partial_count = sum(1 for doc in cluster_docs if doc.get('n_deliveries', 0) > 1)
            total_count = sum(1 for doc in cluster_docs if doc.get('n_deliveries', 0) >= 1)
            if total_count > 0:
                cluster_partial_rate = partial_count / total_count
                baseline_partial_rate = baseline['partial_delivery_rate']['value']

                effect = self._calculate_probability_effect(
                    metric='partial_delivery_rate',
                    cluster_prob=cluster_partial_rate,
                    cluster_n=total_count,
                    baseline_prob=baseline_partial_rate,
                    baseline_n=baseline['partial_delivery_rate']['n_total']
                )

                if effect:
                    effect_sizes['partial_delivery_rate'] = effect

        # Calculate return_rate effect
        if 'return_rate' in baseline:
            return_count = sum(1 for doc in cluster_docs if self._has_return(doc))
            total_orders = len(cluster_docs)
            if total_orders > 0:
                cluster_return_rate = return_count / total_orders
                baseline_return_rate = baseline['return_rate']['value']

                effect = self._calculate_probability_effect(
                    metric='return_rate',
                    cluster_prob=cluster_return_rate,
                    cluster_n=total_orders,
                    baseline_prob=baseline_return_rate,
                    baseline_n=baseline['return_rate']['n_total']
                )

                if effect:
                    effect_sizes['return_rate'] = effect

        # Determine if cluster is notable
        is_notable = any(
            es.is_significant and es.effect_interpretation in ('medium', 'large')
            for es in effect_sizes.values()
        )

        # Generate summary
        summary = self._generate_cluster_summary(effect_sizes)

        return ClusterCorrelation(
            cluster_id=cluster_id,
            n_documents=len(cluster_docs),
            effect_sizes=effect_sizes,
            summary=summary,
            is_notable=is_notable
        )

    def _calculate_effect_size(
        self,
        metric: str,
        cluster_values: List[float],
        baseline_mean: float,
        baseline_std: float,
        baseline_n: int
    ) -> Optional[EffectSize]:
        """Calculate effect size for a continuous metric."""
        if len(cluster_values) < 2:
            return None

        cluster_mean = np.mean(cluster_values)
        cluster_std = np.std(cluster_values, ddof=1)
        cluster_n = len(cluster_values)

        difference = cluster_mean - baseline_mean

        # Cohen's d with pooled standard deviation
        if baseline_std == 0 and cluster_std == 0:
            cohens_d = 0.0
        else:
            # Pooled standard deviation
            pooled_std = math.sqrt(
                ((baseline_n - 1) * baseline_std**2 + (cluster_n - 1) * cluster_std**2) /
                (baseline_n + cluster_n - 2)
            ) if baseline_n + cluster_n > 2 else max(baseline_std, cluster_std)

            cohens_d = difference / pooled_std if pooled_std > 0 else 0.0

        # Interpret effect size
        abs_d = abs(cohens_d)
        if abs_d < self.EFFECT_THRESHOLDS['negligible']:
            interpretation = 'negligible'
        elif abs_d < self.EFFECT_THRESHOLDS['small']:
            interpretation = 'small'
        elif abs_d < self.EFFECT_THRESHOLDS['medium']:
            interpretation = 'medium'
        else:
            interpretation = 'large'

        # Calculate confidence interval for mean difference
        se = math.sqrt(cluster_std**2 / cluster_n + baseline_std**2 / baseline_n) if cluster_n > 0 and baseline_n > 0 else 0

        # t-value for confidence interval
        df = cluster_n + baseline_n - 2
        t_crit = stats.t.ppf(1 - self.alpha / 2, df) if df > 0 else 1.96

        ci_lower = difference - t_crit * se
        ci_upper = difference + t_crit * se

        # Two-sample t-test for significance
        try:
            t_stat, p_value = stats.ttest_ind_from_stats(
                mean1=cluster_mean, std1=cluster_std, nobs1=cluster_n,
                mean2=baseline_mean, std2=baseline_std, nobs2=baseline_n
            )
            is_significant = p_value < self.alpha
        except Exception:
            p_value = None
            is_significant = False

        return EffectSize(
            metric=metric,
            cluster_value=float(cluster_mean),
            baseline_value=float(baseline_mean),
            difference=float(difference),
            effect_size=float(cohens_d),
            effect_interpretation=interpretation,
            ci_lower=float(ci_lower),
            ci_upper=float(ci_upper),
            p_value=float(p_value) if p_value is not None else None,
            is_significant=is_significant,
            n_cluster=cluster_n,
            n_baseline=baseline_n
        )

    def _calculate_probability_effect(
        self,
        metric: str,
        cluster_prob: float,
        cluster_n: int,
        baseline_prob: float,
        baseline_n: int
    ) -> Optional[EffectSize]:
        """Calculate effect size for a probability/proportion metric."""
        difference = cluster_prob - baseline_prob

        # Cohen's h for proportions
        phi_cluster = 2 * math.asin(math.sqrt(cluster_prob))
        phi_baseline = 2 * math.asin(math.sqrt(baseline_prob))
        cohens_h = phi_cluster - phi_baseline

        # Interpret effect size
        abs_h = abs(cohens_h)
        if abs_h < 0.2:
            interpretation = 'negligible'
        elif abs_h < 0.5:
            interpretation = 'small'
        elif abs_h < 0.8:
            interpretation = 'medium'
        else:
            interpretation = 'large'

        # Confidence interval for difference in proportions
        se = math.sqrt(
            cluster_prob * (1 - cluster_prob) / cluster_n +
            baseline_prob * (1 - baseline_prob) / baseline_n
        ) if cluster_n > 0 and baseline_n > 0 else 0

        z_crit = stats.norm.ppf(1 - self.alpha / 2)
        ci_lower = difference - z_crit * se
        ci_upper = difference + z_crit * se

        # Two-proportion z-test
        try:
            pooled_prob = (cluster_prob * cluster_n + baseline_prob * baseline_n) / (cluster_n + baseline_n)
            se_pooled = math.sqrt(
                pooled_prob * (1 - pooled_prob) * (1/cluster_n + 1/baseline_n)
            ) if pooled_prob > 0 and pooled_prob < 1 else 0

            if se_pooled > 0:
                z_stat = difference / se_pooled
                p_value = 2 * (1 - stats.norm.cdf(abs(z_stat)))
                is_significant = p_value < self.alpha
            else:
                p_value = None
                is_significant = False
        except Exception:
            p_value = None
            is_significant = False

        return EffectSize(
            metric=metric,
            cluster_value=float(cluster_prob),
            baseline_value=float(baseline_prob),
            difference=float(difference),
            effect_size=float(cohens_h),
            effect_interpretation=interpretation,
            ci_lower=float(ci_lower),
            ci_upper=float(ci_upper),
            p_value=float(p_value) if p_value is not None else None,
            is_significant=is_significant,
            n_cluster=cluster_n,
            n_baseline=baseline_n
        )

    def _extract_metric_values(
        self,
        documents: List[Dict[str, Any]],
        metric: str
    ) -> List[float]:
        """Extract metric values from documents.

        Returns a list of valid float values, logging excluded values for transparency.
        """
        values = []
        excluded_count = 0
        nan_count = 0
        missing_count = 0

        for doc in documents:
            timing = doc.get('timing')
            if timing is None:
                missing_count += 1
                continue
            value = timing.get(metric)

            if value is None:
                missing_count += 1
                continue

            # Check for NaN BEFORE conversion to catch string "nan"
            if isinstance(value, str) and value.lower() in ('nan', 'none', 'null', ''):
                nan_count += 1
                continue

            try:
                float_value = float(value)
                if math.isnan(float_value) or math.isinf(float_value):
                    nan_count += 1
                    continue
                values.append(float_value)
            except (ValueError, TypeError):
                excluded_count += 1
                continue

        # Log exclusions for transparency (only if significant)
        total_excluded = excluded_count + nan_count + missing_count
        if total_excluded > 0 and total_excluded > len(documents) * 0.1:
            logger.info(
                f"Metric '{metric}': {len(values)} valid values, "
                f"excluded {missing_count} missing, {nan_count} NaN/inf, "
                f"{excluded_count} invalid from {len(documents)} documents"
            )

        return values

    def _generate_cluster_summary(self, effect_sizes: Dict[str, EffectSize]) -> str:
        """Generate a summary description for cluster effects."""
        notable_effects = []

        for metric, effect in effect_sizes.items():
            if effect.is_significant:
                direction = "higher" if effect.difference > 0 else "lower"
                metric_name = metric.replace('_', ' ')
                notable_effects.append(
                    f"{effect.effect_interpretation} {direction} {metric_name}"
                )

        if notable_effects:
            return "Shows " + ", ".join(notable_effects)
        else:
            return "No significant differences from baseline"

    def _generate_summary(
        self,
        baseline: Dict[str, Any],
        cluster_correlations: Dict[int, ClusterCorrelation]
    ) -> Dict[str, Any]:
        """Generate overall summary of correlations."""
        notable_clusters = [
            cid for cid, corr in cluster_correlations.items()
            if corr.is_notable
        ]

        return {
            'n_clusters_analyzed': len(cluster_correlations),
            'n_notable_clusters': len(notable_clusters),
            'notable_cluster_ids': notable_clusters,
            'baseline_metrics': list(baseline.keys()),
        }

    def _empty_result(self) -> Dict[str, Any]:
        """Return an empty result structure."""
        return {
            'baseline': {},
            'clusters': {},
            'summary': {
                'n_clusters_analyzed': 0,
                'n_notable_clusters': 0,
                'notable_cluster_ids': [],
                'baseline_metrics': [],
            },
            'parameters': {
                'delay_threshold_days': self.delay_threshold_days,
                'confidence_level': self.confidence_level,
                'min_sample_size': self.min_sample_size,
            },
            'n_documents': 0,
            'n_clusters_analyzed': 0,
        }


def calculate_cohens_d(
    group1_mean: float,
    group1_std: float,
    group1_n: int,
    group2_mean: float,
    group2_std: float,
    group2_n: int
) -> float:
    """
    Calculate Cohen's d effect size between two groups.

    Args:
        group1_mean: Mean of group 1
        group1_std: Standard deviation of group 1
        group1_n: Sample size of group 1
        group2_mean: Mean of group 2
        group2_std: Standard deviation of group 2
        group2_n: Sample size of group 2

    Returns:
        Cohen's d effect size
    """
    diff = group1_mean - group2_mean

    # Pooled standard deviation
    pooled_std = math.sqrt(
        ((group1_n - 1) * group1_std**2 + (group2_n - 1) * group2_std**2) /
        (group1_n + group2_n - 2)
    )

    if pooled_std == 0:
        return 0.0

    return diff / pooled_std
