"""BERTopic-based document clustering for transaction forensics."""
from __future__ import annotations

import time
from typing import Any

import numpy as np
from bertopic import BERTopic
from sentence_transformers import SentenceTransformer
from sklearn.metrics import silhouette_score as sk_silhouette_score


def cluster_with_bertopic(
    texts: list[str], min_topic_size: int = 20
) -> dict[str, Any]:
    """Cluster documents using BERTopic with sentence-transformer embeddings.

    Args:
        texts: List of document strings to cluster.
        min_topic_size: Minimum number of documents per topic.

    Returns:
        Dict with topics, topic_info, n_topics, outlier_count,
        silhouette_score, topic_representations, embeddings, duration_seconds.
    """
    start = time.time()

    if len(texts) < min_topic_size:
        print(f"[bertopic] Only {len(texts)} docs (< min_topic_size={min_topic_size}). Returning all as outliers.")
        embeddings = SentenceTransformer("all-MiniLM-L6-v2").encode(texts, show_progress_bar=True)
        return {
            "topics": [-1] * len(texts),
            "topic_info": [{"topic_id": -1, "count": len(texts), "name": "Outlier", "representation": []}],
            "n_topics": 0,
            "outlier_count": len(texts),
            "silhouette_score": -1.0,
            "topic_representations": {},
            "embeddings": np.array(embeddings),
            "duration_seconds": round(time.time() - start, 2),
        }

    print("[bertopic] Encoding documents with all-MiniLM-L6-v2 ...")
    embedding_model = SentenceTransformer("all-MiniLM-L6-v2")
    embeddings = embedding_model.encode(texts, show_progress_bar=True)

    print(f"[bertopic] Fitting BERTopic (min_topic_size={min_topic_size}) ...")
    topic_model = BERTopic(
        embedding_model=embedding_model,
        min_topic_size=min_topic_size,
        verbose=True,
    )

    try:
        topics, _probs = topic_model.fit_transform(texts, embeddings=embeddings)
    except Exception as exc:
        print(f"[bertopic] BERTopic failed: {exc}. Returning all as outliers.")
        return {
            "topics": [-1] * len(texts),
            "topic_info": [{"topic_id": -1, "count": len(texts), "name": "Outlier", "representation": []}],
            "n_topics": 0,
            "outlier_count": len(texts),
            "silhouette_score": -1.0,
            "topic_representations": {},
            "embeddings": np.array(embeddings),
            "duration_seconds": round(time.time() - start, 2),
        }

    # Build topic info from BERTopic's internal table
    info_df = topic_model.get_topic_info()
    topic_info = []
    for _, row in info_df.iterrows():
        tid = int(row["Topic"])
        words = topic_model.get_topic(tid)
        top_words = [w for w, _ in words[:10]] if words and words != -1 else []
        topic_info.append({
            "topic_id": tid,
            "count": int(row["Count"]),
            "name": str(row.get("Name", f"Topic_{tid}")),
            "representation": top_words,
        })

    # Topic representations dict (exclude outlier topic -1)
    topic_representations = {}
    for entry in topic_info:
        if entry["topic_id"] != -1:
            topic_representations[entry["topic_id"]] = entry["representation"]

    topics_arr = np.array(topics)
    outlier_count = int((topics_arr == -1).sum())
    n_topics = len(set(topics) - {-1})

    # Silhouette score on non-outlier documents
    sil_score = -1.0
    mask = topics_arr != -1
    if mask.sum() > 1 and n_topics > 1:
        try:
            sil_score = float(sk_silhouette_score(embeddings[mask], topics_arr[mask]))
        except Exception:
            pass

    duration = round(time.time() - start, 2)
    print(f"[bertopic] Done. {n_topics} topics, {outlier_count} outliers, silhouette={sil_score:.3f}, {duration}s")

    return {
        "topics": [int(t) for t in topics],
        "topic_info": topic_info,
        "n_topics": n_topics,
        "outlier_count": outlier_count,
        "silhouette_score": sil_score,
        "topic_representations": topic_representations,
        "embeddings": np.array(embeddings),
        "duration_seconds": duration,
    }
