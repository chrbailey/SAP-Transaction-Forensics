#!/usr/bin/env python3
"""
Download SAP SALT Dataset from HuggingFace

This script downloads the SALT (Sales Autocompletion Linked Business Tables)
dataset and converts it to JSON format for use with the SALT adapter.

Prerequisites:
    pip install datasets pyarrow

Usage:
    python scripts/download-salt.py [--output-dir ./data/salt] [--max-docs 10000]

The script will create:
    - data/salt/salt_data.json - Main data file used by the adapter
    - data/salt/salt_stats.json - Dataset statistics
"""

import argparse
import json
import os
import sys
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description='Download SAP SALT dataset')
    parser.add_argument(
        '--output-dir',
        type=str,
        default='./data/salt',
        help='Output directory for downloaded data'
    )
    parser.add_argument(
        '--max-docs',
        type=int,
        default=100000,
        help='Maximum number of sales documents to download'
    )
    parser.add_argument(
        '--split',
        type=str,
        default='train',
        choices=['train', 'test'],
        help='Dataset split to download'
    )
    parser.add_argument(
        '--force',
        action='store_true',
        help='Force re-download even if data exists'
    )

    args = parser.parse_args()

    output_dir = Path(args.output_dir)
    output_file = output_dir / 'salt_data.json'
    stats_file = output_dir / 'salt_stats.json'

    # Check if already downloaded
    if output_file.exists() and not args.force:
        print(f"SALT data already exists at {output_file}")
        print("Use --force to re-download")
        return 0

    # Import datasets library
    try:
        from datasets import load_dataset
    except ImportError:
        print("Error: 'datasets' package not installed")
        print("Install with: pip install datasets pyarrow")
        return 1

    # Create output directory
    output_dir.mkdir(parents=True, exist_ok=True)

    print(f"Downloading SALT dataset from HuggingFace...")
    print(f"Split: {args.split}")
    print(f"Max documents: {args.max_docs}")
    print()

    try:
        # Download each table
        print("Loading salesdocuments...")
        sales_docs = load_dataset("SAP/SALT", "salesdocuments", split=args.split)
        print(f"  Found {len(sales_docs)} sales documents")

        print("Loading salesdocument_items...")
        sales_items = load_dataset("SAP/SALT", "salesdocument_items", split=args.split)
        print(f"  Found {len(sales_items)} sales document items")

        print("Loading customers...")
        customers = load_dataset("SAP/SALT", "customers", split=args.split)
        print(f"  Found {len(customers)} customers")

        print("Loading addresses...")
        addresses = load_dataset("SAP/SALT", "addresses", split=args.split)
        print(f"  Found {len(addresses)} addresses")

        print()

        # Limit sales documents if needed
        if len(sales_docs) > args.max_docs:
            print(f"Limiting to {args.max_docs} sales documents...")
            sales_docs = sales_docs.select(range(args.max_docs))

        # Get unique document numbers from limited set
        doc_numbers = set(row['SALESDOCUMENT'] for row in sales_docs if row.get('SALESDOCUMENT'))

        # Filter items to match limited documents
        print("Filtering items to match selected documents...")
        filtered_items = [
            row for row in sales_items
            if row.get('SALESDOCUMENT') in doc_numbers
        ]
        print(f"  Filtered to {len(filtered_items)} items")

        # Convert to dictionaries
        print("Converting to JSON format...")
        result = {
            "salesDocuments": [dict(row) for row in sales_docs],
            "salesDocumentItems": [dict(row) for row in filtered_items],
            "customers": [dict(row) for row in customers],
            "addresses": [dict(row) for row in addresses],
        }

        # Calculate statistics
        sales_orgs = set()
        plants = set()
        dates = []

        for doc in result["salesDocuments"]:
            if doc.get('SALESORGANIZATION'):
                sales_orgs.add(doc['SALESORGANIZATION'])
            if doc.get('CREATIONDATE'):
                dates.append(doc['CREATIONDATE'])

        for item in result["salesDocumentItems"]:
            if item.get('PLANT'):
                plants.add(item['PLANT'])

        dates.sort()

        stats = {
            "salesDocuments": len(result["salesDocuments"]),
            "salesDocumentItems": len(result["salesDocumentItems"]),
            "customers": len(result["customers"]),
            "addresses": len(result["addresses"]),
            "uniqueSalesOrgs": len(sales_orgs),
            "salesOrgs": sorted(list(sales_orgs)),
            "uniquePlants": len(plants),
            "plants": sorted(list(plants)),
            "dateRange": {
                "earliest": dates[0] if dates else None,
                "latest": dates[-1] if dates else None,
            }
        }

        # Write data file
        print(f"Writing data to {output_file}...")
        with open(output_file, 'w') as f:
            json.dump(result, f)

        # Write stats file
        print(f"Writing stats to {stats_file}...")
        with open(stats_file, 'w') as f:
            json.dump(stats, f, indent=2)

        # Print summary
        print()
        print("=" * 60)
        print("SALT Dataset Download Complete")
        print("=" * 60)
        print(f"Sales Documents:      {stats['salesDocuments']:,}")
        print(f"Sales Document Items: {stats['salesDocumentItems']:,}")
        print(f"Customers:            {stats['customers']:,}")
        print(f"Addresses:            {stats['addresses']:,}")
        print(f"Unique Sales Orgs:    {stats['uniqueSalesOrgs']}")
        print(f"Unique Plants:        {stats['uniquePlants']}")
        print(f"Date Range:           {stats['dateRange']['earliest']} to {stats['dateRange']['latest']}")
        print()
        print(f"Data saved to: {output_file}")
        print(f"Stats saved to: {stats_file}")
        print()
        print("To use with the MCP server:")
        print("  1. Set DATA_ADAPTER=salt in .env")
        print("  2. Or use: new SaltAdapter({ cacheDir: './data/salt' })")

        return 0

    except Exception as e:
        print(f"Error downloading dataset: {e}")
        return 1


if __name__ == '__main__':
    sys.exit(main())
