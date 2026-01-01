"""
Main CLI entry point for the SAP Workflow Mining Pattern Engine.

Usage:
    python -m pattern_engine ingest --input-dir ./data
    python -m pattern_engine analyze --output-dir ./output
    python -m pattern_engine report --format json|markdown
"""

import click
import json
import sys
from pathlib import Path
from typing import Any, Optional

import numpy as np

from . import DEFAULT_CONFIG, __version__
from .ingest.loader import DataLoader
from .ingest.csv_loader import CSVLoader, load_csv_directory
from .redaction.redactor import Redactor
from .normalize.text_processor import TextProcessor
from .cluster.text_clusterer import TextClusterer
from .correlate.outcome_analyzer import OutcomeAnalyzer
from .report.generator import ReportGenerator


def convert_for_json(obj: Any) -> Any:
    """Convert objects to JSON-serializable types, including numpy types."""
    if isinstance(obj, dict):
        return {str(k): convert_for_json(v) for k, v in obj.items()}
    elif isinstance(obj, (list, tuple)):
        return [convert_for_json(item) for item in obj]
    elif isinstance(obj, (np.integer,)):
        return int(obj)
    elif isinstance(obj, (np.floating,)):
        return float(obj)
    elif isinstance(obj, np.ndarray):
        return obj.tolist()
    elif isinstance(obj, np.bool_):
        return bool(obj)
    else:
        return obj


# Store pipeline state between commands
class PipelineContext:
    """Holds state between CLI commands."""

    def __init__(self):
        self.config = DEFAULT_CONFIG.copy()
        self.documents = None
        self.processed_documents = None
        self.clusters = None
        self.correlations = None
        self.pattern_cards = None
        self.data_dir = None
        self.output_dir = None


pass_context = click.make_pass_decorator(PipelineContext, ensure=True)


@click.group()
@click.version_option(version=__version__)
@click.option('--seed', default=42, help='Random seed for reproducibility')
@click.option('--redaction-mode', type=click.Choice(['raw_local', 'shareable']),
              default='shareable', help='PII redaction mode')
@click.pass_context
def cli(ctx, seed: int, redaction_mode: str):
    """SAP Workflow Mining Pattern Engine

    Discovers text patterns in SAP workflow data and correlates them
    to business outcomes like delivery delays and invoice lag.
    """
    ctx.ensure_object(PipelineContext)
    ctx.obj.config['random_seed'] = seed
    ctx.obj.config['redaction_mode'] = redaction_mode


@cli.command()
@click.option('--input-dir', '-i', required=True, type=click.Path(exists=True),
              help='Directory containing input JSON files (or CSV files in csv-mode)')
@click.option('--output', '-o', type=click.Path(), default=None,
              help='Output file for ingested data (optional)')
@click.option('--csv-mode', is_flag=True, default=False,
              help='Load data from SAP CSV exports (SE16N format) instead of JSON')
@pass_context
def ingest(ctx, input_dir: str, output: Optional[str], csv_mode: bool):
    """Ingest MCP tool outputs or synthetic data.

    In JSON mode (default):
    Loads sales_orders.json, deliveries.json, invoices.json, and doc_flow.json,
    then builds unified document records with consolidated text.

    In CSV mode (--csv-mode):
    Loads VBAK.csv, VBAP.csv, and optionally texts.csv and VBFA.csv,
    then builds unified document records. Useful for SE16N table exports.
    """
    input_path = Path(input_dir)
    ctx.data_dir = input_path

    if csv_mode:
        click.echo(f"Loading CSV data from {input_path}...")
        try:
            documents = load_csv_directory(input_path, random_seed=ctx.config['random_seed'])
        except ValueError as e:
            click.echo(f"Error loading CSV files: {e}", err=True)
            sys.exit(1)
    else:
        click.echo(f"Loading JSON data from {input_path}...")
        loader = DataLoader()
        documents = loader.load_all(input_path)

    if not documents:
        click.echo("Error: No documents loaded. Check input directory.", err=True)
        sys.exit(1)

    click.echo(f"Loaded {len(documents)} unified document records")

    # Apply redaction based on mode
    redactor = Redactor(mode=ctx.config['redaction_mode'])
    redacted_documents = []
    for doc in documents:
        redacted_documents.append(redactor.redact_document(doc))

    ctx.documents = redacted_documents
    click.echo(f"Applied {ctx.config['redaction_mode']} redaction mode")

    if output:
        output_path = Path(output)
        with open(output_path, 'w') as f:
            json.dump(redacted_documents, f, indent=2, default=str)
        click.echo(f"Saved ingested data to {output_path}")

    # Save to context for pipeline
    _save_pipeline_state(ctx, 'documents', redacted_documents)

    click.echo("Ingestion complete.")


@cli.command()
@click.option('--input-dir', '-i', type=click.Path(exists=True), default=None,
              help='Directory containing input JSON files (if not already ingested)')
@click.option('--output-dir', '-o', required=True, type=click.Path(),
              help='Directory for analysis outputs')
@click.option('--min-cluster-size', default=5, type=int,
              help='Minimum documents per cluster')
@click.option('--delay-threshold', default=7, type=int,
              help='Days threshold for delay detection')
@click.option('--embedding-model', type=click.Choice(['tfidf', 'sentence-transformers']),
              default='tfidf', help='Text embedding model to use')
@pass_context
def analyze(ctx, input_dir: Optional[str], output_dir: str,
            min_cluster_size: int, delay_threshold: int, embedding_model: str):
    """Run pattern discovery and outcome correlation analysis.

    Performs text normalization, clustering, and correlates patterns
    to business outcomes like delivery delays and invoice lag.
    """
    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)
    ctx.output_dir = output_path

    # Load documents if not already in context
    documents = _load_pipeline_state(ctx, 'documents')

    if documents is None:
        if input_dir is None:
            click.echo("Error: No ingested data found. Run 'ingest' first or provide --input-dir", err=True)
            sys.exit(1)

        # Run ingestion inline
        loader = DataLoader()
        documents = loader.load_all(Path(input_dir))
        redactor = Redactor(mode=ctx.config['redaction_mode'])
        documents = [redactor.redact_document(doc) for doc in documents]

    click.echo(f"Analyzing {len(documents)} documents...")

    # Text normalization
    click.echo("Normalizing text...")
    processor = TextProcessor()
    processed_docs = []
    for doc in documents:
        processed_doc = doc.copy()
        processed_doc['normalized_text'] = processor.process(doc.get('consolidated_text', ''))
        processed_docs.append(processed_doc)

    # Clustering
    click.echo(f"Clustering with {embedding_model}...")
    clusterer = TextClusterer(
        embedding_model=embedding_model,
        min_cluster_size=min_cluster_size,
        random_seed=ctx.config['random_seed']
    )

    texts = [doc.get('normalized_text', '') for doc in processed_docs]
    cluster_result = clusterer.fit_predict(texts)

    # Assign cluster labels to documents
    for doc, label in zip(processed_docs, cluster_result['labels']):
        doc['cluster_id'] = label

    click.echo(f"Found {cluster_result['n_clusters']} clusters")

    # Outcome correlation
    click.echo("Analyzing outcome correlations...")
    analyzer = OutcomeAnalyzer(delay_threshold_days=delay_threshold)
    correlations = analyzer.analyze(processed_docs, cluster_result)

    # Generate pattern cards
    click.echo("Generating pattern cards...")
    from .report.pattern_card import PatternCardGenerator

    card_generator = PatternCardGenerator(
        redaction_mode=ctx.config['redaction_mode'],
        random_seed=ctx.config['random_seed']
    )
    pattern_cards = card_generator.generate_cards(
        documents=processed_docs,
        cluster_result=cluster_result,
        correlations=correlations
    )

    click.echo(f"Generated {len(pattern_cards)} pattern cards")

    # Save analysis results
    ctx.processed_documents = processed_docs
    ctx.clusters = cluster_result
    ctx.correlations = correlations
    ctx.pattern_cards = pattern_cards

    _save_pipeline_state(ctx, 'processed_documents', processed_docs)
    _save_pipeline_state(ctx, 'clusters', cluster_result)
    _save_pipeline_state(ctx, 'correlations', correlations)
    _save_pipeline_state(ctx, 'pattern_cards', [card.to_dict() for card in pattern_cards])

    # Save intermediate outputs
    with open(output_path / 'clusters.json', 'w') as f:
        json.dump(cluster_result, f, indent=2, default=str)

    with open(output_path / 'correlations.json', 'w') as f:
        json.dump(correlations, f, indent=2, default=str)

    click.echo(f"Analysis complete. Results saved to {output_path}")


@cli.command()
@click.option('--format', '-f', 'output_format', type=click.Choice(['json', 'markdown']),
              default='json', help='Output format')
@click.option('--output-dir', '-o', type=click.Path(), default='./output',
              help='Directory for report outputs')
@click.option('--input-dir', '-i', type=click.Path(exists=True), default=None,
              help='Directory containing input JSON files (runs full pipeline if needed)')
@pass_context
def report(ctx, output_format: str, output_dir: str, input_dir: Optional[str]):
    """Generate pattern card reports.

    Outputs pattern cards in JSON or Markdown format with full
    evidence tracking and reproducibility information.
    """
    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)

    # Try to load pattern cards from context
    pattern_cards_data = _load_pipeline_state(ctx, 'pattern_cards')

    if pattern_cards_data is None:
        if input_dir is None:
            click.echo("Error: No analysis data found. Run 'analyze' first or provide --input-dir", err=True)
            sys.exit(1)

        # Run full pipeline
        click.echo("Running full pipeline...")

        # Ingest
        loader = DataLoader()
        documents = loader.load_all(Path(input_dir))
        redactor = Redactor(mode=ctx.config['redaction_mode'])
        documents = [redactor.redact_document(doc) for doc in documents]

        # Process
        processor = TextProcessor()
        processed_docs = []
        for doc in documents:
            processed_doc = doc.copy()
            processed_doc['normalized_text'] = processor.process(doc.get('consolidated_text', ''))
            processed_docs.append(processed_doc)

        # Cluster
        clusterer = TextClusterer(
            embedding_model='tfidf',
            min_cluster_size=5,
            random_seed=ctx.config['random_seed']
        )
        texts = [doc.get('normalized_text', '') for doc in processed_docs]
        cluster_result = clusterer.fit_predict(texts)

        for doc, label in zip(processed_docs, cluster_result['labels']):
            doc['cluster_id'] = label

        # Correlate
        analyzer = OutcomeAnalyzer(delay_threshold_days=7)
        correlations = analyzer.analyze(processed_docs, cluster_result)

        # Generate cards
        from .report.pattern_card import PatternCardGenerator
        card_generator = PatternCardGenerator(
            redaction_mode=ctx.config['redaction_mode'],
            random_seed=ctx.config['random_seed']
        )
        pattern_cards = card_generator.generate_cards(
            documents=processed_docs,
            cluster_result=cluster_result,
            correlations=correlations
        )
    else:
        # Reconstruct pattern cards from saved data
        from .report.pattern_card import PatternCard
        pattern_cards = [PatternCard.from_dict(d) for d in pattern_cards_data]

    # Generate report
    click.echo(f"Generating {output_format} report...")

    generator = ReportGenerator(
        output_format=output_format,
        random_seed=ctx.config['random_seed']
    )

    report_content = generator.generate(pattern_cards)

    # Determine output filename
    if output_format == 'json':
        output_file = output_path / 'pattern_cards.json'
    else:
        output_file = output_path / 'pattern_cards.md'

    with open(output_file, 'w') as f:
        f.write(report_content)

    click.echo(f"Report saved to {output_file}")
    click.echo(f"Generated {len(pattern_cards)} pattern cards")


@cli.command()
@click.option('--input-dir', '-i', '--input', required=True, type=click.Path(exists=True),
              help='Directory containing input JSON files (or CSV files in csv-mode)')
@click.option('--output-dir', '-o', '--output', required=True, type=click.Path(),
              help='Directory for all outputs')
@click.option('--format', '-f', 'output_format', type=click.Choice(['json', 'markdown', 'both']),
              default='both', help='Output format for reports')
@click.option('--mode', '-m', type=click.Choice(['raw_local', 'shareable']),
              default=None, help='Redaction mode (overrides global setting)')
@click.option('--csv-mode', is_flag=True, default=False,
              help='Load data from SAP CSV exports (SE16N format) instead of JSON')
@pass_context
def run(ctx, input_dir: str, output_dir: str, output_format: str, mode: str, csv_mode: bool):
    """Run the complete pipeline: ingest -> analyze -> report.

    This is a convenience command that runs all steps in sequence.

    Use --csv-mode to load data from SAP SE16N CSV exports instead of JSON.
    In CSV mode, the input directory should contain:
    - VBAK.csv (sales order headers) - required
    - VBAP.csv (sales order items) - required
    - texts.csv or STXH.csv (order texts) - optional
    - VBFA.csv (document flow) - optional

    Output files:
    - pattern_cards.json   - Pattern cards in JSON format
    - pattern_cards.md     - Pattern cards in Markdown format
    - evidence_ledger.json - Evidence supporting each pattern
    - clustering_summary.json - Clustering statistics
    - correlation_stats.json - Correlation analysis results
    """
    input_path = Path(input_dir)
    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)

    # Allow mode override
    redaction_mode = mode if mode else ctx.config['redaction_mode']

    from datetime import datetime

    click.echo("=" * 60)
    click.echo("SAP Workflow Mining Pattern Engine")
    click.echo("=" * 60)
    click.echo(f"Input: {input_path}")
    click.echo(f"Output: {output_path}")
    click.echo(f"Seed: {ctx.config['random_seed']}")
    click.echo(f"Redaction: {redaction_mode}")
    click.echo(f"Input Mode: {'CSV (SE16N exports)' if csv_mode else 'JSON'}")
    click.echo("=" * 60)

    # Step 1: Ingest
    click.echo("\n[1/6] Ingesting data...")

    if csv_mode:
        # Load from CSV exports
        try:
            documents = load_csv_directory(input_path, random_seed=ctx.config['random_seed'])
            click.echo(f"  Loaded {len(documents)} documents from CSV exports")
        except ValueError as e:
            click.echo(f"Error loading CSV files: {e}", err=True)
            click.echo("\nCSV mode requires these files in the input directory:", err=True)
            click.echo("  - VBAK.csv (sales order headers) - REQUIRED", err=True)
            click.echo("  - VBAP.csv (sales order items) - REQUIRED", err=True)
            click.echo("  - texts.csv or STXH.csv (order texts) - optional", err=True)
            click.echo("  - VBFA.csv (document flow) - optional", err=True)
            sys.exit(1)
    else:
        # Load from JSON files
        loader = DataLoader()
        documents = loader.load_all(input_path)

    if not documents:
        click.echo("Error: No documents loaded.", err=True)
        sys.exit(1)

    click.echo(f"  Loaded {len(documents)} documents")

    # Step 2: Redact
    click.echo("\n[2/6] Applying redaction...")
    redactor = Redactor(
        mode=redaction_mode,
        hash_salt=f"sap_workflow_mining_{ctx.config['random_seed']}"
    )

    redacted_docs = []
    for doc in documents:
        redacted_doc = doc.copy()
        if 'consolidated_text' in redacted_doc:
            redacted_doc['consolidated_text'] = redactor.redact_text(
                redacted_doc['consolidated_text']
            )
        redacted_docs.append(redacted_doc)

    redaction_stats = redactor.get_stats()
    click.echo(f"  Applied {redaction_stats['total_redactions']} redactions")

    # Step 3: Normalize
    click.echo("\n[3/6] Normalizing text...")
    processor = TextProcessor()
    processed_docs = []
    for doc in redacted_docs:
        processed_doc = doc.copy()
        processed_doc['normalized_text'] = processor.process(doc.get('consolidated_text', ''))
        processed_docs.append(processed_doc)

    click.echo(f"  Normalized {len(processed_docs)} documents")

    # Step 4: Cluster
    click.echo("\n[4/6] Clustering documents...")
    clusterer = TextClusterer(
        embedding_model='tfidf',
        min_cluster_size=5,
        random_seed=ctx.config['random_seed']
    )

    texts = [doc.get('normalized_text', '') for doc in processed_docs]
    cluster_result = clusterer.fit_predict(texts)

    for doc, label in zip(processed_docs, cluster_result['labels']):
        doc['cluster_id'] = label

    click.echo(f"  Found {cluster_result['n_clusters']} clusters")
    if cluster_result.get('silhouette'):
        click.echo(f"  Silhouette score: {cluster_result['silhouette']:.3f}")

    # Step 5: Correlate
    click.echo("\n[5/6] Analyzing outcome correlations...")
    analyzer = OutcomeAnalyzer(delay_threshold_days=7)
    correlations = analyzer.analyze(processed_docs, cluster_result)

    n_notable = correlations['summary']['n_notable_clusters']
    click.echo(f"  Analyzed {correlations['n_clusters_analyzed']} clusters")
    click.echo(f"  Found {n_notable} notable patterns")

    # Step 6: Generate reports
    click.echo("\n[6/6] Generating pattern cards...")
    from .report.pattern_card import PatternCardGenerator
    card_generator = PatternCardGenerator(
        redaction_mode=redaction_mode,
        random_seed=ctx.config['random_seed']
    )
    pattern_cards = card_generator.generate_cards(
        documents=processed_docs,
        cluster_result=cluster_result,
        correlations=correlations
    )

    click.echo(f"  Generated {len(pattern_cards)} pattern cards")

    # Write output files
    click.echo("\nWriting output files...")

    # pattern_cards.json
    cards_json = {
        'metadata': {
            'generated_at': datetime.utcnow().isoformat() + 'Z',
            'seed': ctx.config['random_seed'],
            'mode': redaction_mode,
            'n_cards': len(pattern_cards),
        },
        'cards': [card.to_dict() for card in pattern_cards]
    }
    with open(output_path / 'pattern_cards.json', 'w', encoding='utf-8') as f:
        json.dump(cards_json, f, indent=2, default=str)
    click.echo(f"  Wrote pattern_cards.json")

    # pattern_cards.md
    generator = ReportGenerator(output_format='markdown', random_seed=ctx.config['random_seed'])
    md_content = generator.generate(pattern_cards)
    with open(output_path / 'pattern_cards.md', 'w', encoding='utf-8') as f:
        f.write(md_content)
    click.echo(f"  Wrote pattern_cards.md")

    # evidence_ledger.json
    evidence_ledger = {
        'metadata': {
            'generated_at': datetime.utcnow().isoformat() + 'Z',
            'seed': ctx.config['random_seed'],
            'n_cards': len(pattern_cards),
        },
        'entries': [
            {
                'card_id': card.id,
                'doc_keys': card.evidence.doc_keys,
                'fields_used': [f.field_name for f in card.evidence.field_usage],
                'sample_size': card.sample_size,
                'total_population': card.evidence.row_counts.get('total_documents', 0),
                'full_evidence': card.evidence.to_dict()
            }
            for card in pattern_cards
        ]
    }
    with open(output_path / 'evidence_ledger.json', 'w', encoding='utf-8') as f:
        json.dump(evidence_ledger, f, indent=2, default=str)
    click.echo(f"  Wrote evidence_ledger.json")

    # clustering_summary.json
    clustering_summary = {
        'metadata': {
            'generated_at': datetime.utcnow().isoformat() + 'Z',
            'seed': ctx.config['random_seed'],
        },
        'n_documents': len(processed_docs),
        'n_clusters': cluster_result['n_clusters'],
        'silhouette_score': cluster_result.get('silhouette'),
        'cluster_info': cluster_result.get('cluster_info', {}),
        'parameters': cluster_result.get('parameters', {}),
    }
    with open(output_path / 'clustering_summary.json', 'w', encoding='utf-8') as f:
        json.dump(clustering_summary, f, indent=2, default=str)
    click.echo(f"  Wrote clustering_summary.json")

    # correlation_stats.json
    correlation_stats = {
        'metadata': {
            'generated_at': datetime.utcnow().isoformat() + 'Z',
            'seed': ctx.config['random_seed'],
        },
        'baseline': correlations['baseline'],
        'summary': correlations['summary'],
        'parameters': correlations['parameters'],
        'clusters': correlations['clusters'],
    }
    with open(output_path / 'correlation_stats.json', 'w', encoding='utf-8') as f:
        json.dump(convert_for_json(correlation_stats), f, indent=2, default=str)
    click.echo(f"  Wrote correlation_stats.json")

    click.echo("\n" + "=" * 60)
    click.echo("Pipeline complete!")
    click.echo(f"Pattern cards: {len(pattern_cards)}")
    click.echo(f"Output directory: {output_path}")
    click.echo("=" * 60)


def _save_pipeline_state(ctx: PipelineContext, key: str, data):
    """Save pipeline state to a temporary file."""
    import tempfile
    import os

    state_dir = Path(tempfile.gettempdir()) / 'pattern_engine_state'
    state_dir.mkdir(exist_ok=True)

    state_file = state_dir / f'{key}.json'
    with open(state_file, 'w') as f:
        json.dump(data, f, default=str)


def _load_pipeline_state(ctx: PipelineContext, key: str):
    """Load pipeline state from a temporary file."""
    import tempfile

    state_dir = Path(tempfile.gettempdir()) / 'pattern_engine_state'
    state_file = state_dir / f'{key}.json'

    if state_file.exists():
        with open(state_file, 'r') as f:
            return json.load(f)
    return None


def main():
    """Main entry point."""
    cli()


if __name__ == '__main__':
    main()
