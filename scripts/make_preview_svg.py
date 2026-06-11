#!/usr/bin/env python3
"""Generate demo/preview.svg — a README banner rendered from real findings.

Reads demo/findings.json (produced by analyze_sfdc.py --json) and draws a
dashboard-style preview: headline KPIs plus the quarter-end close-date chart.
Run via scripts/bake-demo.sh; deterministic for a given findings file.
"""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FINDINGS = ROOT / "demo" / "findings.json"
OUT = ROOT / "demo" / "preview.svg"

MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
          "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def fmt_money(v: float) -> str:
    if v >= 1_000_000:
        return f"${v / 1_000_000:.1f}M"
    if v >= 1_000:
        return f"${v / 1_000:.0f}K"
    return f"${v:,.0f}"


def main() -> None:
    d = json.loads(FINDINGS.read_text())
    h = d["headline"]
    q = d["quarter_end"]

    kpis = [
        (str(h["opportunities_analyzed"]), "OPPORTUNITIES", "#e2e8f0"),
        (str(h["opportunities_flagged"]), "FLAGGED", "#f97316"),
        (str(h["anomaly_instances"]), "ANOMALIES", "#f97316"),
        (str(h["cross_system_anomalies"]), "CROSS-SYSTEM", "#ef4444"),
        (f"{h['win_rate_pct']}%", "WIN RATE", "#e2e8f0"),
        (fmt_money(h["avg_deal_size"]), "AVG DEAL", "#e2e8f0"),
    ]

    W, H = 1280, 400
    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" '
        f'viewBox="0 0 {W} {H}" font-family="-apple-system,Segoe UI,Helvetica,Arial,sans-serif">',
        '<defs>'
        '<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">'
        '<stop offset="0" stop-color="#0d1424"/><stop offset="1" stop-color="#0a0e17"/>'
        '</linearGradient>'
        '<linearGradient id="accent" x1="0" y1="0" x2="1" y2="0">'
        '<stop offset="0" stop-color="#3b82f6"/><stop offset="1" stop-color="#8b5cf6"/>'
        '</linearGradient>'
        '<linearGradient id="qbar" x1="0" y1="0" x2="0" y2="1">'
        '<stop offset="0" stop-color="#f97316"/><stop offset="1" stop-color="#c2410c"/>'
        '</linearGradient>'
        '</defs>',
        f'<rect width="{W}" height="{H}" rx="14" fill="url(#bg)"/>',
        f'<rect width="{W}" height="4" fill="url(#accent)"/>',
        # Title block
        '<text x="48" y="62" font-size="26" font-weight="800" fill="#e2e8f0">'
        'SAP Transaction Forensics</text>',
        '<text x="48" y="88" font-size="14" fill="#94a3b8">'
        'Cross-system anomaly detection · SFDC ↔ SAP · read-only · '
        'generated from the analysis pipeline (seed 42)</text>',
        '<rect x="980" y="40" width="252" height="30" rx="15" fill="rgba(34,197,94,0.08)" '
        'stroke="rgba(34,197,94,0.35)"/>',
        '<circle cx="1000" cy="55" r="4" fill="#22c55e"/>',
        '<text x="1012" y="60" font-size="12" fill="#22c55e" font-family="monospace">'
        'LIVE DEMO · ZERO INSTALL</text>',
    ]

    # KPI cards
    card_w, card_h, gap, x0, y0 = 182, 92, 16, 48, 116
    for i, (num, lbl, color) in enumerate(kpis):
        x = x0 + i * (card_w + gap)
        parts += [
            f'<rect x="{x}" y="{y0}" width="{card_w}" height="{card_h}" rx="10" '
            'fill="#111827" stroke="#1e2d45"/>',
            f'<rect x="{x}" y="{y0}" width="{card_w}" height="3" rx="1.5" fill="url(#accent)"/>',
            f'<text x="{x + card_w / 2}" y="{y0 + 52}" font-size="30" font-weight="800" '
            f'fill="{color}" text-anchor="middle">{num}</text>',
            f'<text x="{x + card_w / 2}" y="{y0 + 76}" font-size="10.5" letter-spacing="1" '
            f'fill="#64748b" text-anchor="middle">{lbl}</text>',
        ]

    # Quarter-end chart
    cy0, ch = 248, 96
    parts += [
        f'<rect x="48" y="{cy0 - 14}" width="1184" height="{ch + 56}" rx="10" '
        'fill="#111827" stroke="#1e2d45"/>',
        f'<text x="68" y="{cy0 + 10}" font-size="13" font-weight="700" fill="#e2e8f0">'
        'Quarter-End Compression</text>',
        f'<text x="68" y="{cy0 + 28}" font-size="11.5" fill="#94a3b8">'
        f'{q["qtr_end_pct"]}% of closed deals land in quarter-end months — '
        f'{q["ratio"]}× the {q["expected_pct"]}% uniform baseline</text>',
    ]
    counts = [m["count"] for m in q["months"]]
    mx = max(counts) or 1
    bw, bgap, bx0 = 56, 24, 360
    for i, m in enumerate(q["months"]):
        bh = max(3, round(m["count"] / mx * (ch - 30)))
        x = bx0 + i * (bw + bgap)
        y = cy0 + ch - bh
        fill = 'url(#qbar)' if m["is_qtr_end"] else '#1c2742'
        parts += [
            f'<rect x="{x}" y="{y}" width="{bw}" height="{bh}" rx="3" fill="{fill}"/>',
            f'<text x="{x + bw / 2}" y="{y - 6}" font-size="11" font-weight="700" '
            f'fill="#94a3b8" text-anchor="middle">{m["count"]}</text>',
            f'<text x="{x + bw / 2}" y="{cy0 + ch + 18}" font-size="10" '
            f'fill="#64748b" text-anchor="middle" font-family="monospace">{MONTHS[i]}</text>',
        ]

    parts.append(
        f'<text x="48" y="{H - 16}" font-size="11" fill="#475569" font-family="monospace">'
        f'$ make demo-web &#8594; generates data · runs forensics · opens this dashboard'
        '</text>'
    )
    parts.append('</svg>')

    OUT.write_text("\n".join(parts))
    print(f"[preview] Wrote {OUT}")


if __name__ == "__main__":
    main()
