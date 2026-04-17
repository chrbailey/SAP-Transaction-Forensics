"""Demo: run pattern discovery against the synthetic SFDC opportunities.

Usage:
    python3 demo_discovery.py

Requires ANTHROPIC_API_KEY in the environment (.env file or export).
"""
from __future__ import annotations

import logging
import os
import sys
from pathlib import Path

from dotenv import load_dotenv

from pattern_discovery import discover_patterns
from patterns_db import PatternsDB


def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
    )
    load_dotenv()

    if not os.getenv("ANTHROPIC_API_KEY"):
        print("ERROR: ANTHROPIC_API_KEY not set. Add it to .env or export it.")
        sys.exit(1)

    repo_root = Path(__file__).resolve().parents[1]
    data_path = repo_root / "synthetic-data" / "sfdc_output" / "opportunities.json"
    db_path = Path(__file__).parent / "patterns.db"

    if not data_path.exists():
        print(f"ERROR: synthetic data not found at {data_path}")
        print("Run 'make demo' from the repo root first.")
        sys.exit(1)

    print(f"Running pattern discovery against {data_path}")
    print(f"Pattern library: {db_path}")
    print()

    result = discover_patterns(data_path=data_path, db_path=db_path)

    print()
    print("=" * 60)
    print("Pattern Discovery Run Complete")
    print("=" * 60)
    print(f"  Candidates proposed:  {result.candidates_proposed}")
    print(f"  Critic passed:        {result.candidates_confirmed}")
    print(f"  Critic rejected:      {result.candidates_rejected}")
    print(f"  Uncertain (flagged):  {result.candidates_uncertain}")
    print(f"  Duration:             {result.duration_ms}ms")
    print()

    if result.confirmed_patterns:
        print("Confirmed patterns (first 3):")
        print("-" * 60)
        for entry in result.confirmed_patterns[:3]:
            c = entry["candidate"]
            print(f"  • {c['name']}")
            print(f"    {c['description']}")
            print(f"    Category: {c['category']}")
            print(f"    Supporting transactions: {len(c.get('supporting_transaction_ids', []))}")
            print()

    if result.rejected_patterns:
        print("Rejected candidates (first 2):")
        print("-" * 60)
        for entry in result.rejected_patterns[:2]:
            c = entry["candidate"]
            review = entry["review"]
            print(f"  • {c['name']} — REJECTED")
            print(f"    Description: {c['description']}")
            findings = review.get("findings", []) if review else []
            for f in findings[:2]:
                print(f"    Finding: [{f.get('category')}] {f.get('detail')}")
            print()

    # Final library state
    db = PatternsDB(db_path)
    all_patterns = db.list_all_patterns()
    confirmed = [p for p in all_patterns if p["status"] == "confirmed"]
    rejected = [p for p in all_patterns if p["status"] == "rejected"]
    db.close()

    print("=" * 60)
    print("Pattern Library State")
    print("=" * 60)
    print(f"  Total patterns:       {len(all_patterns)}")
    print(f"  Confirmed:            {len(confirmed)}")
    print(f"  Rejected (negatives): {len(rejected)}")
    print()
    print(f"Library persisted at: {db_path}")
    print("Run again to see the library grow — prior patterns become baselines.")


if __name__ == "__main__":
    main()
