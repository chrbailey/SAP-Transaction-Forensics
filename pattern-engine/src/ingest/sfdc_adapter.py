"""
Salesforce (SFDC) Ingest Adapter for SAP Transaction Forensics.

Loads SFDC synthetic data from JSON files and converts to event-log records
compatible with the conformance checking and pattern detection pipeline.

Event record schema:
    case_id      : str   — opportunity id (e.g. "006000000000000001")
    activity     : str   — stage name or "Activity:<type>:<subject>"
    timestamp    : str   — ISO-8601 datetime string
    resource     : str   — owner_id
    event_source : str   — "stage_history" | "activity"
    attributes   : dict  — additional metadata
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Loaders
# ---------------------------------------------------------------------------


def load_sfdc_data(data_dir: str) -> dict:
    """
    Load SFDC JSON files from *data_dir* and build lookup indexes.

    Reads:
        opportunities.json
        accounts.json
        stage_histories.json
        activities.json

    Returns a dict with keys:
        opportunities       : list of raw opportunity dicts
        accounts            : list of raw account dicts
        account_map         : dict  id -> account dict
        histories_by_opp    : dict  opportunity_id -> sorted list of stage-history dicts
        activities_by_opp   : dict  opportunity_id -> list of activity dicts
    """
    base = Path(data_dir)

    def _load(filename: str) -> list:
        path = base / filename
        if not path.exists():
            logger.warning("SFDC file not found: %s", path)
            return []
        with path.open("r", encoding="utf-8") as fh:
            return json.load(fh)

    opportunities: List[Dict[str, Any]] = _load("opportunities.json")
    accounts: List[Dict[str, Any]] = _load("accounts.json")
    stage_histories: List[Dict[str, Any]] = _load("stage_histories.json")
    activities: List[Dict[str, Any]] = _load("activities.json")

    # Build account lookup map
    account_map: Dict[str, Dict[str, Any]] = {
        acc["id"]: acc for acc in accounts if "id" in acc
    }

    # Group stage histories by opportunity_id, sorted by created_date
    histories_by_opp: Dict[str, List[Dict[str, Any]]] = {}
    for entry in stage_histories:
        opp_id = entry.get("opportunity_id")
        if opp_id is None:
            continue
        histories_by_opp.setdefault(opp_id, []).append(entry)

    for opp_id in histories_by_opp:
        histories_by_opp[opp_id].sort(
            key=lambda e: e.get("created_date", "")
        )

    # Group activities by opportunity_id
    activities_by_opp: Dict[str, List[Dict[str, Any]]] = {}
    for act in activities:
        opp_id = act.get("opportunity_id")
        if opp_id is None:
            continue
        activities_by_opp.setdefault(opp_id, []).append(act)

    return {
        "opportunities": opportunities,
        "accounts": accounts,
        "account_map": account_map,
        "histories_by_opp": histories_by_opp,
        "activities_by_opp": activities_by_opp,
    }


def sfdc_to_event_log(data: dict) -> list:
    """
    Convert loaded SFDC data to a flat list of event-log records.

    Each record has:
        case_id      : str   — opportunity id
        activity     : str   — stage name or "Activity:<type>:<subject>"
        timestamp    : str   — ISO-8601 datetime string
        resource     : str   — owner_id
        event_source : str   — "stage_history" or "activity"
        attributes   : dict  — extra metadata

    Records are sorted by timestamp (ascending).
    """
    records: List[Dict[str, Any]] = []

    opportunities: List[Dict[str, Any]] = data.get("opportunities", [])
    histories_by_opp: Dict[str, List[Dict[str, Any]]] = data.get(
        "histories_by_opp", {}
    )
    activities_by_opp: Dict[str, List[Dict[str, Any]]] = data.get(
        "activities_by_opp", {}
    )
    account_map: Dict[str, Dict[str, Any]] = data.get("account_map", {})

    for opp in opportunities:
        # Opportunities use "id" as the primary key
        opp_id: str = opp.get("id", "")
        if not opp_id:
            continue

        account_id: str = opp.get("account_id", "")
        account_name: str = account_map.get(account_id, {}).get("name", "")
        opp_type: str = opp.get("type", "")

        # --- Stage-history events ---
        for entry in histories_by_opp.get(opp_id, []):
            stage_name: str = entry.get("stage_name", "")
            timestamp: str = entry.get("created_date", "")
            if not timestamp:
                continue

            # Normalise to ISO-8601 (strip trailing Z if present)
            if timestamp.endswith("Z"):
                timestamp = timestamp[:-1] + "+00:00"

            records.append(
                {
                    "case_id": opp_id,
                    "activity": stage_name,
                    "timestamp": timestamp,
                    "resource": entry.get("owner_id", ""),
                    "event_source": "stage_history",
                    "attributes": {
                        "opportunity_name": opp.get("name", ""),
                        "account_id": account_id,
                        "account_name": account_name,
                        "opportunity_type": opp_type,
                        "amount": entry.get("amount") or opp.get("amount"),
                        "pattern_flags": opp.get("_pattern_flags", []),
                    },
                }
            )

        # --- Activity events ---
        for act in activities_by_opp.get(opp_id, []):
            act_type: str = act.get("type", "Unknown")
            subject: str = act.get("subject", "")
            activity_date: str = act.get("activity_date", "")
            if not activity_date:
                continue

            # activity_date may be just a date ("YYYY-MM-DD"); append time
            if "T" not in activity_date:
                activity_date = activity_date + "T00:00:00"

            records.append(
                {
                    "case_id": opp_id,
                    "activity": f"Activity:{act_type}:{subject}",
                    "timestamp": activity_date,
                    "resource": act.get("owner_id", ""),
                    "event_source": "activity",
                    "attributes": {
                        "opportunity_name": opp.get("name", ""),
                        "account_id": account_id,
                        "account_name": account_name,
                        "opportunity_type": opp_type,
                        "activity_status": act.get("status", ""),
                        "pattern_flags": opp.get("_pattern_flags", []),
                    },
                }
            )

    # Sort entire log by timestamp
    records.sort(key=lambda r: r.get("timestamp", ""))

    return records


def load_sap_records(data_dir: str) -> dict:
    """
    Load SAP JSON files from *data_dir*.

    Reads:
        sap_orders.json
        sap_doc_flows.json
        accounts.json   (used as customers proxy)

    Returns a dict with keys:
        orders      : list of SAP order dicts
        doc_flows   : list of SAP document-flow dicts
        customers   : list of account dicts (SAP customer records)
    """
    base = Path(data_dir)

    def _load(filename: str) -> list:
        path = base / filename
        if not path.exists():
            logger.warning("SAP file not found: %s", path)
            return []
        with path.open("r", encoding="utf-8") as fh:
            return json.load(fh)

    return {
        "orders": _load("sap_orders.json"),
        "doc_flows": _load("sap_doc_flows.json"),
        "customers": _load("accounts.json"),
    }
