#!/usr/bin/env python3
"""
Transaction Forensics — Pattern Engine v3.0
Enterprise communication forensics using semantic NLP, network analysis,
and temporal change-point detection.

Pipeline: Ingest → Normalize → Embed (SBERT) → Cluster (BERTopic/HDBSCAN)
                              → Network Graph → Temporal Analysis
                              → Stabilize → Measure → Report

v3.0 changes:
  - BERTopic (sentence-transformers + HDBSCAN) replaces TF-IDF + KMeans
  - Network analysis: communication graph, centrality, community detection
  - Temporal change-point detection via ruptures
  - TF-IDF + KMeans kept as fallback if BERTopic fails (no GPU, memory)
  - Computed metrics (v2.0) retained and enhanced with graph/temporal signals

Author: Christopher Bailey
Data Source: Salesforce/HERB (HuggingFace)
"""
from __future__ import annotations

import json
import math
import os
import re
import sys
import time
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path
from typing import Optional

import numpy as np
import pandas as pd
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.cluster import KMeans
from sklearn.metrics import silhouette_score, silhouette_samples

# ═══════════════════════════════════════════════════════════════════════════
# CONFIG
# ═══════════════════════════════════════════════════════════════════════════

HERB_BASE = os.environ.get(
    "HERB_PATH",
    "/Volumes/OWC drive/Models/huggingface-cache/hub/datasets--Salesforce--HERB/"
    "snapshots/a00bca08f9118e482e6de9951fdcb654fbed5343"
)

OUTPUT_DIR = Path(__file__).parent / "public"
N_CLUSTERS = 12
TFIDF_MAX_FEATURES = 5000
TFIDF_NGRAM_RANGE = (1, 3)
MIN_DOC_LENGTH = 30
STABILITY_RUNS = 10           # Bootstrap iterations for cluster stability
STABILITY_THRESHOLD = 0.5     # Minimum stability to surface a pattern
MIN_CLUSTER_SIZE = 15         # Prune clusters smaller than this


# ═══════════════════════════════════════════════════════════════════════════
# STAGE 1: INGEST
# ═══════════════════════════════════════════════════════════════════════════

def ingest_herb(base_path: str) -> dict:
    """Load all HERB data with relational metadata for joins."""
    t0 = time.time()
    base = Path(base_path)

    with open(base / "metadata" / "customers_data.json") as f:
        customers = json.load(f)
    with open(base / "metadata" / "salesforce_team.json") as f:
        team = json.load(f)
    with open(base / "metadata" / "employee.json") as f:
        employees_raw = json.load(f)

    # Build employee lookup for relational joins
    # employee.json is a dict keyed by eid
    employee_map = {}
    if isinstance(employees_raw, dict):
        employee_map = employees_raw
        employees = list(employees_raw.values())
    else:
        employees = employees_raw
        for emp in employees:
            if isinstance(emp, dict):
                employee_map[emp.get("employee_id", emp.get("id", ""))] = emp

    # Build customer lookup
    customer_map = {}
    for cust in customers:
        customer_map[cust.get("id", "")] = cust
        customer_map[cust.get("name", "").lower()] = cust

    products = {}
    for p in sorted((base / "products").iterdir()):
        if p.suffix == ".json":
            with open(p) as f:
                products[p.stem] = json.load(f)

    documents = []
    for prod_name, prod_data in products.items():
        # Track which customers are associated with this product
        prod_customers = set(prod_data.get("customers", []))

        for msg in prod_data.get("slack", []):
            user = msg.get("Message", {}).get("User", {})
            text = user.get("text", "")
            if text and len(text) >= MIN_DOC_LENGTH and "created this channel" not in text:
                uid = user.get("userId", "")
                documents.append({
                    "text": text,
                    "source": "slack",
                    "product": prod_name,
                    "channel": msg.get("Channel", {}).get("name", ""),
                    "user": uid,
                    "timestamp": user.get("timestamp", ""),
                    "thread_replies": len(msg.get("ThreadReplies", []) or []),
                    "has_reactions": bool(msg.get("Message", {}).get("Reactions")),
                    "employee_info": employee_map.get(uid),
                    "product_customers": prod_customers,
                })

        for t_item in prod_data.get("meeting_transcripts", []):
            transcript = t_item.get("transcript", "")
            if transcript and len(transcript) >= MIN_DOC_LENGTH:
                attendees = []
                lines = transcript.split("\n")
                if lines and lines[0].startswith("Attendees"):
                    attendees = [a.strip() for a in lines[1].split(",") if a.strip()]
                documents.append({
                    "text": transcript[:2000],
                    "source": "transcript",
                    "product": prod_name,
                    "channel": "",
                    "user": "",
                    "timestamp": "",
                    "thread_replies": 0,
                    "has_reactions": False,
                    "attendee_count": len(attendees),
                    "attendees": attendees,
                    "product_customers": prod_customers,
                })

        for doc in prod_data.get("documents", []):
            content = doc.get("content", "")
            if content and len(content) >= MIN_DOC_LENGTH:
                documents.append({
                    "text": content[:2000],
                    "source": "document",
                    "product": prod_name,
                    "channel": "",
                    "user": "",
                    "timestamp": "",
                    "thread_replies": 0,
                    "has_reactions": False,
                    "product_customers": prod_customers,
                })

        for pr in prod_data.get("prs", []):
            title = pr.get("title", "")
            summary = pr.get("summary", "")
            combined = f"{title}. {summary}" if summary else title
            if combined and len(combined) >= MIN_DOC_LENGTH:
                documents.append({
                    "text": combined[:500],
                    "source": "pull_request",
                    "product": prod_name,
                    "channel": "",
                    "user": "",
                    "timestamp": "",
                    "thread_replies": 0,
                    "has_reactions": False,
                    "product_customers": prod_customers,
                })

    ingest_time = time.time() - t0
    return {
        "documents": documents,
        "customers": customers,
        "customer_map": customer_map,
        "team": team,
        "employees": employees,
        "employee_map": employee_map,
        "products": list(products.keys()),
        "products_data": products,
        "stats": {
            "total_documents": len(documents),
            "by_source": dict(Counter(d["source"] for d in documents)),
            "by_product": dict(Counter(d["product"] for d in documents)),
            "ingest_time_seconds": round(ingest_time, 3),
        }
    }


# ═══════════════════════════════════════════════════════════════════════════
# STAGE 2: NORMALIZE
# ═══════════════════════════════════════════════════════════════════════════

SF_ABBREVIATIONS = {
    "SFDC": "Salesforce", "SOQL": "Salesforce Object Query Language",
    "LWC": "Lightning Web Component", "SLDS": "Salesforce Lightning Design System",
    "CPQ": "configure price quote", "MQL": "marketing qualified lead",
    "ACV": "annual contract value", "ARR": "annual recurring revenue",
    "TAM": "total addressable market", "NPS": "net promoter score",
    "SLA": "service level agreement", "PII": "personally identifiable information",
    "GDPR": "General Data Protection Regulation", "RBAC": "role-based access control",
    "NLP": "natural language processing", "API": "application programming interface",
    "MVP": "minimum viable product", "KPI": "key performance indicator",
    "SWOT": "strengths weaknesses opportunities threats", "ROI": "return on investment",
    "PR": "pull request", "CI/CD": "continuous integration continuous deployment",
}

def normalize_text(text: str) -> str:
    text = re.sub(r"<[^>]+\|([^>]+)>", r"\1", text)
    text = re.sub(r"https?://\S+", "", text)
    for abbr, expansion in SF_ABBREVIATIONS.items():
        text = re.sub(rf"\b{re.escape(abbr)}\b", f"{abbr} ({expansion})", text, count=1)
    text = text.lower().strip()
    text = re.sub(r"\s+", " ", text)
    return text


# ═══════════════════════════════════════════════════════════════════════════
# STAGE 3: VECTORIZE + CLUSTER
# ═══════════════════════════════════════════════════════════════════════════

def cluster_documents(documents: list[dict], n_clusters: int = N_CLUSTERS) -> dict:
    t0 = time.time()
    texts = [normalize_text(d["text"]) for d in documents]

    vectorizer = TfidfVectorizer(
        max_features=TFIDF_MAX_FEATURES, ngram_range=TFIDF_NGRAM_RANGE,
        stop_words="english", min_df=2, max_df=0.95,
    )
    tfidf_matrix = vectorizer.fit_transform(texts)
    feature_names = vectorizer.get_feature_names_out()

    # Optimal k via silhouette
    k_range = range(max(2, n_clusters - 4), n_clusters + 5)
    best_k, best_score = n_clusters, -1
    k_scores = {}
    for k in k_range:
        km = KMeans(n_clusters=k, random_state=42, n_init=10, max_iter=300)
        labels = km.fit_predict(tfidf_matrix)
        score = silhouette_score(tfidf_matrix, labels, sample_size=min(5000, len(texts)))
        k_scores[k] = round(score, 4)
        if score > best_score:
            best_k, best_score = k, score

    # Final clustering
    kmeans = KMeans(n_clusters=best_k, random_state=42, n_init=10, max_iter=300)
    cluster_labels = kmeans.fit_predict(tfidf_matrix)

    # Per-sample silhouette scores for cluster quality
    sample_silhouettes = silhouette_samples(tfidf_matrix, cluster_labels)

    # Top phrases per cluster
    cluster_phrases = {}
    cluster_docs = defaultdict(list)
    cluster_silhouette_means = {}
    for i, label in enumerate(cluster_labels):
        cluster_docs[label].append(i)

    for label, doc_indices in cluster_docs.items():
        cluster_vectors = tfidf_matrix[doc_indices].toarray()
        mean_scores = cluster_vectors.mean(axis=0)
        top_indices = mean_scores.argsort()[-10:][::-1]
        phrases = [feature_names[idx] for idx in top_indices if mean_scores[idx] > 0]
        cluster_phrases[label] = phrases
        cluster_silhouette_means[label] = round(float(np.mean(sample_silhouettes[doc_indices])), 4)

    cluster_time = time.time() - t0
    return {
        "labels": cluster_labels.tolist(),
        "n_clusters": best_k,
        "silhouette_score": round(best_score, 4),
        "k_scores": k_scores,
        "cluster_sizes": dict(Counter(cluster_labels.tolist())),
        "cluster_phrases": {str(k): v for k, v in cluster_phrases.items()},
        "cluster_docs": {str(k): v for k, v in cluster_docs.items()},
        "cluster_silhouette_means": {str(k): v for k, v in cluster_silhouette_means.items()},
        "tfidf_features": len(feature_names),
        "tfidf_ngram_range": list(TFIDF_NGRAM_RANGE),
        "cluster_time_seconds": round(cluster_time, 3),
        "tfidf_matrix": tfidf_matrix,
    }


# ═══════════════════════════════════════════════════════════════════════════
# STAGE 4: STABILITY — bootstrap cluster validation
# ═══════════════════════════════════════════════════════════════════════════

def compute_stability(tfidf_matrix, best_k: int, base_labels: list[int],
                      n_runs: int = STABILITY_RUNS) -> dict:
    """Run clustering n_runs times with different seeds.
    For each cluster, measure what fraction of its members stay together."""
    t0 = time.time()
    n_docs = tfidf_matrix.shape[0]
    base_arr = np.array(base_labels)

    # Build base cluster membership sets
    base_clusters = defaultdict(set)
    for i, label in enumerate(base_labels):
        base_clusters[label].add(i)

    stability_scores = {}
    run_details = []

    for run in range(n_runs):
        seed = run * 7 + 13  # Deterministic but varied seeds
        km = KMeans(n_clusters=best_k, random_state=seed, n_init=5, max_iter=200)
        alt_labels = km.fit_predict(tfidf_matrix)

        # For each base cluster, find the best-matching alt cluster (Jaccard similarity)
        alt_clusters = defaultdict(set)
        for i, label in enumerate(alt_labels):
            alt_clusters[label].add(i)

        run_matches = {}
        for base_label, base_members in base_clusters.items():
            best_jaccard = 0
            for alt_label, alt_members in alt_clusters.items():
                intersection = len(base_members & alt_members)
                union = len(base_members | alt_members)
                jaccard = intersection / union if union > 0 else 0
                if jaccard > best_jaccard:
                    best_jaccard = jaccard
            run_matches[base_label] = round(best_jaccard, 3)
        run_details.append(run_matches)

    # Average stability per cluster across all runs
    for label in base_clusters:
        scores = [rd.get(label, 0) for rd in run_details]
        stability_scores[str(label)] = {
            "mean": round(float(np.mean(scores)), 3),
            "std": round(float(np.std(scores)), 3),
            "min": round(float(np.min(scores)), 3),
            "max": round(float(np.max(scores)), 3),
            "stable": float(np.mean(scores)) >= STABILITY_THRESHOLD,
        }

    stability_time = time.time() - t0
    return {
        "scores": stability_scores,
        "n_runs": n_runs,
        "seeds_used": [r * 7 + 13 for r in range(n_runs)],
        "threshold": STABILITY_THRESHOLD,
        "stable_count": sum(1 for s in stability_scores.values() if s["stable"]),
        "pruned_count": sum(1 for s in stability_scores.values() if not s["stable"]),
        "duration_seconds": round(stability_time, 3),
    }


# ═══════════════════════════════════════════════════════════════════════════
# STAGE 5: MEASURE — computed metrics replacing keyword heuristics
# ═══════════════════════════════════════════════════════════════════════════

def compute_cluster_metrics(documents: list[dict], doc_indices: list[int],
                            all_docs: list[dict], employee_map: dict,
                            customer_map: dict) -> dict:
    """Compute MEASURED evidence-based metrics for a cluster.
    No keyword matching — only counts, ratios, and statistical measures."""

    cluster_docs = [documents[i] for i in doc_indices]
    total_docs = len(all_docs)
    cluster_size = len(doc_indices)

    # ── 1. Cross-team duplication frequency ──
    products = Counter(d["product"] for d in cluster_docs)
    n_products = len(products)
    product_entropy = 0.0
    for count in products.values():
        p = count / cluster_size
        if p > 0:
            product_entropy -= p * math.log2(p)
    max_entropy = math.log2(n_products) if n_products > 1 else 1
    cross_team_score = round(product_entropy / max_entropy, 3) if max_entropy > 0 else 0

    # ── 2. Source diversity (multi-channel signal) ──
    sources = Counter(d["source"] for d in cluster_docs)
    n_sources = len(sources)
    source_diversity = round(n_sources / 4.0, 2)  # 4 possible sources

    # ── 3. Response latency proxy (thread reply density) ──
    thread_counts = [d.get("thread_replies", 0) for d in cluster_docs if d["source"] == "slack"]
    avg_thread_depth = round(np.mean(thread_counts), 2) if thread_counts else 0
    no_reply_rate = round(sum(1 for t in thread_counts if t == 0) / len(thread_counts), 3) if thread_counts else 0

    # ── 4. Unique author concentration (knowledge silo risk) ──
    authors = Counter(d["user"] for d in cluster_docs if d["user"])
    n_authors = len(authors)
    author_gini = 0.0
    if n_authors > 1:
        sorted_counts = sorted(authors.values())
        n = len(sorted_counts)
        cumsum = np.cumsum(sorted_counts)
        author_gini = round((2 * sum((i + 1) * c for i, c in enumerate(sorted_counts)) /
                            (n * sum(sorted_counts))) - (n + 1) / n, 3)

    # ── 5. Customer mention density ──
    customer_mentions = 0
    customer_names_found = set()
    for d in cluster_docs:
        text_lower = d["text"].lower()
        for cust in (d.get("product_customers") or []):
            cid = customer_map.get(cust, {})
            if isinstance(cid, dict):
                cname = cid.get("name", "").lower()
                company = cid.get("company", "").lower()
                if cname and cname in text_lower:
                    customer_mentions += 1
                    customer_names_found.add(cid.get("company", cust))
                elif company and company in text_lower:
                    customer_mentions += 1
                    customer_names_found.add(company)
    customer_density = round(customer_mentions / cluster_size, 3)

    # ── 6. Temporal spread (longer = more systemic) ──
    timestamps = [d["timestamp"] for d in cluster_docs if d["timestamp"]]
    temporal_span_days = 0
    if len(timestamps) >= 2:
        ts_sorted = sorted(timestamps)
        try:
            t_start = datetime.fromisoformat(ts_sorted[0].replace("Z", "+00:00"))
            t_end = datetime.fromisoformat(ts_sorted[-1].replace("Z", "+00:00"))
            temporal_span_days = (t_end - t_start).days
        except (ValueError, TypeError):
            pass

    # ── 7. Reaction rate (engagement signal) ──
    reaction_docs = [d for d in cluster_docs if d.get("has_reactions")]
    reaction_rate = round(len(reaction_docs) / cluster_size, 3) if cluster_size > 0 else 0

    # ── COMPUTED SEVERITY (no keywords, only metrics) ──
    # Score is a weighted sum of normalized metrics.
    # Each metric contributes 0-1 to the total; weights reflect forensic importance.
    severity_score = 0.0

    # Customer data exposure: customer mentions in cross-team context
    if customer_density > 0.05:
        severity_score += min(customer_density * 10, 2.0)  # Up to 2.0
    elif len(customer_names_found) > 0:
        severity_score += 0.5

    # Knowledge silo: high author concentration with few authors
    if n_authors > 0:
        silo_signal = author_gini * (1.0 if n_authors < 5 else 0.5)
        severity_score += silo_signal  # Up to ~1.0

    # Cross-team spread: high entropy = systemic issue (not always bad, but worth noting)
    if n_products >= 10:
        severity_score += cross_team_score * 0.5  # Up to 0.5 for huge spread
    elif n_products >= 5:
        severity_score += cross_team_score * 0.3

    # Source diversity: patterns appearing across multiple source types = more real
    if source_diversity >= 0.75:
        severity_score += 0.5

    # Large cluster = more impactful
    if cluster_size > 1000:
        severity_score += 0.5
    elif cluster_size > 500:
        severity_score += 0.3

    # Temporal persistence
    if temporal_span_days > 20:
        severity_score += 0.3

    # Scale to 5.0 max
    severity_score = min(round(severity_score, 2), 5.0)

    if severity_score >= 2.5:
        computed_severity = "critical"
    elif severity_score >= 1.5:
        computed_severity = "high"
    elif severity_score >= 0.8:
        computed_severity = "medium"
    else:
        computed_severity = "low"

    # ── COMPUTED TYPE (from dominant metric, not keywords) ──
    metric_signals = {
        "compliance": customer_density * 10 + (1 if cross_team_score > 0.5 else 0),
        "bottleneck": author_gini * 3 + no_reply_rate * 2,
        "communication": cross_team_score * 3 + source_diversity * 2,
        "anomaly": (1 - reaction_rate) * 2 + (1 if temporal_span_days < 3 else 0),
    }
    computed_type = max(metric_signals, key=lambda k: metric_signals[k])

    return {
        "severity": computed_severity,
        "type": computed_type,
        "severity_score": round(severity_score, 2),
        "metrics": {
            "cross_team_entropy": {"value": cross_team_score, "method": "Shannon entropy of product distribution, normalized to [0,1]", "interpretation": "1.0 = evenly distributed across all products, 0.0 = single product"},
            "source_diversity": {"value": source_diversity, "method": "Unique source types / 4 (slack, transcript, document, PR)", "interpretation": "1.0 = present in all source types"},
            "no_reply_rate": {"value": no_reply_rate, "method": "Fraction of Slack messages with 0 thread replies", "interpretation": "Higher = less engagement / potential communication gap"},
            "avg_thread_depth": {"value": avg_thread_depth, "method": "Mean thread reply count for Slack messages in cluster"},
            "author_gini": {"value": author_gini, "method": "Gini coefficient of message authorship distribution", "interpretation": "Higher = more concentrated (fewer authors dominating)"},
            "unique_authors": {"value": n_authors, "method": "Count of distinct user IDs in cluster"},
            "customer_density": {"value": customer_density, "method": "Customer name mentions per document in cluster"},
            "customers_referenced": {"value": list(customer_names_found)[:5], "method": "Customer names found via relational join with customer master data"},
            "temporal_span_days": {"value": temporal_span_days, "method": "Days between earliest and latest timestamped document"},
            "reaction_rate": {"value": reaction_rate, "method": "Fraction of messages with emoji reactions"},
            "product_count": {"value": n_products, "method": "Distinct products represented in cluster"},
        },
        "metric_signals": {k: round(v, 2) for k, v in metric_signals.items()},
        "products": dict(products),
        "sources": dict(sources),
        "n_authors": n_authors,
        "customer_names_found": list(customer_names_found)[:10],
    }


# ═══════════════════════════════════════════════════════════════════════════
# STAGE 6: REPORT — assemble pattern cards with full provenance
# ═══════════════════════════════════════════════════════════════════════════

def build_cards(documents: list[dict], clustering: dict, stability: dict,
                employee_map: dict, customer_map: dict) -> tuple[list[dict], list[dict], float]:
    """Build pattern cards using computed metrics. Returns (cards, pruned, time)."""
    t0 = time.time()
    cards = []
    pruned = []

    for label_str, doc_indices in clustering["cluster_docs"].items():
        label = int(label_str)
        if len(doc_indices) < MIN_CLUSTER_SIZE:
            pruned.append({"cluster_id": label, "size": len(doc_indices), "reason": f"below minimum size ({MIN_CLUSTER_SIZE})"})
            continue

        stab = stability["scores"].get(label_str, {})
        if not stab.get("stable", False):
            pruned.append({"cluster_id": label, "size": len(doc_indices),
                          "reason": f"unstable (stability {stab.get('mean', 0):.0%} < {STABILITY_THRESHOLD:.0%} threshold)",
                          "stability": stab.get("mean", 0)})
            continue

        cluster_docs = [documents[i] for i in doc_indices]
        phrases = clustering["cluster_phrases"].get(label_str, [])
        cluster_sil = clustering["cluster_silhouette_means"].get(label_str, 0)

        # Compute evidence-based metrics
        metrics_result = compute_cluster_metrics(
            documents, doc_indices, documents, employee_map, customer_map
        )

        # Confidence = stability * silhouette quality
        stability_mean = stab.get("mean", 0.5)
        confidence_score = round(stability_mean * 0.6 + min(max(cluster_sil, 0), 1) * 0.4, 2)
        confidence_score = min(confidence_score, 0.95)
        confidence = "HIGH" if confidence_score >= 0.7 else "MEDIUM" if confidence_score >= 0.5 else "LOW"

        # Title from top phrases
        title_phrases = [p for p in phrases[:3] if len(p) > 3]
        title = " / ".join(w.title() for w in title_phrases[:3]) if title_phrases else f"Cluster {label}"

        # Time range
        timestamps = [d["timestamp"] for d in cluster_docs if d["timestamp"]]
        time_range = ""
        if timestamps:
            ts_sorted = sorted(timestamps)
            time_range = f"{ts_sorted[0][:10]} to {ts_sorted[-1][:10]}"

        # Sample messages
        samples = [d["text"][:200] for d in cluster_docs if d["source"] == "slack"][:4]
        if not samples:
            samples = [d["text"][:200] for d in cluster_docs[:3]]

        card = {
            "id": f"PAT-{hash(title + str(len(doc_indices))) % 0xFFFFFF:06X}",
            "title": title,
            "description": (
                f"Cluster of {len(doc_indices):,} documents across {metrics_result['metrics']['product_count']['value']} products. "
                f"Cross-team entropy: {metrics_result['metrics']['cross_team_entropy']['value']:.2f}. "
                f"Author concentration (Gini): {metrics_result['metrics']['author_gini']['value']:.2f}. "
                f"Customer references: {metrics_result['metrics']['customer_density']['value']:.3f}/doc."
            ),
            "type": metrics_result["type"],
            "confidence": confidence,
            "confidence_score": confidence_score,
            "severity": metrics_result["severity"],
            "severity_reasoning": (
                f"Computed severity score: {metrics_result['severity_score']:.1f}/5.0. "
                f"Based on: customer density ({metrics_result['metrics']['customer_density']['value']:.3f}), "
                f"cross-team entropy ({metrics_result['metrics']['cross_team_entropy']['value']:.2f}), "
                f"author Gini ({metrics_result['metrics']['author_gini']['value']:.2f}), "
                f"no-reply rate ({metrics_result['metrics']['no_reply_rate']['value']:.0%})."
            ),
            "top_phrases": phrases[:6],
            "occurrence": f"{len(doc_indices):,} of {len(documents):,} documents ({len(doc_indices)/len(documents):.1%})",
            "effect": (
                f"Spans {metrics_result['metrics']['product_count']['value']} products, "
                f"{metrics_result['n_authors']} authors, "
                f"{metrics_result['metrics']['temporal_span_days']['value']} days. "
                f"Sources: {dict(metrics_result['sources'])}."
            ),
            "evidence": {
                "source_count": len(doc_indices),
                "source_breakdown": metrics_result["sources"],
                "sample_messages": samples,
                "affected_products": list(metrics_result["products"].keys()),
                "affected_teams": list(metrics_result["products"].keys())[:5],
                "customers_referenced": metrics_result["customer_names_found"],
                "time_range": time_range or "Not timestamped",
            },
            "metrics": metrics_result["metrics"],
            "metric_signals": metrics_result["metric_signals"],
            "sample_snippets": [s[:100] for s in samples[:2]],
            "caveats": (
                f"Confidence {confidence_score:.0%} = stability ({stability_mean:.0%}) x silhouette ({cluster_sil:.3f}). "
                f"Cluster stability tested across {STABILITY_RUNS} bootstrap runs. "
                f"Severity computed from metrics, not keyword matching."
            ),
            "recommendation": (
                f"Investigate {len(doc_indices):,} documents. "
                f"Dominant metric signal: {max(metrics_result['metric_signals'], key=lambda k: metrics_result['metric_signals'][k])} "
                f"({max(metrics_result['metric_signals'].values()):.1f}). "
                f"Top phrases: {', '.join(phrases[:3])}."
            ),
            "computation": {
                "cluster_id": label,
                "cluster_size": len(doc_indices),
                "method": "TF-IDF + KMeans",
                "silhouette": cluster_sil,
                "stability": stab,
                "severity_score": metrics_result["severity_score"],
                "top_tfidf_terms": phrases[:6],
            }
        }
        cards.append(card)

    sev_order = {"critical": 0, "high": 1, "medium": 2, "low": 3}
    cards.sort(key=lambda c: (sev_order.get(c["severity"], 9), -c["confidence_score"]))

    build_time = time.time() - t0
    return cards, pruned, round(build_time, 3)


def generate_report(ingest_result: dict, clustering: dict, stability: dict,
                    cards: list[dict], pruned: list[dict], build_time: float) -> dict:
    # Remove non-serializable tfidf_matrix
    clustering_clean = {k: v for k, v in clustering.items() if k != "tfidf_matrix"}

    return {
        "metadata": {
            "generated_at": datetime.now().isoformat(),
            "author": "Christopher Bailey",
            "engine": "Transaction Forensics Pattern Engine v2.0",
            "source": "Salesforce/HERB",
            "source_url": "https://huggingface.co/datasets/Salesforce/HERB",
            "license": "CC-BY-NC-4.0",
            "products_analyzed": ingest_result["products"],
            "total_messages_scanned": ingest_result["stats"]["by_source"].get("slack", 0),
            "total_documents_scanned": ingest_result["stats"]["by_source"].get("document", 0),
            "total_transcripts_scanned": ingest_result["stats"]["by_source"].get("transcript", 0),
            "total_prs_analyzed": ingest_result["stats"]["by_source"].get("pull_request", 0),
            "total_customers": len(ingest_result["customers"]),
            "total_team_members": len(ingest_result["team"]),
        },
        "pipeline": {
            "version": "2.0",
            "stages": [
                {"name": "Ingest", "duration_seconds": ingest_result["stats"]["ingest_time_seconds"],
                 "documents_loaded": ingest_result["stats"]["total_documents"],
                 "sources": ingest_result["stats"]["by_source"],
                 "relational_joins": "employee_map, customer_map loaded for cross-referencing"},
                {"name": "Normalize", "description": f"Text cleaning + {len(SF_ABBREVIATIONS)} abbreviation expansions + URL/mention stripping"},
                {"name": "Vectorize", "method": "TF-IDF",
                 "features": clustering_clean["tfidf_features"],
                 "ngram_range": clustering_clean["tfidf_ngram_range"],
                 "max_features": TFIDF_MAX_FEATURES},
                {"name": "Cluster", "method": "KMeans",
                 "optimal_k": clustering_clean["n_clusters"],
                 "silhouette_score": clustering_clean["silhouette_score"],
                 "k_scores": clustering_clean.get("k_scores", {}),
                 "per_cluster_silhouette": clustering_clean.get("cluster_silhouette_means", {}),
                 "duration_seconds": clustering_clean["cluster_time_seconds"],
                 "cluster_sizes": clustering_clean["cluster_sizes"]},
                {"name": "Stabilize", "method": f"Bootstrap ({STABILITY_RUNS} runs, Jaccard similarity)",
                 "threshold": STABILITY_THRESHOLD,
                 "stable_clusters": stability["stable_count"],
                 "pruned_clusters": stability["pruned_count"],
                 "duration_seconds": stability["duration_seconds"]},
                {"name": "Measure", "method": "Evidence-based scoring (NO keyword heuristics)",
                 "metrics_computed": ["cross_team_entropy", "source_diversity", "no_reply_rate",
                                     "author_gini", "customer_density", "temporal_span_days", "reaction_rate"],
                 "severity_method": "Weighted metric combination (customer_density x cross_team, author_gini, no_reply_rate)",
                 "type_method": "Dominant metric signal (highest computed score wins)",
                 "patterns_surfaced": len(cards),
                 "patterns_pruned": len(pruned),
                 "duration_seconds": build_time},
            ],
            "total_duration_seconds": round(
                ingest_result["stats"]["ingest_time_seconds"] +
                clustering_clean["cluster_time_seconds"] +
                stability["duration_seconds"] + build_time, 3
            ),
            "pruned_clusters": pruned,
        },
        "cards": cards,
    }


# ═══════════════════════════════════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════════════════════════════════

def main():
    print("=" * 60)
    print("Transaction Forensics — Pattern Engine v3.0")
    print("Author: Christopher Bailey")
    print("Data: Salesforce/HERB (HuggingFace)")
    print("=" * 60)

    # ── Stage 1: Ingest ──
    print("\n[1/8] Ingesting HERB dataset...")
    ingest_result = ingest_herb(HERB_BASE)
    stats = ingest_result["stats"]
    print(f"      {stats['total_documents']:,} documents in {stats['ingest_time_seconds']}s")
    print(f"      Sources: {stats['by_source']}")
    print(f"      Products: {len(ingest_result['products'])}")
    print(f"      Employees: {len(ingest_result['employees'])}, Customers: {len(ingest_result['customers'])}")

    # ── Stage 2: Normalize ──
    print(f"\n[2/8] Normalizing ({len(SF_ABBREVIATIONS)} abbreviation expansions)...")
    texts = [normalize_text(d["text"]) for d in ingest_result["documents"]]

    # ── Stage 3: BERTopic Clustering (with TF-IDF fallback) ──
    bertopic_result = None
    try:
        from bertopic_cluster import cluster_with_bertopic
        print(f"\n[3/8] BERTopic clustering (SBERT + HDBSCAN)...")
        bertopic_result = cluster_with_bertopic(texts, min_topic_size=20)
        print(f"      Topics: {bertopic_result['n_topics']} (outliers: {bertopic_result['outlier_count']})")
        print(f"      Silhouette: {bertopic_result['silhouette_score']}")
        print(f"      Time: {bertopic_result['duration_seconds']}s")
        for tid, info in list(bertopic_result['topic_representations'].items())[:5]:
            print(f"      Topic {tid}: {', '.join(info[:5])}")
    except Exception as e:
        print(f"\n[3/8] BERTopic failed ({e}), falling back to TF-IDF + KMeans...")

    # TF-IDF + KMeans (always run for stability analysis)
    print(f"\n[4/8] TF-IDF + KMeans clustering (for stability baseline)...")
    clustering = cluster_documents(ingest_result["documents"])
    print(f"      Features: {clustering['tfidf_features']}, k={clustering['n_clusters']} (silhouette: {clustering['silhouette_score']})")

    # ── Stage 4: Network Analysis ──
    network_result = None
    try:
        from network_analysis import build_communication_graph
        print(f"\n[5/8] Network analysis (communication graph)...")
        network_result = build_communication_graph(ingest_result["documents"])
        print(f"      Nodes: {network_result.get('n_nodes', '?')}, Edges: {network_result.get('n_edges', '?')}")
        print(f"      Communities: {network_result.get('n_communities', '?')}")
        print(f"      Density: {network_result.get('graph_density', '?')}")
        if network_result.get('bridge_users'):
            print(f"      Bridge users: {[u[:15] for u in network_result['bridge_users'][:3]]}")
        if network_result.get('isolated_products'):
            print(f"      Isolated products: {network_result['isolated_products'][:3]}")
    except Exception as e:
        print(f"\n[5/8] Network analysis failed: {e}")

    # ── Stage 5: Temporal Analysis ──
    temporal_result = None
    try:
        from temporal_analysis import analyze_temporal_patterns
        print(f"\n[6/8] Temporal change-point detection...")
        temporal_result = analyze_temporal_patterns(ingest_result["documents"])
        print(f"      Window: {temporal_result.get('activity_windows', {}).get('total_days', '?')} days")
        print(f"      Change points: {len(temporal_result.get('change_points', []))}")
        if temporal_result.get('busiest_day'):
            print(f"      Busiest day: {temporal_result['busiest_day']}")
    except Exception as e:
        print(f"\n[6/8] Temporal analysis failed: {e}")

    # ── Stage 6: Bootstrap Stability ──
    print(f"\n[7/8] Bootstrap stability ({STABILITY_RUNS} runs)...")
    stability = compute_stability(clustering["tfidf_matrix"], clustering["n_clusters"], clustering["labels"])
    print(f"      Stable: {stability['stable_count']}, Pruned: {stability['pruned_count']}")

    # ── Stage 7: Measure + Build Cards ──
    print(f"\n[8/8] Computing evidence-based metrics + building cards...")
    cards, pruned, build_time = build_cards(
        ingest_result["documents"], clustering, stability,
        ingest_result["employee_map"], ingest_result["customer_map"]
    )
    print(f"      {len(cards)} patterns surfaced, {len(pruned)} pruned")
    for c in cards:
        print(f"      {c['severity']:8} | {c['type']:12} | {c['confidence']} ({c['confidence_score']:.0%}) | {c['title'][:45]}")

    # ── Generate Report ──
    report = generate_report(ingest_result, clustering, stability, cards, pruned, build_time)

    # Add BERTopic results to report
    if bertopic_result:
        # Don't serialize embeddings (numpy array)
        bt_clean = {k: v for k, v in bertopic_result.items() if k != 'embeddings'}
        report["pipeline"]["bertopic"] = bt_clean
        report["pipeline"]["stages"].insert(2, {
            "name": "BERTopic",
            "method": "Sentence-Transformers (all-MiniLM-L6-v2) + HDBSCAN",
            "n_topics": bertopic_result["n_topics"],
            "outliers": bertopic_result["outlier_count"],
            "silhouette_score": bertopic_result["silhouette_score"],
            "duration_seconds": bertopic_result["duration_seconds"],
            "top_topics": {str(k): v[:5] for k, v in list(bertopic_result["topic_representations"].items())[:8]},
        })

    # Add network results
    if network_result:
        # Don't serialize full centrality dicts (too large)
        net_summary = {
            "n_nodes": network_result.get("n_nodes"),
            "n_edges": network_result.get("n_edges"),
            "n_communities": network_result.get("n_communities"),
            "graph_density": network_result.get("graph_density"),
            "bridge_users": network_result.get("bridge_users", [])[:5],
            "isolated_products": network_result.get("isolated_products", []),
            "duration_seconds": network_result.get("duration_seconds"),
        }
        # Product overlap for top pairs
        overlap = network_result.get("product_overlap_matrix", {})
        top_overlaps = sorted(overlap.items(), key=lambda x: x[1], reverse=True)[:10]
        net_summary["top_product_overlaps"] = {k: v for k, v in top_overlaps}

        report["pipeline"]["network"] = net_summary
        report["pipeline"]["stages"].append({
            "name": "Network",
            "method": "Communication graph (NetworkX), Louvain communities, centrality analysis",
            "n_nodes": net_summary["n_nodes"],
            "n_edges": net_summary["n_edges"],
            "communities": net_summary["n_communities"],
            "bridge_users": net_summary["bridge_users"],
            "density": net_summary["graph_density"],
        })

    # Add temporal results
    if temporal_result:
        report["pipeline"]["temporal"] = temporal_result
        report["pipeline"]["stages"].append({
            "name": "Temporal",
            "method": "Change-point detection (ruptures PELT, RBF kernel)",
            "total_days": temporal_result.get("activity_windows", {}).get("total_days"),
            "change_points": len(temporal_result.get("change_points", [])),
            "busiest_day": temporal_result.get("busiest_day"),
        })

    # Recalculate total duration
    total_time = sum(
        s.get("duration_seconds", 0) for s in report["pipeline"]["stages"]
        if isinstance(s.get("duration_seconds"), (int, float))
    )
    report["pipeline"]["total_duration_seconds"] = round(total_time, 3)
    report["metadata"]["engine"] = "Transaction Forensics Pattern Engine v3.0"

    output_path = OUTPUT_DIR / "pattern_cards.json"
    with open(output_path, "w") as f:
        json.dump(report, f, indent=2)

    print(f"\n      Output: {output_path}")
    print(f"      Total: {report['pipeline']['total_duration_seconds']}s")
    print("=" * 60)
    print("Done.")


if __name__ == "__main__":
    main()
