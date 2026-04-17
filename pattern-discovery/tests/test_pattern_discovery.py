"""Tests for the forensic pattern discovery critic-loop."""
from __future__ import annotations

import json
import sqlite3
import sys
from pathlib import Path

import pytest

# Allow imports from the parent directory
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from pattern_discovery import (  # noqa: E402
    ralph_route,
    worker_propose,
    critic_review,
    discover_patterns,
)
from patterns_db import PatternsDB  # noqa: E402


# ============================================================================
# Fixtures
# ============================================================================

@pytest.fixture
def db(tmp_path):
    db_path = tmp_path / "test_patterns.db"
    database = PatternsDB(db_path)
    yield database
    database.close()


@pytest.fixture
def sample_data(tmp_path):
    data = [
        {"id": "opp-001", "stage": "Closed Won", "amount": 50000},
        {"id": "opp-002", "stage": "Closed Lost", "amount": 12000},
        {"id": "opp-003", "stage": "Closed Won", "amount": 250000},
    ]
    path = tmp_path / "data.json"
    path.write_text(json.dumps(data))
    return path


# ============================================================================
# PatternsDB — append-only enforcement
# ============================================================================

class TestPatternsDBAppendOnly:
    def test_observations_cannot_be_updated(self, db):
        pid = db.upsert_confirmed_pattern(
            name="test-pattern",
            description="test",
            category="anomaly",
            detection_signature="amount > 100000",
            confidence_basis="supported",
            run_id="run-1",
            observation_count=1,
        )
        db.record_observations(pid, ["tx-1"], "run-1")
        with pytest.raises(sqlite3.IntegrityError, match="append-only"):
            db.conn.execute(
                "UPDATE pattern_observations SET transaction_id = 'tx-2' WHERE pattern_id = ?",
                (pid,),
            )

    def test_observations_cannot_be_deleted(self, db):
        pid = db.upsert_confirmed_pattern(
            name="test-pattern",
            description="test",
            category="anomaly",
            detection_signature="amount > 100000",
            confidence_basis="supported",
            run_id="run-1",
            observation_count=1,
        )
        db.record_observations(pid, ["tx-1"], "run-1")
        with pytest.raises(sqlite3.IntegrityError, match="append-only"):
            db.conn.execute("DELETE FROM pattern_observations WHERE pattern_id = ?", (pid,))


class TestPatternsDBLifecycle:
    def test_upsert_confirmed_creates_new(self, db):
        pid = db.upsert_confirmed_pattern(
            name="round-trip-close",
            description="Opp closed then reopened within 30d",
            category="sequence",
            detection_signature="close_date - created_date < 30d",
            confidence_basis="strong_multi_instance",
            run_id="r1",
            observation_count=5,
        )
        assert pid
        found = db.get_pattern_by_name("round-trip-close")
        assert found is not None
        assert found["status"] == "confirmed"
        assert found["evidence_count"] == 5

    def test_upsert_confirmed_increments_evidence(self, db):
        db.upsert_confirmed_pattern(
            "p1", "d", "anomaly", "sig", "supported", "r1", 3
        )
        db.upsert_confirmed_pattern(
            "p1", "d", "anomaly", "sig", "supported", "r2", 4
        )
        found = db.get_pattern_by_name("p1")
        assert found["evidence_count"] == 7
        assert found["last_confirmed_run_id"] == "r2"

    def test_record_rejection(self, db):
        db.record_rejection("bad-pattern", "d", "anomaly", "sig", "thin_evidence", "r1")
        found = db.get_pattern_by_name("bad-pattern")
        assert found["status"] == "rejected"
        assert found["rejection_count"] == 1

    def test_rejection_increments_counter(self, db):
        db.record_rejection("bad-pattern", "d", "anomaly", "sig", "thin_evidence", "r1")
        db.record_rejection("bad-pattern", "d", "anomaly", "sig", "thin_evidence", "r2")
        found = db.get_pattern_by_name("bad-pattern")
        assert found["rejection_count"] == 2

    def test_list_confirmed_only(self, db):
        db.upsert_confirmed_pattern("p1", "d", "anomaly", "s", "supported", "r1", 2)
        db.record_rejection("p2", "d", "anomaly", "s", "thin_evidence", "r1")
        confirmed = db.list_confirmed_patterns()
        assert len(confirmed) == 1
        assert confirmed[0]["name"] == "p1"


class TestPatternsDBRuns:
    def test_run_lifecycle(self, db):
        rid = db.start_run("some-file.json")
        assert rid
        db.complete_run(rid, 5, 3, 1, 1, 12345)
        run = db.get_run(rid)
        assert run["candidates_proposed"] == 5
        assert run["candidates_confirmed"] == 3
        assert run["status"] == "completed"
        assert run["duration_ms"] == 12345


class TestGetPriorPatternsJson:
    def test_empty_library(self, db):
        result = db.get_prior_patterns_json()
        assert json.loads(result) == []

    def test_includes_confirmed_patterns(self, db):
        db.upsert_confirmed_pattern(
            "p1", "desc", "anomaly", "sig", "strong_multi_instance", "r1", 10
        )
        result = db.get_prior_patterns_json()
        parsed = json.loads(result)
        assert len(parsed) == 1
        assert parsed[0]["name"] == "p1"
        assert parsed[0]["evidence_count"] == 10


# ============================================================================
# Ralph routing logic
# ============================================================================

class TestRalphRoute:
    def test_confirmed_on_pass_with_low_severity(self):
        candidates = [{"name": "p1"}]
        reviews = [{
            "candidate_name": "p1",
            "passed": True,
            "severity_of_findings": "none",
            "findings": [],
        }]
        confirmed, rejected, uncertain = ralph_route(candidates, reviews)
        assert len(confirmed) == 1
        assert not rejected
        assert not uncertain

    def test_rejected_on_high_severity(self):
        candidates = [{"name": "p1"}]
        reviews = [{
            "candidate_name": "p1",
            "passed": False,
            "severity_of_findings": "high",
            "findings": [{"category": "flattery", "detail": "uses 'obvious'"}],
        }]
        confirmed, rejected, uncertain = ralph_route(candidates, reviews)
        assert not confirmed
        assert len(rejected) == 1
        assert not uncertain

    def test_uncertain_on_medium_severity(self):
        candidates = [{"name": "p1"}]
        reviews = [{
            "candidate_name": "p1",
            "passed": False,
            "severity_of_findings": "medium",
            "findings": [],
        }]
        confirmed, rejected, uncertain = ralph_route(candidates, reviews)
        assert not confirmed
        assert not rejected
        assert len(uncertain) == 1

    def test_missing_review_routes_uncertain(self):
        candidates = [{"name": "orphan"}]
        reviews = []
        confirmed, rejected, uncertain = ralph_route(candidates, reviews)
        assert not confirmed
        assert not rejected
        assert len(uncertain) == 1

    def test_multiple_candidates_mixed_outcomes(self):
        candidates = [
            {"name": "good"},
            {"name": "bad"},
            {"name": "maybe"},
        ]
        reviews = [
            {"candidate_name": "good", "passed": True, "severity_of_findings": "none"},
            {"candidate_name": "bad", "passed": False, "severity_of_findings": "high"},
            {"candidate_name": "maybe", "passed": False, "severity_of_findings": "medium"},
        ]
        confirmed, rejected, uncertain = ralph_route(candidates, reviews)
        assert len(confirmed) == 1
        assert len(rejected) == 1
        assert len(uncertain) == 1


# ============================================================================
# Worker and Critic with mocked Claude
# ============================================================================

def _mock_call_factory(response_text: str):
    def _mock(system_prompt: str, user_prompt: str) -> str:
        return response_text
    return _mock


class TestWorkerPropose:
    def test_parses_valid_json(self):
        mock = _mock_call_factory(json.dumps({
            "candidates": [{"name": "p1", "description": "d", "category": "anomaly"}],
            "data_summary": "test",
            "total_transactions_reviewed": 3,
        }))
        result = worker_propose("data", "[]", call_claude=mock)
        assert "candidates" in result
        assert result["candidates"][0]["name"] == "p1"

    def test_strips_code_fences(self):
        mock = _mock_call_factory(
            "```json\n" + json.dumps({"candidates": []}) + "\n```"
        )
        result = worker_propose("data", "[]", call_claude=mock)
        assert result["candidates"] == []

    def test_invalid_json_returns_error(self):
        mock = _mock_call_factory("not json at all")
        result = worker_propose("data", "[]", call_claude=mock)
        assert "error" in result

    def test_api_exception_returns_error(self):
        def raising(sp, up):
            raise RuntimeError("api down")
        result = worker_propose("data", "[]", call_claude=raising)
        assert result["error"] == "api down"


class TestCriticReview:
    def test_parses_valid_json(self):
        mock = _mock_call_factory(json.dumps({
            "reviews": [{
                "candidate_name": "p1",
                "passed": True,
                "severity_of_findings": "none",
                "findings": [],
            }],
            "summary": "looks good",
        }))
        result = critic_review("data", [{"name": "p1"}], call_claude=mock)
        assert len(result["reviews"]) == 1
        assert result["reviews"][0]["passed"] is True

    def test_invalid_json_returns_error(self):
        mock = _mock_call_factory("broken")
        result = critic_review("data", [], call_claude=mock)
        assert "error" in result


# ============================================================================
# End-to-end with mocked API
# ============================================================================

class TestDiscoverPatternsE2E:
    def test_full_loop_with_mocks(self, tmp_path, sample_data):
        db_path = tmp_path / "patterns.db"

        def mock_call(system_prompt: str, user_prompt: str) -> str:
            if "forensic pattern analyst" in system_prompt:
                return json.dumps({
                    "candidates": [
                        {
                            "name": "high-value-won",
                            "description": "Opportunities over $100k that closed won",
                            "category": "outlier",
                            "detection_signature": "amount > 100000 AND stage = 'Closed Won'",
                            "supporting_transaction_ids": ["opp-003"],
                            "confidence_basis": "thin_evidence",
                            "relationship_to_prior": "novel_candidate",
                            "prior_pattern_name": None,
                        }
                    ],
                    "data_summary": "3 opportunities",
                    "total_transactions_reviewed": 3,
                })
            return json.dumps({
                "reviews": [{
                    "candidate_name": "high-value-won",
                    "passed": True,
                    "severity_of_findings": "low",
                    "findings": [],
                }],
                "summary": "thin evidence but correctly flagged",
            })

        result = discover_patterns(
            data_path=sample_data,
            db_path=db_path,
            call_claude=mock_call,
        )
        assert result.candidates_proposed == 1
        assert result.candidates_confirmed == 1
        assert result.candidates_rejected == 0
        assert result.duration_ms >= 0

        # Verify it landed in the DB
        db = PatternsDB(db_path)
        found = db.get_pattern_by_name("high-value-won")
        assert found is not None
        assert found["status"] == "confirmed"
        observations = db.get_observations_for_pattern(found["id"])
        assert len(observations) == 1
        assert observations[0]["transaction_id"] == "opp-003"
        db.close()

    def test_library_grows_across_runs(self, tmp_path, sample_data):
        db_path = tmp_path / "patterns.db"

        def make_mock(pattern_name: str):
            def _mock(sp, up):
                if "forensic pattern analyst" in sp:
                    return json.dumps({
                        "candidates": [{
                            "name": pattern_name,
                            "description": "desc",
                            "category": "anomaly",
                            "detection_signature": "sig",
                            "supporting_transaction_ids": ["opp-001", "opp-002", "opp-003"],
                            "confidence_basis": "strong_multi_instance",
                            "relationship_to_prior": "novel_candidate",
                            "prior_pattern_name": None,
                        }],
                        "data_summary": "test",
                        "total_transactions_reviewed": 3,
                    })
                return json.dumps({
                    "reviews": [{
                        "candidate_name": pattern_name,
                        "passed": True,
                        "severity_of_findings": "none",
                        "findings": [],
                    }],
                    "summary": "ok",
                })
            return _mock

        discover_patterns(sample_data, db_path, call_claude=make_mock("pattern-a"))
        discover_patterns(sample_data, db_path, call_claude=make_mock("pattern-b"))

        db = PatternsDB(db_path)
        confirmed = db.list_confirmed_patterns()
        assert len(confirmed) == 2
        db.close()

    def test_worker_error_records_failed_run(self, tmp_path, sample_data):
        db_path = tmp_path / "patterns.db"

        def mock(sp, up):
            raise RuntimeError("worker down")

        result = discover_patterns(sample_data, db_path, call_claude=mock)
        assert result.candidates_proposed == 0

        db = PatternsDB(db_path)
        run = db.get_run(result.run_id)
        assert run["status"] == "failed"
        db.close()
