"""
Benchmark Suite for SAP Workflow Mining.

This module provides tools to validate the workflow mining pipeline against
standard process mining benchmark datasets:

1. SAP SALT - Real SAP ERP sales data from Hugging Face
2. BPI Challenge 2019 - Purchase order handling event log
3. OCEL 2.0 datasets - Object-centric event logs

Example Usage:
    from benchmark import BenchmarkRunner

    runner = BenchmarkRunner()
    results = runner.run_all_benchmarks()
    runner.generate_report("benchmark_results.md")
"""

from .runner import (
    BenchmarkRunner,
    BenchmarkResult,
    DatasetBenchmark,
    run_salt_benchmark,
    run_bpi2019_benchmark,
)

__all__ = [
    'BenchmarkRunner',
    'BenchmarkResult',
    'DatasetBenchmark',
    'run_salt_benchmark',
    'run_bpi2019_benchmark',
]
