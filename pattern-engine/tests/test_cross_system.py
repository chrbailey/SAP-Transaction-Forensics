"""
Unit tests for pattern-engine/src/correlate/cross_system.py

Tests cover:
- parse_date: ISO and YYYYMMDD formats, empty/None returns None
- find_cross_system_anomalies:
  - No timing_gap when gap is within threshold
  - Detects timing_gap (66 days > 30-day threshold, severity high because >60)
  - Detects amount_discrepancy (30% > 5% tolerance, severity high because >20%)
  - Detects missing_handoff (SFDC has sap_order_number but no matching SAP record)
- compute_cross_system_metrics: correct total_matched, avg_gap_days
"""

from __future__ import annotations

import pytest

from src.correlate.cross_system import (
    compute_cross_system_metrics,
    find_cross_system_anomalies,
    parse_date,
)


# ---------------------------------------------------------------------------
# parse_date
# ---------------------------------------------------------------------------


class TestParseDate:
    def test_iso_format(self):
        dt = parse_date("2024-03-15")
        assert dt is not None
        assert dt.year == 2024
        assert dt.month == 3
        assert dt.day == 15

    def test_yyyymmdd_format(self):
        dt = parse_date("20240315")
        assert dt is not None
        assert dt.year == 2024
        assert dt.month == 3
        assert dt.day == 15

    def test_empty_string_returns_none(self):
        assert parse_date("") is None

    def test_none_returns_none(self):
        assert parse_date(None) is None  # type: ignore[arg-type]

    def test_invalid_returns_none(self):
        assert parse_date("not-a-date") is None

    def test_iso_and_yyyymmdd_are_equivalent(self):
        assert parse_date("2024-03-15") == parse_date("20240315")


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


def _make_sfdc(
    opp_id: str,
    close_date: str,
    amount: float,
    stage_name: str = "Closed Won",
    is_won: bool = True,
    sap_order_id: str | None = None,
) -> dict:
    return {
        "id": opp_id,
        "close_date": close_date,
        "amount": amount,
        "stage_name": stage_name,
        "is_won": is_won,
        "sap_order_id": sap_order_id,
    }


def _make_sap(vbeln: str, erdat: str, netwr: float) -> dict:
    return {"vbeln": vbeln, "erdat": erdat, "netwr": netwr}


def _make_match(sfdc_id: str, sap_id: str, confidence: float = 0.9) -> dict:
    return {"sfdc_id": sfdc_id, "sap_id": sap_id, "confidence": confidence}


# ---------------------------------------------------------------------------
# find_cross_system_anomalies — timing_gap
# ---------------------------------------------------------------------------


class TestTimingGap:
    def test_no_gap_within_threshold(self):
        """3-day gap should not trigger a timing_gap anomaly (threshold=30)."""
        sfdc = [_make_sfdc("OPP001", "2024-03-01", 100_000)]
        sap = [_make_sap("SAP001", "2024-03-04", 100_000)]
        matches = [_make_match("OPP001", "SAP001")]

        anomalies = find_cross_system_anomalies(sfdc, sap, matches)
        timing_gaps = [a for a in anomalies if a["type"] == "timing_gap"]
        assert len(timing_gaps) == 0

    def test_detects_timing_gap_66_days(self):
        """66-day gap (> 60) should be detected as high-severity timing_gap."""
        sfdc = [_make_sfdc("OPP001", "2024-01-01", 100_000)]
        sap = [_make_sap("SAP001", "2024-03-07", 100_000)]  # 66 days later
        matches = [_make_match("OPP001", "SAP001")]

        anomalies = find_cross_system_anomalies(sfdc, sap, matches)
        timing_gaps = [a for a in anomalies if a["type"] == "timing_gap"]
        assert len(timing_gaps) == 1
        assert timing_gaps[0]["severity"] == "high"
        assert timing_gaps[0]["sfdc_id"] == "OPP001"
        assert timing_gaps[0]["sap_id"] == "SAP001"
        assert "66" in timing_gaps[0]["evidence"]

    def test_timing_gap_medium_severity_between_30_and_60(self):
        """45-day gap (> 30 but <= 60) should be medium severity."""
        sfdc = [_make_sfdc("OPP002", "2024-01-01", 50_000)]
        sap = [_make_sap("SAP002", "2024-02-15", 50_000)]  # 45 days
        matches = [_make_match("OPP002", "SAP002")]

        anomalies = find_cross_system_anomalies(sfdc, sap, matches)
        timing_gaps = [a for a in anomalies if a["type"] == "timing_gap"]
        assert len(timing_gaps) == 1
        assert timing_gaps[0]["severity"] == "medium"

    def test_custom_threshold(self):
        """Gap of 10 days should not trigger with threshold=30 but should with threshold=5."""
        sfdc = [_make_sfdc("OPP003", "2024-01-01", 50_000)]
        sap = [_make_sap("SAP003", "2024-01-11", 50_000)]  # 10 days
        matches = [_make_match("OPP003", "SAP003")]

        anomalies_30 = find_cross_system_anomalies(sfdc, sap, matches, gap_threshold_days=30)
        assert len([a for a in anomalies_30 if a["type"] == "timing_gap"]) == 0

        anomalies_5 = find_cross_system_anomalies(sfdc, sap, matches, gap_threshold_days=5)
        assert len([a for a in anomalies_5 if a["type"] == "timing_gap"]) == 1


# ---------------------------------------------------------------------------
# find_cross_system_anomalies — amount_discrepancy
# ---------------------------------------------------------------------------


class TestAmountDiscrepancy:
    def test_detects_30_percent_discrepancy(self):
        """30% discrepancy (> 20%) should be detected as high-severity."""
        sfdc = [_make_sfdc("OPP001", "2024-03-01", 100_000)]
        sap = [_make_sap("SAP001", "2024-03-05", 130_000)]  # 30% higher
        matches = [_make_match("OPP001", "SAP001")]

        anomalies = find_cross_system_anomalies(sfdc, sap, matches)
        discrepancies = [a for a in anomalies if a["type"] == "amount_discrepancy"]
        assert len(discrepancies) == 1
        assert discrepancies[0]["severity"] == "high"
        assert discrepancies[0]["sfdc_id"] == "OPP001"
        assert discrepancies[0]["sap_id"] == "SAP001"

    def test_no_discrepancy_within_tolerance(self):
        """3% difference (within 5% tolerance) should not trigger anomaly."""
        sfdc = [_make_sfdc("OPP001", "2024-03-01", 100_000)]
        sap = [_make_sap("SAP001", "2024-03-05", 103_000)]
        matches = [_make_match("OPP001", "SAP001")]

        anomalies = find_cross_system_anomalies(sfdc, sap, matches)
        discrepancies = [a for a in anomalies if a["type"] == "amount_discrepancy"]
        assert len(discrepancies) == 0

    def test_medium_severity_discrepancy_between_5_and_20_percent(self):
        """10% discrepancy (> 5%, <= 20%) should be medium severity."""
        sfdc = [_make_sfdc("OPP001", "2024-03-01", 100_000)]
        sap = [_make_sap("SAP001", "2024-03-05", 110_000)]  # 10% higher
        matches = [_make_match("OPP001", "SAP001")]

        anomalies = find_cross_system_anomalies(sfdc, sap, matches)
        discrepancies = [a for a in anomalies if a["type"] == "amount_discrepancy"]
        assert len(discrepancies) == 1
        assert discrepancies[0]["severity"] == "medium"


# ---------------------------------------------------------------------------
# find_cross_system_anomalies — sequence_violation
# ---------------------------------------------------------------------------


class TestSequenceViolation:
    def test_detects_sequence_violation(self):
        """SAP order before SFDC close date should trigger sequence_violation."""
        sfdc = [_make_sfdc("OPP001", "2024-03-15", 100_000)]
        sap = [_make_sap("SAP001", "2024-03-10", 100_000)]  # 5 days BEFORE close
        matches = [_make_match("OPP001", "SAP001")]

        anomalies = find_cross_system_anomalies(sfdc, sap, matches)
        violations = [a for a in anomalies if a["type"] == "sequence_violation"]
        assert len(violations) == 1
        assert violations[0]["severity"] == "high"
        assert violations[0]["sfdc_id"] == "OPP001"

    def test_no_sequence_violation_when_sap_after_sfdc(self):
        """SAP order 3 days after SFDC close should not trigger sequence_violation."""
        sfdc = [_make_sfdc("OPP001", "2024-03-01", 100_000)]
        sap = [_make_sap("SAP001", "2024-03-04", 100_000)]
        matches = [_make_match("OPP001", "SAP001")]

        anomalies = find_cross_system_anomalies(sfdc, sap, matches)
        violations = [a for a in anomalies if a["type"] == "sequence_violation"]
        assert len(violations) == 0


# ---------------------------------------------------------------------------
# find_cross_system_anomalies — missing_handoff
# ---------------------------------------------------------------------------


class TestMissingHandoff:
    def test_detects_missing_handoff(self):
        """SFDC Closed Won with sap_order_id but no matching SAP record = missing_handoff."""
        sfdc = [_make_sfdc("OPP001", "2024-03-01", 100_000, sap_order_id="SAP_GHOST")]
        sap = []  # no SAP records
        matches = []  # no matches

        anomalies = find_cross_system_anomalies(sfdc, sap, matches)
        handoffs = [a for a in anomalies if a["type"] == "missing_handoff"]
        assert len(handoffs) == 1
        assert handoffs[0]["severity"] == "high"
        assert handoffs[0]["sfdc_id"] == "OPP001"
        assert handoffs[0]["sap_id"] == "SAP_GHOST"

    def test_no_missing_handoff_when_sap_record_exists(self):
        """When SAP record exists for the sap_order_id, no missing_handoff."""
        sfdc = [_make_sfdc("OPP001", "2024-03-01", 100_000, sap_order_id="SAP001")]
        sap = [_make_sap("SAP001", "2024-03-05", 100_000)]
        matches = [_make_match("OPP001", "SAP001")]

        anomalies = find_cross_system_anomalies(sfdc, sap, matches)
        handoffs = [a for a in anomalies if a["type"] == "missing_handoff"]
        assert len(handoffs) == 0

    def test_no_missing_handoff_for_non_won_opp(self):
        """Non-won opportunity with sap_order_id should not trigger missing_handoff."""
        sfdc = [_make_sfdc(
            "OPP001", "2024-03-01", 100_000,
            stage_name="Closed Lost", is_won=False, sap_order_id="SAP_GHOST"
        )]
        sap = []
        matches = []

        anomalies = find_cross_system_anomalies(sfdc, sap, matches)
        handoffs = [a for a in anomalies if a["type"] == "missing_handoff"]
        assert len(handoffs) == 0

    def test_no_missing_handoff_when_no_sap_order_id(self):
        """Closed Won with no sap_order_id should not trigger missing_handoff."""
        sfdc = [_make_sfdc("OPP001", "2024-03-01", 100_000, sap_order_id=None)]
        sap = []
        matches = []

        anomalies = find_cross_system_anomalies(sfdc, sap, matches)
        handoffs = [a for a in anomalies if a["type"] == "missing_handoff"]
        assert len(handoffs) == 0


# ---------------------------------------------------------------------------
# find_cross_system_anomalies — edge cases
# ---------------------------------------------------------------------------


class TestEdgeCases:
    def test_empty_inputs(self):
        anomalies = find_cross_system_anomalies([], [], [])
        assert anomalies == []

    def test_match_with_missing_sfdc_record_skipped(self):
        """Match referencing unknown sfdc_id should be silently skipped."""
        sap = [_make_sap("SAP001", "2024-03-05", 100_000)]
        matches = [_make_match("UNKNOWN_OPP", "SAP001")]
        anomalies = find_cross_system_anomalies([], sap, matches)
        assert anomalies == []

    def test_match_with_missing_sap_record_skipped(self):
        """Match referencing unknown sap_id should be silently skipped."""
        sfdc = [_make_sfdc("OPP001", "2024-03-01", 100_000)]
        matches = [_make_match("OPP001", "UNKNOWN_SAP")]
        anomalies = find_cross_system_anomalies(sfdc, [], matches)
        # Only potential missing_handoff (if sap_order_id set), no crash
        assert isinstance(anomalies, list)


# ---------------------------------------------------------------------------
# compute_cross_system_metrics
# ---------------------------------------------------------------------------


class TestComputeCrossSystemMetrics:
    def test_basic_metrics(self):
        sfdc = [
            _make_sfdc("OPP001", "2024-01-01", 100_000),
            _make_sfdc("OPP002", "2024-02-01", 200_000),
            _make_sfdc("OPP003", "2024-03-01", 300_000),
        ]
        sap = [
            _make_sap("SAP001", "2024-01-06", 100_000),  # 5-day gap
            _make_sap("SAP002", "2024-02-11", 200_000),  # 10-day gap
        ]
        matches = [
            _make_match("OPP001", "SAP001"),
            _make_match("OPP002", "SAP002"),
        ]

        metrics = compute_cross_system_metrics(sfdc, sap, matches)

        assert metrics["total_sfdc"] == 3
        assert metrics["total_sap"] == 2
        assert metrics["total_matched"] == 2
        assert metrics["unmatched_sfdc"] == 1  # OPP003 not matched
        assert metrics["unmatched_sap"] == 0   # both SAP records matched

    def test_avg_gap_days(self):
        """Average gap should be (5 + 10) / 2 = 7.5 days."""
        sfdc = [
            _make_sfdc("OPP001", "2024-01-01", 100_000),
            _make_sfdc("OPP002", "2024-02-01", 200_000),
        ]
        sap = [
            _make_sap("SAP001", "2024-01-06", 100_000),  # 5-day gap
            _make_sap("SAP002", "2024-02-11", 200_000),  # 10-day gap
        ]
        matches = [
            _make_match("OPP001", "SAP001"),
            _make_match("OPP002", "SAP002"),
        ]

        metrics = compute_cross_system_metrics(sfdc, sap, matches)
        assert metrics["avg_gap_days"] == pytest.approx(7.5)

    def test_empty_inputs(self):
        metrics = compute_cross_system_metrics([], [], [])
        assert metrics["total_sfdc"] == 0
        assert metrics["total_sap"] == 0
        assert metrics["total_matched"] == 0
        assert metrics["avg_gap_days"] == 0.0
        assert metrics["match_rate"] == 0.0

    def test_match_rate(self):
        sfdc = [
            _make_sfdc("OPP001", "2024-01-01", 100_000),
            _make_sfdc("OPP002", "2024-02-01", 200_000),
        ]
        sap = [_make_sap("SAP001", "2024-01-05", 100_000)]
        matches = [_make_match("OPP001", "SAP001")]

        metrics = compute_cross_system_metrics(sfdc, sap, matches)
        assert metrics["match_rate"] == pytest.approx(0.5)  # 1 of 2 matched
