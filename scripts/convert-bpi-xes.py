#!/usr/bin/env python3
"""
BPI Challenge 2019 XES to JSON Converter

Converts the BPI Challenge 2019 XES event log to a JSON format
compatible with the SAP Workflow Mining MCP server.

Usage:
    python scripts/convert-bpi-xes.py [--input PATH] [--output PATH] [--limit N]
"""

import argparse
import json
import sys
from pathlib import Path
from datetime import datetime
from collections import defaultdict

def parse_args():
    parser = argparse.ArgumentParser(description='Convert BPI 2019 XES to JSON')
    parser.add_argument('--input', '-i',
                        default='data/bpi/BPI_Challenge_2019.xes',
                        help='Input XES file path')
    parser.add_argument('--output', '-o',
                        default='data/bpi/bpi_2019.json',
                        help='Output JSON file path')
    parser.add_argument('--limit', '-l', type=int, default=0,
                        help='Limit number of cases (0 = no limit)')
    parser.add_argument('--stats-only', action='store_true',
                        help='Only output statistics, no JSON')
    return parser.parse_args()


def main():
    args = parse_args()

    print(f"Loading XES file: {args.input}")
    print("This may take a few minutes for large files...")

    try:
        import pm4py
        from pm4py.objects.log.importer.xes import importer as xes_importer
    except ImportError:
        print("Error: pm4py not installed. Run: pip install pm4py")
        sys.exit(1)

    # Load the XES file with proper importer
    log = xes_importer.apply(args.input)

    total_traces = len(log)
    print(f"Loaded {total_traces} cases (traces)")

    # Collect statistics
    activities = set()
    vendors = set()
    companies = set()
    po_docs = set()
    users = set()
    min_date = None
    max_date = None
    total_events = 0

    # Convert to our format
    traces = []
    processed = 0

    for trace in log:
        if args.limit and processed >= args.limit:
            break

        # Extract trace attributes
        trace_attrs = {}
        if hasattr(trace, 'attributes'):
            for key, value in trace.attributes.items():
                if isinstance(value, datetime):
                    trace_attrs[key] = value.isoformat()
                else:
                    trace_attrs[key] = str(value) if value is not None else None

        # Track unique values
        if 'Vendor' in trace_attrs:
            vendors.add(trace_attrs['Vendor'])
        if 'Company' in trace_attrs:
            companies.add(trace_attrs['Company'])
        if 'Purchasing Document' in trace_attrs:
            po_docs.add(trace_attrs['Purchasing Document'])

        # Convert events
        events = []
        for event in trace:
            event_data = {}
            for key, value in event.items():
                if isinstance(value, datetime):
                    event_data[key] = value.isoformat()
                    # Track date range
                    if min_date is None or value < min_date:
                        min_date = value
                    if max_date is None or value > max_date:
                        max_date = value
                else:
                    event_data[key] = str(value) if value is not None else None

            # Track activities and users
            if 'concept:name' in event_data:
                activities.add(event_data['concept:name'])
            if 'User' in event_data:
                users.add(event_data['User'])

            events.append(event_data)
            total_events += 1

        case_id = trace_attrs.get('concept:name', f'case_{processed}')
        traces.append({
            'case_id': case_id,
            'attributes': trace_attrs,
            'events': events
        })

        processed += 1
        if processed % 10000 == 0:
            print(f"  Processed {processed}/{total_traces} cases...")

    # Build statistics
    stats = {
        'total_cases': total_traces,
        'processed_cases': processed,
        'total_events': total_events,
        'unique_activities': len(activities),
        'unique_vendors': len(vendors),
        'unique_companies': len(companies),
        'unique_po_documents': len(po_docs),
        'unique_users': len(users),
        'date_range': {
            'earliest': min_date.isoformat() if min_date else None,
            'latest': max_date.isoformat() if max_date else None
        },
        'activities': sorted(list(activities)),
        'companies': sorted(list(companies))
    }

    print("\n=== BPI Challenge 2019 Statistics ===")
    print(f"Total cases: {stats['total_cases']}")
    print(f"Processed cases: {stats['processed_cases']}")
    print(f"Total events: {stats['total_events']}")
    print(f"Unique activities: {stats['unique_activities']}")
    print(f"Unique vendors: {stats['unique_vendors']}")
    print(f"Unique companies: {stats['unique_companies']}")
    print(f"Unique PO documents: {stats['unique_po_documents']}")
    print(f"Unique users: {stats['unique_users']}")
    print(f"Date range: {stats['date_range']['earliest']} to {stats['date_range']['latest']}")
    print(f"\nActivities ({len(activities)}):")
    for act in sorted(activities):
        print(f"  - {act}")

    if args.stats_only:
        return

    # Write output
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    output_data = {
        'metadata': {
            'source': 'BPI Challenge 2019',
            'description': 'Purchase-to-Pay process from multinational coatings company',
            'url': 'https://data.4tu.nl/articles/dataset/BPI_Challenge_2019/12715853',
            'converted_at': datetime.now().isoformat()
        },
        'stats': stats,
        'traces': traces
    }

    print(f"\nWriting to {args.output}...")
    with open(output_path, 'w') as f:
        json.dump(output_data, f)

    # Also write stats separately
    stats_path = output_path.parent / 'bpi_2019_stats.json'
    with open(stats_path, 'w') as f:
        json.dump(stats, f, indent=2)

    print(f"Done! Output: {args.output}")
    print(f"Stats: {stats_path}")

    # Show file size
    size_mb = output_path.stat().st_size / (1024 * 1024)
    print(f"Output file size: {size_mb:.1f} MB")


if __name__ == '__main__':
    main()
