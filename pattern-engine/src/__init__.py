"""
Transaction Forensics Pattern Engine

This engine ingests MCP tool outputs, discovers text patterns,
correlates them to outcomes, and generates evidence-backed pattern cards.
"""

__version__ = "0.1.1"
__author__ = "Transaction Forensics Team"

from pathlib import Path

# Package root directory
PACKAGE_ROOT = Path(__file__).parent

# Default configuration
DEFAULT_CONFIG = {
    "random_seed": 42,
    "redaction_mode": "shareable",  # "raw_local" or "shareable"
    "min_cluster_size": 5,
    "delay_threshold_days": 7,
    "embedding_model": "tfidf",  # "tfidf" or "sentence-transformers"
}
