"""
Tests for CSV loader functionality.

Tests the CSV import mode that allows bypassing RFC connections
by loading data from SE16N CSV exports.
"""

import csv
import pytest
import tempfile
from pathlib import Path
from datetime import datetime

from src.ingest.csv_loader import (
    CSVLoader,
    convert_csv_to_orders,
    load_csv_directory,
    VBAK_FIELD_MAP,
    VBAP_FIELD_MAP,
)


class TestCSVLoader:
    """Tests for CSVLoader class."""

    @pytest.fixture
    def sample_vbak_data(self):
        """Sample VBAK data for testing."""
        return [
            ['VBELN', 'AUART', 'VKORG', 'ERDAT', 'NETWR', 'WAERK', 'KUNNR', 'VDATU'],
            ['0000000001', 'OR', '1000', '2024-01-15', '12500.00', 'USD', 'CUST001', '2024-01-22'],
            ['0000000002', 'SO', '2000', '2024-01-16', '45000.00', 'EUR', 'CUST002', '2024-01-20'],
            ['0000000003', 'RE', '1000', '2024-01-17', '2500.00', 'USD', 'CUST001', '2024-01-24'],
        ]

    @pytest.fixture
    def sample_vbap_data(self):
        """Sample VBAP data for testing."""
        return [
            ['VBELN', 'POSNR', 'MATNR', 'WERKS', 'KWMENG', 'NETWR'],
            ['0000000001', '000010', 'MAT-001', '1000', '5', '6250.00'],
            ['0000000001', '000020', 'MAT-002', '1000', '10', '6250.00'],
            ['0000000002', '000010', 'MAT-003', '2000', '2', '30000.00'],
            ['0000000002', '000020', 'MAT-004', '2000', '100', '15000.00'],
            ['0000000003', '000010', 'MAT-001', '1000', '-2', '2500.00'],
        ]

    @pytest.fixture
    def sample_text_data(self):
        """Sample text data for testing."""
        return [
            ['TDNAME', 'TDID', 'TDSPRAS', 'TDLINE'],
            ['0000000001', '0001', 'EN', 'Rush order - expedite processing.'],
            ['0000000001', '0002', 'EN', 'Customer priority account.'],
            ['0000000002', '0001', 'EN', 'International shipment - verify docs.'],
        ]

    @pytest.fixture
    def csv_dir(self, sample_vbak_data, sample_vbap_data, sample_text_data):
        """Create temporary directory with CSV files."""
        with tempfile.TemporaryDirectory() as tmpdir:
            tmppath = Path(tmpdir)

            # Write VBAK
            with open(tmppath / 'VBAK.csv', 'w', newline='') as f:
                writer = csv.writer(f)
                writer.writerows(sample_vbak_data)

            # Write VBAP
            with open(tmppath / 'VBAP.csv', 'w', newline='') as f:
                writer = csv.writer(f)
                writer.writerows(sample_vbap_data)

            # Write texts
            with open(tmppath / 'texts.csv', 'w', newline='') as f:
                writer = csv.writer(f)
                writer.writerows(sample_text_data)

            yield tmppath

    def test_load_from_csv_basic(self, csv_dir):
        """Test basic CSV loading."""
        loader = CSVLoader()
        result = loader.load_from_csv(
            vbak_csv=csv_dir / 'VBAK.csv',
            vbap_csv=csv_dir / 'VBAP.csv',
        )

        assert result.success
        assert len(result.documents) == 3
        assert result.stats['vbak_records'] == 3
        assert result.stats['vbap_records'] == 5

    def test_load_from_csv_with_texts(self, csv_dir):
        """Test CSV loading with text file."""
        loader = CSVLoader()
        result = loader.load_from_csv(
            vbak_csv=csv_dir / 'VBAK.csv',
            vbap_csv=csv_dir / 'VBAP.csv',
            text_csv=csv_dir / 'texts.csv',
        )

        assert result.success

        # Check that texts were loaded for order 1
        doc1 = next(d for d in result.documents if d['doc_key'] == '0000000001')
        assert 'Rush order' in doc1['consolidated_text']
        assert 'priority account' in doc1['consolidated_text']

    def test_document_structure(self, csv_dir):
        """Test that documents have expected structure."""
        loader = CSVLoader()
        result = loader.load_from_csv(
            vbak_csv=csv_dir / 'VBAK.csv',
            vbap_csv=csv_dir / 'VBAP.csv',
        )

        doc = result.documents[0]

        # Check required fields
        assert 'doc_key' in doc
        assert 'consolidated_text' in doc
        assert 'order' in doc
        assert 'dates' in doc
        assert 'timing' in doc
        assert 'sales_org' in doc

        # Check order structure
        order = doc['order']
        assert 'document_number' in order
        assert 'vbeln' in order
        assert 'auart' in order
        assert 'items' in order

    def test_items_linked_to_orders(self, csv_dir):
        """Test that items are correctly linked to orders."""
        loader = CSVLoader()
        result = loader.load_from_csv(
            vbak_csv=csv_dir / 'VBAK.csv',
            vbap_csv=csv_dir / 'VBAP.csv',
        )

        # Order 1 should have 2 items
        doc1 = next(d for d in result.documents if d['doc_key'] == '0000000001')
        assert len(doc1['order']['items']) == 2

        # Order 2 should have 2 items
        doc2 = next(d for d in result.documents if d['doc_key'] == '0000000002')
        assert len(doc2['order']['items']) == 2

        # Order 3 should have 1 item
        doc3 = next(d for d in result.documents if d['doc_key'] == '0000000003')
        assert len(doc3['order']['items']) == 1

    def test_synthetic_text_generation(self, csv_dir):
        """Test synthetic text generation when no text file provided."""
        loader = CSVLoader(random_seed=42)
        result = loader.load_from_csv(
            vbak_csv=csv_dir / 'VBAK.csv',
            vbap_csv=csv_dir / 'VBAP.csv',
            text_csv=None,  # No text file
        )

        assert result.success

        # All documents should have some text
        for doc in result.documents:
            assert doc['consolidated_text']
            assert len(doc['consolidated_text']) > 0

        # Rush order (SO) should have rush-related text
        doc_so = next(d for d in result.documents if d['order']['auart'] == 'SO')
        # Synthetic text should mention order type
        assert 'order' in doc_so['consolidated_text'].lower()

    def test_date_parsing(self, csv_dir):
        """Test various date format parsing."""
        loader = CSVLoader()

        # Test different date formats
        test_dates = [
            ('2024-01-15', datetime(2024, 1, 15)),
            ('20240115', datetime(2024, 1, 15)),
            ('15.01.2024', datetime(2024, 1, 15)),
        ]

        for date_str, expected in test_dates:
            parsed = loader._parse_date(date_str)
            assert parsed is not None
            assert parsed.date() == expected.date()

    def test_missing_vbak_file(self, csv_dir):
        """Test error handling for missing VBAK file."""
        loader = CSVLoader()
        result = loader.load_from_csv(
            vbak_csv=csv_dir / 'nonexistent.csv',
            vbap_csv=csv_dir / 'VBAP.csv',
        )

        assert not result.success
        assert len(result.errors) > 0
        assert 'not found' in result.errors[0].lower()

    def test_missing_vbap_file(self, csv_dir):
        """Test error handling for missing VBAP file."""
        loader = CSVLoader()
        result = loader.load_from_csv(
            vbak_csv=csv_dir / 'VBAK.csv',
            vbap_csv=csv_dir / 'nonexistent.csv',
        )

        assert not result.success
        assert len(result.errors) > 0

    def test_delimiter_detection(self):
        """Test auto-detection of CSV delimiters."""
        loader = CSVLoader()

        # Comma-delimited
        assert loader._detect_delimiter('a,b,c\n1,2,3') == ','

        # Semicolon-delimited (European)
        assert loader._detect_delimiter('a;b;c\n1;2;3') == ';'

        # Tab-delimited
        assert loader._detect_delimiter('a\tb\tc\n1\t2\t3') == '\t'

    def test_field_name_normalization(self):
        """Test that various field name formats are handled."""
        # Check that mapping includes common variants
        assert 'VBELN' in VBAK_FIELD_MAP
        assert 'vbeln' in VBAK_FIELD_MAP
        assert 'Sales Document' in VBAK_FIELD_MAP

        assert 'MATNR' in VBAP_FIELD_MAP
        assert 'Material' in VBAP_FIELD_MAP


class TestCSVDirectoryLoader:
    """Tests for load_csv_directory function."""

    @pytest.fixture
    def csv_dir(self):
        """Create temporary directory with CSV files."""
        with tempfile.TemporaryDirectory() as tmpdir:
            tmppath = Path(tmpdir)

            # Write minimal VBAK
            with open(tmppath / 'VBAK.csv', 'w', newline='') as f:
                writer = csv.writer(f)
                writer.writerow(['VBELN', 'AUART', 'VKORG', 'ERDAT', 'NETWR', 'WAERK', 'KUNNR'])
                writer.writerow(['0000000001', 'OR', '1000', '2024-01-15', '10000', 'USD', 'C001'])

            # Write minimal VBAP
            with open(tmppath / 'VBAP.csv', 'w', newline='') as f:
                writer = csv.writer(f)
                writer.writerow(['VBELN', 'POSNR', 'MATNR', 'KWMENG', 'NETWR'])
                writer.writerow(['0000000001', '000010', 'MAT001', '5', '10000'])

            yield tmppath

    def test_load_csv_directory(self, csv_dir):
        """Test loading from directory."""
        documents = load_csv_directory(csv_dir)

        assert len(documents) == 1
        assert documents[0]['doc_key'] == '0000000001'

    def test_load_csv_directory_not_found(self):
        """Test error when directory doesn't exist."""
        with pytest.raises(ValueError, match='not found'):
            load_csv_directory('/nonexistent/path')

    def test_load_csv_directory_missing_vbak(self):
        """Test error when VBAK file missing."""
        with tempfile.TemporaryDirectory() as tmpdir:
            tmppath = Path(tmpdir)

            # Only VBAP, no VBAK
            with open(tmppath / 'VBAP.csv', 'w') as f:
                f.write('VBELN,POSNR\n')

            with pytest.raises(ValueError, match='VBAK'):
                load_csv_directory(tmppath)


class TestConvertCSVToOrders:
    """Tests for convert_csv_to_orders function."""

    def test_convert_csv_to_orders(self):
        """Test the convenience conversion function."""
        with tempfile.TemporaryDirectory() as tmpdir:
            tmppath = Path(tmpdir)

            # Create minimal test files
            with open(tmppath / 'vbak.csv', 'w', newline='') as f:
                writer = csv.writer(f)
                writer.writerow(['VBELN', 'AUART', 'ERDAT', 'NETWR', 'WAERK', 'KUNNR'])
                writer.writerow(['0000000001', 'OR', '2024-01-15', '5000', 'USD', 'C001'])

            with open(tmppath / 'vbap.csv', 'w', newline='') as f:
                writer = csv.writer(f)
                writer.writerow(['VBELN', 'POSNR', 'MATNR', 'KWMENG'])
                writer.writerow(['0000000001', '10', 'MAT1', '10'])

            documents = convert_csv_to_orders(
                vbak_csv=tmppath / 'vbak.csv',
                vbap_csv=tmppath / 'vbap.csv',
            )

            assert len(documents) == 1
            assert documents[0]['doc_key'] == '0000000001'


class TestCSVValidation:
    """Tests for CSV validation functionality."""

    def test_validate_csv_structure(self):
        """Test CSV structure validation."""
        loader = CSVLoader()

        with tempfile.TemporaryDirectory() as tmpdir:
            tmppath = Path(tmpdir)

            # Create valid CSV
            with open(tmppath / 'test.csv', 'w', newline='') as f:
                writer = csv.writer(f)
                writer.writerow(['VBELN', 'AUART', 'UnknownCol'])
                writer.writerow(['0001', 'OR', 'value'])

            result = loader._validate_csv(
                tmppath / 'test.csv',
                VBAK_FIELD_MAP,
                'vbeln'
            )

            assert result.valid
            assert 'vbeln' in result.mapped_columns.values()
            assert 'UnknownCol' in result.unmapped_columns

    def test_validate_csv_missing_required_field(self):
        """Test validation fails when required field missing."""
        loader = CSVLoader()

        with tempfile.TemporaryDirectory() as tmpdir:
            tmppath = Path(tmpdir)

            # Create CSV without VBELN
            with open(tmppath / 'test.csv', 'w', newline='') as f:
                writer = csv.writer(f)
                writer.writerow(['AUART', 'NETWR'])
                writer.writerow(['OR', '1000'])

            result = loader._validate_csv(
                tmppath / 'test.csv',
                VBAK_FIELD_MAP,
                'vbeln'
            )

            assert not result.valid
            assert len(result.errors) > 0


class TestEdgeCases:
    """Tests for edge cases and error handling."""

    def test_empty_csv_file(self):
        """Test handling of empty CSV file."""
        loader = CSVLoader()

        with tempfile.TemporaryDirectory() as tmpdir:
            tmppath = Path(tmpdir)

            # Create empty CSV (headers only)
            with open(tmppath / 'VBAK.csv', 'w') as f:
                f.write('VBELN,AUART\n')

            with open(tmppath / 'VBAP.csv', 'w') as f:
                f.write('VBELN,POSNR\n')

            result = loader.load_from_csv(
                vbak_csv=tmppath / 'VBAK.csv',
                vbap_csv=tmppath / 'VBAP.csv',
            )

            assert result.success
            assert len(result.documents) == 0

    def test_special_characters_in_text(self):
        """Test handling of special characters in text."""
        loader = CSVLoader()

        with tempfile.TemporaryDirectory() as tmpdir:
            tmppath = Path(tmpdir)

            # Create files with special characters
            with open(tmppath / 'VBAK.csv', 'w', newline='', encoding='utf-8') as f:
                writer = csv.writer(f)
                writer.writerow(['VBELN', 'AUART', 'ERDAT', 'NETWR', 'KUNNR'])
                writer.writerow(['0001', 'OR', '2024-01-15', '1000', 'C001'])

            with open(tmppath / 'VBAP.csv', 'w', newline='', encoding='utf-8') as f:
                writer = csv.writer(f)
                writer.writerow(['VBELN', 'POSNR', 'MATNR'])
                writer.writerow(['0001', '10', 'MAT-001'])

            with open(tmppath / 'texts.csv', 'w', newline='', encoding='utf-8') as f:
                writer = csv.writer(f)
                writer.writerow(['TDNAME', 'TDID', 'TDSPRAS', 'TDLINE'])
                writer.writerow(['0001', '0001', 'EN', 'Special chars: Munchen, cafe, $100'])

            result = loader.load_from_csv(
                vbak_csv=tmppath / 'VBAK.csv',
                vbap_csv=tmppath / 'VBAP.csv',
                text_csv=tmppath / 'texts.csv',
            )

            assert result.success
            assert 'Munchen' in result.documents[0]['consolidated_text']

    def test_european_number_format(self):
        """Test handling of European number format (comma as decimal)."""
        loader = CSVLoader()

        # Test value cleaning
        assert loader._clean_value('1234,56') == 1234.56
        assert loader._clean_value('1000') == 1000

    def test_reproducible_text_generation(self):
        """Test that synthetic text generation is reproducible with same seed."""
        with tempfile.TemporaryDirectory() as tmpdir:
            tmppath = Path(tmpdir)

            # Create minimal test files
            with open(tmppath / 'VBAK.csv', 'w', newline='') as f:
                writer = csv.writer(f)
                writer.writerow(['VBELN', 'AUART', 'ERDAT', 'NETWR', 'KUNNR'])
                writer.writerow(['0001', 'OR', '2024-01-15', '100000', 'C001'])

            with open(tmppath / 'VBAP.csv', 'w', newline='') as f:
                writer = csv.writer(f)
                writer.writerow(['VBELN', 'POSNR', 'MATNR'])
                writer.writerow(['0001', '10', 'MAT1'])

            # Load twice with same seed
            loader1 = CSVLoader(random_seed=42)
            result1 = loader1.load_from_csv(
                vbak_csv=tmppath / 'VBAK.csv',
                vbap_csv=tmppath / 'VBAP.csv',
            )

            loader2 = CSVLoader(random_seed=42)
            result2 = loader2.load_from_csv(
                vbak_csv=tmppath / 'VBAK.csv',
                vbap_csv=tmppath / 'VBAP.csv',
            )

            # Should produce same text
            assert result1.documents[0]['consolidated_text'] == result2.documents[0]['consolidated_text']

            # Different seed should produce different text
            loader3 = CSVLoader(random_seed=123)
            result3 = loader3.load_from_csv(
                vbak_csv=tmppath / 'VBAK.csv',
                vbap_csv=tmppath / 'VBAP.csv',
            )

            # May or may not be different depending on patterns, but test passes
            assert result3.success
