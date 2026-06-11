"""Network Analysis — Communication graph and metrics from enterprise message data.
Detects communities, identifies bridge users, and finds product silos.
Standalone module. No imports from analyze.py.
"""
from __future__ import annotations

import time
from collections import defaultdict
from itertools import combinations
from typing import Dict, List, Optional, Set, Tuple

import networkx as nx
from networkx.algorithms.community import louvain_communities


def build_communication_graph(documents: List[Dict]) -> Dict:
    """Build a communication graph from enterprise message documents.
    Each document has: user, product, channel, timestamp, text.
    Returns dict with centrality, communities, bridge users, product overlaps, etc.
    """
    t0 = time.time()
    if not documents:
        return _empty_result(time.time() - t0)

    # --- Collect relationships ---
    channel_users: Dict[str, Set[str]] = defaultdict(set)
    user_products: Dict[str, Set[str]] = defaultdict(set)
    chan_msgs: Dict[Tuple[str, str], int] = defaultdict(int)
    all_users: Set[str] = set()
    for doc in documents:
        user = doc.get("user")
        if not user:
            continue
        all_users.add(user)
        channel, product = doc.get("channel"), doc.get("product")
        if channel:
            channel_users[channel].add(user)
            chan_msgs[(user, channel)] += 1
        if product:
            user_products[user].add(product)

    if len(all_users) < 2:
        return _empty_result(time.time() - t0, users=all_users)

    # --- Build user graph (edges = shared channels, weight = combined msg count) ---
    G = nx.Graph()
    G.add_nodes_from(all_users)
    edge_weights: Dict[Tuple[str, str], int] = defaultdict(int)
    for channel, users in channel_users.items():
        su = sorted(users)
        for i, u1 in enumerate(su):
            for u2 in su[i + 1:]:
                edge_weights[(u1, u2)] += chan_msgs[(u1, channel)] + chan_msgs[(u2, channel)]
    for (u1, u2), w in edge_weights.items():
        G.add_edge(u1, u2, weight=w)

    # --- Centrality & communities ---
    degree_cent = nx.degree_centrality(G)
    betweenness_cent = nx.betweenness_centrality(G, weight="weight")
    if G.number_of_edges() > 0:
        communities = [set(c) for c in louvain_communities(G, weight="weight", seed=42)]
    else:
        communities = [{u} for u in all_users]

    # --- Bridge users (top-5 betweenness, excluding zero) ---
    sorted_bw = sorted(betweenness_cent.items(), key=lambda x: x[1], reverse=True)
    bridge_users = [u for u, s in sorted_bw[:5] if s > 0]

    # --- Product overlap & isolated products ---
    all_products: Set[str] = set()
    prod_users: Dict[str, Set[str]] = defaultdict(set)
    for user, prods in user_products.items():
        all_products.update(prods)
        for p in prods:
            prod_users[p].add(user)
    product_overlap: Dict[str, int] = {}
    connected: Set[str] = set()
    for p1, p2 in combinations(sorted(all_products), 2):
        shared = len(prod_users[p1] & prod_users[p2])
        if shared > 0:
            product_overlap[f"{p1}|{p2}"] = shared
            connected.update((p1, p2))

    return {
        "n_nodes": G.number_of_nodes(),
        "n_edges": G.number_of_edges(),
        "degree_centrality": degree_cent,
        "betweenness_centrality": betweenness_cent,
        "communities": communities,
        "n_communities": len(communities),
        "bridge_users": bridge_users,
        "isolated_products": sorted(all_products - connected),
        "product_overlap_matrix": product_overlap,
        "graph_density": nx.density(G),
        "duration_seconds": round(time.time() - t0, 4),
    }


def _empty_result(elapsed: float, users: Optional[Set[str]] = None) -> Dict:
    """Zeroed-out result for empty or single-user input."""
    u = users or set()
    cent = {x: 0.0 for x in u}
    return {
        "n_nodes": len(u), "n_edges": 0,
        "degree_centrality": dict(cent), "betweenness_centrality": dict(cent),
        "communities": [set(u)] if u else [], "n_communities": 1 if u else 0,
        "bridge_users": [], "isolated_products": [], "product_overlap_matrix": {},
        "graph_density": 0.0, "duration_seconds": round(elapsed, 4),
    }
