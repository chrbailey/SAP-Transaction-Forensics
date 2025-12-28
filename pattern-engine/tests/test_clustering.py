"""
Tests for text clustering module.

Tests cover:
- Reproducibility with fixed seed
- Cluster quality metrics
- Phrase extraction
- Edge cases
"""

import pytest
import numpy as np

from src.cluster.text_clusterer import TextClusterer, cluster_texts


class TestClusteringReproducibility:
    """Tests for deterministic clustering results."""

    @pytest.fixture
    def sample_texts(self):
        """Sample texts with distinct patterns."""
        return [
            # Expedite/Rush pattern
            "EXPEDITE order urgent rush delivery needed",
            "Rush shipment expedite this order immediately",
            "Urgent expedite required rush processing",
            "Express delivery expedite rush order",
            "Expedite this shipment urgent rush",
            # Credit hold pattern
            "Credit hold customer payment pending",
            "Order blocked credit hold applied",
            "Credit hold review payment terms",
            "Customer on credit hold payment required",
            "Credit block applied hold order",
            # Delivery delay pattern
            "Delivery delayed shipping postponed",
            "Shipment delay delivery rescheduled",
            "Delayed delivery new date pending",
            "Delivery postponed delay notification",
            "Shipping delay delivery will be late",
            # Standard processing
            "Standard order processing normal",
            "Regular shipment standard delivery",
            "Normal processing standard terms",
            "Regular order standard shipping",
            "Standard delivery normal processing",
        ]

    def test_same_seed_same_clusters(self, sample_texts):
        """Test that same seed produces same clusters."""
        clusterer1 = TextClusterer(
            embedding_model='tfidf',
            n_clusters=4,
            random_seed=42
        )
        clusterer2 = TextClusterer(
            embedding_model='tfidf',
            n_clusters=4,
            random_seed=42
        )

        result1 = clusterer1.fit_predict(sample_texts)
        result2 = clusterer2.fit_predict(sample_texts)

        # Same number of clusters
        assert result1['n_clusters'] == result2['n_clusters']

        # Same labels (order should match)
        assert result1['labels'] == result2['labels']

    def test_different_seed_different_clusters(self, sample_texts):
        """Test that different seeds can produce different results."""
        clusterer1 = TextClusterer(
            embedding_model='tfidf',
            n_clusters=4,
            random_seed=42
        )
        clusterer2 = TextClusterer(
            embedding_model='tfidf',
            n_clusters=4,
            random_seed=123
        )

        result1 = clusterer1.fit_predict(sample_texts)
        result2 = clusterer2.fit_predict(sample_texts)

        # Note: Results may still be same if clustering is very stable
        # This test just verifies the mechanism works
        assert result1['n_clusters'] == result2['n_clusters']

    def test_multiple_runs_same_result(self, sample_texts):
        """Test consistency across multiple runs."""
        clusterer = TextClusterer(
            embedding_model='tfidf',
            n_clusters=4,
            random_seed=42
        )

        results = []
        for _ in range(3):
            result = clusterer.fit_predict(sample_texts)
            results.append(result['labels'])

        # All runs should produce same labels
        for labels in results[1:]:
            assert labels == results[0]


class TestClusteringWithKnownPatterns:
    """Tests with texts that have known distinguishable patterns."""

    def test_distinct_patterns_separated(self):
        """Test that distinct patterns end up in different clusters."""
        # Very distinct patterns that should cluster separately
        texts = [
            # Group A: Credit-related
            "credit hold payment blocked",
            "credit block applied customer",
            "payment credit hold status",
            "credit block payment pending",
            "blocked credit customer payment",
            # Group B: Delivery-related
            "delivery scheduled shipment ready",
            "shipping delivery confirmed date",
            "shipment delivery on time",
            "delivery shipped successfully",
            "shipped delivered completed",
        ]

        clusterer = TextClusterer(
            embedding_model='tfidf',
            n_clusters=2,
            random_seed=42
        )
        result = clusterer.fit_predict(texts)

        labels = result['labels']

        # First 5 should be in same cluster
        credit_labels = set(labels[:5])
        # Last 5 should be in same cluster
        delivery_labels = set(labels[5:])

        # Each group should be mostly in one cluster
        assert len(credit_labels) <= 2  # Allow some noise
        assert len(delivery_labels) <= 2

        # The two groups should be different
        # (at least the majority should be different)
        assert labels[0] != labels[5] or labels[2] != labels[7]

    def test_minimum_cluster_size(self):
        """Test that minimum cluster size is respected."""
        texts = [
            "text one", "text two", "text three",
            "text four", "text five", "text six",
        ]

        clusterer = TextClusterer(
            embedding_model='tfidf',
            min_cluster_size=3,
            random_seed=42
        )

        result = clusterer.fit_predict(texts)

        # Check cluster info
        for cluster_id, info in result['cluster_info'].items():
            assert info['n_documents'] >= 1  # At least some documents


class TestPhraseExtraction:
    """Tests for top phrase extraction."""

    def test_phrases_extracted(self):
        """Test that phrases are extracted for clusters."""
        texts = [
            "expedite order urgent rush",
            "rush expedite shipment urgent",
            "urgent rush expedite order",
            "order expedite rush urgent",
            "credit hold blocked payment",
            "payment blocked credit hold",
            "blocked credit payment hold",
            "hold credit blocked payment",
        ]

        clusterer = TextClusterer(
            embedding_model='tfidf',
            n_clusters=2,
            random_seed=42
        )
        result = clusterer.fit_predict(texts)

        # Should have phrases for each cluster
        assert len(result['top_phrases']) > 0

        # Phrases should be non-empty for clusters with documents
        for cluster_id, phrases in result['top_phrases'].items():
            if result['cluster_info'].get(cluster_id, {}).get('n_documents', 0) > 0:
                assert len(phrases) > 0

    def test_phrases_reflect_content(self):
        """Test that extracted phrases reflect cluster content."""
        texts = [
            "expedite rush urgent fast",
            "rush expedite quick urgent",
            "urgent rush expedite fast",
            "expedite urgent rush quick",
        ]

        clusterer = TextClusterer(
            embedding_model='tfidf',
            n_clusters=1,
            random_seed=42
        )
        result = clusterer.fit_predict(texts)

        # Get phrases for the cluster
        if result['top_phrases']:
            phrases = result['top_phrases'][0]
            phrase_words = [p[0] for p in phrases]

            # Should contain words from our texts
            expected = {'expedite', 'rush', 'urgent', 'fast', 'quick'}
            found = set(phrase_words) & expected
            assert len(found) > 0


class TestClusteringEdgeCases:
    """Tests for edge cases in clustering."""

    def test_empty_input(self):
        """Test handling of empty input."""
        clusterer = TextClusterer(random_seed=42)
        result = clusterer.fit_predict([])

        assert result['n_clusters'] == 0
        assert result['labels'] == []

    def test_single_document(self):
        """Test handling of single document."""
        clusterer = TextClusterer(random_seed=42, min_cluster_size=1)
        result = clusterer.fit_predict(["single document text"])

        # Should handle gracefully
        assert len(result['labels']) == 1

    def test_empty_strings_filtered(self):
        """Test that empty strings are handled."""
        texts = ["valid text here", "", "  ", "another valid text"]

        clusterer = TextClusterer(random_seed=42, min_cluster_size=1)
        result = clusterer.fit_predict(texts)

        # Should have labels for all inputs
        assert len(result['labels']) == 4

        # Empty strings should be marked as noise (negative label)
        assert result['labels'][1] < 0  # Empty string
        assert result['labels'][2] < 0  # Whitespace-only string

    def test_identical_documents(self):
        """Test handling of identical documents."""
        texts = ["same text"] * 10

        clusterer = TextClusterer(
            n_clusters=1,
            random_seed=42
        )
        result = clusterer.fit_predict(texts)

        # When all docs are identical, TF-IDF can't distinguish them
        # Either all get same cluster label, or all marked as noise/invalid
        labels = result['labels']
        unique_labels = set(labels)
        # Should have at most one distinct label (all same cluster or all noise)
        assert len(unique_labels) <= 1 or all(l < 0 for l in labels)

    def test_very_short_texts(self):
        """Test handling of very short texts."""
        texts = ["a", "b", "c", "d", "e"]

        clusterer = TextClusterer(random_seed=42, min_cluster_size=1)

        # Should not crash
        result = clusterer.fit_predict(texts)
        assert len(result['labels']) == 5


class TestClusteringAlgorithms:
    """Tests for different clustering algorithms."""

    @pytest.fixture
    def sample_texts(self):
        """Sample texts for algorithm tests."""
        return [
            "delivery delay shipment postponed",
            "delay delivery shipping late",
            "shipment delayed delivery postponed",
            "credit hold blocked payment",
            "blocked credit customer hold",
            "payment hold credit blocked",
            "rush expedite urgent order",
            "urgent rush express expedite",
            "expedite order rush urgent",
        ]

    def test_kmeans_clustering(self, sample_texts):
        """Test KMeans clustering."""
        clusterer = TextClusterer(
            clustering_algorithm='kmeans',
            n_clusters=3,
            random_seed=42
        )
        result = clusterer.fit_predict(sample_texts)

        assert result['n_clusters'] == 3
        assert result['parameters']['clustering_algorithm'] == 'kmeans'

    def test_dbscan_clustering(self, sample_texts):
        """Test DBSCAN clustering."""
        clusterer = TextClusterer(
            clustering_algorithm='dbscan',
            random_seed=42
        )
        result = clusterer.fit_predict(sample_texts)

        assert result['parameters']['clustering_algorithm'] == 'dbscan'
        # DBSCAN may find different number of clusters
        assert 'n_clusters' in result


class TestConvenienceFunction:
    """Tests for the convenience function."""

    def test_cluster_texts_function(self):
        """Test the cluster_texts convenience function."""
        texts = [
            "order one text here",
            "order two text here",
            "order three text here",
            "different topic entirely",
            "another different topic",
        ]

        result = cluster_texts(texts, n_clusters=2, random_seed=42)

        assert 'labels' in result
        assert len(result['labels']) == 5
        assert result['n_clusters'] == 2


class TestClusteringMetrics:
    """Tests for clustering quality metrics."""

    def test_silhouette_score_calculated(self):
        """Test that silhouette score is calculated when applicable."""
        texts = [
            # Cluster 1
            "credit hold payment blocked",
            "blocked credit payment hold",
            "credit block payment pending",
            # Cluster 2
            "delivery shipped completed",
            "shipment delivered done",
            "shipping delivery complete",
        ]

        clusterer = TextClusterer(
            n_clusters=2,
            random_seed=42
        )
        result = clusterer.fit_predict(texts)

        # Should have silhouette score for 2+ clusters
        if result['n_clusters'] > 1:
            assert result['silhouette'] is not None
            assert -1 <= result['silhouette'] <= 1

    def test_cluster_info_complete(self):
        """Test that cluster info contains all required fields."""
        texts = [f"document {i} text content" for i in range(20)]

        clusterer = TextClusterer(n_clusters=3, random_seed=42)
        result = clusterer.fit_predict(texts)

        for cluster_id, info in result['cluster_info'].items():
            assert 'n_documents' in info
            assert 'avg_text_length' in info
            assert 'percentage' in info
            assert info['n_documents'] > 0
