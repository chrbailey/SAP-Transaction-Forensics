"""
Pattern detection tests that validate planted anomalies in the actual
generated synthetic SFDC data at synthetic-data/sfdc_output/.

Tests are skipped with pytest.mark.skipif if data has not been generated.

Imports use:
    src.ingest.sfdc_adapter  (load_sfdc_data, sfdc_to_event_log)
    src.conformance          (ConformanceChecker)
    src.conformance.templates.opportunity_pipeline (get_new_business_model)
"""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime
from pathlib import Path
from typing import Dict, List

import pytest

# Data directory (relative to this test file: three levels up, then synthetic-data/sfdc_output)
DATA_DIR = Path(__file__).parent.parent.parent / "synthetic-data" / "sfdc_output"
DATA_AVAILABLE = DATA_DIR.is_dir() and (DATA_DIR / "opportunities.json").exists()

skip_if_no_data = pytest.mark.skipif(
    not DATA_AVAILABLE,
    reason=f"Synthetic SFDC data not found at {DATA_DIR}. Run generate_sfdc.py first.",
)


# ---------------------------------------------------------------------------
# Shared fixture: load data once per module
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def sfdc_data():
    """Load SFDC data from sfdc_output/."""
    from src.ingest.sfdc_adapter import load_sfdc_data

    return load_sfdc_data(str(DATA_DIR))


@pytest.fixture(scope="module")
def event_log(sfdc_data):
    """Convert loaded SFDC data to a flat event log."""
    from src.ingest.sfdc_adapter import sfdc_to_event_log

    return sfdc_to_event_log(sfdc_data)


@pytest.fixture(scope="module")
def events_by_case(event_log):
    """Group event log by case_id."""
    by_case: Dict[str, List] = defaultdict(list)
    for ev in event_log:
        by_case[ev["case_id"]].append(ev)
    return by_case


# ---------------------------------------------------------------------------
# 1. STAGE_SKIP — conformance checker detects missing stages
# ---------------------------------------------------------------------------


@skip_if_no_data
def test_stage_skip_detected(sfdc_data, events_by_case):
    """
    STAGE_SKIP-flagged opportunities should have at least 50% non-conformant
    traces when checked with strict mode (any deviation = non-conformant).
    """
    from src.conformance import ConformanceChecker
    from src.conformance.templates.opportunity_pipeline import get_new_business_model

    model = get_new_business_model()
    checker = ConformanceChecker(model, strict_mode=True)

    stage_skip_opps = [
        o
        for o in sfdc_data["opportunities"]
        if "STAGE_SKIP" in o.get("_pattern_flags", [])
    ]
    assert len(stage_skip_opps) > 0, "Expected at least one STAGE_SKIP opportunity"

    non_conformant = 0
    checked = 0
    for opp in stage_skip_opps:
        opp_id = opp["id"]
        # Only check stage_history events (not activities)
        trace = [
            e
            for e in events_by_case.get(opp_id, [])
            if e.get("event_source") == "stage_history"
        ]
        if not trace:
            continue
        result = checker.check_trace(trace, case_id=opp_id)
        checked += 1
        if not result.is_conformant:
            non_conformant += 1

    assert checked > 0, "No stage history traces found for STAGE_SKIP opps"
    detection_rate = non_conformant / checked
    assert detection_rate >= 0.50, (
        f"Expected >=50% of STAGE_SKIP opps to be non-conformant, "
        f"got {non_conformant}/{checked} ({detection_rate:.0%})"
    )


# ---------------------------------------------------------------------------
# 2. GHOST_PIPELINE — zero activities
# ---------------------------------------------------------------------------


@skip_if_no_data
def test_ghost_pipeline_detected(sfdc_data):
    """
    GHOST_PIPELINE-flagged opportunities must have 0 activities in
    the activities_by_opp index returned by load_sfdc_data.
    """
    activities_by_opp = sfdc_data["activities_by_opp"]

    ghost_opps = [
        o
        for o in sfdc_data["opportunities"]
        if "GHOST_PIPELINE" in o.get("_pattern_flags", [])
    ]
    assert len(ghost_opps) > 0, "Expected at least one GHOST_PIPELINE opportunity"

    for opp in ghost_opps:
        opp_id = opp["id"]
        acts = activities_by_opp.get(opp_id, [])
        assert len(acts) == 0, (
            f"GHOST_PIPELINE opp {opp_id} should have 0 activities, "
            f"but found {len(acts)}"
        )


# ---------------------------------------------------------------------------
# 3. QUARTER_END_COMPRESSION — close dates in last 5 days of quarter
# ---------------------------------------------------------------------------


@skip_if_no_data
def test_quarter_end_compression(sfdc_data):
    """
    QUARTER_END_COMPRESSION-flagged opportunities must have close_date
    in a quarter-end month (3, 6, 9, 12) AND day in the last 5 days
    of that month (>= 27 for 31-day months, >= 26 for 30-day months).
    We simplify to: month in (3,6,9,12) AND day >= 26.
    """
    quarter_end_opps = [
        o
        for o in sfdc_data["opportunities"]
        if "QUARTER_END_COMPRESSION" in o.get("_pattern_flags", [])
    ]
    assert len(quarter_end_opps) > 0, "Expected at least one QUARTER_END_COMPRESSION opportunity"

    # Some QUARTER_END opps also have SPEED_ANOMALY which overwrites the
    # close_date (SPEED_ANOMALY runs after QUARTER_END in the generator).
    # Exclude those from the month/day check — they are not a data defect.
    pure_quarter_end_opps = [
        o for o in quarter_end_opps
        if "SPEED_ANOMALY" not in o.get("_pattern_flags", [])
    ]
    assert len(pure_quarter_end_opps) > 0, (
        "Expected at least some QUARTER_END opps without SPEED_ANOMALY override"
    )

    for opp in pure_quarter_end_opps:
        close_dt = datetime.strptime(opp["close_date"], "%Y-%m-%d")
        assert close_dt.month in (3, 6, 9, 12), (
            f"QUARTER_END opp {opp['id']} close_date {opp['close_date']} "
            f"not in quarter-end month (3/6/9/12)"
        )
        # Last 5 days: for months with 28-31 days, day >= 24 covers last 5 days
        # Generator uses last 5 days of quarter (days_back in 0..4)
        # June has 30 days -> last 5 = 26-30. March has 31 -> last 5 = 27-31.
        # Sept has 30 -> last 5 = 26-30. Dec has 31 -> last 5 = 27-31.
        # Conservative check: day >= 26
        assert close_dt.day >= 26, (
            f"QUARTER_END opp {opp['id']} close_date {opp['close_date']} "
            f"day {close_dt.day} not in last 5 days of month"
        )


# ---------------------------------------------------------------------------
# 4. SPEED_ANOMALY — closed within 3 days of creation
# ---------------------------------------------------------------------------


@skip_if_no_data
def test_speed_anomaly(sfdc_data):
    """
    SPEED_ANOMALY-flagged opportunities must close within 3 days of creation.
    """
    speed_opps = [
        o
        for o in sfdc_data["opportunities"]
        if "SPEED_ANOMALY" in o.get("_pattern_flags", [])
    ]
    assert len(speed_opps) > 0, "Expected at least one SPEED_ANOMALY opportunity"

    for opp in speed_opps:
        created_dt = datetime.strptime(opp["created_date"], "%Y-%m-%d")
        close_dt = datetime.strptime(opp["close_date"], "%Y-%m-%d")
        days_to_close = (close_dt - created_dt).days
        assert days_to_close <= 3, (
            f"SPEED_ANOMALY opp {opp['id']} took {days_to_close} days to close, "
            f"expected <= 3"
        )


# ---------------------------------------------------------------------------
# 5. CROSS_SYSTEM_GAP — sap_order_number/sap_order_id is set
# ---------------------------------------------------------------------------


@skip_if_no_data
def test_cross_system_gap(sfdc_data):
    """
    CROSS_SYSTEM_GAP-flagged opportunities must have sap_order_id set
    (indicating they are SAP-linked, which is the prerequisite for a
    cross-system gap to exist).
    """
    gap_opps = [
        o
        for o in sfdc_data["opportunities"]
        if "CROSS_SYSTEM_GAP" in o.get("_pattern_flags", [])
    ]
    assert len(gap_opps) > 0, "Expected at least one CROSS_SYSTEM_GAP opportunity"

    for opp in gap_opps:
        sap_order_id = opp.get("sap_order_id") or opp.get("sap_order_number")
        assert sap_order_id, (
            f"CROSS_SYSTEM_GAP opp {opp['id']} should have sap_order_id set, "
            f"but got: {sap_order_id!r}"
        )


# ---------------------------------------------------------------------------
# 6. STAGE_REGRESSION — backward stage movement detected by conformance
# ---------------------------------------------------------------------------


@skip_if_no_data
def test_stage_regression_detected(sfdc_data, events_by_case):
    """
    STAGE_REGRESSION-flagged opportunities should be detected as non-conformant
    by the conformance checker (backward stage movement violates the model).
    At least 50% must be flagged non-conformant.
    """
    from src.conformance import ConformanceChecker
    from src.conformance.templates.opportunity_pipeline import get_new_business_model

    model = get_new_business_model()
    checker = ConformanceChecker(model, strict_mode=True)

    regression_opps = [
        o
        for o in sfdc_data["opportunities"]
        if "STAGE_REGRESSION" in o.get("_pattern_flags", [])
    ]
    assert len(regression_opps) > 0, "Expected at least one STAGE_REGRESSION opportunity"

    non_conformant = 0
    checked = 0
    for opp in regression_opps:
        opp_id = opp["id"]
        trace = [
            e
            for e in events_by_case.get(opp_id, [])
            if e.get("event_source") == "stage_history"
        ]
        if not trace:
            continue
        result = checker.check_trace(trace, case_id=opp_id)
        checked += 1
        if not result.is_conformant:
            non_conformant += 1

    assert checked > 0, "No stage history traces found for STAGE_REGRESSION opps"
    detection_rate = non_conformant / checked
    assert detection_rate >= 0.50, (
        f"Expected >=50% of STAGE_REGRESSION opps to be non-conformant, "
        f"got {non_conformant}/{checked} ({detection_rate:.0%})"
    )


# ---------------------------------------------------------------------------
# 7. AMOUNT_INFLATION — inflated amount set on last stage history entry
# ---------------------------------------------------------------------------


@skip_if_no_data
def test_amount_inflation_detected(sfdc_data):
    """
    AMOUNT_INFLATION-flagged opportunities must have the last stage_history
    entry's amount set (non-None) and equal to the opportunity's current
    amount, confirming the >50% inflation was applied to the final stage.
    """
    histories_by_opp = sfdc_data["histories_by_opp"]

    inflation_opps = [
        o
        for o in sfdc_data["opportunities"]
        if "AMOUNT_INFLATION" in o.get("_pattern_flags", [])
    ]
    assert len(inflation_opps) > 0, "Expected at least one AMOUNT_INFLATION opportunity"

    for opp in inflation_opps:
        opp_id = opp["id"]
        histories = histories_by_opp.get(opp_id, [])
        assert histories, (
            f"AMOUNT_INFLATION opp {opp_id} has no stage history entries"
        )
        last_h = max(histories, key=lambda h: h.get("created_date", ""))
        last_amount = last_h.get("amount")
        assert last_amount is not None, (
            f"AMOUNT_INFLATION opp {opp_id} last history entry has no amount set"
        )
        assert last_amount == opp["amount"], (
            f"AMOUNT_INFLATION opp {opp_id} last history amount {last_amount} "
            f"does not match opp amount {opp['amount']}"
        )


# ---------------------------------------------------------------------------
# 8. SPLIT_DEAL — sibling opportunity on same account within 7 days
# ---------------------------------------------------------------------------


@skip_if_no_data
def test_split_deal_detected(sfdc_data):
    """
    SPLIT_DEAL-flagged opportunities must have at least one other SPLIT_DEAL
    opportunity on the same account_id.

    Note: we check for a sibling with the SPLIT_DEAL flag on the same account
    rather than enforcing the 7-day window here, because the STALE_PIPELINE
    pattern (applied after SPLIT_DEAL) can backdate created_date on the
    original opp, making the apparent gap exceed 7 days in the output data.
    """
    all_opps = sfdc_data["opportunities"]

    split_opps = [
        o
        for o in all_opps
        if "SPLIT_DEAL" in o.get("_pattern_flags", [])
    ]
    assert len(split_opps) > 0, "Expected at least one SPLIT_DEAL opportunity"

    for opp in split_opps:
        opp_id = opp["id"]
        account_id = opp["account_id"]

        siblings = [
            o2 for o2 in all_opps
            if o2["id"] != opp_id
            and o2["account_id"] == account_id
            and "SPLIT_DEAL" in o2.get("_pattern_flags", [])
        ]
        assert siblings, (
            f"SPLIT_DEAL opp {opp_id} (account {account_id}) "
            f"has no sibling SPLIT_DEAL opp on the same account"
        )


# ---------------------------------------------------------------------------
# 9. STALE_PIPELINE — open opp created >90 days before dataset end
# ---------------------------------------------------------------------------


@skip_if_no_data
def test_stale_pipeline_detected(sfdc_data):
    """
    STALE_PIPELINE-flagged opportunities must be open (not closed) AND have
    a created_date more than 90 days before the dataset end date (2025-12-31).
    """
    dataset_end = datetime(2025, 12, 31)

    stale_opps = [
        o
        for o in sfdc_data["opportunities"]
        if "STALE_PIPELINE" in o.get("_pattern_flags", [])
    ]
    assert len(stale_opps) > 0, "Expected at least one STALE_PIPELINE opportunity"

    for opp in stale_opps:
        assert not opp.get("is_closed", True), (
            f"STALE_PIPELINE opp {opp['id']} should be open (is_closed=False), "
            f"but is_closed={opp.get('is_closed')}"
        )
        created = datetime.strptime(opp["created_date"], "%Y-%m-%d")
        days_stale = (dataset_end - created).days
        assert days_stale > 90, (
            f"STALE_PIPELINE opp {opp['id']} created_date {opp['created_date']} "
            f"is only {days_stale} days before dataset end (expected >90)"
        )


# ---------------------------------------------------------------------------
# 10. OWNER_SWAP_AT_CLOSE — last stage history entry has different owner
# ---------------------------------------------------------------------------


@skip_if_no_data
def test_owner_swap_detected(sfdc_data):
    """
    OWNER_SWAP_AT_CLOSE-flagged opportunities must have the last stage_history
    entry's owner_id differ from the opportunity's owner_id, indicating the
    owner was swapped in the final stage.
    """
    histories_by_opp = sfdc_data["histories_by_opp"]

    owner_swap_opps = [
        o
        for o in sfdc_data["opportunities"]
        if "OWNER_SWAP_AT_CLOSE" in o.get("_pattern_flags", [])
    ]
    assert len(owner_swap_opps) > 0, "Expected at least one OWNER_SWAP_AT_CLOSE opportunity"

    for opp in owner_swap_opps:
        opp_id = opp["id"]
        histories = histories_by_opp.get(opp_id, [])
        assert histories, (
            f"OWNER_SWAP_AT_CLOSE opp {opp_id} has no stage history entries"
        )
        last_h = max(histories, key=lambda h: h.get("created_date", ""))
        last_owner = last_h.get("owner_id")
        opp_owner = opp.get("owner_id")
        assert last_owner != opp_owner, (
            f"OWNER_SWAP_AT_CLOSE opp {opp_id} last history owner_id {last_owner!r} "
            f"should differ from opp owner_id {opp_owner!r}"
        )
