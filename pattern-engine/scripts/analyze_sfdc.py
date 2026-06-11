"""
SFDC Forensic Analysis Pipeline

Loads SFDC synthetic data, runs conformance checking, cross-system
correlation, and pattern detection, then prints a structured findings
report as Markdown to stdout.

Usage:
    cd /path/to/pattern-engine
    python3.11 scripts/analyze_sfdc.py

    # Also write a machine-readable findings file (used by the web demo):
    python3.11 scripts/analyze_sfdc.py --json ../demo/findings.json
"""

from __future__ import annotations

import argparse
import json
import sys
import os
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from statistics import median
from typing import Any, Dict, List

# ---------------------------------------------------------------------------
# Path setup — run from pattern-engine/ or any directory
# ---------------------------------------------------------------------------

SCRIPT_DIR = Path(__file__).resolve().parent
PATTERN_ENGINE_DIR = SCRIPT_DIR.parent
sys.path.insert(0, str(PATTERN_ENGINE_DIR))

DATA_DIR = PATTERN_ENGINE_DIR.parent / "synthetic-data" / "sfdc_output"

# ---------------------------------------------------------------------------
# Imports from project modules
# ---------------------------------------------------------------------------

from src.ingest.sfdc_adapter import load_sfdc_data, sfdc_to_event_log, load_sap_records
from src.conformance import ConformanceChecker
from src.conformance.templates.opportunity_pipeline import (
    get_new_business_model,
    get_renewal_model,
)
from src.correlate.cross_system import (
    find_cross_system_anomalies,
    compute_cross_system_metrics,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def parse_date(date_str: str):
    """Parse YYYY-MM-DD string to datetime, or None."""
    if not date_str:
        return None
    try:
        return datetime.strptime(date_str[:10], "%Y-%m-%d")
    except (ValueError, TypeError):
        return None


def fmt_pct(n: float, d: float) -> str:
    if d == 0:
        return "N/A"
    return f"{n / d * 100:.1f}%"


def fmt_currency(v) -> str:
    try:
        return f"${float(v):,.0f}"
    except (TypeError, ValueError):
        return str(v)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


FLAG_DESCRIPTIONS = {
    "QUARTER_END_COMPRESSION": "Close dates clustered at quarter-end (pipeline gaming)",
    "SPLIT_DEAL": "Deal split across multiple opportunities to stay under approval thresholds",
    "STALE_PIPELINE": "Opportunity age far exceeds expected sales cycle",
    "AMOUNT_INFLATION": "Deal amount inflated relative to account history",
    "GHOST_PIPELINE": "No activity logged after initial creation (abandoned opportunity)",
    "SPEED_ANOMALY": "Stage progression far faster or slower than baseline",
    "STAGE_SKIP": "One or more mandatory pipeline stages skipped",
    "STAGE_REGRESSION": "Stage moved backward (e.g., from Proposal back to Prospecting)",
    "CROSS_SYSTEM_GAP": "Large timing gap between SFDC close and SAP order creation",
    "OWNER_SWAP_AT_CLOSE": "Owner changed within final stage before close",
}

# Risk severity assigned to each pattern flag for demo presentation.
FLAG_SEVERITY = {
    "SPLIT_DEAL": "critical",
    "AMOUNT_INFLATION": "critical",
    "CROSS_SYSTEM_GAP": "high",
    "OWNER_SWAP_AT_CLOSE": "high",
    "STAGE_SKIP": "high",
    "STAGE_REGRESSION": "high",
    "QUARTER_END_COMPRESSION": "medium",
    "GHOST_PIPELINE": "medium",
    "STALE_PIPELINE": "medium",
    "SPEED_ANOMALY": "low",
}

FLAG_ORDER = [
    "QUARTER_END_COMPRESSION",
    "SPLIT_DEAL",
    "STALE_PIPELINE",
    "AMOUNT_INFLATION",
    "GHOST_PIPELINE",
    "SPEED_ANOMALY",
    "STAGE_SKIP",
    "STAGE_REGRESSION",
    "CROSS_SYSTEM_GAP",
    "OWNER_SWAP_AT_CLOSE",
]


def _opp_example(opp: Dict[str, Any]) -> Dict[str, Any]:
    """Compact, shareable representation of an opportunity for evidence display."""
    return {
        "id": opp.get("id"),
        "name": opp.get("name"),
        "account_id": opp.get("account_id"),
        "amount": opp.get("amount"),
        "stage": opp.get("stage_name"),
        "type": opp.get("type"),
        "close_date": opp.get("close_date"),
        "owner": opp.get("owner_name") or opp.get("owner_id"),
    }


def main(json_path: str | None = None) -> None:
    # -----------------------------------------------------------------------
    # 1. Load data
    # -----------------------------------------------------------------------
    sfdc_data = load_sfdc_data(str(DATA_DIR))
    event_log = sfdc_to_event_log(sfdc_data)
    sap_data = load_sap_records(str(DATA_DIR))

    opps: List[Dict[str, Any]] = sfdc_data["opportunities"]
    accounts: List[Dict[str, Any]] = sfdc_data["accounts"]
    histories_by_opp: Dict[str, list] = sfdc_data["histories_by_opp"]
    activities_by_opp: Dict[str, list] = sfdc_data["activities_by_opp"]

    sap_orders: List[Dict[str, Any]] = sap_data["orders"]

    # Load line_items directly (not exposed via load_sfdc_data)
    line_items_path = DATA_DIR / "line_items.json"
    if line_items_path.exists():
        with line_items_path.open() as fh:
            line_items: List[Dict[str, Any]] = json.load(fh)
    else:
        line_items = []

    # -----------------------------------------------------------------------
    # 2. Dataset summary
    # -----------------------------------------------------------------------
    total_stage_histories = sum(len(v) for v in histories_by_opp.values())
    total_activities = sum(len(v) for v in activities_by_opp.values())

    # -----------------------------------------------------------------------
    # 3. Win rate / deal metrics
    # -----------------------------------------------------------------------
    closed_won = [o for o in opps if o.get("is_won")]
    closed_lost = [o for o in opps if o.get("is_closed") and not o.get("is_won")]
    closed_all = [o for o in opps if o.get("is_closed")]

    win_rate = len(closed_won) / len(closed_all) * 100 if closed_all else 0.0

    won_amounts = [
        float(o["amount"]) for o in closed_won if o.get("amount") is not None
    ]
    avg_deal_size = sum(won_amounts) / len(won_amounts) if won_amounts else 0.0

    # Median close time in days (created_date -> close_date for Closed Won)
    close_times: List[float] = []
    for o in closed_won:
        created = parse_date(o.get("created_date", ""))
        closed = parse_date(o.get("close_date", ""))
        if created and closed:
            close_times.append((closed - created).days)
    median_close_days = median(close_times) if close_times else 0.0

    # -----------------------------------------------------------------------
    # 4. Conformance analysis — New Business only
    # -----------------------------------------------------------------------
    nb_opps = [o for o in opps if o.get("type") == "New Business"]
    nb_model = get_new_business_model()
    nb_checker = ConformanceChecker(nb_model)

    # Build structured event log per case (stage_history events only for conformance)
    nb_cases = []
    for opp in nb_opps:
        opp_id = opp["id"]
        hist = histories_by_opp.get(opp_id, [])
        events = []
        for entry in hist:
            ts = entry.get("created_date", "")
            if ts.endswith("Z"):
                ts = ts[:-1] + "+00:00"
            events.append(
                {"activity": entry.get("stage_name", ""), "timestamp": ts}
            )
        if events:
            nb_cases.append({"case_id": opp_id, "events": events})

    nb_result = nb_checker.check_log(nb_cases)

    # Deviation type breakdown
    dev_type_counts: Counter = Counter()
    dev_severity_counts: Counter = Counter()
    for case_res in nb_result.case_results:
        for dev in case_res.deviations:
            dev_type_counts[dev.deviation_type.value] += 1
            dev_severity_counts[dev.severity.value] += 1

    # -----------------------------------------------------------------------
    # 5. Pattern detection — all opps
    # -----------------------------------------------------------------------
    all_flags: Counter = Counter()
    flag_opp_ids: Dict[str, List[str]] = defaultdict(list)
    for opp in opps:
        for flag in opp.get("_pattern_flags", []):
            all_flags[flag] += 1
            flag_opp_ids[flag].append(opp["id"])

    # Also collect SAP-level flags
    sap_flags: Counter = Counter()
    for order in sap_orders:
        for flag in order.get("_pattern_flags", []):
            sap_flags[flag] += 1

    # -----------------------------------------------------------------------
    # 6. Cross-system correlation
    # -----------------------------------------------------------------------
    # Build match list: opportunities that have a sap_order_id
    matches = []
    sap_by_sfdc_id = {
        o.get("sfdc_opportunity_id"): o for o in sap_orders if o.get("sfdc_opportunity_id")
    }
    for opp in opps:
        sap_order_id = opp.get("sap_order_id")
        if sap_order_id:
            matches.append(
                {"sfdc_id": opp["id"], "sap_id": sap_order_id, "confidence": 1.0}
            )

    cross_anomalies = find_cross_system_anomalies(
        sfdc_opportunities=opps,
        sap_orders=sap_orders,
        matches=matches,
    )
    cross_metrics = compute_cross_system_metrics(
        sfdc_opportunities=opps,
        sap_orders=sap_orders,
        matches=matches,
    )

    # Breakdown by anomaly type
    cross_type_counts: Counter = Counter(a["type"] for a in cross_anomalies)
    cross_severity_counts: Counter = Counter(a["severity"] for a in cross_anomalies)

    # -----------------------------------------------------------------------
    # 7. Stage distribution
    # -----------------------------------------------------------------------
    stage_dist: Counter = Counter(o.get("stage_name", "Unknown") for o in opps)

    # -----------------------------------------------------------------------
    # 8. Quarter-end analysis — close dates
    # -----------------------------------------------------------------------
    month_dist: Counter = Counter()
    qtr_end_months = {3, 6, 9, 12}
    qtr_end_count = 0
    total_closed_with_date = 0
    for o in closed_all:
        d = parse_date(o.get("close_date", ""))
        if d:
            month_dist[d.month] += 1
            total_closed_with_date += 1
            if d.month in qtr_end_months:
                qtr_end_count += 1

    # -----------------------------------------------------------------------
    # Build machine-readable findings (drives the zero-install web demo)
    # -----------------------------------------------------------------------
    if json_path:
        opp_by_id = {o["id"]: o for o in opps}
        acct_by_id = {a["id"]: a.get("name") for a in accounts}

        anomalies_json = []
        for flag in FLAG_ORDER:
            ids = flag_opp_ids.get(flag, [])
            examples = []
            for oid in ids[:4]:
                opp = opp_by_id.get(oid)
                if not opp:
                    continue
                ex = _opp_example(opp)
                ex["account_name"] = acct_by_id.get(ex["account_id"], ex["account_id"])
                examples.append(ex)
            anomalies_json.append(
                {
                    "flag": flag,
                    "count": all_flags.get(flag, 0),
                    "severity": FLAG_SEVERITY.get(flag, "medium"),
                    "description": FLAG_DESCRIPTIONS.get(flag, ""),
                    "examples": examples,
                }
            )

        cross_examples = [
            {
                "type": a["type"],
                "severity": a["severity"],
                "evidence": a["evidence"],
                "sfdc_id": a.get("sfdc_id"),
                "sap_id": a.get("sap_id"),
            }
            for a in cross_anomalies[:8]
        ]

        actual_qtr_pct = (
            qtr_end_count / total_closed_with_date * 100
            if total_closed_with_date
            else 0.0
        )

        total_flagged = sum(1 for o in opps if o.get("_pattern_flags"))
        total_anomaly_instances = sum(all_flags.values())

        findings = {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "dataset": {
                "opportunities": len(opps),
                "accounts": len(accounts),
                "stage_histories": total_stage_histories,
                "activities": total_activities,
                "line_items": len(line_items),
                "sap_orders": len(sap_orders),
                "event_log_records": len(event_log),
                "seed": 42,
            },
            "headline": {
                "opportunities_analyzed": len(opps),
                "opportunities_flagged": total_flagged,
                "anomaly_instances": total_anomaly_instances,
                "anomaly_categories": sum(1 for f in FLAG_ORDER if all_flags.get(f)),
                "cross_system_anomalies": len(cross_anomalies),
                "high_severity_cross": sum(
                    1 for a in cross_anomalies if a["severity"] == "high"
                ),
                "sap_match_rate_pct": round(cross_metrics["match_rate"] * 100, 1),
                "win_rate_pct": round(win_rate, 1),
                "avg_deal_size": round(avg_deal_size, 2),
                "median_cycle_days": round(median_close_days),
            },
            "anomalies": anomalies_json,
            "cross_system": {
                "total_sfdc": cross_metrics["total_sfdc"],
                "total_sap": cross_metrics["total_sap"],
                "matched_pairs": cross_metrics["total_matched"],
                "match_rate_pct": round(cross_metrics["match_rate"] * 100, 1),
                "avg_gap_days": round(cross_metrics["avg_gap_days"], 1),
                "anomaly_count": len(cross_anomalies),
                "examples": cross_examples,
            },
            "conformance": {
                "model": nb_result.model_name,
                "total_cases": nb_result.total_cases,
                "conformant_cases": nb_result.conformant_cases,
                "conformance_rate_pct": round(nb_result.conformance_rate, 1),
                "average_fitness": round(nb_result.average_fitness, 4),
                "total_deviations": nb_result.total_deviations,
                "deviation_types": dict(dev_type_counts),
            },
            "quarter_end": {
                "months": [
                    {"month": m, "count": month_dist.get(m, 0), "is_qtr_end": m in qtr_end_months}
                    for m in range(1, 13)
                ],
                "qtr_end_count": qtr_end_count,
                "total_closed": total_closed_with_date,
                "qtr_end_pct": round(actual_qtr_pct, 1),
                "expected_pct": round(4 / 12 * 100, 1),
                "ratio": round(actual_qtr_pct / (4 / 12 * 100), 1) if total_closed_with_date else 0,
            },
            "stage_distribution": [
                {"stage": stage, "count": cnt} for stage, cnt in stage_dist.most_common()
            ],
        }

        out_path = Path(json_path)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        with out_path.open("w") as fh:
            json.dump(findings, fh, indent=2)
        print(f"[analyze_sfdc] Wrote findings JSON → {out_path}", file=sys.stderr)

    # -----------------------------------------------------------------------
    # Print report
    # -----------------------------------------------------------------------
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    print(f"# SFDC Forensic Analysis Report")
    print(f"\n_Generated: {now}_")
    print(f"\n_Data directory: `{DATA_DIR}`_")

    # --- Dataset Summary ---
    print(f"\n---")
    print(f"\n## 1. Dataset Summary")
    print(f"\n| Entity | Count |")
    print(f"|--------|-------|")
    print(f"| Opportunities | {len(opps)} |")
    print(f"| Accounts | {len(accounts)} |")
    print(f"| Stage histories | {total_stage_histories} |")
    print(f"| Activities | {total_activities} |")
    print(f"| Line items | {len(line_items)} |")
    print(f"| SAP orders | {len(sap_orders)} |")
    print(f"| Event log records | {len(event_log)} |")

    print(f"\n**Opportunity types:**")
    type_dist: Counter = Counter(o.get("type", "Unknown") for o in opps)
    for t, cnt in type_dist.most_common():
        print(f"- {t}: {cnt}")

    # --- Win Rate / Deal Metrics ---
    print(f"\n---")
    print(f"\n## 2. Win Rate & Deal Metrics")
    print(f"\n| Metric | Value |")
    print(f"|--------|-------|")
    print(f"| Total opportunities | {len(opps)} |")
    print(f"| Closed Won | {len(closed_won)} |")
    print(f"| Closed Lost | {len(closed_lost)} |")
    print(f"| Open (not closed) | {len(opps) - len(closed_all)} |")
    print(f"| Win rate (of closed) | {win_rate:.1f}% |")
    print(f"| Avg deal size (Closed Won) | {fmt_currency(avg_deal_size)} |")
    print(f"| Median close time (days) | {median_close_days:.0f} |")

    # --- Conformance Analysis ---
    print(f"\n---")
    print(f"\n## 3. Conformance Analysis — New Business Pipeline")
    print(f"\nModel: `{nb_result.model_name}` | Cases analyzed: {nb_result.total_cases}")
    print(f"\n| Metric | Value |")
    print(f"|--------|-------|")
    print(f"| Total cases | {nb_result.total_cases} |")
    print(f"| Conformant (no critical deviations) | {nb_result.conformant_cases} ({nb_result.conformance_rate:.1f}%) |")
    print(f"| Fully conformant (zero deviations) | {nb_result.fully_conformant_cases} ({nb_result.full_conformance_rate:.1f}%) |")
    print(f"| Average fitness score | {nb_result.average_fitness:.4f} |")
    print(f"| Min fitness | {nb_result.min_fitness:.4f} |")
    print(f"| Max fitness | {nb_result.max_fitness:.4f} |")
    print(f"| Total deviations | {nb_result.total_deviations} |")

    print(f"\n**Deviation types:**")
    if dev_type_counts:
        for dt, cnt in dev_type_counts.most_common():
            print(f"- `{dt}`: {cnt}")
    else:
        print("- None detected")

    print(f"\n**Deviation severity breakdown:**")
    if dev_severity_counts:
        for sev, cnt in dev_severity_counts.most_common():
            print(f"- {sev}: {cnt}")
    else:
        print("- None")

    # --- Pattern Detection ---
    print(f"\n---")
    print(f"\n## 4. Pattern Detection")
    print(f"\nFlags set on SFDC opportunities (total flagged opps: "
          f"{sum(1 for o in opps if o.get('_pattern_flags'))}):")
    print(f"\n| Pattern Flag | Opp Count | Description |")
    print(f"|-------------|-----------|-------------|")

    flag_descriptions = {
        "QUARTER_END_COMPRESSION": "Close dates clustered at quarter-end (pipeline gaming)",
        "SPLIT_DEAL": "Deal split across multiple opportunities to stay under approval thresholds",
        "STALE_PIPELINE": "Opportunity age far exceeds expected sales cycle",
        "AMOUNT_INFLATION": "Deal amount inflated relative to account history",
        "GHOST_PIPELINE": "No activity logged after initial creation (abandoned opportunity)",
        "SPEED_ANOMALY": "Stage progression far faster or slower than baseline",
        "STAGE_SKIP": "One or more mandatory pipeline stages skipped",
        "STAGE_REGRESSION": "Stage moved backward (e.g., from Proposal back to Prospecting)",
        "CROSS_SYSTEM_GAP": "Large timing gap between SFDC close and SAP order creation",
        "OWNER_SWAP_AT_CLOSE": "Owner changed within final stage before close",
    }

    for flag in [
        "QUARTER_END_COMPRESSION",
        "SPLIT_DEAL",
        "STALE_PIPELINE",
        "AMOUNT_INFLATION",
        "GHOST_PIPELINE",
        "SPEED_ANOMALY",
        "STAGE_SKIP",
        "STAGE_REGRESSION",
        "CROSS_SYSTEM_GAP",
        "OWNER_SWAP_AT_CLOSE",
    ]:
        cnt = all_flags.get(flag, 0)
        desc = flag_descriptions.get(flag, "")
        print(f"| `{flag}` | {cnt} | {desc} |")

    if sap_flags:
        print(f"\n**SAP-level flags:**")
        for flag, cnt in sap_flags.most_common():
            print(f"- `{flag}`: {cnt} orders")

    # --- Cross-System Correlation ---
    print(f"\n---")
    print(f"\n## 5. Cross-System Correlation (SFDC ↔ SAP)")
    print(f"\n| Metric | Value |")
    print(f"|--------|-------|")
    print(f"| Total SFDC opportunities | {cross_metrics['total_sfdc']} |")
    print(f"| Total SAP orders | {cross_metrics['total_sap']} |")
    print(f"| Matched pairs | {cross_metrics['total_matched']} |")
    print(f"| Unmatched SFDC opps | {cross_metrics['unmatched_sfdc']} |")
    print(f"| Unmatched SAP orders | {cross_metrics['unmatched_sap']} |")
    print(f"| Match rate | {cross_metrics['match_rate']:.1%} |")
    print(f"| Avg timing gap (days) | {cross_metrics['avg_gap_days']:.1f} |")

    print(f"\n**Cross-system anomalies detected: {len(cross_anomalies)}**")
    print(f"\n| Anomaly Type | Count | High Severity | Medium Severity |")
    print(f"|-------------|-------|---------------|-----------------|")

    anomaly_types = ["timing_gap", "amount_discrepancy", "sequence_violation", "missing_handoff"]
    for atype in anomaly_types:
        type_anomalies = [a for a in cross_anomalies if a["type"] == atype]
        high = sum(1 for a in type_anomalies if a["severity"] == "high")
        medium = sum(1 for a in type_anomalies if a["severity"] == "medium")
        print(f"| `{atype}` | {len(type_anomalies)} | {high} | {medium} |")

    if cross_anomalies:
        print(f"\n**Sample anomaly evidence (up to 5):**")
        for a in cross_anomalies[:5]:
            print(f"- [{a['severity'].upper()}] `{a['type']}` — {a['evidence']}")

    # --- Stage Distribution ---
    print(f"\n---")
    print(f"\n## 6. Stage Distribution")
    print(f"\n| Stage | Count | % of Total |")
    print(f"|-------|-------|------------|")
    for stage, cnt in stage_dist.most_common():
        print(f"| {stage} | {cnt} | {fmt_pct(cnt, len(opps))} |")

    # --- Quarter-End Analysis ---
    print(f"\n---")
    print(f"\n## 7. Quarter-End Close Date Analysis")
    print(f"\nBased on {total_closed_with_date} closed opportunities with valid close dates.")
    print(f"\n| Month | Count | % of Closed |")
    print(f"|-------|-------|-------------|")
    month_names = {
        1: "January", 2: "February", 3: "March", 4: "April",
        5: "May", 6: "June", 7: "July", 8: "August",
        9: "September", 10: "October", 11: "November", 12: "December",
    }
    for m in range(1, 13):
        cnt = month_dist.get(m, 0)
        marker = " **[QTR END]**" if m in qtr_end_months else ""
        print(f"| {month_names[m]}{marker} | {cnt} | {fmt_pct(cnt, total_closed_with_date)} |")

    print(f"\n**Quarter-end months (Mar/Jun/Sep/Dec):** "
          f"{qtr_end_count} of {total_closed_with_date} closed opps "
          f"({fmt_pct(qtr_end_count, total_closed_with_date)}) closed in a quarter-end month.")
    expected_qtr_end_pct = 4 / 12 * 100  # 4 of 12 months are quarter-end
    print(f"Expected baseline if uniform: ~{expected_qtr_end_pct:.0f}%")
    if total_closed_with_date > 0:
        actual_pct = qtr_end_count / total_closed_with_date * 100
        if actual_pct > expected_qtr_end_pct * 1.5:
            print(f"\n> **Finding**: Quarter-end concentration ({actual_pct:.1f}%) is "
                  f"{actual_pct / expected_qtr_end_pct:.1f}x the expected baseline — "
                  f"consistent with pipeline compression / sandbagging behavior.")
        else:
            print(f"\n> Quarter-end concentration ({actual_pct:.1f}%) is within "
                  f"expected range of the {expected_qtr_end_pct:.0f}% baseline.")

    # --- Summary findings ---
    print(f"\n---")
    print(f"\n## 8. Key Findings Summary")

    findings = []

    # Conformance
    non_conf_pct = 100 - nb_result.conformance_rate
    if non_conf_pct > 20:
        findings.append(
            f"**High conformance deviation rate**: {non_conf_pct:.1f}% of New Business "
            f"opportunities have critical process deviations. "
            f"Most common type: `{dev_type_counts.most_common(1)[0][0] if dev_type_counts else 'none'}`."
        )

    # Top pattern
    if all_flags:
        top_flag, top_cnt = all_flags.most_common(1)[0]
        findings.append(
            f"**Dominant pattern flag**: `{top_flag}` detected on {top_cnt} opportunities "
            f"({fmt_pct(top_cnt, len(opps))} of all opps)."
        )

    # Cross-system
    high_cross = sum(1 for a in cross_anomalies if a["severity"] == "high")
    if high_cross > 0:
        findings.append(
            f"**Cross-system risk**: {high_cross} high-severity anomalies between SFDC and SAP "
            f"across {len(matches)} matched pairs."
        )

    # Match rate
    if cross_metrics["match_rate"] < 0.5:
        findings.append(
            f"**Low SAP coverage**: Only {cross_metrics['match_rate']:.1%} of SFDC opportunities "
            f"have a linked SAP order — {cross_metrics['unmatched_sfdc']} opps have no SAP record."
        )

    # Win rate
    findings.append(
        f"**Win rate**: {win_rate:.1f}% on closed opportunities. "
        f"Average deal size for Closed Won: {fmt_currency(avg_deal_size)}. "
        f"Median cycle: {median_close_days:.0f} days."
    )

    if findings:
        for f in findings:
            print(f"\n- {f}")
    else:
        print("\nNo significant findings detected.")

    print(f"\n---")
    print(f"\n_End of report._")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="SFDC forensic analysis")
    parser.add_argument(
        "--json",
        dest="json_path",
        default=None,
        help="Also write a machine-readable findings JSON file to this path",
    )
    args = parser.parse_args()
    main(json_path=args.json_path)
