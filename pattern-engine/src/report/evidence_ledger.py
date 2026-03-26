"""
Evidence Ledger Module for Transaction Forensics.

Tracks all evidence supporting pattern discoveries:
- Document keys
- Fields used for analysis
- Row counts
- Sampling information
- Reproducibility metadata
"""

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Dict, List, Optional, Set


@dataclass
class FieldUsage:
    """Tracks how a field was used in analysis."""
    field_name: str
    source_type: str  # 'order', 'delivery', 'invoice', 'doc_flow'
    usage_type: str  # 'text', 'date', 'timing', 'clustering'
    n_non_null: int
    n_total: int

    @property
    def coverage(self) -> float:
        """Calculate field coverage percentage."""
        return self.n_non_null / self.n_total if self.n_total > 0 else 0.0

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            'field_name': self.field_name,
            'source_type': self.source_type,
            'usage_type': self.usage_type,
            'n_non_null': self.n_non_null,
            'n_total': self.n_total,
            'coverage': self.coverage,
        }


@dataclass
class SamplingWarning:
    """Warning about data sampling or limitations."""
    warning_type: str  # 'small_sample', 'missing_data', 'skewed_distribution', etc.
    message: str
    severity: str  # 'info', 'warning', 'critical'
    affected_metric: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            'warning_type': self.warning_type,
            'message': self.message,
            'severity': self.severity,
            'affected_metric': self.affected_metric,
        }


@dataclass
class ReproducibilityInfo:
    """Information needed to reproduce the analysis."""
    random_seed: int
    clustering_algorithm: str
    embedding_model: str
    n_clusters: int
    min_cluster_size: int
    delay_threshold_days: int
    analysis_timestamp: str
    package_version: str = "0.1.0"
    parameters: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            'random_seed': self.random_seed,
            'clustering_algorithm': self.clustering_algorithm,
            'embedding_model': self.embedding_model,
            'n_clusters': self.n_clusters,
            'min_cluster_size': self.min_cluster_size,
            'delay_threshold_days': self.delay_threshold_days,
            'analysis_timestamp': self.analysis_timestamp,
            'package_version': self.package_version,
            'parameters': self.parameters,
        }

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> 'ReproducibilityInfo':
        """Create from dictionary."""
        return cls(**d)


@dataclass
class EvidenceLedger:
    """
    Complete evidence ledger for a pattern card.

    Tracks all documents, fields, and metadata supporting a pattern discovery.
    """
    doc_keys: List[str] = field(default_factory=list)
    field_usage: List[FieldUsage] = field(default_factory=list)
    row_counts: Dict[str, int] = field(default_factory=dict)
    sampling_warnings: List[SamplingWarning] = field(default_factory=list)
    reproducibility: Optional[ReproducibilityInfo] = None
    source_files: List[str] = field(default_factory=list)

    def add_doc_key(self, doc_key: str):
        """Add a document key to the evidence."""
        if doc_key not in self.doc_keys:
            self.doc_keys.append(doc_key)

    def add_doc_keys(self, doc_keys: List[str]):
        """Add multiple document keys."""
        for key in doc_keys:
            self.add_doc_key(key)

    def add_field_usage(
        self,
        field_name: str,
        source_type: str,
        usage_type: str,
        n_non_null: int,
        n_total: int
    ):
        """Record field usage in analysis."""
        self.field_usage.append(FieldUsage(
            field_name=field_name,
            source_type=source_type,
            usage_type=usage_type,
            n_non_null=n_non_null,
            n_total=n_total
        ))

    def add_sampling_warning(
        self,
        warning_type: str,
        message: str,
        severity: str = 'warning',
        affected_metric: Optional[str] = None
    ):
        """Add a sampling or data quality warning."""
        self.sampling_warnings.append(SamplingWarning(
            warning_type=warning_type,
            message=message,
            severity=severity,
            affected_metric=affected_metric
        ))

    def set_reproducibility(
        self,
        random_seed: int,
        clustering_algorithm: str,
        embedding_model: str,
        n_clusters: int,
        min_cluster_size: int,
        delay_threshold_days: int,
        **kwargs
    ):
        """Set reproducibility information."""
        self.reproducibility = ReproducibilityInfo(
            random_seed=random_seed,
            clustering_algorithm=clustering_algorithm,
            embedding_model=embedding_model,
            n_clusters=n_clusters,
            min_cluster_size=min_cluster_size,
            delay_threshold_days=delay_threshold_days,
            analysis_timestamp=datetime.utcnow().isoformat() + 'Z',
            parameters=kwargs
        )

    def set_row_counts(self, counts: Dict[str, int]):
        """Set row counts for different data sources."""
        self.row_counts.update(counts)

    @property
    def n_documents(self) -> int:
        """Total number of supporting documents."""
        return len(self.doc_keys)

    @property
    def has_warnings(self) -> bool:
        """Check if there are any warnings."""
        return len(self.sampling_warnings) > 0

    @property
    def critical_warnings(self) -> List[SamplingWarning]:
        """Get critical warnings only."""
        return [w for w in self.sampling_warnings if w.severity == 'critical']

    def get_fields_by_usage(self, usage_type: str) -> List[FieldUsage]:
        """Get all fields used for a specific purpose."""
        return [f for f in self.field_usage if f.usage_type == usage_type]

    def validate(self) -> List[str]:
        """
        Validate the evidence ledger for completeness.

        Returns:
            List of validation issues (empty if valid)
        """
        issues = []

        if not self.doc_keys:
            issues.append("No document keys recorded")

        if not self.reproducibility:
            issues.append("Missing reproducibility information")

        if not self.row_counts:
            issues.append("No row counts recorded")

        for field_usage in self.field_usage:
            if field_usage.coverage < 0.5:
                issues.append(
                    f"Low coverage ({field_usage.coverage:.0%}) for field {field_usage.field_name}"
                )

        return issues

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for serialization."""
        return {
            'doc_keys': self.doc_keys,
            'n_documents': self.n_documents,
            'field_usage': [f.to_dict() for f in self.field_usage],
            'row_counts': self.row_counts,
            'sampling_warnings': [w.to_dict() for w in self.sampling_warnings],
            'reproducibility': self.reproducibility.to_dict() if self.reproducibility else None,
            'source_files': self.source_files,
            'has_warnings': self.has_warnings,
            'validation_issues': self.validate(),
        }

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> 'EvidenceLedger':
        """Create from dictionary."""
        ledger = cls()
        ledger.doc_keys = d.get('doc_keys', [])
        ledger.field_usage = [
            FieldUsage(**f) for f in d.get('field_usage', [])
        ]
        ledger.row_counts = d.get('row_counts', {})
        ledger.sampling_warnings = [
            SamplingWarning(**w) for w in d.get('sampling_warnings', [])
        ]
        if d.get('reproducibility'):
            ledger.reproducibility = ReproducibilityInfo.from_dict(d['reproducibility'])
        ledger.source_files = d.get('source_files', [])
        return ledger

    def to_markdown(self) -> str:
        """Generate markdown representation of evidence."""
        lines = []

        lines.append("### Evidence Summary")
        lines.append("")
        lines.append(f"- **Documents**: {self.n_documents}")
        lines.append(f"- **Source Files**: {len(self.source_files)}")

        if self.row_counts:
            lines.append("")
            lines.append("**Row Counts:**")
            for source, count in self.row_counts.items():
                lines.append(f"- {source}: {count:,}")

        if self.sampling_warnings:
            lines.append("")
            lines.append("**Warnings:**")
            for warning in self.sampling_warnings:
                icon = "!" if warning.severity == 'critical' else "i"
                lines.append(f"- [{icon}] {warning.message}")

        if self.reproducibility:
            lines.append("")
            lines.append("**Reproducibility:**")
            lines.append(f"- Seed: {self.reproducibility.random_seed}")
            lines.append(f"- Algorithm: {self.reproducibility.clustering_algorithm}")
            lines.append(f"- Embedding: {self.reproducibility.embedding_model}")
            lines.append(f"- Timestamp: {self.reproducibility.analysis_timestamp}")

        return '\n'.join(lines)


def create_evidence_ledger(
    documents: List[Dict[str, Any]],
    cluster_docs: List[Dict[str, Any]],
    cluster_result: Dict[str, Any],
    correlations: Dict[str, Any]
) -> EvidenceLedger:
    """
    Create an evidence ledger from analysis results.

    Args:
        documents: All documents in the analysis
        cluster_docs: Documents in the specific cluster
        cluster_result: Clustering result
        correlations: Correlation analysis result

    Returns:
        Populated EvidenceLedger
    """
    ledger = EvidenceLedger()

    # Add document keys
    for doc in cluster_docs:
        doc_key = doc.get('doc_key')
        if doc_key:
            ledger.add_doc_key(doc_key)

    # Add source files
    if cluster_docs:
        source_files = cluster_docs[0].get('source_files', [])
        ledger.source_files = source_files

    # Set row counts
    ledger.set_row_counts({
        'total_documents': len(documents),
        'cluster_documents': len(cluster_docs),
    })

    # Track field usage
    _track_field_usage(ledger, cluster_docs)

    # Set reproducibility info
    params = cluster_result.get('parameters', {})
    corr_params = correlations.get('parameters', {})

    ledger.set_reproducibility(
        random_seed=params.get('random_seed', 42),
        clustering_algorithm=params.get('clustering_algorithm', 'kmeans'),
        embedding_model=params.get('embedding_model', 'tfidf'),
        n_clusters=params.get('n_clusters', 0),
        min_cluster_size=params.get('min_cluster_size', 5),
        delay_threshold_days=corr_params.get('delay_threshold_days', 7),
    )

    # Add sampling warnings
    _add_sampling_warnings(ledger, cluster_docs)

    return ledger


def _track_field_usage(ledger: EvidenceLedger, docs: List[Dict[str, Any]]):
    """Track which fields were used in analysis."""
    n_total = len(docs)

    # Text fields
    n_with_text = sum(1 for d in docs if d.get('consolidated_text'))
    ledger.add_field_usage('consolidated_text', 'unified', 'text', n_with_text, n_total)

    # Timing fields
    timing_fields = [
        'order_to_delivery_days',
        'delivery_to_invoice_days',
        'order_to_invoice_days',
        'delay_from_requested_days',
    ]

    for field in timing_fields:
        n_with_field = sum(
            1 for d in docs
            if d.get('timing', {}).get(field) is not None
        )
        ledger.add_field_usage(field, 'timing', 'timing', n_with_field, n_total)


def _add_sampling_warnings(ledger: EvidenceLedger, docs: List[Dict[str, Any]]):
    """Add warnings about data quality and sampling."""
    n_docs = len(docs)

    # Small sample warning
    if n_docs < 10:
        ledger.add_sampling_warning(
            'small_sample',
            f"Small sample size ({n_docs} documents). Results may not be reliable.",
            'warning'
        )
    elif n_docs < 30:
        ledger.add_sampling_warning(
            'small_sample',
            f"Moderate sample size ({n_docs} documents). Interpret with caution.",
            'info'
        )

    # Missing timing data
    n_with_timing = sum(
        1 for d in docs
        if d.get('timing', {}).get('order_to_delivery_days') is not None
    )
    if n_with_timing < n_docs * 0.5:
        ledger.add_sampling_warning(
            'missing_data',
            f"Only {n_with_timing}/{n_docs} documents have complete timing data.",
            'warning',
            'order_to_delivery_days'
        )

    # Missing text data
    n_with_text = sum(1 for d in docs if d.get('consolidated_text', '').strip())
    if n_with_text < n_docs * 0.8:
        ledger.add_sampling_warning(
            'missing_data',
            f"Only {n_with_text}/{n_docs} documents have text content.",
            'warning',
            'consolidated_text'
        )
