"""Temporal change-point detection for enterprise communication data."""
from __future__ import annotations

import time
from collections import Counter, defaultdict
from datetime import datetime, timedelta
from typing import Any


def analyze_temporal_patterns(documents: list[dict]) -> dict:
    """Analyze temporal patterns in communication documents with change-point detection."""
    start = time.time()
    empty = {
        "daily_volume": [], "change_points": [], "per_product_trends": {},
        "activity_windows": {"earliest": "", "latest": "", "total_days": 0, "active_days": 0},
        "busiest_day": {"date": "", "count": 0}, "quietest_day": {"date": "", "count": 0},
        "duration_seconds": 0.0,
    }
    # Parse timestamps, skipping invalid ones
    parsed: list[tuple[datetime, dict]] = []
    for doc in documents:
        try:
            parsed.append((datetime.fromisoformat(doc.get("timestamp", "")), doc))
        except (ValueError, TypeError):
            continue
    if not parsed:
        empty["duration_seconds"] = round(time.time() - start, 4)
        return empty

    parsed.sort(key=lambda x: x[0])
    earliest, latest = parsed[0][0], parsed[-1][0]
    total_days = (latest.date() - earliest.date()).days + 1
    date_range = [(earliest.date() + timedelta(days=i)).strftime("%Y-%m-%d") for i in range(total_days)]

    # Build daily and per-product counts
    daily_counts: Counter[str] = Counter()
    product_daily: dict[str, Counter[str]] = defaultdict(Counter)
    for ts, doc in parsed:
        day = ts.strftime("%Y-%m-%d")
        daily_counts[day] += 1
        product_daily[doc.get("product", "unknown")][day] += 1

    all_days = sorted(daily_counts)
    daily_volume = [{"date": d, "count": daily_counts[d]} for d in all_days]
    signal = [float(daily_counts.get(d, 0)) for d in date_range]

    # Change-point detection via ruptures
    change_points: list[dict[str, Any]] = []
    try:
        import numpy as np
        import ruptures as rpt
        if len(signal) >= 3:
            algo = rpt.Pelt(model="rbf").fit(np.array(signal).reshape(-1, 1))
            for cp in algo.predict(pen=10):
                if cp >= len(date_range):
                    continue
                before = np.mean(signal[max(0, cp - 3):cp]) if cp > 0 else 0
                after = np.mean(signal[cp:min(len(signal), cp + 3)]) if cp < len(signal) else 0
                mag = after - before
                change_points.append({
                    "date": date_range[min(cp, len(date_range) - 1)],
                    "type": "increase" if mag >= 0 else "decrease",
                    "magnitude": round(abs(mag), 2),
                })
    except Exception:
        pass

    # Per-product trends (first-half vs second-half average comparison)
    per_product_trends: dict[str, dict] = {}
    for product, counts in product_daily.items():
        total = sum(counts.values())
        vals = [counts.get(d, 0) for d in date_range]
        mid = len(vals) // 2
        diff = (sum(vals[mid:]) / max(len(vals) - mid, 1)) - (sum(vals[:mid]) / max(mid, 1))
        per_product_trends[product] = {
            "total": total, "daily_avg": round(total / max(total_days, 1), 2),
            "peak_day": max(counts, key=counts.get),  # type: ignore[arg-type]
            "trend": "increasing" if diff > 0.5 else ("decreasing" if diff < -0.5 else "stable"),
        }

    busiest = max(daily_volume, key=lambda x: x["count"])
    quietest = min(daily_volume, key=lambda x: x["count"])
    return {
        "daily_volume": daily_volume, "change_points": change_points,
        "per_product_trends": per_product_trends,
        "activity_windows": {
            "earliest": earliest.strftime("%Y-%m-%d"), "latest": latest.strftime("%Y-%m-%d"),
            "total_days": total_days, "active_days": len(all_days),
        },
        "busiest_day": busiest, "quietest_day": quietest,
        "duration_seconds": round(time.time() - start, 4),
    }
