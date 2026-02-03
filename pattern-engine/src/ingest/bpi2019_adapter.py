"""
BPI Challenge 2019 Dataset Adapter for SAP Workflow Mining.

Converts the BPI Challenge 2019 (Purchase Order Handling) event log into
the format expected by the SAP Workflow Mining tool.

Dataset: https://data.4tu.nl/articles/dataset/BPI_Challenge_2019/12715853/1
Paper: Business Process Intelligence Challenge 2019

The BPI 2019 dataset contains real event log data from a multinational
coatings/paints company, covering the purchase order handling process
(Procure-to-Pay / P2P).

Process Flow (P2P - analogous to O2C):
    Purchase Order → Goods Receipt → Invoice Receipt → Payment
    (Similar to: Sales Order → Delivery → Invoice → Payment in O2C)

Dataset Statistics:
    - 76,349 purchase documents
    - 251,734 case instances (document + item combinations)
    - 1,595,923 events
    - 42 activities
    - 627 users (607 human + 20 batch)

Example Usage:
    from ingest.bpi2019_adapter import BPI2019Adapter

    # Load from CSV
    adapter = BPI2019Adapter()
    adapter.load_from_csv("/path/to/BPI_Challenge_2019.csv")

    # Convert to workflow mining format
    data = adapter.to_workflow_format()

    # Or load from XES format
    adapter.load_from_xes("/path/to/BPI_Challenge_2019.xes")
"""

import logging
import csv
import gzip
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple
from collections import defaultdict
import json
import re

logger = logging.getLogger(__name__)

# Optional imports
try:
    import pandas as pd
    PANDAS_AVAILABLE = True
except ImportError:
    PANDAS_AVAILABLE = False
    pd = None


@dataclass
class BPI2019LoadResult:
    """Result of loading BPI 2019 dataset."""

    total_events: int = 0
    total_cases: int = 0
    unique_documents: int = 0
    unique_vendors: int = 0
    activities: Set[str] = field(default_factory=set)
    date_range: Tuple[Optional[str], Optional[str]] = (None, None)
    warnings: List[str] = field(default_factory=list)

    def __str__(self) -> str:
        return (
            f"BPI 2019 Load Result:\n"
            f"  Total Events: {self.total_events:,}\n"
            f"  Total Cases: {self.total_cases:,}\n"
            f"  Unique Documents: {self.unique_documents:,}\n"
            f"  Unique Vendors: {self.unique_vendors:,}\n"
            f"  Activities: {len(self.activities)}\n"
            f"  Date Range: {self.date_range[0]} to {self.date_range[1]}\n"
            f"  Warnings: {len(self.warnings)}"
        )


# Activity mapping: BPI 2019 activities → O2C equivalents
# This maps P2P activities to conceptually similar O2C activities
ACTIVITY_MAPPING = {
    # Document creation
    'Create Purchase Order Item': 'OrderCreated',
    'Record Purchase Order Item': 'OrderCreated',

    # Goods movement
    'Record Goods Receipt': 'DeliveryCreated',
    'Receive Goods': 'GoodsIssue',
    'Clear Goods Receipt': 'GoodsIssue',

    # Invoice processing
    'Record Invoice Receipt': 'InvoiceCreated',
    'Create Invoice': 'InvoiceCreated',
    'Receive Invoice': 'InvoiceCreated',
    'Scan Invoice': 'InvoiceCreated',

    # Matching and verification
    '3-way match': 'InvoiceVerified',
    '2-way match': 'InvoiceVerified',
    'Record Invoice': 'InvoiceVerified',

    # Vendor interaction
    'Vendor creates invoice': 'InvoiceCreated',
    'Vendor creates debit memo': 'DebitMemo',

    # Payment
    'Clear Invoice': 'PaymentReceived',
    'Record Payment': 'PaymentReceived',

    # Changes and corrections
    'Change Price': 'OrderChanged',
    'Change Quantity': 'OrderChanged',
    'Change Delivery Date': 'OrderChanged',
    'Change Vendor': 'OrderChanged',
    'Cancel Goods Receipt': 'DeliveryCancelled',
    'Cancel Invoice Receipt': 'InvoiceCancelled',
    'Delete Purchase Order Item': 'OrderCancelled',

    # Approvals
    'Release Purchase Order': 'OrderApproved',
    'Approve Purchase Order': 'OrderApproved',

    # Blocking
    'Block Purchase Order Item': 'CreditBlock',
    'Unblock Purchase Order Item': 'CreditRelease',
    'Set Payment Block': 'CreditBlock',
    'Remove Payment Block': 'CreditRelease',
}


class BPI2019Adapter:
    """
    Adapter for BPI Challenge 2019 dataset.

    Transforms BPI 2019 event log (P2P process) into a format compatible
    with SAP Workflow Mining (designed for O2C but applicable to P2P).

    Key Mappings:
        Purchase Document → Sales Order (conceptual equivalent)
        Goods Receipt → Delivery
        Invoice Receipt → Billing Document
        Vendor → Customer (reverse relationship in P2P vs O2C)
    """

    # Expected CSV columns from BPI 2019
    EXPECTED_COLUMNS = {
        'case:concept:name',      # Case ID (doc + item)
        'concept:name',           # Activity name
        'time:timestamp',         # Event timestamp
        'case:Purchasing Document',
        'case:Item',
        'case:Vendor',
        'case:Company',
        'case:Document Type',
        'case:Item Category',
        'case:Spend area text',
        'case:Name',              # Vendor name
        'org:resource',           # User/resource
    }

    def __init__(self):
        """Initialize the BPI 2019 adapter."""
        self._events: List[Dict[str, Any]] = []
        self._cases: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
        self._documents: Dict[str, Dict[str, Any]] = {}
        self._vendors: Dict[str, Dict[str, Any]] = {}
        self._load_result: Optional[BPI2019LoadResult] = None

    def load_from_csv(
        self,
        file_path: str,
        encoding: str = 'latin-1',  # BPI 2019 uses latin-1/cp1252 encoding
        max_rows: Optional[int] = None
    ) -> BPI2019LoadResult:
        """
        Load BPI 2019 dataset from CSV file.

        Args:
            file_path: Path to CSV file (can be gzipped)
            encoding: File encoding
            max_rows: Maximum rows to load (None for all)

        Returns:
            BPI2019LoadResult with load statistics
        """
        result = BPI2019LoadResult()
        path = Path(file_path)

        logger.info(f"Loading BPI 2019 from {path}...")

        # Handle gzipped files
        if path.suffix == '.gz':
            opener = lambda: gzip.open(path, 'rt', encoding=encoding)
        else:
            opener = lambda: open(path, 'r', encoding=encoding, newline='')

        min_date = None
        max_date = None
        documents = set()
        vendors = set()

        with opener() as f:
            # BPI 2019 CSV may have commas in quoted fields
            reader = csv.DictReader(f)

            for i, row in enumerate(reader):
                if max_rows and i >= max_rows:
                    break

                try:
                    event = self._parse_csv_row(row)
                    self._events.append(event)

                    # Track by case
                    case_id = event['case_id']
                    self._cases[case_id].append(event)

                    # Track statistics
                    result.activities.add(event['activity'])
                    documents.add(event.get('document_number', ''))
                    vendors.add(event.get('vendor', ''))

                    # Track date range
                    ts = event.get('timestamp')
                    if ts:
                        if min_date is None or ts < min_date:
                            min_date = ts
                        if max_date is None or ts > max_date:
                            max_date = ts

                    # Build document metadata
                    doc_num = event.get('document_number')
                    if doc_num and doc_num not in self._documents:
                        self._documents[doc_num] = {
                            'document_number': doc_num,
                            'vendor': event.get('vendor'),
                            'vendor_name': event.get('vendor_name'),
                            'company': event.get('company'),
                            'document_type': event.get('document_type'),
                            'spend_area': event.get('spend_area'),
                        }

                    # Build vendor metadata
                    vendor = event.get('vendor')
                    if vendor and vendor not in self._vendors:
                        self._vendors[vendor] = {
                            'customer_id': vendor,  # Mapped to customer for O2C compat
                            'name': event.get('vendor_name'),
                        }

                except Exception as e:
                    result.warnings.append(f"Row {i}: {str(e)}")
                    if len(result.warnings) <= 5:
                        logger.warning(f"Error parsing row {i}: {e}")

        result.total_events = len(self._events)
        result.total_cases = len(self._cases)
        result.unique_documents = len(documents)
        result.unique_vendors = len(vendors - {''})
        result.date_range = (
            min_date.isoformat() if min_date else None,
            max_date.isoformat() if max_date else None
        )

        self._load_result = result
        logger.info(f"BPI 2019 loaded successfully:\n{result}")
        return result

    def _parse_csv_row(self, row: Dict[str, str]) -> Dict[str, Any]:
        """Parse a single CSV row into event format."""
        # Handle different possible column name formats
        # BPI 2019 CSV has columns like "case Vendor", "event concept:name", etc.
        def get_val(keys: List[str]) -> Optional[str]:
            for key in keys:
                # Try exact match first
                if key in row and row[key]:
                    return row[key].strip()
                # Try with trailing space (CSV artifact)
                if key + ' ' in row and row[key + ' ']:
                    return row[key + ' '].strip()
            return None

        # Parse timestamp - BPI 2019 uses "event time:timestamp"
        ts_str = get_val([
            'event time:timestamp',
            'time:timestamp',
            'timestamp',
        ])
        timestamp = None
        if ts_str:
            try:
                # Handle various timestamp formats
                ts_str = ts_str.replace('+00:00', 'Z').replace(' ', 'T')
                if '.' in ts_str:
                    ts_str = ts_str.split('.')[0] + 'Z'
                timestamp = datetime.fromisoformat(ts_str.rstrip('Z'))
            except:
                try:
                    timestamp = datetime.strptime(ts_str[:19], '%Y-%m-%dT%H:%M:%S')
                except:
                    pass

        # BPI 2019 specific column mappings
        return {
            'case_id': get_val(['case concept:name', 'case:concept:name', 'Case ID']),
            'activity': get_val(['event concept:name', 'concept:name', 'Activity']),
            'timestamp': timestamp,
            'document_number': get_val(['case Purchasing Document', 'case:Purchasing Document']),
            'item_number': get_val(['case Item', 'case:Item']),
            'vendor': get_val(['case Vendor', 'case:Vendor']),
            'vendor_name': get_val(['case Name', 'case:Name']),
            'company': get_val(['case Company', 'case:Company']),
            'document_type': get_val(['case Document Type', 'case:Document Type']),
            'item_category': get_val(['case Item Category', 'case:Item Category']),
            'spend_area': get_val(['case Spend area text', 'case:Spend area text']),
            'spend_classification': get_val(['case Spend classification text']),
            'resource': get_val(['event org:resource', 'org:resource', 'event User']),
            'gr_based_inv': get_val(['case GR-Based Inv. Verif.']) == 'True',
            'goods_receipt': get_val(['case Goods Receipt']) == 'True',
        }

    def load_from_pandas(self, df: 'pd.DataFrame') -> BPI2019LoadResult:
        """
        Load BPI 2019 from a pandas DataFrame.

        Args:
            df: DataFrame with BPI 2019 event log

        Returns:
            BPI2019LoadResult
        """
        if not PANDAS_AVAILABLE:
            raise ImportError("Pandas required. Install with: pip install pandas")

        result = BPI2019LoadResult()

        for _, row in df.iterrows():
            event = self._parse_csv_row(row.to_dict())
            self._events.append(event)
            self._cases[event['case_id']].append(event)
            result.activities.add(event['activity'])

        result.total_events = len(self._events)
        result.total_cases = len(self._cases)
        result.unique_documents = len(self._documents)

        self._load_result = result
        return result

    def to_workflow_format(
        self,
        map_activities: bool = True,
        aggregate_by_document: bool = True,
        sample_documents: Optional[int] = None
    ) -> Dict[str, List[Dict[str, Any]]]:
        """
        Convert BPI 2019 events to workflow mining format.

        Args:
            map_activities: Map P2P activities to O2C equivalents
            aggregate_by_document: Aggregate cases by purchase document
            sample_documents: Limit number of documents

        Returns:
            Dictionary with sales_orders, customers, deliveries, invoices, doc_flow
        """
        if not self._events:
            raise ValueError("No data loaded. Call load_from_csv() first.")

        result = {
            'sales_orders': [],   # Purchase orders mapped to sales orders
            'deliveries': [],     # Goods receipts mapped to deliveries
            'invoices': [],       # Invoice receipts mapped to invoices
            'customers': [],      # Vendors mapped to customers
            'doc_flow': [],       # Document relationships
            'materials': [],
        }

        # Select documents to process
        doc_nums = list(self._documents.keys())
        if sample_documents:
            doc_nums = doc_nums[:sample_documents]

        processed_docs = set()
        delivery_map = {}  # Track which GRs we've created
        invoice_map = {}   # Track which invoices we've created

        for doc_num in doc_nums:
            if doc_num in processed_docs:
                continue
            processed_docs.add(doc_num)

            doc_info = self._documents.get(doc_num, {})

            # Find all events for this document
            doc_events = [
                e for e in self._events
                if e.get('document_number') == doc_num
            ]

            if not doc_events:
                continue

            # Sort by timestamp
            doc_events.sort(key=lambda x: x['timestamp'] or datetime.min)

            # Extract key dates from events
            created_date = None
            gr_date = None
            invoice_date = None

            for event in doc_events:
                activity = event['activity']
                ts = event['timestamp']

                if not ts:
                    continue

                # Find creation date
                if 'Create' in activity or 'Record Purchase Order' in activity:
                    if created_date is None or ts < created_date:
                        created_date = ts

                # Find goods receipt date
                if 'Goods Receipt' in activity or 'Receive Goods' in activity:
                    if gr_date is None:
                        gr_date = ts

                # Find invoice date
                if 'Invoice' in activity:
                    if invoice_date is None:
                        invoice_date = ts

            # Create sales order (purchase order)
            order = {
                'document_number': doc_num,
                'created_date': created_date.isoformat() if created_date else None,
                'order_type': doc_info.get('document_type', 'NB'),  # NB = standard PO
                'customer': doc_info.get('vendor', ''),  # Vendor mapped to customer
                'sales_org': doc_info.get('company', ''),
                'texts': doc_info.get('spend_area', ''),
            }

            # Add items from cases
            items = []
            seen_items = set()
            for event in doc_events:
                item_num = event.get('item_number')
                if item_num and item_num not in seen_items:
                    seen_items.add(item_num)
                    items.append({
                        'item_number': item_num,
                        'item_category': event.get('item_category', ''),
                    })
            order['items'] = items

            result['sales_orders'].append(order)

            # Create delivery (goods receipt)
            if gr_date:
                delivery_num = f"GR{doc_num}"
                result['deliveries'].append({
                    'document_number': delivery_num,
                    'created_date': gr_date.isoformat(),
                    'actual_gi_date': gr_date.isoformat(),
                    'customer': doc_info.get('vendor', ''),
                })
                delivery_map[doc_num] = delivery_num

                # Doc flow: PO → GR
                result['doc_flow'].append({
                    'preceding_doc': doc_num,
                    'subsequent_doc': delivery_num,
                    'preceding_category': 'F',  # PO
                    'subsequent_category': 'R',  # GR (custom)
                })

            # Create invoice (invoice receipt)
            if invoice_date:
                invoice_num = f"IR{doc_num}"
                result['invoices'].append({
                    'document_number': invoice_num,
                    'billing_date': invoice_date.isoformat(),
                    'customer': doc_info.get('vendor', ''),
                })
                invoice_map[doc_num] = invoice_num

                # Doc flow: GR → Invoice (if GR exists) or PO → Invoice
                if doc_num in delivery_map:
                    result['doc_flow'].append({
                        'preceding_doc': delivery_map[doc_num],
                        'subsequent_doc': invoice_num,
                        'preceding_category': 'R',
                        'subsequent_category': 'P',  # Invoice
                    })
                else:
                    result['doc_flow'].append({
                        'preceding_doc': doc_num,
                        'subsequent_doc': invoice_num,
                        'preceding_category': 'F',
                        'subsequent_category': 'P',
                    })

        # Add vendors as customers
        for vendor_id, vendor_info in self._vendors.items():
            result['customers'].append({
                'customer_id': vendor_id,
                'name': vendor_info.get('name', ''),
            })

        logger.info(
            f"Converted to workflow format: "
            f"{len(result['sales_orders'])} orders, "
            f"{len(result['deliveries'])} deliveries, "
            f"{len(result['invoices'])} invoices, "
            f"{len(result['customers'])} customers"
        )

        return result

    def to_event_log(
        self,
        map_activities: bool = True
    ) -> List[Dict[str, Any]]:
        """
        Get events in simple event log format.

        Args:
            map_activities: Map P2P activities to O2C equivalents

        Returns:
            List of event dictionaries
        """
        events = []
        for event in self._events:
            activity = event['activity']
            if map_activities and activity in ACTIVITY_MAPPING:
                activity = ACTIVITY_MAPPING[activity]

            events.append({
                'case_id': event['document_number'],  # Use document as case
                'activity': activity,
                'timestamp': event['timestamp'].isoformat() if event['timestamp'] else None,
                'resource': event['resource'],
                'item': event['item_number'],
                **{k: v for k, v in event.items()
                   if k not in ['case_id', 'activity', 'timestamp', 'resource']}
            })

        return events

    def save_to_json(
        self,
        output_dir: str,
        **kwargs
    ) -> Dict[str, str]:
        """
        Convert and save BPI 2019 data to JSON files.

        Args:
            output_dir: Directory to save JSON files
            **kwargs: Arguments passed to to_workflow_format()

        Returns:
            Dictionary mapping table names to file paths
        """
        data = self.to_workflow_format(**kwargs)
        output_path = Path(output_dir)
        output_path.mkdir(parents=True, exist_ok=True)

        saved_files = {}
        for table_name, records in data.items():
            if records:
                file_path = output_path / f"{table_name}.json"
                with open(file_path, 'w') as f:
                    json.dump(records, f, indent=2, default=str)
                saved_files[table_name] = str(file_path)
                logger.info(f"Saved {len(records)} records to {file_path}")

        return saved_files

    def get_process_variants(
        self,
        top_n: int = 10
    ) -> List[Tuple[str, int]]:
        """
        Get most common process variants (activity sequences).

        Args:
            top_n: Number of variants to return

        Returns:
            List of (variant_string, count) tuples
        """
        variant_counts = defaultdict(int)

        for case_id, events in self._cases.items():
            # Sort events by timestamp
            sorted_events = sorted(
                events,
                key=lambda x: x['timestamp'] or datetime.min
            )
            # Create variant string
            variant = ' → '.join(e['activity'] for e in sorted_events)
            variant_counts[variant] += 1

        # Sort by count
        sorted_variants = sorted(
            variant_counts.items(),
            key=lambda x: x[1],
            reverse=True
        )

        return sorted_variants[:top_n]

    def get_statistics(self) -> Dict[str, Any]:
        """Get statistics about loaded data."""
        stats = {
            'loaded': self._load_result is not None,
        }

        if self._load_result:
            stats.update({
                'total_events': self._load_result.total_events,
                'total_cases': self._load_result.total_cases,
                'unique_documents': self._load_result.unique_documents,
                'unique_vendors': self._load_result.unique_vendors,
                'activities': list(self._load_result.activities),
                'date_range': self._load_result.date_range,
            })

        return stats


def load_bpi2019_dataset(
    file_path: str,
    sample_documents: Optional[int] = None,
    output_dir: Optional[str] = None
) -> Dict[str, List[Dict[str, Any]]]:
    """
    Convenience function to load BPI 2019 dataset.

    Args:
        file_path: Path to BPI 2019 CSV file
        sample_documents: Limit number of documents
        output_dir: If provided, save to JSON files

    Returns:
        Workflow mining format data
    """
    adapter = BPI2019Adapter()
    adapter.load_from_csv(file_path)

    if output_dir:
        adapter.save_to_json(output_dir, sample_documents=sample_documents)

    return adapter.to_workflow_format(sample_documents=sample_documents)
