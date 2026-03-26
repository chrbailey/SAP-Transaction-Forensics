"""
Correlation module for analyzing cluster-outcome relationships and
cross-system anomaly detection.
"""

try:
    from .outcome_analyzer import OutcomeAnalyzer, EffectSize
    _outcome_available = True
except ImportError:
    _outcome_available = False

from .cross_system import (
    parse_date,
    find_cross_system_anomalies,
    compute_cross_system_metrics,
)

__all__ = [
    'parse_date',
    'find_cross_system_anomalies',
    'compute_cross_system_metrics',
]

if _outcome_available:
    __all__ += ['OutcomeAnalyzer', 'EffectSize']
