"""
Kaggle CRM Sales Opportunities → SFDC-format JSON Converter

Converts the Kaggle CRM dataset (CSV) into the JSON format consumed
by the SFDC adapter (src/ingest/sfdc_adapter.py).

Input  : /data/kaggle-crm/*.csv
Output : /data/kaggle-crm/sfdc_format/{opportunities,accounts,stage_histories,
                                        line_items,activities,products}.json

Usage:
    cd /path/to/pattern-engine
    python3.11 scripts/convert_kaggle_crm.py
"""

from __future__ import annotations

import csv
import hashlib
import json
import random
import sys
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

SCRIPT_DIR = Path(__file__).resolve().parent
PATTERN_ENGINE_DIR = SCRIPT_DIR.parent
REPO_ROOT = PATTERN_ENGINE_DIR.parent
DATA_DIR = REPO_ROOT / "data" / "kaggle-crm"
OUT_DIR = DATA_DIR / "sfdc_format"

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

STAGE_MAP: Dict[str, str] = {
    "Prospecting": "Prospecting",
    "Engaging": "Qualification",
    "Won": "Closed Won",
    "Lost": "Closed Lost",
}

# Intermediate stages inserted for Won deals to enrich stage histories
INTERMEDIATE_STAGES = [
    "Needs Analysis",
    "Proposal/Price Quote",
]

ACTIVITY_SUBJECTS: Dict[str, List[str]] = {
    "GTX Basic": [
        "Initial call - GTX Basic demo",
        "Follow-up: GTX Basic pricing",
        "GTX Basic technical review",
    ],
    "GTX Plus Basic": [
        "Discovery call - GTX Plus Basic",
        "GTX Plus Basic feature walkthrough",
        "GTX Plus Basic trial setup",
    ],
    "GTXPro": [
        "GTXPro enterprise demo",
        "GTXPro integration discussion",
        "GTXPro ROI analysis",
    ],
    "GTX Pro": [
        "GTX Pro enterprise demo",
        "GTX Pro integration discussion",
        "GTX Pro ROI analysis",
    ],
    "MG Special": [
        "MG Special intro call",
        "MG Special use-case review",
        "MG Special pilot discussion",
    ],
    "MG Advanced": [
        "MG Advanced capabilities demo",
        "MG Advanced competitive comparison",
        "MG Advanced contract review",
    ],
    "GTX Plus Pro": [
        "GTX Plus Pro solution overview",
        "GTX Plus Pro security review",
        "GTX Plus Pro scoping call",
    ],
}
DEFAULT_SUBJECTS = [
    "Discovery call",
    "Product demonstration",
    "Proposal review",
]


# ---------------------------------------------------------------------------
# ID generation helpers
# ---------------------------------------------------------------------------


def _det_id(prefix: str, value: str, length: int = 15) -> str:
    """Deterministic ID from a string value, SFDC-style."""
    digest = hashlib.md5(value.encode()).hexdigest()[:length]
    return f"{prefix}{digest}"


def opportunity_id(raw_id: str) -> str:
    """Convert raw opportunity ID to SFDC-style (prefix 006)."""
    return f"006{raw_id}"


def account_id(account_name: str) -> str:
    """Deterministic SFDC account ID from name."""
    return _det_id("001", account_name)


def owner_id(agent_name: str) -> str:
    """Deterministic SFDC user ID from agent name."""
    return _det_id("005", agent_name)


def product_id(product_name: str) -> str:
    """Deterministic SFDC product ID from name."""
    return _det_id("01t", product_name)


# ---------------------------------------------------------------------------
# Date helpers
# ---------------------------------------------------------------------------


def parse_date(s: str) -> Optional[datetime]:
    if not s or s.strip() == "":
        return None
    try:
        return datetime.strptime(s.strip()[:10], "%Y-%m-%d")
    except ValueError:
        return None


def iso_date(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%dT00:00:00")


def evenly_spaced_dates(
    start: datetime, end: datetime, n: int
) -> List[datetime]:
    """Return *n* evenly spaced datetimes between start and end (exclusive)."""
    if n <= 0 or end <= start:
        return []
    delta = (end - start) / (n + 1)
    return [start + delta * (i + 1) for i in range(n)]


# ---------------------------------------------------------------------------
# Loaders
# ---------------------------------------------------------------------------


def load_csv(path: Path) -> List[Dict[str, str]]:
    with path.open(newline="", encoding="utf-8-sig") as fh:
        return list(csv.DictReader(fh))


# ---------------------------------------------------------------------------
# Conversion logic
# ---------------------------------------------------------------------------


def build_accounts(accounts_rows: List[Dict[str, str]]) -> List[Dict[str, Any]]:
    out = []
    for row in accounts_rows:
        name = row["account"].strip()
        try:
            revenue = float(row.get("revenue") or 0)
        except ValueError:
            revenue = 0.0
        try:
            employees = int(row.get("employees") or 0)
        except ValueError:
            employees = 0
        try:
            year_est = int(row.get("year_established") or 0)
        except ValueError:
            year_est = 0

        out.append(
            {
                "id": account_id(name),
                "name": name,
                "industry": row.get("sector", "").strip(),
                "annual_revenue": revenue * 1_000_000,  # listed in millions
                "number_of_employees": employees,
                "billing_country": row.get("office_location", "").strip(),
                "parent_id": account_id(row["subsidiary_of"].strip())
                if row.get("subsidiary_of", "").strip()
                else None,
                "year_established": year_est,
            }
        )
    return out


def build_products(products_rows: List[Dict[str, str]]) -> List[Dict[str, Any]]:
    out = []
    for row in products_rows:
        name = row["product"].strip()
        try:
            price = float(row.get("sales_price") or 0)
        except ValueError:
            price = 0.0
        out.append(
            {
                "id": product_id(name),
                "name": name,
                "series": row.get("series", "").strip(),
                "unit_price": price,
            }
        )
    return out


def build_opportunities_and_related(
    pipeline_rows: List[Dict[str, str]],
    accounts_rows: List[Dict[str, str]],
    products_rows: List[Dict[str, str]],
    teams_rows: List[Dict[str, str]],
) -> tuple[
    List[Dict[str, Any]],
    List[Dict[str, Any]],
    List[Dict[str, Any]],
    List[Dict[str, Any]],
]:
    """
    Returns (opportunities, stage_histories, line_items, activities).
    """
    # Build lookup maps
    account_names = {row["account"].strip() for row in accounts_rows}
    product_price: Dict[str, float] = {}
    for row in products_rows:
        try:
            product_price[row["product"].strip()] = float(row["sales_price"])
        except ValueError:
            product_price[row["product"].strip()] = 0.0

    agent_manager: Dict[str, str] = {
        row["sales_agent"].strip(): row.get("manager", "").strip()
        for row in teams_rows
    }

    opportunities: List[Dict[str, Any]] = []
    stage_histories: List[Dict[str, Any]] = []
    line_items: List[Dict[str, Any]] = []
    activities: List[Dict[str, Any]] = []

    rng = random.Random(42)  # deterministic

    for row in pipeline_rows:
        raw_id = row["opportunity_id"].strip()
        opp_id = opportunity_id(raw_id)
        agent = row["sales_agent"].strip()
        product = row["product"].strip()
        acct_name = row["account"].strip()
        raw_stage = row["deal_stage"].strip()
        engage_date_str = row.get("engage_date", "").strip()
        close_date_str = row.get("close_date", "").strip()
        close_value_str = row.get("close_value", "").strip()

        stage = STAGE_MAP.get(raw_stage, raw_stage)
        engage_dt = parse_date(engage_date_str)
        close_dt = parse_date(close_date_str)

        try:
            amount = float(close_value_str) if close_value_str else None
        except ValueError:
            amount = None

        # created_date = engage_date if available, else close_date
        created_dt = engage_dt or close_dt
        created_date = iso_date(created_dt) if created_dt else None

        is_won = raw_stage == "Won"
        is_lost = raw_stage == "Lost"
        is_closed = is_won or is_lost

        opp: Dict[str, Any] = {
            "id": opp_id,
            "name": f"{acct_name} - {product}",
            "account_id": account_id(acct_name) if acct_name in account_names else None,
            "owner_id": owner_id(agent),
            "stage_name": stage,
            "type": "New Business",
            "amount": amount,
            "close_date": iso_date(close_dt) if close_dt else None,
            "created_date": created_date,
            "is_closed": is_closed,
            "is_won": is_won,
            "_source": "kaggle_crm",
            "_raw_stage": raw_stage,
            "_agent": agent,
            "_product": product,
            "_manager": agent_manager.get(agent, ""),
        }
        opportunities.append(opp)

        # ----------------------------------------------------------------
        # Stage histories
        # ----------------------------------------------------------------
        hist_entries: List[tuple[str, datetime]] = []

        if engage_dt:
            hist_entries.append(("Prospecting", engage_dt))
            hist_entries.append(("Qualification", engage_dt))

        if is_won and engage_dt and close_dt:
            # Insert intermediate stages between engage and close
            mid_dates = evenly_spaced_dates(
                engage_dt, close_dt, len(INTERMEDIATE_STAGES)
            )
            for stage_name, mid_dt in zip(INTERMEDIATE_STAGES, mid_dates):
                hist_entries.append((stage_name, mid_dt))
            hist_entries.append(("Closed Won", close_dt))
        elif is_lost and close_dt:
            hist_entries.append(("Closed Lost", close_dt))
        elif is_won and close_dt:
            hist_entries.append(("Closed Won", close_dt))

        # Deduplicate while preserving order
        seen: set = set()
        for stage_name, dt in hist_entries:
            key = (stage_name, dt.date())
            if key not in seen:
                seen.add(key)
                stage_histories.append(
                    {
                        "opportunity_id": opp_id,
                        "stage_name": stage_name,
                        "created_date": iso_date(dt),
                        "owner_id": owner_id(agent),
                        "amount": amount,
                    }
                )

        # ----------------------------------------------------------------
        # Line items
        # ----------------------------------------------------------------
        price = product_price.get(product, 0.0)
        quantity = rng.randint(1, 5)
        line_items.append(
            {
                "id": _det_id("00k", opp_id + product),
                "opportunity_id": opp_id,
                "product_id": product_id(product),
                "product_name": product,
                "unit_price": price,
                "quantity": quantity,
                "total_price": price * quantity,
            }
        )

        # ----------------------------------------------------------------
        # Activities (1-3 tasks per opportunity)
        # ----------------------------------------------------------------
        subjects = ACTIVITY_SUBJECTS.get(product, DEFAULT_SUBJECTS)
        n_acts = rng.randint(1, min(3, len(subjects)))
        act_base_dt = engage_dt or close_dt or datetime(2017, 1, 1)
        for i, subj in enumerate(subjects[:n_acts]):
            act_dt = act_base_dt + timedelta(days=i * rng.randint(3, 14))
            activities.append(
                {
                    "id": _det_id("00T", opp_id + str(i)),
                    "opportunity_id": opp_id,
                    "type": "Task",
                    "subject": subj,
                    "status": "Completed",
                    "activity_date": iso_date(act_dt),
                    "owner_id": owner_id(agent),
                }
            )

    return opportunities, stage_histories, line_items, activities


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def convert() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    print(f"Loading CSVs from {DATA_DIR} ...", flush=True)
    pipeline = load_csv(DATA_DIR / "sales_pipeline.csv")
    accounts_rows = load_csv(DATA_DIR / "accounts.csv")
    products_rows = load_csv(DATA_DIR / "products.csv")
    teams_rows = load_csv(DATA_DIR / "sales_teams.csv")

    print(
        f"  sales_pipeline.csv  : {len(pipeline):,} rows",
        f"\n  accounts.csv        : {len(accounts_rows)} rows",
        f"\n  products.csv        : {len(products_rows)} rows",
        f"\n  sales_teams.csv     : {len(teams_rows)} rows",
        flush=True,
    )

    accounts = build_accounts(accounts_rows)
    products = build_products(products_rows)
    opps, histories, line_items, acts = build_opportunities_and_related(
        pipeline, accounts_rows, products_rows, teams_rows
    )

    files: Dict[str, Any] = {
        "opportunities.json": opps,
        "accounts.json": accounts,
        "stage_histories.json": histories,
        "line_items.json": line_items,
        "activities.json": acts,
        "products.json": products,
    }

    for fname, data in files.items():
        path = OUT_DIR / fname
        with path.open("w", encoding="utf-8") as fh:
            json.dump(data, fh, indent=2)
        print(f"  Wrote {path.name}: {len(data):,} records")

    print(f"\nDone. Output: {OUT_DIR}")


if __name__ == "__main__":
    convert()
