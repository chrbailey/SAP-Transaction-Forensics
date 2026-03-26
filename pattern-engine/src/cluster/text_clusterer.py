"""
Text Clustering Module for Transaction Forensics.

Provides pattern discovery through:
- TF-IDF vectorization (primary, always available)
- Optional sentence-transformers embeddings
- DBSCAN or KMeans clustering
- Deterministic results with configurable seed
"""

import logging
from collections import Counter
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
from sklearn.cluster import DBSCAN, KMeans
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics import silhouette_score
from sklearn.preprocessing import normalize

logger = logging.getLogger(__name__)


# Try to import sentence-transformers for optional embedding support
try:
    from sentence_transformers import SentenceTransformer
    SENTENCE_TRANSFORMERS_AVAILABLE = True
except ImportError:
    SENTENCE_TRANSFORMERS_AVAILABLE = False
    logger.info("sentence-transformers not available, using TF-IDF only")


class TextClusterer:
    """
    Text clusterer for discovering patterns in SAP workflow text.

    Supports both TF-IDF and sentence-transformer embeddings,
    with configurable clustering algorithms.
    """

    # Default TF-IDF parameters
    DEFAULT_TFIDF_PARAMS = {
        'max_features': 5000,
        'min_df': 2,
        'max_df': 0.95,
        'ngram_range': (1, 3),
        'stop_words': 'english',
    }

    # Default sentence-transformer model
    DEFAULT_ST_MODEL = 'all-MiniLM-L6-v2'

    def __init__(
        self,
        embedding_model: str = 'tfidf',
        clustering_algorithm: str = 'kmeans',
        n_clusters: Optional[int] = None,
        min_cluster_size: int = 5,
        random_seed: int = 42,
        tfidf_params: Optional[Dict] = None,
        st_model_name: Optional[str] = None,
    ):
        """
        Initialize the text clusterer.

        Args:
            embedding_model: 'tfidf' or 'sentence-transformers'
            clustering_algorithm: 'kmeans' or 'dbscan'
            n_clusters: Number of clusters for KMeans (auto-determined if None)
            min_cluster_size: Minimum documents per cluster
            random_seed: Random seed for reproducibility
            tfidf_params: Custom TF-IDF parameters
            st_model_name: Sentence-transformer model name
        """
        self.embedding_model = embedding_model
        self.clustering_algorithm = clustering_algorithm
        self.n_clusters = n_clusters
        self.min_cluster_size = min_cluster_size
        self.random_seed = random_seed

        # TF-IDF configuration
        self.tfidf_params = self.DEFAULT_TFIDF_PARAMS.copy()
        if tfidf_params:
            self.tfidf_params.update(tfidf_params)

        # Sentence-transformer configuration
        self.st_model_name = st_model_name or self.DEFAULT_ST_MODEL

        # Initialize components
        self.vectorizer = None
        self.st_model = None
        self.clusterer = None
        self.embeddings = None
        self.feature_names = None

        # Set random seed for numpy
        np.random.seed(self.random_seed)

    # Special cluster labels for edge cases
    LABEL_NOISE = -1           # Standard noise label (couldn't cluster)
    LABEL_EMPTY_INPUT = -2     # Document had empty/whitespace-only text
    LABEL_DEGENERATE = -3      # All documents identical (clustering meaningless)

    def fit_predict(self, texts: List[str]) -> Dict[str, Any]:
        """
        Fit the clusterer and predict cluster labels.

        Args:
            texts: List of text documents to cluster

        Returns:
            Dictionary containing:
                - labels: Cluster labels for each document
                - n_clusters: Number of clusters found
                - cluster_info: Information about each cluster
                - top_phrases: Top phrases per cluster
                - silhouette: Silhouette score (if applicable)
                - parameters: Parameters used
                - n_empty_documents: Count of empty input documents
                - degenerate_cluster: True if all documents were identical
        """
        if not texts:
            return self._empty_result()

        # EDGE CASE FIX: Track empty documents separately from noise
        valid_indices = []
        empty_indices = []
        for i, t in enumerate(texts):
            if t and t.strip():
                valid_indices.append(i)
            else:
                empty_indices.append(i)

        valid_texts = [texts[i] for i in valid_indices]

        if len(valid_texts) < self.min_cluster_size:
            logger.warning(f"Too few valid texts ({len(valid_texts)}) for clustering")
            # EDGE CASE FIX: Mark empty docs with LABEL_EMPTY_INPUT, not noise
            result = self._empty_result(n_docs=len(texts))
            labels = result['labels']
            for i in empty_indices:
                labels[i] = self.LABEL_EMPTY_INPUT
            result['labels'] = labels
            result['n_empty_documents'] = len(empty_indices)
            return result

        # Generate embeddings
        logger.info(f"Generating embeddings using {self.embedding_model}...")
        embeddings = self._generate_embeddings(valid_texts)

        if embeddings is None or len(embeddings) == 0:
            result = self._empty_result(n_docs=len(texts))
            for i in empty_indices:
                result['labels'][i] = self.LABEL_EMPTY_INPUT
            result['n_empty_documents'] = len(empty_indices)
            return result

        self.embeddings = embeddings

        # EDGE CASE FIX: Detect degenerate case where all embeddings are identical
        embedding_variance = np.var(embeddings)
        if embedding_variance < 1e-10:
            logger.warning(
                "All document embeddings are nearly identical - clustering is meaningless. "
                "This may indicate duplicate documents or very similar text."
            )
            # Mark all documents with special degenerate label
            full_labels = [self.LABEL_DEGENERATE] * len(texts)
            for i in empty_indices:
                full_labels[i] = self.LABEL_EMPTY_INPUT

            return {
                'labels': full_labels,
                'n_clusters': 0,
                'cluster_info': {},
                'top_phrases': {},
                'silhouette': None,
                'parameters': {
                    'embedding_model': self.embedding_model,
                    'clustering_algorithm': self.clustering_algorithm,
                    'n_clusters': self.n_clusters,
                    'min_cluster_size': self.min_cluster_size,
                    'random_seed': self.random_seed,
                },
                'n_documents': len(texts),
                'n_valid_documents': len(valid_texts),
                'n_noise_documents': 0,
                'n_empty_documents': len(empty_indices),
                'degenerate_cluster': True,
                'degenerate_reason': 'All embeddings identical - documents may be duplicates',
            }

        # Determine number of clusters if not specified
        if self.n_clusters is None:
            self.n_clusters = self._estimate_n_clusters(len(valid_texts))

        # Perform clustering
        logger.info(f"Clustering with {self.clustering_algorithm}...")
        labels = self._perform_clustering(embeddings)

        # Map labels back to original indices
        # EDGE CASE FIX: Mark empty docs with LABEL_EMPTY_INPUT
        full_labels = [self.LABEL_NOISE] * len(texts)
        for idx, label in zip(valid_indices, labels):
            full_labels[idx] = label
        for idx in empty_indices:
            full_labels[idx] = self.LABEL_EMPTY_INPUT

        # Calculate cluster statistics
        cluster_info = self._calculate_cluster_info(valid_texts, labels)

        # Extract top phrases per cluster
        top_phrases = self._extract_top_phrases(valid_texts, labels)

        # Calculate silhouette score if we have enough clusters
        silhouette = None
        unique_labels = set(l for l in labels if l >= 0)
        if len(unique_labels) > 1:
            try:
                valid_mask = labels >= 0
                if sum(valid_mask) > len(unique_labels):
                    silhouette = silhouette_score(
                        embeddings[valid_mask],
                        labels[valid_mask]
                    )
            except Exception as e:
                logger.warning(f"Could not calculate silhouette score: {e}")

        return {
            'labels': full_labels,
            'n_clusters': len(unique_labels),
            'cluster_info': cluster_info,
            'top_phrases': top_phrases,
            'silhouette': silhouette,
            'parameters': {
                'embedding_model': self.embedding_model,
                'clustering_algorithm': self.clustering_algorithm,
                'n_clusters': self.n_clusters,
                'min_cluster_size': self.min_cluster_size,
                'random_seed': self.random_seed,
            },
            'n_documents': len(texts),
            'n_valid_documents': len(valid_texts),
            'n_noise_documents': sum(1 for l in labels if l == self.LABEL_NOISE),
            'n_empty_documents': len(empty_indices),
            'degenerate_cluster': False,
        }

    def _generate_embeddings(self, texts: List[str]) -> Optional[np.ndarray]:
        """Generate embeddings for texts."""
        if self.embedding_model == 'sentence-transformers':
            return self._generate_st_embeddings(texts)
        else:
            return self._generate_tfidf_embeddings(texts)

    def _generate_tfidf_embeddings(self, texts: List[str]) -> np.ndarray:
        """Generate TF-IDF embeddings."""
        self.vectorizer = TfidfVectorizer(**self.tfidf_params)

        try:
            embeddings = self.vectorizer.fit_transform(texts)
            self.feature_names = self.vectorizer.get_feature_names_out()
            return embeddings.toarray()
        except ValueError as e:
            logger.warning(f"TF-IDF vectorization failed with default params: {e}")
            # Try with less restrictive parameters
            try:
                relaxed_params = self.tfidf_params.copy()
                relaxed_params['min_df'] = 1
                relaxed_params['max_df'] = 1.0
                self.vectorizer = TfidfVectorizer(**relaxed_params)
                embeddings = self.vectorizer.fit_transform(texts)
                self.feature_names = self.vectorizer.get_feature_names_out()
                return embeddings.toarray()
            except ValueError as e2:
                # Final fallback: just use word counts with no filtering
                logger.warning(f"TF-IDF still failed, using simple vectorizer: {e2}")
                try:
                    from sklearn.feature_extraction.text import CountVectorizer
                    self.vectorizer = CountVectorizer(min_df=1)
                    embeddings = self.vectorizer.fit_transform(texts)
                    self.feature_names = self.vectorizer.get_feature_names_out()
                    return embeddings.toarray().astype(float)
                except ValueError:
                    # If everything fails, return zero vectors
                    logger.error("All vectorization methods failed, returning zero vectors")
                    self.feature_names = np.array([])
                    return np.zeros((len(texts), 1))

    def _generate_st_embeddings(self, texts: List[str]) -> np.ndarray:
        """Generate sentence-transformer embeddings."""
        if not SENTENCE_TRANSFORMERS_AVAILABLE:
            logger.warning("sentence-transformers not available, falling back to TF-IDF")
            return self._generate_tfidf_embeddings(texts)

        try:
            if self.st_model is None:
                self.st_model = SentenceTransformer(self.st_model_name)

            embeddings = self.st_model.encode(
                texts,
                show_progress_bar=False,
                convert_to_numpy=True
            )

            # Normalize embeddings
            embeddings = normalize(embeddings)

            # Also generate TF-IDF for phrase extraction
            self.vectorizer = TfidfVectorizer(**self.tfidf_params)
            self.vectorizer.fit(texts)
            self.feature_names = self.vectorizer.get_feature_names_out()

            return embeddings

        except Exception as e:
            logger.warning(f"Sentence-transformer failed: {e}, falling back to TF-IDF")
            return self._generate_tfidf_embeddings(texts)

    def _perform_clustering(self, embeddings: np.ndarray) -> np.ndarray:
        """Perform clustering on embeddings."""
        if self.clustering_algorithm == 'dbscan':
            return self._cluster_dbscan(embeddings)
        else:
            return self._cluster_kmeans(embeddings)

    def _cluster_kmeans(self, embeddings: np.ndarray) -> np.ndarray:
        """Perform KMeans clustering."""
        n_samples = len(embeddings)

        # Ensure n_clusters doesn't exceed n_samples
        actual_n_clusters = min(self.n_clusters, n_samples)

        if actual_n_clusters < 1:
            # Edge case: no samples
            return np.array([])

        if actual_n_clusters == 1 or n_samples == 1:
            # Edge case: only one cluster possible
            return np.zeros(n_samples, dtype=int)

        self.clusterer = KMeans(
            n_clusters=actual_n_clusters,
            random_state=self.random_seed,
            n_init=10,
            max_iter=300
        )

        labels = self.clusterer.fit_predict(embeddings)
        return np.array(labels)

    def _cluster_dbscan(self, embeddings: np.ndarray) -> np.ndarray:
        """Perform DBSCAN clustering."""
        # Estimate epsilon using nearest neighbor distances
        from sklearn.neighbors import NearestNeighbors

        # Use min_cluster_size as min_samples
        min_samples = max(2, self.min_cluster_size // 2)

        nn = NearestNeighbors(n_neighbors=min_samples)
        nn.fit(embeddings)
        distances, _ = nn.kneighbors(embeddings)

        # Use the elbow of the k-distance graph
        k_distances = np.sort(distances[:, -1])
        eps = np.percentile(k_distances, 90)

        self.clusterer = DBSCAN(
            eps=eps,
            min_samples=min_samples,
            metric='cosine' if self.embedding_model == 'sentence-transformers' else 'euclidean'
        )

        labels = self.clusterer.fit_predict(embeddings)
        return np.array(labels)

    def _estimate_n_clusters(self, n_documents: int) -> int:
        """
        Estimate the optimal number of clusters using elbow method or silhouette score.

        Uses a combination of:
        1. Elbow method (looking for the "elbow" in SSE curve)
        2. Silhouette score (for validation)

        Falls back to heuristic sqrt(n/2) if methods fail.
        """
        if self.embeddings is None or len(self.embeddings) < 10:
            # Not enough data, use simple heuristic
            estimated = int(np.sqrt(n_documents / 2))
            return max(3, min(15, estimated))

        # Try range of k values
        min_k = 3
        max_k = min(15, n_documents // 3)  # Don't try more clusters than makes sense

        if max_k <= min_k:
            return max(3, min(10, n_documents // 2))

        k_range = range(min_k, max_k + 1)
        sse_scores = []  # Sum of squared errors (inertia)
        silhouette_scores = []

        for k in k_range:
            try:
                kmeans = KMeans(
                    n_clusters=k,
                    random_state=self.random_seed,
                    n_init=10,
                    max_iter=100  # Faster for estimation
                )
                labels = kmeans.fit_predict(self.embeddings)
                sse_scores.append(kmeans.inertia_)

                # Calculate silhouette score
                if k > 1:
                    sil_score = silhouette_score(self.embeddings, labels)
                    silhouette_scores.append((k, sil_score))
            except Exception as e:
                logger.warning(f"Could not evaluate k={k}: {e}")
                continue

        # Find elbow point using rate of change
        if len(sse_scores) >= 3:
            optimal_k = self._find_elbow(list(k_range), sse_scores)
            if optimal_k:
                logger.info(f"Elbow method suggests k={optimal_k}")
                return optimal_k

        # Fall back to best silhouette score
        if silhouette_scores:
            best_k, best_score = max(silhouette_scores, key=lambda x: x[1])
            logger.info(f"Silhouette method suggests k={best_k} (score={best_score:.3f})")
            return best_k

        # Final fallback: heuristic
        estimated = int(np.sqrt(n_documents / 2))
        return max(3, min(15, estimated))

    def _find_elbow(self, k_values: List[int], sse_values: List[float]) -> Optional[int]:
        """
        Find the elbow point in the SSE curve.

        Uses the method of finding the point furthest from the line
        connecting the first and last points.
        """
        if len(k_values) < 3 or len(sse_values) < 3:
            return None

        # Normalize values
        k_norm = np.array(k_values, dtype=float)
        sse_norm = np.array(sse_values, dtype=float)

        # Normalize to [0, 1] range
        k_norm = (k_norm - k_norm.min()) / (k_norm.max() - k_norm.min() + 1e-10)
        sse_norm = (sse_norm - sse_norm.min()) / (sse_norm.max() - sse_norm.min() + 1e-10)

        # Line from first to last point
        p1 = np.array([k_norm[0], sse_norm[0]])
        p2 = np.array([k_norm[-1], sse_norm[-1]])

        # Calculate perpendicular distance from each point to the line
        line_vec = p2 - p1
        line_len = np.linalg.norm(line_vec)

        if line_len < 1e-10:
            return None

        line_unit = line_vec / line_len

        distances = []
        for i, (k, sse) in enumerate(zip(k_norm, sse_norm)):
            point = np.array([k, sse])
            point_vec = point - p1
            proj_len = np.dot(point_vec, line_unit)
            proj_point = p1 + proj_len * line_unit
            dist = np.linalg.norm(point - proj_point)
            distances.append(dist)

        # Find maximum distance (elbow point)
        max_idx = np.argmax(distances)
        return k_values[max_idx]

    def _calculate_cluster_info(
        self,
        texts: List[str],
        labels: np.ndarray
    ) -> Dict[int, Dict[str, Any]]:
        """Calculate information about each cluster."""
        cluster_info = {}

        unique_labels = set(l for l in labels if l >= 0)

        for label in unique_labels:
            mask = labels == label
            cluster_texts = [t for t, m in zip(texts, mask) if m]

            # Calculate average text length
            avg_length = np.mean([len(t) for t in cluster_texts])

            # Count documents
            n_docs = sum(mask)

            cluster_info[int(label)] = {
                'n_documents': n_docs,
                'avg_text_length': float(avg_length),
                'percentage': float(n_docs / len(texts) * 100),
            }

        return cluster_info

    def _extract_top_phrases(
        self,
        texts: List[str],
        labels: np.ndarray,
        top_n: int = 10
    ) -> Dict[int, List[Tuple[str, float]]]:
        """Extract top phrases for each cluster."""
        if self.vectorizer is None or self.feature_names is None:
            return {}

        top_phrases = {}
        unique_labels = set(l for l in labels if l >= 0)

        for label in unique_labels:
            mask = labels == label
            cluster_texts = [t for t, m in zip(texts, mask) if m]

            if not cluster_texts:
                continue

            # Get TF-IDF scores for cluster texts
            try:
                cluster_tfidf = self.vectorizer.transform(cluster_texts)
                mean_tfidf = np.asarray(cluster_tfidf.mean(axis=0)).flatten()

                # Get top features
                top_indices = mean_tfidf.argsort()[-top_n:][::-1]
                phrases = [
                    (self.feature_names[i], float(mean_tfidf[i]))
                    for i in top_indices
                    if mean_tfidf[i] > 0
                ]

                top_phrases[int(label)] = phrases

            except Exception as e:
                logger.warning(f"Could not extract phrases for cluster {label}: {e}")
                top_phrases[int(label)] = []

        return top_phrases

    def get_cluster_theme(self, cluster_id: int, top_n: int = 3) -> str:
        """
        Generate a theme/label for a cluster based on top phrases.

        Args:
            cluster_id: Cluster ID
            top_n: Number of top phrases to use

        Returns:
            Theme string
        """
        if not hasattr(self, '_last_result') or self._last_result is None:
            return f"Cluster {cluster_id}"

        top_phrases = self._last_result.get('top_phrases', {}).get(cluster_id, [])

        if not top_phrases:
            return f"Cluster {cluster_id}"

        theme_words = [phrase for phrase, _ in top_phrases[:top_n]]
        return ' / '.join(theme_words).upper()

    def _empty_result(self, n_docs: int = 0) -> Dict[str, Any]:
        """Return an empty result structure."""
        return {
            'labels': [-1] * n_docs,
            'n_clusters': 0,
            'cluster_info': {},
            'top_phrases': {},
            'silhouette': None,
            'parameters': {
                'embedding_model': self.embedding_model,
                'clustering_algorithm': self.clustering_algorithm,
                'n_clusters': self.n_clusters,
                'min_cluster_size': self.min_cluster_size,
                'random_seed': self.random_seed,
            },
            'n_documents': n_docs,
            'n_valid_documents': 0,
            'n_noise_documents': n_docs,
        }


def cluster_texts(
    texts: List[str],
    n_clusters: Optional[int] = None,
    random_seed: int = 42
) -> Dict[str, Any]:
    """
    Convenience function for text clustering.

    Args:
        texts: List of texts to cluster
        n_clusters: Number of clusters (auto if None)
        random_seed: Random seed

    Returns:
        Clustering result dictionary
    """
    clusterer = TextClusterer(
        n_clusters=n_clusters,
        random_seed=random_seed
    )
    return clusterer.fit_predict(texts)
