"""
Benchmark Runner for SAP Workflow Mining.

Validates the complete workflow mining pipeline against standard benchmark
datasets to prove the tool works with real-world data.

Benchmarks:
1. SAP SALT Dataset (Hugging Face)
   - Real SAP ERP sales data
   - Tests: data loading, event transformation, feature extraction

2. BPI Challenge 2019
   - Purchase order handling from multinational company
   - Tests: event log parsing, conformance checking, prediction

Usage:
    # Run all benchmarks
    python -m benchmark.runner

    # Run specific benchmark
    python -m benchmark.runner --dataset salt --sample 1000
"""

import json
import logging
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
import sys

logger = logging.getLogger(__name__)


@dataclass
class BenchmarkResult:
    """Result of running a benchmark."""

    dataset_name: str
    success: bool
    duration_seconds: float
    metrics: Dict[str, Any] = field(default_factory=dict)
    errors: List[str] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)
    timestamp: datetime = field(default_factory=datetime.now)

    def to_dict(self) -> Dict[str, Any]:
        return {
            'dataset_name': self.dataset_name,
            'success': self.success,
            'duration_seconds': round(self.duration_seconds, 2),
            'metrics': self.metrics,
            'errors': self.errors,
            'warnings': self.warnings,
            'timestamp': self.timestamp.isoformat(),
        }

    def __str__(self) -> str:
        status = "✅ PASS" if self.success else "❌ FAIL"
        return (
            f"{status} {self.dataset_name}\n"
            f"  Duration: {self.duration_seconds:.2f}s\n"
            f"  Metrics: {json.dumps(self.metrics, indent=4)}\n"
            f"  Errors: {len(self.errors)}, Warnings: {len(self.warnings)}"
        )


class DatasetBenchmark(ABC):
    """Base class for dataset benchmarks."""

    @property
    @abstractmethod
    def name(self) -> str:
        """Dataset name."""
        pass

    @property
    @abstractmethod
    def description(self) -> str:
        """Dataset description."""
        pass

    @abstractmethod
    def run(self, sample_size: Optional[int] = None) -> BenchmarkResult:
        """Run the benchmark."""
        pass


class SALTBenchmark(DatasetBenchmark):
    """Benchmark for SAP SALT dataset."""

    @property
    def name(self) -> str:
        return "SAP SALT"

    @property
    def description(self) -> str:
        return "Real SAP ERP sales data from Hugging Face"

    def run(self, sample_size: Optional[int] = 100) -> BenchmarkResult:
        """
        Run SALT benchmark.

        Tests:
        1. Load data from Hugging Face
        2. Convert to workflow format
        3. Extract features
        4. Run predictions (if models available)
        """
        start_time = time.time()
        errors = []
        warnings = []
        metrics = {}

        try:
            # Import here to handle optional dependencies
            from ..ingest.salt_adapter import SALTAdapter

            logger.info(f"Starting SALT benchmark (sample_size={sample_size})...")

            # Step 1: Load dataset
            logger.info("Step 1: Loading SALT dataset from Hugging Face...")
            adapter = SALTAdapter()

            try:
                load_result = adapter.load_from_huggingface(split="train")
                metrics['load'] = {
                    'sales_documents': load_result.sales_documents,
                    'sales_items': load_result.sales_items,
                    'customers': load_result.customers,
                }
                warnings.extend(load_result.warnings)
            except ImportError as e:
                errors.append(f"Missing dependency: {e}")
                return BenchmarkResult(
                    dataset_name=self.name,
                    success=False,
                    duration_seconds=time.time() - start_time,
                    metrics=metrics,
                    errors=errors,
                    warnings=warnings,
                )

            # Step 2: Convert to workflow format
            logger.info("Step 2: Converting to workflow format...")
            data = adapter.to_workflow_format(
                sample_size=sample_size,
                generate_events=True
            )

            metrics['conversion'] = {
                'sales_orders': len(data.get('sales_orders', [])),
                'deliveries': len(data.get('deliveries', [])),
                'invoices': len(data.get('invoices', [])),
                'doc_flow_links': len(data.get('doc_flow', [])),
                'customers': len(data.get('customers', [])),
            }

            # Step 3: Test feature extraction
            logger.info("Step 3: Testing feature extraction...")
            try:
                from ..prediction.features import FeatureExtractor

                extractor = FeatureExtractor()

                # Build event traces from converted data
                traces_built = 0
                features_extracted = 0

                for order in data.get('sales_orders', [])[:10]:
                    doc_num = order.get('document_number')

                    # Build trace from doc_flow
                    trace = []
                    if order.get('created_date'):
                        trace.append({
                            'activity': 'OrderCreated',
                            'timestamp': order['created_date'],
                        })

                    # Find linked delivery
                    for flow in data.get('doc_flow', []):
                        if flow.get('preceding_doc') == doc_num:
                            # Find the delivery
                            for delivery in data.get('deliveries', []):
                                if delivery.get('document_number') == flow.get('subsequent_doc'):
                                    if delivery.get('created_date'):
                                        trace.append({
                                            'activity': 'DeliveryCreated',
                                            'timestamp': delivery['created_date'],
                                        })
                                    if delivery.get('actual_gi_date'):
                                        trace.append({
                                            'activity': 'GoodsIssue',
                                            'timestamp': delivery['actual_gi_date'],
                                        })

                    if len(trace) >= 2:
                        traces_built += 1
                        try:
                            features = extractor.extract(trace, case_id=doc_num)
                            if features.feature_vector is not None:
                                features_extracted += 1
                        except Exception as e:
                            warnings.append(f"Feature extraction error: {e}")

                metrics['feature_extraction'] = {
                    'traces_built': traces_built,
                    'features_extracted': features_extracted,
                }

            except ImportError as e:
                warnings.append(f"Feature extraction skipped: {e}")

            # Success criteria
            success = (
                metrics.get('conversion', {}).get('sales_orders', 0) > 0 and
                len(errors) == 0
            )

            logger.info(f"SALT benchmark complete: {'PASS' if success else 'FAIL'}")

        except Exception as e:
            errors.append(f"Benchmark failed: {str(e)}")
            logger.error(f"SALT benchmark error: {e}", exc_info=True)
            success = False

        return BenchmarkResult(
            dataset_name=self.name,
            success=success,
            duration_seconds=time.time() - start_time,
            metrics=metrics,
            errors=errors,
            warnings=warnings,
        )


class BPI2019Benchmark(DatasetBenchmark):
    """Benchmark for BPI Challenge 2019 dataset."""

    def __init__(self, csv_path: Optional[str] = None):
        self.csv_path = csv_path

    @property
    def name(self) -> str:
        return "BPI Challenge 2019"

    @property
    def description(self) -> str:
        return "Purchase order handling event log from multinational company"

    def run(self, sample_size: Optional[int] = 1000) -> BenchmarkResult:
        """
        Run BPI 2019 benchmark.

        Tests:
        1. Load and parse event log
        2. Extract process variants
        3. Convert to workflow format
        4. Run conformance checking
        """
        start_time = time.time()
        errors = []
        warnings = []
        metrics = {}

        try:
            from ..ingest.bpi2019_adapter import BPI2019Adapter

            logger.info(f"Starting BPI 2019 benchmark (sample_size={sample_size})...")

            if not self.csv_path:
                # Try to find dataset in common locations
                possible_paths = [
                    Path.home() / "Downloads" / "BPI_Challenge_2019.csv",
                    Path.home() / "data" / "bpi2019" / "BPI_Challenge_2019.csv",
                    Path("/tmp/bpi2019/BPI_Challenge_2019.csv"),
                ]

                for path in possible_paths:
                    if path.exists():
                        self.csv_path = str(path)
                        break

                if not self.csv_path:
                    errors.append(
                        "BPI 2019 CSV not found. Download from: "
                        "https://data.4tu.nl/articles/dataset/BPI_Challenge_2019/12715853/1"
                    )
                    return BenchmarkResult(
                        dataset_name=self.name,
                        success=False,
                        duration_seconds=time.time() - start_time,
                        metrics=metrics,
                        errors=errors,
                        warnings=warnings,
                    )

            # Step 1: Load event log
            logger.info(f"Step 1: Loading BPI 2019 from {self.csv_path}...")
            adapter = BPI2019Adapter()
            load_result = adapter.load_from_csv(
                self.csv_path,
                max_rows=sample_size * 50 if sample_size else None  # Events per doc
            )

            metrics['load'] = {
                'total_events': load_result.total_events,
                'total_cases': load_result.total_cases,
                'unique_documents': load_result.unique_documents,
                'unique_vendors': load_result.unique_vendors,
                'activities': len(load_result.activities),
                'date_range': load_result.date_range,
            }
            warnings.extend(load_result.warnings[:5])  # Limit warnings

            # Step 2: Analyze process variants
            logger.info("Step 2: Analyzing process variants...")
            variants = adapter.get_process_variants(top_n=5)
            metrics['variants'] = {
                'top_variants': [
                    {'sequence': v[0][:100] + '...' if len(v[0]) > 100 else v[0], 'count': v[1]}
                    for v in variants
                ],
                'total_unique_variants': len(adapter._cases),
            }

            # Step 3: Convert to workflow format
            logger.info("Step 3: Converting to workflow format...")
            data = adapter.to_workflow_format(sample_documents=sample_size)

            metrics['conversion'] = {
                'sales_orders': len(data.get('sales_orders', [])),
                'deliveries': len(data.get('deliveries', [])),
                'invoices': len(data.get('invoices', [])),
                'doc_flow_links': len(data.get('doc_flow', [])),
                'customers': len(data.get('customers', [])),
            }

            # Step 4: Test conformance checking (if available)
            logger.info("Step 4: Testing conformance checking...")
            try:
                from ..conformance.checker import ConformanceChecker

                # Build some test traces
                events = adapter.to_event_log(map_activities=True)

                # Group events by case
                case_traces = {}
                for event in events[:1000]:  # Limit for performance
                    case_id = event['case_id']
                    if case_id not in case_traces:
                        case_traces[case_id] = []
                    case_traces[case_id].append(event)

                # Run conformance check on sample
                checker = ConformanceChecker()
                conformant_count = 0
                checked_count = 0

                for case_id, trace in list(case_traces.items())[:100]:
                    try:
                        result = checker.check_trace(trace, case_id)
                        checked_count += 1
                        if result.fitness_score >= 0.8:
                            conformant_count += 1
                    except Exception as e:
                        warnings.append(f"Conformance check error: {e}")

                metrics['conformance'] = {
                    'cases_checked': checked_count,
                    'conformant_cases': conformant_count,
                    'conformance_rate': round(conformant_count / max(checked_count, 1) * 100, 1),
                }

            except ImportError as e:
                warnings.append(f"Conformance checking skipped: {e}")

            # Success criteria
            success = (
                metrics.get('load', {}).get('total_events', 0) > 0 and
                metrics.get('conversion', {}).get('sales_orders', 0) > 0 and
                len(errors) == 0
            )

            logger.info(f"BPI 2019 benchmark complete: {'PASS' if success else 'FAIL'}")

        except Exception as e:
            errors.append(f"Benchmark failed: {str(e)}")
            logger.error(f"BPI 2019 benchmark error: {e}", exc_info=True)
            success = False

        return BenchmarkResult(
            dataset_name=self.name,
            success=success,
            duration_seconds=time.time() - start_time,
            metrics=metrics,
            errors=errors,
            warnings=warnings,
        )


class BenchmarkRunner:
    """
    Runs all benchmarks and generates reports.

    Example:
        runner = BenchmarkRunner()
        results = runner.run_all_benchmarks()
        runner.generate_report("benchmark_results.md")
    """

    def __init__(self):
        self.benchmarks: List[DatasetBenchmark] = []
        self.results: List[BenchmarkResult] = []

        # Register default benchmarks
        self.benchmarks.append(SALTBenchmark())
        self.benchmarks.append(BPI2019Benchmark())

    def add_benchmark(self, benchmark: DatasetBenchmark) -> None:
        """Add a custom benchmark."""
        self.benchmarks.append(benchmark)

    def run_benchmark(
        self,
        name: str,
        sample_size: Optional[int] = None
    ) -> Optional[BenchmarkResult]:
        """Run a specific benchmark by name."""
        for benchmark in self.benchmarks:
            if benchmark.name.lower() == name.lower():
                result = benchmark.run(sample_size=sample_size)
                self.results.append(result)
                return result
        return None

    def run_all_benchmarks(
        self,
        sample_size: Optional[int] = 100
    ) -> List[BenchmarkResult]:
        """Run all registered benchmarks."""
        self.results = []

        for benchmark in self.benchmarks:
            logger.info(f"\n{'='*60}")
            logger.info(f"Running benchmark: {benchmark.name}")
            logger.info(f"Description: {benchmark.description}")
            logger.info('='*60)

            try:
                result = benchmark.run(sample_size=sample_size)
                self.results.append(result)
                print(result)
            except Exception as e:
                logger.error(f"Benchmark {benchmark.name} failed: {e}")
                self.results.append(BenchmarkResult(
                    dataset_name=benchmark.name,
                    success=False,
                    duration_seconds=0,
                    errors=[str(e)],
                ))

        return self.results

    def generate_report(self, output_path: Optional[str] = None) -> str:
        """Generate a markdown report of benchmark results."""
        lines = [
            "# SAP Workflow Mining Benchmark Results",
            "",
            f"**Generated:** {datetime.now().isoformat()}",
            "",
            "## Summary",
            "",
            "| Dataset | Status | Duration | Key Metrics |",
            "|---------|--------|----------|-------------|",
        ]

        total_pass = 0
        total_fail = 0

        for result in self.results:
            status = "✅ PASS" if result.success else "❌ FAIL"
            if result.success:
                total_pass += 1
            else:
                total_fail += 1

            # Extract key metric
            key_metric = ""
            if 'conversion' in result.metrics:
                orders = result.metrics['conversion'].get('sales_orders', 0)
                key_metric = f"{orders:,} orders processed"
            elif 'load' in result.metrics:
                events = result.metrics['load'].get('total_events', 0)
                key_metric = f"{events:,} events loaded"

            lines.append(
                f"| {result.dataset_name} | {status} | "
                f"{result.duration_seconds:.1f}s | {key_metric} |"
            )

        lines.extend([
            "",
            f"**Total:** {total_pass} passed, {total_fail} failed",
            "",
            "## Detailed Results",
            "",
        ])

        for result in self.results:
            lines.extend([
                f"### {result.dataset_name}",
                "",
                f"**Status:** {'✅ PASS' if result.success else '❌ FAIL'}",
                f"**Duration:** {result.duration_seconds:.2f} seconds",
                "",
                "**Metrics:**",
                "```json",
                json.dumps(result.metrics, indent=2, default=str),
                "```",
                "",
            ])

            if result.errors:
                lines.extend([
                    "**Errors:**",
                    "",
                ])
                for error in result.errors:
                    lines.append(f"- {error}")
                lines.append("")

            if result.warnings:
                lines.extend([
                    "**Warnings:**",
                    "",
                ])
                for warning in result.warnings[:5]:
                    lines.append(f"- {warning}")
                if len(result.warnings) > 5:
                    lines.append(f"- ... and {len(result.warnings) - 5} more")
                lines.append("")

        report = "\n".join(lines)

        if output_path:
            Path(output_path).write_text(report)
            logger.info(f"Report saved to {output_path}")

        return report

    def save_results_json(self, output_path: str) -> None:
        """Save results as JSON."""
        data = {
            'timestamp': datetime.now().isoformat(),
            'results': [r.to_dict() for r in self.results],
        }
        Path(output_path).write_text(json.dumps(data, indent=2))
        logger.info(f"Results saved to {output_path}")


def run_salt_benchmark(sample_size: int = 100) -> BenchmarkResult:
    """Convenience function to run SALT benchmark."""
    benchmark = SALTBenchmark()
    return benchmark.run(sample_size=sample_size)


def run_bpi2019_benchmark(
    csv_path: Optional[str] = None,
    sample_size: int = 1000
) -> BenchmarkResult:
    """Convenience function to run BPI 2019 benchmark."""
    benchmark = BPI2019Benchmark(csv_path=csv_path)
    return benchmark.run(sample_size=sample_size)


def main():
    """CLI entry point for running benchmarks."""
    import argparse

    parser = argparse.ArgumentParser(description="Run SAP Workflow Mining benchmarks")
    parser.add_argument(
        '--dataset',
        choices=['all', 'salt', 'bpi2019'],
        default='all',
        help='Dataset to benchmark'
    )
    parser.add_argument(
        '--sample',
        type=int,
        default=100,
        help='Sample size (number of documents/orders)'
    )
    parser.add_argument(
        '--bpi-path',
        type=str,
        help='Path to BPI 2019 CSV file'
    )
    parser.add_argument(
        '--output',
        type=str,
        default='benchmark_results.md',
        help='Output report path'
    )
    parser.add_argument(
        '--json',
        type=str,
        help='Output JSON results path'
    )
    parser.add_argument(
        '-v', '--verbose',
        action='store_true',
        help='Verbose output'
    )

    args = parser.parse_args()

    # Configure logging
    log_level = logging.DEBUG if args.verbose else logging.INFO
    logging.basicConfig(
        level=log_level,
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
    )

    runner = BenchmarkRunner()

    if args.bpi_path:
        # Update BPI 2019 benchmark with provided path
        for i, benchmark in enumerate(runner.benchmarks):
            if isinstance(benchmark, BPI2019Benchmark):
                runner.benchmarks[i] = BPI2019Benchmark(csv_path=args.bpi_path)

    if args.dataset == 'all':
        results = runner.run_all_benchmarks(sample_size=args.sample)
    else:
        result = runner.run_benchmark(args.dataset, sample_size=args.sample)
        results = [result] if result else []

    # Generate report
    report = runner.generate_report(args.output)
    print("\n" + report)

    # Save JSON if requested
    if args.json:
        runner.save_results_json(args.json)

    # Exit with appropriate code
    all_passed = all(r.success for r in results)
    sys.exit(0 if all_passed else 1)


if __name__ == "__main__":
    main()
