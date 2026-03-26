"""
Tests for SFDC Opportunity Pipeline Conformance Models.

Covers:
- Model construction: activities and transitions present
- Conforming trace: fitness >= 0.9
- Stage-skip detection: skipping mandatory intermediate stages
- Stage regression detection: backward stage move
- Factory function: get_opportunity_model dispatch
"""

from __future__ import annotations

import pytest
from datetime import datetime, timedelta

from src.conformance.checker import ConformanceChecker
from src.conformance.models import ProcessModel
from src.conformance.templates.opportunity_pipeline import (
    get_new_business_model,
    get_opportunity_model,
    get_renewal_model,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

BASE_DATE = datetime(2024, 1, 1, 9, 0, 0)


def _ts(days: int = 0) -> str:
    """Return ISO-8601 timestamp offset *days* from BASE_DATE."""
    return (BASE_DATE + timedelta(days=days)).isoformat()


def _make_trace(*stage_names: str) -> list:
    """Build a minimal event trace from ordered stage names."""
    return [
        {"activity": stage, "timestamp": _ts(i)}
        for i, stage in enumerate(stage_names)
    ]


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def nb_model() -> ProcessModel:
    return get_new_business_model()


@pytest.fixture
def renewal_model() -> ProcessModel:
    return get_renewal_model()


@pytest.fixture
def nb_checker(nb_model: ProcessModel) -> ConformanceChecker:
    return ConformanceChecker(nb_model)


@pytest.fixture
def renewal_checker(renewal_model: ProcessModel) -> ConformanceChecker:
    return ConformanceChecker(renewal_model)


# ---------------------------------------------------------------------------
# Tests: model structure
# ---------------------------------------------------------------------------


class TestNewBusinessModel:
    def test_returns_process_model(self, nb_model: ProcessModel) -> None:
        assert isinstance(nb_model, ProcessModel)

    def test_has_activities(self, nb_model: ProcessModel) -> None:
        assert len(nb_model.activities) >= 10  # 8 stages + Closed Won + Closed Lost

    def test_has_transitions(self, nb_model: ProcessModel) -> None:
        assert len(nb_model.transitions) > 0

    def test_start_activity_is_prospecting(self, nb_model: ProcessModel) -> None:
        assert "Prospecting" in nb_model.start_activities

    def test_end_activities_include_closed_won(self, nb_model: ProcessModel) -> None:
        assert "Closed Won" in nb_model.end_activities

    def test_closed_lost_in_activities(self, nb_model: ProcessModel) -> None:
        # Closed Lost is OPTIONAL (not an END activity) so that traces ending
        # with Closed Won are not penalised for its absence.
        assert "Closed Lost" in nb_model.activities

    def test_all_pipeline_stages_present(self, nb_model: ProcessModel) -> None:
        expected_stages = [
            "Prospecting",
            "Qualification",
            "Needs Analysis",
            "Value Proposition",
            "Id. Decision Makers",
            "Perception Analysis",
            "Proposal/Price Quote",
            "Negotiation/Review",
            "Closed Won",
            "Closed Lost",
        ]
        for stage in expected_stages:
            assert stage in nb_model.activities, f"Missing stage: {stage}"

    def test_sequential_transitions_exist(self, nb_model: ProcessModel) -> None:
        # Prospecting -> Qualification must be a valid transition
        assert nb_model.is_valid_transition("Prospecting", "Qualification")
        # Negotiation/Review -> Closed Won must be valid
        assert nb_model.is_valid_transition("Negotiation/Review", "Closed Won")


class TestRenewalModel:
    def test_returns_process_model(self, renewal_model: ProcessModel) -> None:
        assert isinstance(renewal_model, ProcessModel)

    def test_has_activities(self, renewal_model: ProcessModel) -> None:
        assert len(renewal_model.activities) == 4  # Qualification, Proposal, Won, Lost

    def test_start_activity_is_qualification(self, renewal_model: ProcessModel) -> None:
        assert "Qualification" in renewal_model.start_activities

    def test_has_transitions(self, renewal_model: ProcessModel) -> None:
        assert len(renewal_model.transitions) > 0

    def test_proposal_to_closed_won(self, renewal_model: ProcessModel) -> None:
        assert renewal_model.is_valid_transition("Proposal", "Closed Won")

    def test_proposal_to_closed_lost(self, renewal_model: ProcessModel) -> None:
        assert renewal_model.is_valid_transition("Proposal", "Closed Lost")


# ---------------------------------------------------------------------------
# Tests: conforming trace
# ---------------------------------------------------------------------------


class TestConformingTrace:
    def test_full_new_business_trace_is_conformant(self, nb_checker: ConformanceChecker) -> None:
        trace = _make_trace(
            "Prospecting",
            "Qualification",
            "Needs Analysis",
            "Value Proposition",
            "Id. Decision Makers",
            "Perception Analysis",
            "Proposal/Price Quote",
            "Negotiation/Review",
            "Closed Won",
        )
        result = nb_checker.check_trace(trace, case_id="FULL_TRACE")
        assert result.fitness_score >= 0.9, (
            f"Expected fitness >= 0.9 for full conforming trace, got {result.fitness_score}"
        )

    def test_full_renewal_trace_is_conformant(
        self, renewal_checker: ConformanceChecker
    ) -> None:
        trace = _make_trace("Qualification", "Proposal", "Closed Won")
        result = renewal_checker.check_trace(trace, case_id="RENEWAL_FULL")
        assert result.fitness_score >= 0.9, (
            f"Expected fitness >= 0.9 for renewal conforming trace, got {result.fitness_score}"
        )

    def test_conforming_trace_has_no_critical_deviations(
        self, nb_checker: ConformanceChecker
    ) -> None:
        trace = _make_trace(
            "Prospecting",
            "Qualification",
            "Needs Analysis",
            "Value Proposition",
            "Id. Decision Makers",
            "Perception Analysis",
            "Proposal/Price Quote",
            "Negotiation/Review",
            "Closed Won",
        )
        result = nb_checker.check_trace(trace, case_id="NO_CRITICAL")
        assert result.is_conformant, "Full conforming trace should be conformant"


# ---------------------------------------------------------------------------
# Tests: stage-skip detection
# ---------------------------------------------------------------------------


class TestStageSkipDetection:
    def test_skip_detected(self, nb_checker: ConformanceChecker) -> None:
        """Jumping from Prospecting straight to Closed Won should be detected."""
        trace = _make_trace("Prospecting", "Closed Won")
        result = nb_checker.check_trace(trace, case_id="STAGE_SKIP")
        # Fitness should be lower than a conforming trace
        assert result.fitness_score < 0.9, (
            f"Stage-skip should reduce fitness below 0.9, got {result.fitness_score}"
        )

    def test_skip_produces_deviations(self, nb_checker: ConformanceChecker) -> None:
        trace = _make_trace("Prospecting", "Closed Won")
        result = nb_checker.check_trace(trace, case_id="STAGE_SKIP_DEVS")
        assert len(result.deviations) > 0, "Stage-skip should produce at least one deviation"

    def test_partial_skip_lower_fitness(self, nb_checker: ConformanceChecker) -> None:
        """Skipping several intermediate stages should reduce fitness."""
        # Skip Needs Analysis → Perception Analysis (jump from Qualification)
        trace = _make_trace(
            "Prospecting",
            "Qualification",
            "Proposal/Price Quote",
            "Negotiation/Review",
            "Closed Won",
        )
        result = nb_checker.check_trace(trace, case_id="PARTIAL_SKIP")
        assert result.fitness_score < 1.0, "Partial skip should not be fully conformant"


# ---------------------------------------------------------------------------
# Tests: stage regression detection
# ---------------------------------------------------------------------------


class TestStageRegressionDetection:
    def test_regression_produces_deviations(self, nb_checker: ConformanceChecker) -> None:
        """Moving backward (e.g. Qualification after Needs Analysis) is a deviation."""
        trace = _make_trace(
            "Prospecting",
            "Qualification",
            "Needs Analysis",
            "Qualification",   # regression: back to an earlier stage
            "Value Proposition",
            "Id. Decision Makers",
            "Perception Analysis",
            "Proposal/Price Quote",
            "Negotiation/Review",
            "Closed Won",
        )
        result = nb_checker.check_trace(trace, case_id="REGRESSION")
        # A regression should either reduce fitness or produce deviations
        assert (
            len(result.deviations) > 0 or not result.is_fully_conformant
        ), "Stage regression should not produce a fully conformant result"

    def test_regression_lowers_fitness_vs_clean(
        self, nb_checker: ConformanceChecker
    ) -> None:
        clean = _make_trace(
            "Prospecting",
            "Qualification",
            "Needs Analysis",
            "Value Proposition",
            "Id. Decision Makers",
            "Perception Analysis",
            "Proposal/Price Quote",
            "Negotiation/Review",
            "Closed Won",
        )
        regressed = _make_trace(
            "Prospecting",
            "Qualification",
            "Needs Analysis",
            "Qualification",   # regression
            "Value Proposition",
            "Id. Decision Makers",
            "Perception Analysis",
            "Proposal/Price Quote",
            "Negotiation/Review",
            "Closed Won",
        )
        clean_result = nb_checker.check_trace(clean, case_id="CLEAN")
        reg_result = nb_checker.check_trace(regressed, case_id="REG")
        assert reg_result.fitness_score <= clean_result.fitness_score, (
            "Regression trace should not score higher than clean trace"
        )


# ---------------------------------------------------------------------------
# Tests: factory function
# ---------------------------------------------------------------------------


class TestGetOpportunityModel:
    def test_new_business_returns_nb_model(self) -> None:
        model = get_opportunity_model("New Business")
        assert model.name == "sfdc_new_business"

    def test_renewal_returns_renewal_model(self) -> None:
        model = get_opportunity_model("Renewal")
        assert model.name == "sfdc_renewal"

    def test_default_returns_nb_model(self) -> None:
        model = get_opportunity_model()
        assert model.name == "sfdc_new_business"

    def test_unknown_type_returns_nb_model(self) -> None:
        model = get_opportunity_model("Upsell")
        assert model.name == "sfdc_new_business"
