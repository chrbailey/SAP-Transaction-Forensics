"""
Kaggle CRM Sales Opportunities — Forensic Analysis Pipeline

Loads the Kaggle CRM dataset (converted to SFDC-format JSON), runs
conformance checking against the New Business pipeline model, and
prints a structured findings report as Markdown to stdout.

Usage:
    cd /path/to/pattern-engine
    python3.11 scripts/analyze_kaggle_crm.py
"""

from __future__ import annotations

import json
import subprocess
import sys
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path
from statistics import median, stdev
from typing import Any, Dict, List, Optional

# ---------------------------------------------------------------------------
# Path setup
# ---------------------------------------------------------------------------

SCRIPT_DIR = Path(__file__).resolve().parent
PATTERN_ENGINE_DIR = SCRIPT_DIR.parent
sys.path.insert(0, str(PATTERN_ENGINE_DIR))

REPO_ROOT = PATTERN_ENGINE_DIR.parent
DATA_DIR = REPO_ROOT / "data" / "kaggle-crm" / "sfdc_format"

# ---------------------------------------------------------------------------
# Project imports
# ---------------------------------------------------------------------------

from src.ingest.sfdc_adapter import load_sfdc_data, sfdc_to_event_log
from src.conformance import ConformanceChecker
from src.conformance.templates.opportunity_pipeline import get_new_business_model

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def parse_date(s: Optional[str]) -> Optional[datetime]:
    if not s:
        return None
    try:
        return datetime.strptime(s[:10], "%Y-%m-%d")
    except (ValueError, TypeError):
        return None


def fmt_pct(n: float, d: float) -> str:
    if d == 0:
        return "N/A"
    return f"{n / d * 100:.1f}%"


def fmt_currency(v: Any) -> str:
    try:
        return f"${float(v):,.0f}"
    except (TypeError, ValueError):
        return str(v)


def ensure_json_files() -> None:
    """Run the converter if JSON output files are missing."""
    required = [
        DATA_DIR / "opportunities.json",
        DATA_DIR / "accounts.json",
        DATA_DIR / "stage_histories.json",
    ]
    if all(p.exists() for p in required):
        return
    print("JSON files not found — running converter ...", flush=True)
    converter = SCRIPT_DIR / "convert_kaggle_crm.py"
    result = subprocess.run(
        [sys.executable, str(converter)],
        capture_output=False,
    )
    if result.returncode != 0:
        print("ERROR: Converter failed. Exiting.", file=sys.stderr)
        sys.exit(1)
    print()


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main() -> None:
    ensure_json_files()

    # -----------------------------------------------------------------------
    # 1. Load data
    # -----------------------------------------------------------------------
    sfdc_data = load_sfdc_data(str(DATA_DIR))
    event_log = sfdc_to_event_log(sfdc_data)

    opps: List[Dict[str, Any]] = sfdc_data["opportunities"]
    accounts: List[Dict[str, Any]] = sfdc_data["accounts"]
    histories_by_opp: Dict[str, list] = sfdc_data["histories_by_opp"]
    activities_by_opp: Dict[str, list] = sfdc_data["activities_by_opp"]

    # Load additional files not exposed by load_sfdc_data
    def _load_json(fname: str) -> list:
        p = DATA_DIR / fname
        if p.exists():
            with p.open() as fh:
                return json.load(fh)
        return []

    line_items: List[Dict[str, Any]] = _load_json("line_items.json")
    products: List[Dict[str, Any]] = _load_json("products.json")

    # -----------------------------------------------------------------------
    # 2. Dataset summary counts
    # -----------------------------------------------------------------------
    total_stage_histories = sum(len(v) for v in histories_by_opp.values())
    total_activities = sum(len(v) for v in activities_by_opp.values())

    # -----------------------------------------------------------------------
    # 3. Win rate / deal metrics
    # -----------------------------------------------------------------------
    closed_won = [o for o in opps if o.get("is_won")]
    closed_lost = [o for o in opps if o.get("is_closed") and not o.get("is_won")]
    closed_all = [o for o in opps if o.get("is_closed")]
    open_opps = [o for o in opps if not o.get("is_closed")]

    win_rate = len(closed_won) / len(closed_all) * 100 if closed_all else 0.0

    won_amounts = [float(o["amount"]) for o in closed_won if o.get("amount") is not None]
    avg_deal_size = sum(won_amounts) / len(won_amounts) if won_amounts else 0.0
    total_won_revenue = sum(won_amounts)

    # Deal velocity: engage_date → close_date for Won deals
    velocities: List[float] = []
    for o in closed_won:
        created = parse_date(o.get("created_date", ""))
        closed = parse_date(o.get("close_date", ""))
        if created and closed and closed > created:
            velocities.append((closed - created).days)

    median_velocity = median(velocities) if velocities else 0.0
    avg_velocity = sum(velocities) / len(velocities) if velocities else 0.0

    # -----------------------------------------------------------------------
    # 4. Conformance analysis — New Business pipeline
    # -----------------------------------------------------------------------
    nb_model = get_new_business_model()
    nb_checker = ConformanceChecker(nb_model)

    nb_cases = []
    for opp in opps:
        opp_id = opp["id"]
        hist = histories_by_opp.get(opp_id, [])
        events = []
        for entry in hist:
            ts = entry.get("created_date", "")
            if ts.endswith("Z"):
                ts = ts[:-1] + "+00:00"
            events.append({"activity": entry.get("stage_name", ""), "timestamp": ts})
        if events:
            nb_cases.append({"case_id": opp_id, "events": events})

    nb_result = nb_checker.check_log(nb_cases)

    dev_type_counts: Counter = Counter()
    dev_severity_counts: Counter = Counter()
    for case_res in nb_result.case_results:
        for dev in case_res.deviations:
            dev_type_counts[dev.deviation_type.value] += 1
            dev_severity_counts[dev.severity.value] += 1

    # -----------------------------------------------------------------------
    # 5. Quarter-end close date distribution
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
    # 6. Agent performance
    # -----------------------------------------------------------------------
    agent_won: Counter = Counter()
    agent_lost: Counter = Counter()
    agent_open: Counter = Counter()
    agent_revenue: Dict[str, float] = defaultdict(float)

    for o in opps:
        agent = o.get("_agent", "Unknown")
        if o.get("is_won"):
            agent_won[agent] += 1
            agent_revenue[agent] += float(o.get("amount") or 0)
        elif o.get("is_closed"):
            agent_lost[agent] += 1
        else:
            agent_open[agent] += 1

    agent_total: Counter = Counter()
    for agent in set(list(agent_won.keys()) + list(agent_lost.keys()) + list(agent_open.keys())):
        agent_total[agent] = agent_won[agent] + agent_lost[agent] + agent_open[agent]

    # Top 10 agents by win rate (min 5 closed deals)
    agent_win_rates = []
    for agent in agent_total:
        closed = agent_won[agent] + agent_lost[agent]
        if closed >= 5:
            wr = agent_won[agent] / closed * 100
            agent_win_rates.append((agent, wr, agent_won[agent], closed, agent_revenue[agent]))
    agent_win_rates.sort(key=lambda x: x[1], reverse=True)

    # -----------------------------------------------------------------------
    # 7. Account concentration
    # -----------------------------------------------------------------------
    acct_revenue: Dict[str, float] = defaultdict(float)
    acct_deals: Counter = Counter()
    for o in closed_won:
        acct_id = o.get("account_id", "Unknown")
        # Map account_id back to name via account_map
        acct = sfdc_data["account_map"].get(acct_id, {})
        name = acct.get("name", acct_id or "Unknown")
        acct_revenue[name] += float(o.get("amount") or 0)
        acct_deals[name] += 1

    top_accounts = sorted(acct_revenue.items(), key=lambda x: x[1], reverse=True)[:10]

    # -----------------------------------------------------------------------
    # 8. Product mix analysis
    # -----------------------------------------------------------------------
    product_won: Counter = Counter()
    product_lost: Counter = Counter()
    product_revenue: Dict[str, float] = defaultdict(float)

    for o in opps:
        prod = o.get("_product", "Unknown")
        if o.get("is_won"):
            product_won[prod] += 1
            product_revenue[prod] += float(o.get("amount") or 0)
        elif o.get("is_closed"):
            product_lost[prod] += 1

    all_products = sorted(
        set(list(product_won.keys()) + list(product_lost.keys())),
        key=lambda p: product_won[p] + product_lost[p],
        reverse=True,
    )

    # -----------------------------------------------------------------------
    # 9. Stage distribution
    # -----------------------------------------------------------------------
    stage_dist: Counter = Counter(o.get("stage_name", "Unknown") for o in opps)

    # -----------------------------------------------------------------------
    # Print report
    # -----------------------------------------------------------------------
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    month_names = {
        1: "January", 2: "February", 3: "March", 4: "April",
        5: "May", 6: "June", 7: "July", 8: "August",
        9: "September", 10: "October", 11: "November", 12: "December",
    }

    print("# Kaggle CRM Sales Opportunities — Forensic Analysis Report")
    print(f"\n_Generated: {now}_")
    print(f"\n_Data directory: `{DATA_DIR}`_")

    # --- Dataset Summary ---
    print("\n---\n")
    print("## 1. Dataset Summary")
    print("\n| Entity | Count |")
    print("|--------|-------|")
    print(f"| Opportunities | {len(opps):,} |")
    print(f"| Accounts | {len(accounts):,} |")
    print(f"| Products | {len(products):,} |")
    print(f"| Stage histories | {total_stage_histories:,} |")
    print(f"| Activities | {total_activities:,} |")
    print(f"| Line items | {len(line_items):,} |")
    print(f"| Event log records | {len(event_log):,} |")

    # --- Win Rate & Deal Metrics ---
    print("\n---\n")
    print("## 2. Win Rate & Deal Metrics")
    print("\n| Metric | Value |")
    print("|--------|-------|")
    print(f"| Total opportunities | {len(opps):,} |")
    print(f"| Closed Won | {len(closed_won):,} |")
    print(f"| Closed Lost | {len(closed_lost):,} |")
    print(f"| Open (not closed) | {len(open_opps):,} |")
    print(f"| Win rate (of closed) | {win_rate:.1f}% |")
    print(f"| Total Won revenue | {fmt_currency(total_won_revenue)} |")
    print(f"| Avg deal size (Won) | {fmt_currency(avg_deal_size)} |")
    print(f"| Median deal velocity (days) | {median_velocity:.0f} |")
    print(f"| Avg deal velocity (days) | {avg_velocity:.0f} |")

    # --- Conformance Analysis ---
    print("\n---\n")
    print("## 3. Conformance Analysis — New Business Pipeline")
    print(f"\nModel: `{nb_result.model_name}` | Cases analyzed: {nb_result.total_cases:,}")
    print("\n| Metric | Value |")
    print("|--------|-------|")
    print(f"| Total cases | {nb_result.total_cases:,} |")
    print(f"| Conformant (no critical deviations) | {nb_result.conformant_cases:,} ({nb_result.conformance_rate:.1f}%) |")
    print(f"| Fully conformant (zero deviations) | {nb_result.fully_conformant_cases:,} ({nb_result.full_conformance_rate:.1f}%) |")
    print(f"| Average fitness score | {nb_result.average_fitness:.4f} |")
    print(f"| Min fitness | {nb_result.min_fitness:.4f} |")
    print(f"| Max fitness | {nb_result.max_fitness:.4f} |")
    print(f"| Total deviations | {nb_result.total_deviations:,} |")

    print("\n**Deviation types:**")
    if dev_type_counts:
        for dt, cnt in dev_type_counts.most_common():
            print(f"- `{dt}`: {cnt:,}")
    else:
        print("- None detected")

    print("\n**Deviation severity breakdown:**")
    if dev_severity_counts:
        for sev, cnt in dev_severity_counts.most_common():
            print(f"- {sev}: {cnt:,}")
    else:
        print("- None")

    # --- Quarter-End Distribution ---
    print("\n---\n")
    print("## 4. Quarter-End Close Date Distribution")
    print(f"\nBased on {total_closed_with_date:,} closed opportunities with valid close dates.")
    print("\n| Month | Count | % of Closed |")
    print("|-------|-------|-------------|")
    for m in range(1, 13):
        cnt = month_dist.get(m, 0)
        marker = " **[QTR END]**" if m in qtr_end_months else ""
        print(f"| {month_names[m]}{marker} | {cnt} | {fmt_pct(cnt, total_closed_with_date)} |")

    qe_pct = qtr_end_count / total_closed_with_date * 100 if total_closed_with_date else 0
    expected_pct = 3 / 12 * 100
    print(
        f"\n**Quarter-end months (Mar/Jun/Sep/Dec):** "
        f"{qtr_end_count} of {total_closed_with_date:,} closed opps "
        f"({qe_pct:.1f}%) closed in a quarter-end month. "
        f"Expected baseline: ~{expected_pct:.0f}%."
    )
    if qe_pct > expected_pct * 1.5:
        print(
            f"\n> **Finding**: Quarter-end concentration ({qe_pct:.1f}%) is "
            f"{qe_pct / expected_pct:.1f}x the expected baseline — "
            f"consistent with pipeline compression or sandbagging behavior."
        )
    else:
        print(
            f"\n> Quarter-end concentration ({qe_pct:.1f}%) is within "
            f"expected range of the {expected_pct:.0f}% baseline."
        )

    # --- Deal Velocity ---
    print("\n---\n")
    print("## 5. Deal Velocity (Days Engage → Close, Won Deals)")
    if velocities:
        buckets = [(0, 30), (31, 60), (61, 90), (91, 180), (181, 365), (366, 9999)]
        labels = ["0-30d", "31-60d", "61-90d", "91-180d", "181-365d", "366d+"]
        print("\n| Bucket | Count | % of Won |")
        print("|--------|-------|----------|")
        for (lo, hi), label in zip(buckets, labels):
            cnt = sum(1 for v in velocities if lo <= v <= hi)
            print(f"| {label} | {cnt} | {fmt_pct(cnt, len(velocities))} |")
        print(f"\n- Median velocity: **{median_velocity:.0f} days**")
        print(f"- Average velocity: **{avg_velocity:.0f} days**")
        if len(velocities) > 1:
            print(f"- Std dev: {stdev(velocities):.0f} days")
    else:
        print("\nNo velocity data available.")

    # --- Agent Performance ---
    print("\n---\n")
    print("## 6. Agent Performance (Win Rate, min 5 closed deals)")
    if agent_win_rates:
        print("\n| Agent | Win Rate | Won | Closed | Revenue |")
        print("|-------|----------|-----|--------|---------|")
        for agent, wr, won, closed, rev in agent_win_rates[:15]:
            print(f"| {agent} | {wr:.1f}% | {won} | {closed} | {fmt_currency(rev)} |")
    else:
        print("\nInsufficient data for agent ranking.")

    # Overall agent stats
    all_agents = set(
        list(agent_won.keys()) + list(agent_lost.keys()) + list(agent_open.keys())
    )
    print(f"\n**Total sales agents:** {len(all_agents)}")
    if all_agents:
        avg_deals = sum(agent_total.values()) / len(all_agents)
        print(f"**Avg deals per agent:** {avg_deals:.1f}")

    # --- Account Concentration ---
    print("\n---\n")
    print("## 7. Account Concentration (Top 10 by Won Revenue)")
    if top_accounts:
        print("\n| Account | Won Revenue | Won Deals |")
        print("|---------|-------------|-----------|")
        for name, rev in top_accounts:
            deals = acct_deals[name]
            pct = rev / total_won_revenue * 100 if total_won_revenue else 0
            print(f"| {name} | {fmt_currency(rev)} ({pct:.1f}%) | {deals} |")

        top5_rev = sum(r for _, r in top_accounts[:5])
        top5_pct = top5_rev / total_won_revenue * 100 if total_won_revenue else 0
        print(f"\n**Top 5 accounts:** {fmt_currency(top5_rev)} ({top5_pct:.1f}% of total won revenue)")
    else:
        print("\nNo account data available.")

    # --- Product Mix ---
    print("\n---\n")
    print("## 8. Product Mix Analysis")
    print("\n| Product | Won | Lost | Win Rate | Won Revenue |")
    print("|---------|-----|------|----------|-------------|")
    for prod in all_products:
        won = product_won[prod]
        lost = product_lost[prod]
        closed = won + lost
        wr = won / closed * 100 if closed else 0
        rev = product_revenue[prod]
        print(f"| {prod} | {won} | {lost} | {wr:.1f}% | {fmt_currency(rev)} |")

    # --- Stage Distribution ---
    print("\n---\n")
    print("## 9. Stage Distribution")
    print("\n| Stage | Count | % of Total |")
    print("|-------|-------|------------|")
    for stage, cnt in stage_dist.most_common():
        print(f"| {stage} | {cnt:,} | {fmt_pct(cnt, len(opps))} |")

    # --- Key Findings ---
    print("\n---\n")
    print("## 10. Key Findings Summary")

    findings = []

    # Win rate
    findings.append(
        f"**Win rate**: {win_rate:.1f}% on closed opportunities ({len(closed_won):,} Won, "
        f"{len(closed_lost):,} Lost). "
        f"Total won revenue: {fmt_currency(total_won_revenue)}. "
        f"Average deal: {fmt_currency(avg_deal_size)}."
    )

    # Conformance
    non_conf_pct = 100 - nb_result.conformance_rate
    if non_conf_pct > 20:
        top_dev = dev_type_counts.most_common(1)[0][0] if dev_type_counts else "none"
        findings.append(
            f"**Process conformance**: {non_conf_pct:.1f}% of cases have critical deviations "
            f"against the New Business pipeline model. "
            f"Most common deviation type: `{top_dev}`. "
            f"Average fitness: {nb_result.average_fitness:.3f}."
        )
    else:
        findings.append(
            f"**Process conformance**: {nb_result.conformance_rate:.1f}% of cases conform to "
            f"the New Business pipeline. "
            f"Average fitness score: {nb_result.average_fitness:.3f}."
        )

    # Quarter-end
    if qe_pct > expected_pct * 1.5:
        findings.append(
            f"**Quarter-end compression**: {qe_pct:.1f}% of closed deals fall in quarter-end months "
            f"({qe_pct / expected_pct:.1f}x expected) — potential pipeline gaming signal."
        )

    # Deal velocity
    if velocities:
        findings.append(
            f"**Deal velocity**: Median {median_velocity:.0f} days (avg {avg_velocity:.0f} days) "
            f"from engagement to close across {len(velocities):,} Won deals."
        )

    # Top agent
    if agent_win_rates:
        top_agent = agent_win_rates[0]
        findings.append(
            f"**Top agent**: {top_agent[0]} with {top_agent[1]:.1f}% win rate "
            f"({top_agent[2]} Won / {top_agent[3]} closed, {fmt_currency(top_agent[4])} revenue)."
        )

    # Account concentration
    if top_accounts:
        top5_rev = sum(r for _, r in top_accounts[:5])
        top5_pct = top5_rev / total_won_revenue * 100 if total_won_revenue else 0
        findings.append(
            f"**Account concentration**: Top 5 accounts drive "
            f"{fmt_currency(top5_rev)} ({top5_pct:.1f}%) of total won revenue."
        )

    for f in findings:
        print(f"\n- {f}")

    print("\n---\n")
    print("_End of report._")


if __name__ == "__main__":
    main()
