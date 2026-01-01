"""
CSV Loader for SAP Table Exports.

Allows users to bypass RFC connections by loading data from SE16N CSV exports.
Supports:
- VBAK - Sales order headers
- VBAP - Sales order items
- STXH/STXL - Text headers/lines (optional)
- VBFA - Document flow (optional)

Usage:
    loader = CSVLoader()
    documents = loader.load_from_csv(
        vbak_csv="exports/VBAK.csv",
        vbap_csv="exports/VBAP.csv",
        text_csv="exports/texts.csv",  # Optional
        vbfa_csv="exports/VBFA.csv"     # Optional
    )
"""

import csv
import hashlib
import logging
import random
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple, Union

logger = logging.getLogger(__name__)


# =============================================================================
# Field Mappings: CSV column headers -> Internal field names
# =============================================================================

# VBAK (Sales Order Header) field mappings
# Maps both SAP technical names and English descriptions
VBAK_FIELD_MAP = {
    # Document number
    'vbeln': 'vbeln',
    'VBELN': 'vbeln',
    'sales_document': 'vbeln',
    'Sales Document': 'vbeln',
    'order_number': 'vbeln',
    'Order Number': 'vbeln',
    # Order type
    'auart': 'auart',
    'AUART': 'auart',
    'order_type': 'auart',
    'Order Type': 'auart',
    'Sales Document Type': 'auart',
    # Sales organization
    'vkorg': 'vkorg',
    'VKORG': 'vkorg',
    'sales_org': 'vkorg',
    'Sales Org': 'vkorg',
    'Sales Organization': 'vkorg',
    # Distribution channel
    'vtweg': 'vtweg',
    'VTWEG': 'vtweg',
    'Distribution Channel': 'vtweg',
    # Division
    'spart': 'spart',
    'SPART': 'spart',
    'Division': 'spart',
    # Created date
    'erdat': 'erdat',
    'ERDAT': 'erdat',
    'created_date': 'erdat',
    'Created Date': 'erdat',
    'Creation Date': 'erdat',
    # Net value
    'netwr': 'netwr',
    'NETWR': 'netwr',
    'net_value': 'netwr',
    'Net Value': 'netwr',
    # Currency
    'waerk': 'waerk',
    'WAERK': 'waerk',
    'currency': 'waerk',
    'Currency': 'waerk',
    # Customer (Sold-to)
    'kunnr': 'kunnr',
    'KUNNR': 'kunnr',
    'customer': 'kunnr',
    'Customer': 'kunnr',
    'Sold-to party': 'kunnr',
    'Sold-To Party': 'kunnr',
    # Requested delivery date
    'vdatu': 'vdatu',
    'VDATU': 'vdatu',
    'req_delivery_date': 'vdatu',
    'Requested Delivery Date': 'vdatu',
    # Created time
    'erzet': 'erzet',
    'ERZET': 'erzet',
    'Created Time': 'erzet',
    # Created by
    'ernam': 'ernam',
    'ERNAM': 'ernam',
    'Created By': 'ernam',
    # Condition number
    'knumv': 'knumv',
    'KNUMV': 'knumv',
}

# VBAP (Sales Order Item) field mappings
VBAP_FIELD_MAP = {
    # Document number
    'vbeln': 'vbeln',
    'VBELN': 'vbeln',
    'sales_document': 'vbeln',
    'Sales Document': 'vbeln',
    # Item number
    'posnr': 'posnr',
    'POSNR': 'posnr',
    'item': 'posnr',
    'Item': 'posnr',
    'item_number': 'posnr',
    'Item Number': 'posnr',
    'Sales Document Item': 'posnr',
    # Material number
    'matnr': 'matnr',
    'MATNR': 'matnr',
    'material': 'matnr',
    'Material': 'matnr',
    'Material Number': 'matnr',
    # Plant
    'werks': 'werks',
    'WERKS': 'werks',
    'plant': 'werks',
    'Plant': 'werks',
    # Quantity
    'kwmeng': 'kwmeng',
    'KWMENG': 'kwmeng',
    'quantity': 'kwmeng',
    'Quantity': 'kwmeng',
    'Order Quantity': 'kwmeng',
    # Net value (item level)
    'netwr': 'netwr',
    'NETWR': 'netwr',
    'net_value': 'netwr',
    'Net Value': 'netwr',
    'Net Amount': 'netwr',
    # Item category
    'pstyv': 'pstyv',
    'PSTYV': 'pstyv',
    'Item Category': 'pstyv',
    # Unit
    'vrkme': 'vrkme',
    'VRKME': 'vrkme',
    'Sales Unit': 'vrkme',
    'meins': 'meins',
    'MEINS': 'meins',
    'Unit': 'meins',
}

# STXH/STXL (Text) field mappings
TEXT_FIELD_MAP = {
    # Object key (usually VBELN)
    'tdname': 'tdname',
    'TDNAME': 'tdname',
    'object_key': 'tdname',
    'Object Key': 'tdname',
    # Text ID
    'tdid': 'tdid',
    'TDID': 'tdid',
    'text_id': 'tdid',
    'Text ID': 'tdid',
    # Language
    'tdspras': 'tdspras',
    'TDSPRAS': 'tdspras',
    'spras': 'tdspras',
    'SPRAS': 'tdspras',
    'language': 'tdspras',
    'Language': 'tdspras',
    # Text content
    'tdline': 'tdline',
    'TDLINE': 'tdline',
    'text': 'tdline',
    'Text': 'tdline',
    'text_line': 'tdline',
    'Text Line': 'tdline',
    'content': 'tdline',
    'Content': 'tdline',
    # Text object type
    'tdobject': 'tdobject',
    'TDOBJECT': 'tdobject',
    'text_object': 'tdobject',
    'Text Object': 'tdobject',
}

# VBFA (Document Flow) field mappings
VBFA_FIELD_MAP = {
    # Preceding document
    'vbelv': 'vbelv',
    'VBELV': 'vbelv',
    'preceding_doc': 'vbelv',
    'Preceding Doc': 'vbelv',
    'Source Document': 'vbelv',
    # Preceding item
    'posnv': 'posnv',
    'POSNV': 'posnv',
    'preceding_item': 'posnv',
    'Source Item': 'posnv',
    # Preceding category
    'vbtyp_v': 'vbtyp_v',
    'VBTYP_V': 'vbtyp_v',
    'source_category': 'vbtyp_v',
    'Source Category': 'vbtyp_v',
    # Subsequent document
    'vbeln': 'vbeln',
    'VBELN': 'vbeln',
    'subsequent_doc': 'vbeln',
    'Subsequent Doc': 'vbeln',
    'Target Document': 'vbeln',
    # Subsequent item
    'posnn': 'posnn',
    'POSNN': 'posnn',
    'subsequent_item': 'posnn',
    'Target Item': 'posnn',
    # Subsequent category
    'vbtyp_n': 'vbtyp_n',
    'VBTYP_N': 'vbtyp_n',
    'target_category': 'vbtyp_n',
    'Target Category': 'vbtyp_n',
    # Reference quantity
    'rfmng': 'rfmng',
    'RFMNG': 'rfmng',
    'quantity': 'rfmng',
    'Reference Quantity': 'rfmng',
    # Creation date
    'erdat': 'erdat',
    'ERDAT': 'erdat',
    'created_date': 'erdat',
    'Created Date': 'erdat',
}


@dataclass
class CSVValidationResult:
    """Result of CSV validation."""
    valid: bool
    file_path: str
    row_count: int = 0
    column_count: int = 0
    detected_columns: List[str] = field(default_factory=list)
    mapped_columns: Dict[str, str] = field(default_factory=dict)
    unmapped_columns: List[str] = field(default_factory=list)
    errors: List[str] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)


@dataclass
class CSVLoadResult:
    """Result of CSV loading operation."""
    success: bool
    documents: List[Dict[str, Any]] = field(default_factory=list)
    validation: Dict[str, CSVValidationResult] = field(default_factory=dict)
    stats: Dict[str, int] = field(default_factory=dict)
    errors: List[str] = field(default_factory=list)


class CSVLoader:
    """
    Loads SAP data from CSV exports (SE16N format).

    Converts CSV exports to the same unified document format
    expected by the pattern engine's DataLoader.
    """

    # Text patterns for synthetic text generation
    TEXT_PATTERNS = {
        'high_value': [
            "High-value order - requires manager approval.",
            "Priority customer - expedited handling required.",
            "Large order quantity - verify stock availability.",
        ],
        'rush': [
            "Rush order - expedite processing.",
            "Customer requested express delivery.",
            "Urgent: Ship within 24 hours.",
        ],
        'international': [
            "International shipment - verify export documentation.",
            "Cross-border delivery - check customs requirements.",
            "Foreign customer - handle currency conversion.",
        ],
        'standard': [
            "Standard order processing.",
            "Regular customer order.",
            "Routine shipment.",
        ],
        'special_handling': [
            "Special packaging required.",
            "Fragile items - handle with care.",
            "Temperature-controlled shipping required.",
        ],
        'credit_check': [
            "Credit check pending.",
            "Credit limit exceeded - approval required.",
            "New customer - verify payment terms.",
        ],
        'backorder': [
            "Partial shipment authorized.",
            "Backorder created for remaining quantity.",
            "Material shortage - notify customer of delay.",
        ],
    }

    # Order type to description mapping
    ORDER_TYPE_DESC = {
        'OR': 'Standard Order',
        'RE': 'Return Order',
        'CR': 'Credit Memo',
        'DR': 'Debit Memo',
        'SO': 'Rush Order',
        'QT': 'Quotation',
        'IN': 'Inquiry',
    }

    def __init__(self, delimiter: str = ',', encoding: str = 'utf-8',
                 random_seed: int = 42):
        """
        Initialize the CSV loader.

        Args:
            delimiter: CSV field delimiter (default: comma)
            encoding: File encoding (default: utf-8)
            random_seed: Seed for reproducible text generation
        """
        self.delimiter = delimiter
        self.encoding = encoding
        self.random_seed = random_seed
        self._rng = random.Random(random_seed)

    def load_from_csv(
        self,
        vbak_csv: Union[str, Path],
        vbap_csv: Union[str, Path],
        text_csv: Optional[Union[str, Path]] = None,
        vbfa_csv: Optional[Union[str, Path]] = None,
    ) -> CSVLoadResult:
        """
        Load SAP data from CSV exports and convert to unified format.

        Args:
            vbak_csv: Path to VBAK (sales order header) CSV
            vbap_csv: Path to VBAP (sales order item) CSV
            text_csv: Optional path to text CSV (STXH/STXL combined)
            vbfa_csv: Optional path to VBFA (document flow) CSV

        Returns:
            CSVLoadResult with loaded documents and validation info
        """
        result = CSVLoadResult(success=False)

        # Validate and load required files
        vbak_path = Path(vbak_csv)
        vbap_path = Path(vbap_csv)

        if not vbak_path.exists():
            result.errors.append(f"VBAK file not found: {vbak_path}")
            return result

        if not vbap_path.exists():
            result.errors.append(f"VBAP file not found: {vbap_path}")
            return result

        # Load and validate VBAK
        logger.info(f"Loading VBAK from {vbak_path}")
        vbak_validation = self._validate_csv(vbak_path, VBAK_FIELD_MAP, 'vbeln')
        result.validation['vbak'] = vbak_validation

        if not vbak_validation.valid:
            result.errors.append(f"VBAK validation failed: {vbak_validation.errors}")
            return result

        vbak_records = self._load_csv(vbak_path, VBAK_FIELD_MAP)
        logger.info(f"Loaded {len(vbak_records)} VBAK records")
        result.stats['vbak_records'] = len(vbak_records)

        # Load and validate VBAP
        logger.info(f"Loading VBAP from {vbap_path}")
        vbap_validation = self._validate_csv(vbap_path, VBAP_FIELD_MAP, 'vbeln')
        result.validation['vbap'] = vbap_validation

        if not vbap_validation.valid:
            result.errors.append(f"VBAP validation failed: {vbap_validation.errors}")
            return result

        vbap_records = self._load_csv(vbap_path, VBAP_FIELD_MAP)
        logger.info(f"Loaded {len(vbap_records)} VBAP records")
        result.stats['vbap_records'] = len(vbap_records)

        # Load optional text file
        text_records = []
        if text_csv:
            text_path = Path(text_csv)
            if text_path.exists():
                logger.info(f"Loading texts from {text_path}")
                text_validation = self._validate_csv(text_path, TEXT_FIELD_MAP, 'tdname')
                result.validation['text'] = text_validation

                if text_validation.valid:
                    text_records = self._load_csv(text_path, TEXT_FIELD_MAP)
                    logger.info(f"Loaded {len(text_records)} text records")
                else:
                    result.validation['text'].warnings.append(
                        f"Text file validation failed, will generate synthetic texts"
                    )
            else:
                logger.warning(f"Text file not found: {text_path}, will generate synthetic texts")
        else:
            logger.info("No text file provided, will generate synthetic texts")

        result.stats['text_records'] = len(text_records)

        # Load optional document flow
        vbfa_records = []
        if vbfa_csv:
            vbfa_path = Path(vbfa_csv)
            if vbfa_path.exists():
                logger.info(f"Loading VBFA from {vbfa_path}")
                vbfa_validation = self._validate_csv(vbfa_path, VBFA_FIELD_MAP, 'vbelv')
                result.validation['vbfa'] = vbfa_validation

                if vbfa_validation.valid:
                    vbfa_records = self._load_csv(vbfa_path, VBFA_FIELD_MAP)
                    logger.info(f"Loaded {len(vbfa_records)} VBFA records")
                else:
                    logger.warning("VBFA validation failed, skipping document flow")
            else:
                logger.warning(f"VBFA file not found: {vbfa_path}")

        result.stats['vbfa_records'] = len(vbfa_records)

        # Convert to unified document format
        logger.info("Converting CSV records to unified document format...")
        documents = self._convert_to_documents(
            vbak_records=vbak_records,
            vbap_records=vbap_records,
            text_records=text_records,
            vbfa_records=vbfa_records,
        )

        result.documents = documents
        result.stats['documents'] = len(documents)
        result.success = True

        logger.info(f"Created {len(documents)} unified documents")
        return result

    def _validate_csv(
        self,
        file_path: Path,
        field_map: Dict[str, str],
        required_key: str
    ) -> CSVValidationResult:
        """
        Validate a CSV file structure and column mappings.

        Args:
            file_path: Path to CSV file
            field_map: Field name mappings
            required_key: Required key field name (normalized)

        Returns:
            CSVValidationResult with validation details
        """
        result = CSVValidationResult(valid=True, file_path=str(file_path))

        try:
            # Try different encodings
            for encoding in [self.encoding, 'utf-8-sig', 'latin-1', 'cp1252']:
                try:
                    with open(file_path, 'r', encoding=encoding, newline='') as f:
                        # Try to detect delimiter
                        sample = f.read(4096)
                        f.seek(0)

                        # Auto-detect delimiter
                        delimiter = self._detect_delimiter(sample)

                        reader = csv.DictReader(f, delimiter=delimiter)
                        headers = reader.fieldnames or []

                        if not headers:
                            result.errors.append("No headers found in CSV")
                            result.valid = False
                            return result

                        result.detected_columns = list(headers)
                        result.column_count = len(headers)

                        # Map columns
                        for header in headers:
                            header_clean = header.strip()
                            if header_clean in field_map:
                                result.mapped_columns[header_clean] = field_map[header_clean]
                            else:
                                result.unmapped_columns.append(header_clean)

                        # Check for required key field
                        has_key = any(
                            field_map.get(h.strip()) == required_key
                            for h in headers
                        )

                        if not has_key:
                            result.errors.append(
                                f"Required field '{required_key}' not found. "
                                f"Expected one of: {[k for k, v in field_map.items() if v == required_key]}"
                            )
                            result.valid = False

                        # Count rows (sample first 100)
                        row_count = 0
                        for _ in reader:
                            row_count += 1
                            if row_count >= 100:
                                # Estimate total
                                f.seek(0)
                                total_lines = sum(1 for _ in f) - 1  # Subtract header
                                row_count = total_lines
                                break

                        result.row_count = row_count

                        if result.unmapped_columns:
                            result.warnings.append(
                                f"Unmapped columns: {result.unmapped_columns}"
                            )

                        # Successfully read with this encoding
                        break

                except UnicodeDecodeError:
                    continue
            else:
                result.errors.append(f"Could not decode file with any supported encoding")
                result.valid = False

        except Exception as e:
            result.errors.append(f"Error reading CSV: {str(e)}")
            result.valid = False

        return result

    def _detect_delimiter(self, sample: str) -> str:
        """Detect CSV delimiter from sample content."""
        # Count occurrences of common delimiters
        delimiters = {
            ',': sample.count(','),
            ';': sample.count(';'),
            '\t': sample.count('\t'),
            '|': sample.count('|'),
        }

        # Return most common delimiter
        return max(delimiters, key=delimiters.get)

    # Fields that should remain as strings (document numbers, item numbers, etc.)
    STRING_FIELDS = {
        'vbeln', 'posnr', 'matnr', 'kunnr', 'tdname', 'tdid', 'tdspras',
        'vbelv', 'posnv', 'posnn', 'werks', 'auart', 'vkorg', 'vtweg',
        'spart', 'waerk', 'pstyv', 'vrkme', 'ernam', 'knumv', 'tdobject',
        'vbtyp_v', 'vbtyp_n',
    }

    def _load_csv(
        self,
        file_path: Path,
        field_map: Dict[str, str]
    ) -> List[Dict[str, Any]]:
        """
        Load CSV file and normalize field names.

        Args:
            file_path: Path to CSV file
            field_map: Field name mappings

        Returns:
            List of records with normalized field names
        """
        records = []

        # Try different encodings
        for encoding in [self.encoding, 'utf-8-sig', 'latin-1', 'cp1252']:
            try:
                with open(file_path, 'r', encoding=encoding, newline='') as f:
                    sample = f.read(4096)
                    f.seek(0)
                    delimiter = self._detect_delimiter(sample)

                    reader = csv.DictReader(f, delimiter=delimiter)

                    for row in reader:
                        normalized_row = {}

                        for header, value in row.items():
                            if header is None:
                                continue
                            header_clean = header.strip()

                            # Normalize field name
                            if header_clean in field_map:
                                normalized_name = field_map[header_clean]
                            else:
                                # Keep original name if not mapped
                                normalized_name = header_clean.lower().replace(' ', '_')

                            # Clean and convert value
                            # Keep string fields as strings (document numbers, etc.)
                            if normalized_name in self.STRING_FIELDS:
                                normalized_row[normalized_name] = str(value).strip() if value else ''
                            else:
                                normalized_row[normalized_name] = self._clean_value(value)

                        records.append(normalized_row)

                    break  # Successfully loaded

            except UnicodeDecodeError:
                continue

        return records

    def _clean_value(self, value: Any) -> Any:
        """Clean and convert a cell value."""
        if value is None:
            return None

        if isinstance(value, str):
            value = value.strip()

            if value == '' or value.upper() in ('NULL', 'NA', 'N/A', '#N/A'):
                return None

            # Try numeric conversion
            try:
                # Check for integer
                if value.isdigit() or (value.startswith('-') and value[1:].isdigit()):
                    return int(value)

                # Check for float (handle European format with comma decimal)
                if ',' in value and '.' not in value:
                    value = value.replace(',', '.')

                float_val = float(value.replace(',', ''))
                return float_val
            except (ValueError, AttributeError):
                pass

        return value

    def _convert_to_documents(
        self,
        vbak_records: List[Dict],
        vbap_records: List[Dict],
        text_records: List[Dict],
        vbfa_records: List[Dict],
    ) -> List[Dict[str, Any]]:
        """
        Convert CSV records to unified document format.

        This creates the same structure expected by the pattern engine's
        DataLoader.load_all() method.
        """
        # Build indices for efficient lookups
        items_by_order = self._group_by_key(vbap_records, 'vbeln')
        texts_by_order = self._group_texts_by_order(text_records)

        # Build document flow index if available
        deliveries_by_order: Dict[str, List[Dict]] = {}
        invoices_by_delivery: Dict[str, List[Dict]] = {}

        if vbfa_records:
            for flow in vbfa_records:
                source_cat = str(flow.get('vbtyp_v', '')).upper()
                target_cat = str(flow.get('vbtyp_n', '')).upper()
                source_doc = str(flow.get('vbelv', ''))
                target_doc = str(flow.get('vbeln', ''))

                # Order (C) -> Delivery (J)
                if source_cat == 'C' and target_cat == 'J':
                    if source_doc not in deliveries_by_order:
                        deliveries_by_order[source_doc] = []
                    deliveries_by_order[source_doc].append({
                        'document_number': target_doc,
                        'created_date': flow.get('erdat'),
                    })

                # Delivery (J) -> Invoice (M)
                if source_cat == 'J' and target_cat == 'M':
                    if source_doc not in invoices_by_delivery:
                        invoices_by_delivery[source_doc] = []
                    invoices_by_delivery[source_doc].append({
                        'document_number': target_doc,
                        'billing_date': flow.get('erdat'),
                    })

        # Create unified documents
        documents = []

        for vbak in vbak_records:
            order_num = str(vbak.get('vbeln', '')).strip()
            if not order_num:
                continue

            # Get items for this order
            items = items_by_order.get(order_num, [])

            # Get or generate texts
            order_texts = texts_by_order.get(order_num, [])
            if not order_texts:
                order_texts = self._generate_synthetic_text(vbak, items)

            # Consolidate text
            consolidated_text = ' '.join(order_texts)

            # Get related deliveries
            related_deliveries = deliveries_by_order.get(order_num, [])

            # Get related invoices (through deliveries)
            related_invoices = []
            for delivery in related_deliveries:
                del_num = delivery.get('document_number', '')
                related_invoices.extend(invoices_by_delivery.get(del_num, []))

            # Calculate dates and timing
            order_date = self._parse_date(vbak.get('erdat'))
            req_del_date = self._parse_date(vbak.get('vdatu'))

            delivery_date = None
            if related_deliveries:
                delivery_dates = [
                    self._parse_date(d.get('created_date'))
                    for d in related_deliveries
                    if d.get('created_date')
                ]
                if delivery_dates:
                    delivery_date = min(d for d in delivery_dates if d)

            invoice_date = None
            if related_invoices:
                invoice_dates = [
                    self._parse_date(i.get('billing_date'))
                    for i in related_invoices
                    if i.get('billing_date')
                ]
                if invoice_dates:
                    invoice_date = min(d for d in invoice_dates if d)

            # Build timing metrics
            timing = self._calculate_timing(
                order_date, req_del_date, delivery_date, invoice_date
            )

            # Build unified document
            doc = {
                'doc_key': order_num,
                'consolidated_text': consolidated_text,
                'order': {
                    'document_number': order_num,
                    'vbeln': order_num,
                    'auart': vbak.get('auart', 'OR'),
                    'vkorg': vbak.get('vkorg', ''),
                    'vtweg': vbak.get('vtweg', ''),
                    'spart': vbak.get('spart', ''),
                    'kunnr': vbak.get('kunnr', ''),
                    'customer': vbak.get('kunnr', ''),
                    'created_date': self._format_date(order_date),
                    'erdat': self._format_date(order_date),
                    'requested_delivery_date': self._format_date(req_del_date),
                    'vdatu': self._format_date(req_del_date),
                    'netwr': vbak.get('netwr', 0),
                    'waerk': vbak.get('waerk', 'USD'),
                    'items': self._format_items(items),
                    'header_texts': [{'text': t} for t in order_texts],
                },
                'deliveries': related_deliveries,
                'invoices': related_invoices,
                'customer': {
                    'customer_id': vbak.get('kunnr', ''),
                    'kunnr': vbak.get('kunnr', ''),
                },
                'dates': {
                    'order_date': self._format_date(order_date),
                    'requested_delivery_date': self._format_date(req_del_date),
                    'actual_delivery_date': self._format_date(delivery_date),
                    'invoice_date': self._format_date(invoice_date),
                },
                'timing': timing,
                'sales_org': vbak.get('vkorg', ''),
                'customer_industry': '',
                'source_files': ['csv_import'],
                'n_deliveries': len(related_deliveries),
                'n_invoices': len(related_invoices),
            }

            documents.append(doc)

        return documents

    def _group_by_key(
        self,
        records: List[Dict],
        key: str
    ) -> Dict[str, List[Dict]]:
        """Group records by a key field."""
        grouped: Dict[str, List[Dict]] = {}

        for record in records:
            key_value = str(record.get(key, '')).strip()
            if key_value:
                if key_value not in grouped:
                    grouped[key_value] = []
                grouped[key_value].append(record)

        return grouped

    def _group_texts_by_order(
        self,
        text_records: List[Dict]
    ) -> Dict[str, List[str]]:
        """Group text records by order number, extracting text content."""
        grouped: Dict[str, List[str]] = {}

        for record in text_records:
            # Text object key (TDNAME) typically contains the order number
            tdname = str(record.get('tdname', '')).strip()
            text_content = str(record.get('tdline', '')).strip()

            if tdname and text_content:
                # Extract order number from TDNAME
                # Format is typically: VBELN (10 chars) or with additional keys
                order_num = tdname[:10].strip() if len(tdname) >= 10 else tdname

                if order_num not in grouped:
                    grouped[order_num] = []
                grouped[order_num].append(text_content)

        return grouped

    def _generate_synthetic_text(
        self,
        vbak: Dict,
        items: List[Dict]
    ) -> List[str]:
        """
        Generate synthetic document text based on order characteristics.

        This mirrors the logic from load_external_datasets.py generate_order_text()
        but adapted for CSV imports.
        """
        texts = []

        # Get order characteristics
        sales_org = str(vbak.get('vkorg', '')).upper()
        order_type = str(vbak.get('auart', 'OR')).upper()
        net_value = float(vbak.get('netwr', 0) or 0)
        customer = str(vbak.get('kunnr', ''))

        # Generate deterministic but varied text based on order hash
        order_hash = hash(str(vbak.get('vbeln', '')) + str(self.random_seed))

        # Order type description
        type_desc = self.ORDER_TYPE_DESC.get(order_type, 'Standard Order')
        texts.append(f"{type_desc} processing.")

        # Value-based patterns
        if net_value > 100000:
            texts.append(self._rng.choice(self.TEXT_PATTERNS['high_value']))
            texts.append(self._rng.choice(self.TEXT_PATTERNS['credit_check']))
        elif net_value > 50000:
            texts.append("Standard order processing.")
        elif net_value < 1000:
            texts.append("Small order - consolidated shipping recommended.")

        # Sales org / region patterns
        if sales_org in ('EMEA', '1000', '0001'):
            texts.append("European region order.")
        elif sales_org in ('APJ', '2000', '0002'):
            texts.append("Asia-Pacific region order.")
            texts.append("Check customs documentation requirements.")
        elif sales_org in ('AMER', '3000', '0003'):
            texts.append("Americas region order.")

        # Item-based patterns
        n_items = len(items)
        if n_items > 5:
            texts.append(f"Multi-line order with {n_items} items.")
            texts.append("Check availability across all product lines.")
        elif n_items > 2:
            texts.append("Standard multi-item order.")

        # Random additional patterns based on hash
        if order_hash % 10 < 2:
            texts.append(self._rng.choice(self.TEXT_PATTERNS['rush']))
        elif order_hash % 10 < 4:
            texts.append(self._rng.choice(self.TEXT_PATTERNS['special_handling']))
        elif order_hash % 10 < 5:
            texts.append(self._rng.choice(self.TEXT_PATTERNS['backorder']))

        return texts

    def _format_items(self, items: List[Dict]) -> List[Dict]:
        """Format items for the unified document structure."""
        formatted = []

        for item in items:
            formatted.append({
                'item_number': item.get('posnr', ''),
                'posnr': item.get('posnr', ''),
                'material_id': item.get('matnr', ''),
                'matnr': item.get('matnr', ''),
                'quantity': item.get('kwmeng', 0),
                'kwmeng': item.get('kwmeng', 0),
                'net_value': item.get('netwr', 0),
                'netwr': item.get('netwr', 0),
                'plant': item.get('werks', ''),
                'werks': item.get('werks', ''),
                'item_category': item.get('pstyv', ''),
                'pstyv': item.get('pstyv', ''),
            })

        return formatted

    def _parse_date(self, date_val: Any) -> Optional[datetime]:
        """Parse a date value to datetime."""
        if date_val is None:
            return None

        if isinstance(date_val, datetime):
            return date_val

        date_str = str(date_val).strip()
        if not date_str:
            return None

        # Try common formats
        formats = [
            '%Y-%m-%d',
            '%Y%m%d',
            '%d.%m.%Y',
            '%m/%d/%Y',
            '%d/%m/%Y',
            '%Y-%m-%dT%H:%M:%S',
        ]

        for fmt in formats:
            try:
                return datetime.strptime(date_str[:len('YYYY-MM-DD')], fmt)
            except (ValueError, IndexError):
                continue

        return None

    def _format_date(self, dt: Optional[datetime]) -> Optional[str]:
        """Format datetime to ISO date string."""
        if dt is None:
            return None
        return dt.strftime('%Y-%m-%d')

    def _calculate_timing(
        self,
        order_date: Optional[datetime],
        req_del_date: Optional[datetime],
        delivery_date: Optional[datetime],
        invoice_date: Optional[datetime],
    ) -> Dict[str, Optional[float]]:
        """Calculate timing metrics from dates."""
        timing = {
            'order_to_delivery_days': None,
            'delivery_delay_days': None,
            'invoice_lag_days': None,
            'order_to_invoice_days': None,
        }

        if order_date and delivery_date:
            timing['order_to_delivery_days'] = (delivery_date - order_date).days

        if req_del_date and delivery_date:
            timing['delivery_delay_days'] = (delivery_date - req_del_date).days

        if delivery_date and invoice_date:
            timing['invoice_lag_days'] = (invoice_date - delivery_date).days

        if order_date and invoice_date:
            timing['order_to_invoice_days'] = (invoice_date - order_date).days

        return timing


def convert_csv_to_orders(
    vbak_csv: Path,
    vbap_csv: Path,
    text_csv: Optional[Path] = None,
    vbfa_csv: Optional[Path] = None,
    random_seed: int = 42,
) -> List[Dict]:
    """
    Convenience function to convert SAP CSV exports to synthetic order format.

    Args:
        vbak_csv: Path to VBAK (sales order header) CSV
        vbap_csv: Path to VBAP (sales order item) CSV
        text_csv: Optional path to text CSV
        vbfa_csv: Optional path to document flow CSV
        random_seed: Random seed for synthetic text generation

    Returns:
        List of unified document records

    Raises:
        ValueError: If required CSV files are invalid or missing
    """
    loader = CSVLoader(random_seed=random_seed)
    result = loader.load_from_csv(
        vbak_csv=vbak_csv,
        vbap_csv=vbap_csv,
        text_csv=text_csv,
        vbfa_csv=vbfa_csv,
    )

    if not result.success:
        raise ValueError(f"CSV conversion failed: {result.errors}")

    return result.documents


def load_csv_directory(
    csv_dir: Union[str, Path],
    random_seed: int = 42,
) -> List[Dict]:
    """
    Load all CSV files from a directory.

    Expects files named:
    - VBAK.csv or vbak.csv (required)
    - VBAP.csv or vbap.csv (required)
    - STXH.csv, STXL.csv, or texts.csv (optional)
    - VBFA.csv or vbfa.csv (optional)

    Args:
        csv_dir: Directory containing CSV exports
        random_seed: Random seed for synthetic text generation

    Returns:
        List of unified document records
    """
    csv_dir = Path(csv_dir)

    if not csv_dir.exists():
        raise ValueError(f"Directory not found: {csv_dir}")

    # Find VBAK file
    vbak_csv = None
    for name in ['VBAK.csv', 'vbak.csv', 'VBAK.CSV', 'sales_orders.csv']:
        path = csv_dir / name
        if path.exists():
            vbak_csv = path
            break

    if not vbak_csv:
        raise ValueError(f"VBAK CSV not found in {csv_dir}")

    # Find VBAP file
    vbap_csv = None
    for name in ['VBAP.csv', 'vbap.csv', 'VBAP.CSV', 'sales_order_items.csv']:
        path = csv_dir / name
        if path.exists():
            vbap_csv = path
            break

    if not vbap_csv:
        raise ValueError(f"VBAP CSV not found in {csv_dir}")

    # Find optional text file
    text_csv = None
    for name in ['STXH.csv', 'stxh.csv', 'STXL.csv', 'stxl.csv', 'texts.csv', 'TEXTS.csv']:
        path = csv_dir / name
        if path.exists():
            text_csv = path
            break

    # Find optional document flow file
    vbfa_csv = None
    for name in ['VBFA.csv', 'vbfa.csv', 'VBFA.CSV', 'doc_flow.csv']:
        path = csv_dir / name
        if path.exists():
            vbfa_csv = path
            break

    return convert_csv_to_orders(
        vbak_csv=vbak_csv,
        vbap_csv=vbap_csv,
        text_csv=text_csv,
        vbfa_csv=vbfa_csv,
        random_seed=random_seed,
    )
