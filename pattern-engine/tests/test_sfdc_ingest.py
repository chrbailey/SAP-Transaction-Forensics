"""
Tests for SFDC Ingest Adapter.

Covers:
- load_sfdc_data: file loading, index construction
- sfdc_to_event_log: event record fields, ordering
- load_sap_records: SAP JSON loading
"""

from __future__ import annotations

import json
import tempfile
from pathlib import Path

import pytest

from src.ingest.sfdc_adapter import load_sap_records, load_sfdc_data, sfdc_to_event_log

# ---------------------------------------------------------------------------
# Minimal fixture data (mirrors real JSON schema exactly)
# ---------------------------------------------------------------------------

OPPORTUNITIES = [
    {
        "id": "006000000000000001",
        "name": "Acme Corp — New Business 001",
        "account_id": "001000000000000001",
        "owner_id": "005000000000000001",
        "type": "New Business",
        "stage_name": "Closed Won",
        "amount": 100000,
        "close_date": "2024-06-30",
        "created_date": "2024-01-01",
        "probability": 100,
        "is_closed": True,
        "is_won": True,
        "is_sap_linked": True,
        "sap_order_id": "SAP0000001",
        "_pattern_flags": [],
    },
    {
        "id": "006000000000000002",
        "name": "Beta Inc — New Business 002",
        "account_id": "001000000000000002",
        "owner_id": "005000000000000002",
        "type": "New Business",
        "stage_name": "Closed Lost",
        "amount": 50000,
        "close_date": "2024-03-31",
        "created_date": "2024-02-01",
        "probability": 0,
        "is_closed": True,
        "is_won": False,
        "is_sap_linked": False,
        "sap_order_id": None,
        "_pattern_flags": ["STAGE_SKIP"],
    },
]

ACCOUNTS = [
    {
        "id": "001000000000000001",
        "name": "Acme Corp",
        "industry": "Technology",
        "annual_revenue": 1000000,
        "employee_count": 100,
        "billing_country": "US",
        "created_date": "2022-01-01",
    },
    {
        "id": "001000000000000002",
        "name": "Beta Inc",
        "industry": "Manufacturing",
        "annual_revenue": 500000,
        "employee_count": 50,
        "billing_country": "CA",
        "created_date": "2022-06-01",
    },
]

STAGE_HISTORIES = [
    {
        "id": "0Sh000000000000001_000",
        "opportunity_id": "006000000000000001",
        "stage_name": "Prospecting",
        "created_date": "2024-01-01T00:00:00Z",
        "owner_id": "005000000000000001",
        "amount": None,
    },
    {
        "id": "0Sh000000000000001_001",
        "opportunity_id": "006000000000000001",
        "stage_name": "Qualification",
        "created_date": "2024-02-01T00:00:00Z",
        "owner_id": "005000000000000001",
        "amount": None,
    },
    {
        "id": "0Sh000000000000001_002",
        "opportunity_id": "006000000000000001",
        "stage_name": "Closed Won",
        "created_date": "2024-06-30T00:00:00Z",
        "owner_id": "005000000000000001",
        "amount": 100000,
    },
    # Opp 2 — skipped stages
    {
        "id": "0Sh000000000000002_000",
        "opportunity_id": "006000000000000002",
        "stage_name": "Prospecting",
        "created_date": "2024-02-01T00:00:00Z",
        "owner_id": "005000000000000002",
        "amount": None,
    },
    {
        "id": "0Sh000000000000002_001",
        "opportunity_id": "006000000000000002",
        "stage_name": "Closed Lost",
        "created_date": "2024-03-31T00:00:00Z",
        "owner_id": "005000000000000002",
        "amount": None,
    },
]

ACTIVITIES = [
    {
        "id": "00T000000000000001",
        "opportunity_id": "006000000000000001",
        "owner_id": "005000000000000001",
        "type": "Email",
        "subject": "Intro email",
        "activity_date": "2024-01-15",
        "status": "Completed",
    },
    {
        "id": "00T000000000000002",
        "opportunity_id": "006000000000000001",
        "owner_id": "005000000000000001",
        "type": "Call",
        "subject": "Discovery call",
        "activity_date": "2024-03-01",
        "status": "Completed",
    },
]

SAP_ORDERS = [
    {
        "vbeln": "SAP0000001",
        "sfdc_opportunity_id": "006000000000000001",
        "erdat": "2024-07-05",
        "audat": "2024-07-05",
        "auart": "TA",
        "vkorg": "1000",
        "vtweg": "10",
        "spart": "10",
        "netwr": 100000,
        "waerk": "USD",
        "kunnr": "001000000000000001",
        "_pattern_flags": [],
    }
]

SAP_DOC_FLOWS = [
    {
        "id": "DFSAP0000001J",
        "vbelv": "SAP0000001",
        "posnv": "000010",
        "vbeln": "DEL0000001",
        "posnn": "000010",
        "vbtyp_n": "J",
        "erdat": "2024-07-07",
        "rfmng": 1,
    }
]


@pytest.fixture
def sfdc_data_dir(tmp_path: Path) -> Path:
    """Write minimal SFDC JSON files to a temp directory."""
    files = {
        "opportunities.json": OPPORTUNITIES,
        "accounts.json": ACCOUNTS,
        "stage_histories.json": STAGE_HISTORIES,
        "activities.json": ACTIVITIES,
    }
    for filename, data in files.items():
        (tmp_path / filename).write_text(json.dumps(data), encoding="utf-8")
    return tmp_path


@pytest.fixture
def sap_data_dir(tmp_path: Path) -> Path:
    """Write minimal SAP JSON files to a temp directory."""
    (tmp_path / "sap_orders.json").write_text(
        json.dumps(SAP_ORDERS), encoding="utf-8"
    )
    (tmp_path / "sap_doc_flows.json").write_text(
        json.dumps(SAP_DOC_FLOWS), encoding="utf-8"
    )
    (tmp_path / "accounts.json").write_text(
        json.dumps(ACCOUNTS), encoding="utf-8"
    )
    return tmp_path


# ---------------------------------------------------------------------------
# Tests: load_sfdc_data
# ---------------------------------------------------------------------------


class TestLoadSfdcData:
    def test_loads_files(self, sfdc_data_dir: Path) -> None:
        data = load_sfdc_data(str(sfdc_data_dir))
        assert isinstance(data, dict)

    def test_opportunities_loaded(self, sfdc_data_dir: Path) -> None:
        data = load_sfdc_data(str(sfdc_data_dir))
        assert len(data["opportunities"]) == 2

    def test_accounts_loaded(self, sfdc_data_dir: Path) -> None:
        data = load_sfdc_data(str(sfdc_data_dir))
        assert len(data["accounts"]) == 2

    def test_account_map_built(self, sfdc_data_dir: Path) -> None:
        data = load_sfdc_data(str(sfdc_data_dir))
        account_map = data["account_map"]
        assert "001000000000000001" in account_map
        assert account_map["001000000000000001"]["name"] == "Acme Corp"

    def test_histories_by_opp(self, sfdc_data_dir: Path) -> None:
        data = load_sfdc_data(str(sfdc_data_dir))
        hbo = data["histories_by_opp"]
        # Opp 1 has 3 history entries
        assert len(hbo["006000000000000001"]) == 3
        # Opp 2 has 2 history entries
        assert len(hbo["006000000000000002"]) == 2

    def test_histories_sorted_by_date(self, sfdc_data_dir: Path) -> None:
        data = load_sfdc_data(str(sfdc_data_dir))
        histories = data["histories_by_opp"]["006000000000000001"]
        dates = [h["created_date"] for h in histories]
        assert dates == sorted(dates)

    def test_activities_by_opp(self, sfdc_data_dir: Path) -> None:
        data = load_sfdc_data(str(sfdc_data_dir))
        abo = data["activities_by_opp"]
        assert len(abo["006000000000000001"]) == 2

    def test_missing_file_returns_empty(self, tmp_path: Path) -> None:
        """load_sfdc_data should tolerate missing files gracefully."""
        data = load_sfdc_data(str(tmp_path))
        assert data["opportunities"] == []
        assert data["accounts"] == []


# ---------------------------------------------------------------------------
# Tests: sfdc_to_event_log
# ---------------------------------------------------------------------------


class TestSfdcToEventLog:
    @pytest.fixture
    def event_log(self, sfdc_data_dir: Path) -> list:
        data = load_sfdc_data(str(sfdc_data_dir))
        return sfdc_to_event_log(data)

    def test_returns_list(self, event_log: list) -> None:
        assert isinstance(event_log, list)

    def test_non_empty(self, event_log: list) -> None:
        # 3 stage histories (opp1) + 2 stage histories (opp2) + 2 activities = 7
        assert len(event_log) == 7

    def test_required_fields_present(self, event_log: list) -> None:
        required = {"case_id", "activity", "timestamp", "resource", "event_source", "attributes"}
        for record in event_log:
            assert required <= set(record.keys()), f"Missing fields in: {record}"

    def test_stage_history_event_source(self, event_log: list) -> None:
        stage_events = [r for r in event_log if r["event_source"] == "stage_history"]
        assert len(stage_events) == 5  # 3 + 2

    def test_activity_event_source(self, event_log: list) -> None:
        act_events = [r for r in event_log if r["event_source"] == "activity"]
        assert len(act_events) == 2

    def test_activity_name_format(self, event_log: list) -> None:
        act_events = [r for r in event_log if r["event_source"] == "activity"]
        for ev in act_events:
            # Should be "Activity:<type>:<subject>"
            assert ev["activity"].startswith("Activity:"), ev["activity"]
            parts = ev["activity"].split(":")
            assert len(parts) == 3

    def test_stage_activity_is_stage_name(self, event_log: list) -> None:
        stage_events = [r for r in event_log if r["event_source"] == "stage_history"]
        stage_names = {ev["activity"] for ev in stage_events}
        assert "Prospecting" in stage_names
        assert "Closed Won" in stage_names

    def test_sorted_by_timestamp(self, event_log: list) -> None:
        timestamps = [r["timestamp"] for r in event_log]
        assert timestamps == sorted(timestamps)

    def test_case_ids_are_opportunity_ids(self, event_log: list) -> None:
        case_ids = {r["case_id"] for r in event_log}
        assert "006000000000000001" in case_ids
        assert "006000000000000002" in case_ids

    def test_attributes_dict(self, event_log: list) -> None:
        for record in event_log:
            assert isinstance(record["attributes"], dict)

    def test_account_name_in_attributes(self, event_log: list) -> None:
        opp1_events = [r for r in event_log if r["case_id"] == "006000000000000001"]
        assert any(
            r["attributes"].get("account_name") == "Acme Corp"
            for r in opp1_events
        )


# ---------------------------------------------------------------------------
# Tests: load_sap_records
# ---------------------------------------------------------------------------


class TestLoadSapRecords:
    def test_loads_sap_files(self, sap_data_dir: Path) -> None:
        data = load_sap_records(str(sap_data_dir))
        assert isinstance(data, dict)

    def test_orders_loaded(self, sap_data_dir: Path) -> None:
        data = load_sap_records(str(sap_data_dir))
        assert len(data["orders"]) == 1
        assert data["orders"][0]["vbeln"] == "SAP0000001"

    def test_doc_flows_loaded(self, sap_data_dir: Path) -> None:
        data = load_sap_records(str(sap_data_dir))
        assert len(data["doc_flows"]) == 1

    def test_customers_loaded(self, sap_data_dir: Path) -> None:
        data = load_sap_records(str(sap_data_dir))
        assert len(data["customers"]) == 2

    def test_missing_files_return_empty(self, tmp_path: Path) -> None:
        data = load_sap_records(str(tmp_path))
        assert data["orders"] == []
        assert data["doc_flows"] == []
        assert data["customers"] == []
