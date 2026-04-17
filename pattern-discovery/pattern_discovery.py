"""Forensic pattern discovery via Worker/Critic/Ralph critic-loop.

Worker proposes candidate forensic patterns from transaction data.
Critic validates each candidate against evidence.
Ralph routes: confirmed → pattern library, rejected → negative examples,
uncertain → flagged for human review.
"""
from __future__ import annotations

import json
import logging
import os
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple, Union

from prompts import (
    CRITIC_SYSTEM_PROMPT,
    CRITIC_USER_TEMPLATE,
    MAX_CRITIC_ATTEMPTS,
    WORKER_SYSTEM_PROMPT,
    WORKER_USER_TEMPLATE,
)
from patterns_db import PatternsDB

logger = logging.getLogger(__name__)


# ============================================================================
# Result types
# ============================================================================

@dataclass
class DiscoveryResult:
    run_id: str
    candidates_proposed: int
    candidates_confirmed: int
    candidates_rejected: int
    candidates_uncertain: int
    duration_ms: int
    confirmed_patterns: List[Dict[str, Any]]
    rejected_patterns: List[Dict[str, Any]]
    uncertain_patterns: List[Dict[str, Any]]


# ============================================================================
# Anthropic client wrapper (dependency-injectable for tests)
# ============================================================================

def _call_claude(
    system_prompt: str,
    user_prompt: str,
    model: str = "claude-sonnet-4-6",
    max_tokens: int = 4096,
) -> str:
    """Call the Anthropic API. Returns raw text. Raises on failure."""
    import anthropic  # local import so tests can skip without SDK

    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        raise RuntimeError("ANTHROPIC_API_KEY not set")
    client = anthropic.Anthropic(api_key=api_key)
    response = client.messages.create(
        model=model,
        max_tokens=max_tokens,
        system=system_prompt,
        messages=[{"role": "user", "content": user_prompt}],
    )
    return response.content[0].text.strip()


def _strip_code_fences(text: str) -> str:
    """Remove markdown code fences if the model wrapped its output."""
    text = text.strip()
    if text.startswith("```"):
        lines = text.split("\n")
        if lines[-1].strip() == "```":
            lines = lines[1:-1]
        else:
            lines = lines[1:]
        text = "\n".join(lines)
    return text


# ============================================================================
# Worker
# ============================================================================

def worker_propose(
    data_json: str,
    prior_patterns_json: str,
    call_claude: Callable[[str, str], str] = None,
) -> Dict[str, Any]:
    """Worker: propose candidate patterns. Returns parsed JSON or {"error": ...}."""
    call = call_claude or (lambda sp, up: _call_claude(sp, up))
    user_prompt = WORKER_USER_TEMPLATE.format(
        prior_patterns_json=prior_patterns_json,
        data_json=data_json,
    )
    try:
        raw = call(WORKER_SYSTEM_PROMPT, user_prompt)
    except Exception as exc:  # noqa: BLE001
        logger.error("Worker API error: %s", exc)
        return {"error": str(exc)}
    cleaned = _strip_code_fences(raw)
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError as exc:
        logger.error("Worker produced invalid JSON: %s", exc)
        return {"error": "invalid_json", "raw": cleaned[:500]}


# ============================================================================
# Critic
# ============================================================================

def critic_review(
    data_json: str,
    candidates: List[Dict[str, Any]],
    call_claude: Callable[[str, str], str] = None,
) -> Dict[str, Any]:
    """Critic: review each candidate. Returns parsed JSON or {"error": ...}."""
    call = call_claude or (lambda sp, up: _call_claude(sp, up))
    candidates_json = json.dumps({"candidates": candidates}, indent=2)
    user_prompt = CRITIC_USER_TEMPLATE.format(
        data_json=data_json,
        candidates_json=candidates_json,
    )
    try:
        raw = call(CRITIC_SYSTEM_PROMPT, user_prompt)
    except Exception as exc:  # noqa: BLE001
        logger.error("Critic API error: %s", exc)
        return {"error": str(exc)}
    cleaned = _strip_code_fences(raw)
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError as exc:
        logger.error("Critic produced invalid JSON: %s", exc)
        return {"error": "invalid_json", "raw": cleaned[:500]}


# ============================================================================
# Ralph — routing logic
# ============================================================================

def ralph_route(
    candidates: List[Dict[str, Any]],
    reviews: List[Dict[str, Any]],
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]], List[Dict[str, Any]]]:
    """Route each candidate based on its critic review.

    Returns (confirmed, rejected, uncertain).
    - Confirmed: critic passed=true, severity "none" or "low"
    - Rejected: critic passed=false, severity "high"
    - Uncertain: passed=false but severity "medium" (human review)
    """
    reviews_by_name = {r.get("candidate_name"): r for r in reviews}
    confirmed: List[Dict[str, Any]] = []
    rejected: List[Dict[str, Any]] = []
    uncertain: List[Dict[str, Any]] = []

    for candidate in candidates:
        name = candidate.get("name")
        review = reviews_by_name.get(name)
        if review is None:
            logger.warning("No critic review for candidate %s — routing to uncertain", name)
            uncertain.append({"candidate": candidate, "review": None})
            continue
        severity = review.get("severity_of_findings", "high")
        passed = review.get("passed", False)
        enriched = {"candidate": candidate, "review": review}
        if passed and severity in ("none", "low"):
            confirmed.append(enriched)
        elif severity == "high" or not passed:
            if severity == "medium":
                uncertain.append(enriched)
            else:
                rejected.append(enriched)
        else:
            uncertain.append(enriched)
    return confirmed, rejected, uncertain


# ============================================================================
# Main entry point
# ============================================================================

def discover_patterns(
    data_path: Union[str, Path],
    db_path: Union[str, Path],
    call_claude: Callable[[str, str], str] = None,
) -> DiscoveryResult:
    """Run one full Worker/Critic/Ralph cycle against transaction data.

    Args:
        data_path: Path to a JSON file containing transaction data (list or dict).
        db_path: Path to the SQLite pattern library.
        call_claude: Optional override for testing. Takes (system, user), returns str.

    Returns:
        DiscoveryResult with counts and the confirmed/rejected/uncertain lists.
    """
    start = time.monotonic()
    data_path = Path(data_path)
    with open(data_path) as f:
        raw_data = json.load(f)

    # Cap the data size sent to the LLM (tokens are not free)
    data_json = json.dumps(raw_data, indent=2)
    if len(data_json) > 30000:
        data_json = data_json[:30000] + "\n... (truncated)"

    db = PatternsDB(db_path)
    run_id = db.start_run(str(data_path))
    prior_patterns_json = db.get_prior_patterns_json()

    try:
        # Worker
        logger.info("Worker proposing candidate patterns...")
        worker_output = worker_propose(data_json, prior_patterns_json, call_claude)
        if "error" in worker_output:
            db.complete_run(run_id, 0, 0, 0, 0, 0, status="failed",
                             error_message=f"worker: {worker_output['error']}")
            db.close()
            return DiscoveryResult(run_id, 0, 0, 0, 0, 0, [], [], [])
        candidates = worker_output.get("candidates", [])
        logger.info("Worker proposed %d candidates", len(candidates))

        if not candidates:
            duration_ms = int((time.monotonic() - start) * 1000)
            db.complete_run(run_id, 0, 0, 0, 0, duration_ms)
            db.close()
            return DiscoveryResult(run_id, 0, 0, 0, 0, duration_ms, [], [], [])

        # Critic
        logger.info("Critic reviewing candidates...")
        critic_output = critic_review(data_json, candidates, call_claude)
        if "error" in critic_output:
            db.complete_run(run_id, len(candidates), 0, 0, len(candidates),
                             0, status="failed",
                             error_message=f"critic: {critic_output['error']}")
            db.close()
            return DiscoveryResult(run_id, len(candidates), 0, 0,
                                   len(candidates), 0, [], [],
                                   [{"candidate": c} for c in candidates])
        reviews = critic_output.get("reviews", [])
        logger.info("Critic produced %d reviews", len(reviews))

        # Ralph routes
        confirmed, rejected, uncertain = ralph_route(candidates, reviews)
        logger.info(
            "Ralph routed: %d confirmed, %d rejected, %d uncertain",
            len(confirmed), len(rejected), len(uncertain),
        )

        # Persist
        for entry in confirmed:
            c = entry["candidate"]
            pid = db.upsert_confirmed_pattern(
                name=c["name"],
                description=c["description"],
                category=c["category"],
                detection_signature=c["detection_signature"],
                confidence_basis=c["confidence_basis"],
                run_id=run_id,
                observation_count=len(c.get("supporting_transaction_ids", [])),
            )
            db.record_observations(pid, c.get("supporting_transaction_ids", []), run_id)

        for entry in rejected:
            c = entry["candidate"]
            db.record_rejection(
                name=c["name"],
                description=c["description"],
                category=c["category"],
                detection_signature=c["detection_signature"],
                confidence_basis=c["confidence_basis"],
                run_id=run_id,
            )

        duration_ms = int((time.monotonic() - start) * 1000)
        db.complete_run(
            run_id,
            candidates_proposed=len(candidates),
            candidates_confirmed=len(confirmed),
            candidates_rejected=len(rejected),
            candidates_uncertain=len(uncertain),
            duration_ms=duration_ms,
        )

        db.close()
        return DiscoveryResult(
            run_id=run_id,
            candidates_proposed=len(candidates),
            candidates_confirmed=len(confirmed),
            candidates_rejected=len(rejected),
            candidates_uncertain=len(uncertain),
            duration_ms=duration_ms,
            confirmed_patterns=confirmed,
            rejected_patterns=rejected,
            uncertain_patterns=uncertain,
        )
    except Exception as exc:  # noqa: BLE001
        logger.exception("Discovery failed")
        db.complete_run(run_id, 0, 0, 0, 0, 0, status="failed", error_message=str(exc))
        db.close()
        raise
