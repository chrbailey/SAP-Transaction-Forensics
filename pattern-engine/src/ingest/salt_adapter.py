"""
SAP SALT Dataset Adapter for SAP Workflow Mining.

Converts the SAP SALT (Sales Autocompletion Linked Tables) dataset from
Hugging Face into the format expected by the SAP Workflow Mining tool.

SALT Dataset: https://huggingface.co/datasets/sap-ai-research/SALT
Paper: arxiv:2501.03413 (NeurIPS'24 Table Representation Workshop)

The SALT dataset contains real SAP ERP data with:
- I_SalesDocument: Sales order headers
- I_SalesDocumentItem: Sales order line items
- I_Customer: Customer master data
- I_AddrOrgNamePostalAddress: Address/organization data

This adapter transforms this relational data into event logs suitable for
process mining analysis.

Example Usage:
    from ingest.salt_adapter import SALTAdapter

    # Load from Hugging Face
    adapter = SALTAdapter()
    adapter.load_from_huggingface()

    # Convert to workflow mining format
    data = adapter.to_workflow_format()

    # Or load from local parquet files
    adapter.load_from_parquet("/path/to/salt/")
    data = adapter.to_workflow_format()
"""

import logging
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
import json

logger = logging.getLogger(__name__)

# Optional imports for dataset loading
try:
    import pandas as pd
    PANDAS_AVAILABLE = True
except ImportError:
    PANDAS_AVAILABLE = False
    pd = None

try:
    from datasets import load_dataset
    HF_AVAILABLE = True
except ImportError:
    HF_AVAILABLE = False


@dataclass
class SALTLoadResult:
    """Result of loading SALT dataset."""

    sales_documents: int = 0
    sales_items: int = 0
    customers: int = 0
    addresses: int = 0
    warnings: List[str] = field(default_factory=list)

    def __str__(self) -> str:
        return (
            f"SALT Load Result:\n"
            f"  Sales Documents: {self.sales_documents:,}\n"
            f"  Sales Items: {self.sales_items:,}\n"
            f"  Customers: {self.customers:,}\n"
            f"  Addresses: {self.addresses:,}\n"
            f"  Warnings: {len(self.warnings)}"
        )


class SALTAdapter:
    """
    Adapter for SAP SALT dataset.

    Transforms SAP SALT relational tables into event logs for process mining.

    SALT Schema Mapping:

    I_SalesDocument -> sales_orders.json
        SALESDOCUMENT -> document_number
        CREATIONDATE -> created_date
        SALESDOCUMENTTYPE -> order_type
        SALESORGANIZATION -> sales_org
        DISTRIBUTIONCHANNEL -> distribution_channel
        ORGANIZATIONDIVISION -> division
        SOLDTOPARTY -> customer
        SALESOFFICE -> sales_office
        SALESGROUP -> sales_group
        CUSTOMERPAYMENTTERMS -> payment_terms
        SHIPPINGCONDITION -> shipping_condition
        HEADERINCOTERMSCLASSIFICATION -> incoterms

    I_SalesDocumentItem -> sales_order_items (merged into sales_orders)
        SALESDOCUMENT -> document_number (FK)
        SALESDOCUMENTITEM -> item_number
        MATERIAL -> material_id
        PLANT -> plant
        SHIPPINGPOINT -> shipping_point
        REQUESTEDQUANTITY -> quantity
        NETAMOUNT -> net_value

    I_Customer -> customers.json
        CUSTOMER -> customer_id
        CUSTOMERNAME -> name
        CUSTOMERACCOUNTGROUP -> account_group
        COUNTRY -> country
        REGION -> region

    Note: SALT doesn't include delivery/invoice data, so we generate
    synthetic events based on sales document lifecycle states.
    """

    # SALT column mappings to our normalized names
    SALES_DOC_MAPPING = {
        'SALESDOCUMENT': 'document_number',
        'CREATIONDATE': 'created_date',
        'SALESDOCUMENTTYPE': 'order_type',
        'SALESORGANIZATION': 'sales_org',
        'DISTRIBUTIONCHANNEL': 'distribution_channel',
        'ORGANIZATIONDIVISION': 'division',
        'SOLDTOPARTY': 'customer',
        'SALESOFFICE': 'sales_office',
        'SALESGROUP': 'sales_group',
        'CUSTOMERPAYMENTTERMS': 'payment_terms',
        'SHIPPINGCONDITION': 'shipping_condition',
        'HEADERINCOTERMSCLASSIFICATION': 'incoterms',
        'PRICINGDATE': 'pricing_date',
        'REQUESTEDDELIVERYDATE': 'requested_delivery_date',
    }

    SALES_ITEM_MAPPING = {
        'SALESDOCUMENT': 'document_number',
        'SALESDOCUMENTITEM': 'item_number',
        'MATERIAL': 'material_id',
        'PLANT': 'plant',
        'SHIPPINGPOINT': 'shipping_point',
        'REQUESTEDQUANTITY': 'quantity',
        'NETAMOUNT': 'net_value',
        'ITEMINCOTERMSCLASSIFICATION': 'item_incoterms',
    }

    CUSTOMER_MAPPING = {
        'CUSTOMER': 'customer_id',
        'CUSTOMERNAME': 'name',
        'CUSTOMERACCOUNTGROUP': 'account_group',
        'COUNTRY': 'country',
        'REGION': 'region',
        'CITYNAME': 'city',
        'POSTALCODE': 'postal_code',
    }

    def __init__(self, dataset_name: str = "sap-ai-research/SALT"):
        """
        Initialize the SALT adapter.

        Args:
            dataset_name: Hugging Face dataset name
        """
        self.dataset_name = dataset_name
        self._sales_documents: Optional[pd.DataFrame] = None
        self._sales_items: Optional[pd.DataFrame] = None
        self._customers: Optional[pd.DataFrame] = None
        self._addresses: Optional[pd.DataFrame] = None
        self._joined: Optional[pd.DataFrame] = None
        self._load_result: Optional[SALTLoadResult] = None

    def load_from_huggingface(
        self,
        split: str = "train",
        use_joined: bool = False
    ) -> SALTLoadResult:
        """
        Load SALT dataset from Hugging Face.

        Args:
            split: Dataset split ("train" or "test")
            use_joined: If True, load pre-joined table instead of individual tables

        Returns:
            SALTLoadResult with load statistics
        """
        if not HF_AVAILABLE:
            raise ImportError(
                "Hugging Face datasets library required. "
                "Install with: pip install datasets"
            )

        if not PANDAS_AVAILABLE:
            raise ImportError(
                "Pandas required for SALT adapter. "
                "Install with: pip install pandas"
            )

        result = SALTLoadResult()
        logger.info(f"Loading SALT dataset from Hugging Face ({split} split)...")

        try:
            if use_joined:
                # Load pre-joined table (more convenient but less flexible)
                ds = load_dataset(self.dataset_name, "joined_table", split=split)
                self._joined = ds.to_pandas()
                result.sales_documents = len(self._joined['SALESDOCUMENT'].unique())
                result.sales_items = len(self._joined)
                logger.info(f"Loaded joined table: {len(self._joined):,} rows")
            else:
                # Load individual tables (recommended for flexibility)
                logger.info("Loading sales documents...")
                ds_docs = load_dataset(self.dataset_name, "salesdocuments", split=split)
                self._sales_documents = ds_docs.to_pandas()
                result.sales_documents = len(self._sales_documents)

                logger.info("Loading sales items...")
                ds_items = load_dataset(self.dataset_name, "salesdocument_items", split=split)
                self._sales_items = ds_items.to_pandas()
                result.sales_items = len(self._sales_items)

                logger.info("Loading customers...")
                ds_cust = load_dataset(self.dataset_name, "customers", split=split)
                self._customers = ds_cust.to_pandas()
                result.customers = len(self._customers)

                logger.info("Loading addresses...")
                ds_addr = load_dataset(self.dataset_name, "addresses", split=split)
                self._addresses = ds_addr.to_pandas()
                result.addresses = len(self._addresses)

        except Exception as e:
            result.warnings.append(f"Error loading dataset: {str(e)}")
            logger.error(f"Failed to load SALT dataset: {e}")
            raise

        self._load_result = result
        logger.info(f"SALT dataset loaded successfully:\n{result}")
        return result

    def load_from_parquet(self, directory: str) -> SALTLoadResult:
        """
        Load SALT dataset from local parquet files.

        Args:
            directory: Path to directory containing SALT parquet files

        Returns:
            SALTLoadResult with load statistics
        """
        if not PANDAS_AVAILABLE:
            raise ImportError("Pandas required. Install with: pip install pandas")

        result = SALTLoadResult()
        dir_path = Path(directory)

        # Expected file patterns
        file_patterns = {
            'sales_documents': ['I_SalesDocument*.parquet', 'salesdocuments*.parquet'],
            'sales_items': ['I_SalesDocumentItem*.parquet', 'salesdocument_items*.parquet'],
            'customers': ['I_Customer*.parquet', 'customers*.parquet'],
            'addresses': ['I_AddrOrg*.parquet', 'addresses*.parquet'],
        }

        for table_name, patterns in file_patterns.items():
            for pattern in patterns:
                files = list(dir_path.glob(pattern))
                if files:
                    df = pd.read_parquet(files[0])
                    setattr(self, f'_{table_name}', df)
                    if table_name == 'sales_documents':
                        result.sales_documents = len(df)
                    elif table_name == 'sales_items':
                        result.sales_items = len(df)
                    elif table_name == 'customers':
                        result.customers = len(df)
                    elif table_name == 'addresses':
                        result.addresses = len(df)
                    logger.info(f"Loaded {table_name}: {len(df):,} rows from {files[0]}")
                    break

        self._load_result = result
        return result

    def _normalize_columns(
        self,
        df: pd.DataFrame,
        mapping: Dict[str, str]
    ) -> pd.DataFrame:
        """Normalize column names using mapping."""
        # Find columns that exist in the dataframe (case-insensitive)
        df_cols_upper = {col.upper(): col for col in df.columns}

        rename_map = {}
        for salt_col, norm_col in mapping.items():
            if salt_col.upper() in df_cols_upper:
                rename_map[df_cols_upper[salt_col.upper()]] = norm_col

        return df.rename(columns=rename_map)

    def _parse_date(self, date_val: Any) -> Optional[str]:
        """Parse date value to ISO format string."""
        if date_val is None or (isinstance(date_val, float) and pd.isna(date_val)):
            return None

        if isinstance(date_val, str):
            # Handle SAP date format (YYYYMMDD) or ISO format
            if len(date_val) == 8 and date_val.isdigit():
                try:
                    return f"{date_val[:4]}-{date_val[4:6]}-{date_val[6:8]}"
                except:
                    return None
            return date_val

        if hasattr(date_val, 'isoformat'):
            return date_val.isoformat()

        return str(date_val)

    def to_workflow_format(
        self,
        include_items: bool = True,
        generate_events: bool = True,
        sample_size: Optional[int] = None
    ) -> Dict[str, List[Dict[str, Any]]]:
        """
        Convert SALT data to workflow mining format.

        Args:
            include_items: Include line item details in sales orders
            generate_events: Generate synthetic delivery/invoice events
            sample_size: Limit number of orders (None for all)

        Returns:
            Dictionary with sales_orders, customers, materials, and optionally
            deliveries, invoices, doc_flow
        """
        if self._sales_documents is None and self._joined is None:
            raise ValueError("No data loaded. Call load_from_huggingface() first.")

        result = {
            'sales_orders': [],
            'customers': [],
            'materials': [],
        }

        if generate_events:
            result['deliveries'] = []
            result['invoices'] = []
            result['doc_flow'] = []

        # Use joined table if available, otherwise individual tables
        if self._joined is not None:
            sales_df = self._normalize_columns(self._joined, {
                **self.SALES_DOC_MAPPING,
                **self.SALES_ITEM_MAPPING
            })
        else:
            sales_df = self._normalize_columns(
                self._sales_documents.copy(),
                self.SALES_DOC_MAPPING
            )

        if sample_size:
            unique_docs = sales_df['document_number'].unique()[:sample_size]
            sales_df = sales_df[sales_df['document_number'].isin(unique_docs)]

        # Group by document for header-level data
        doc_groups = sales_df.groupby('document_number')

        for doc_num, group in doc_groups:
            first_row = group.iloc[0]

            order = {
                'document_number': str(doc_num),
                'created_date': self._parse_date(first_row.get('created_date')),
                'order_type': first_row.get('order_type', 'OR'),
                'sales_org': first_row.get('sales_org'),
                'customer': str(first_row.get('customer', '')),
                'payment_terms': first_row.get('payment_terms'),
                'shipping_condition': first_row.get('shipping_condition'),
                'incoterms': first_row.get('incoterms'),
                'requested_delivery_date': self._parse_date(
                    first_row.get('requested_delivery_date')
                ),
            }

            # Add items if requested and available
            if include_items and 'item_number' in group.columns:
                items = []
                for _, item_row in group.iterrows():
                    items.append({
                        'item_number': str(item_row.get('item_number', '')),
                        'material_id': str(item_row.get('material_id', '')),
                        'quantity': float(item_row.get('quantity', 0)) if pd.notna(item_row.get('quantity')) else 0,
                        'net_value': float(item_row.get('net_value', 0)) if pd.notna(item_row.get('net_value')) else 0,
                        'plant': item_row.get('plant'),
                        'shipping_point': item_row.get('shipping_point'),
                    })
                order['items'] = items

            result['sales_orders'].append(order)

            # Generate synthetic delivery and invoice events
            if generate_events and order['created_date']:
                delivery_num = f"8{doc_num}"  # SAP convention: deliveries start with 8
                invoice_num = f"9{doc_num}"   # SAP convention: invoices start with 9

                # Synthetic delivery (created_date + 3 days)
                try:
                    created = datetime.fromisoformat(order['created_date'][:10])
                    delivery_date = (created + pd.Timedelta(days=3)).isoformat()[:10]
                    gi_date = (created + pd.Timedelta(days=4)).isoformat()[:10]
                    invoice_date = (created + pd.Timedelta(days=5)).isoformat()[:10]
                except:
                    delivery_date = order['created_date']
                    gi_date = order['created_date']
                    invoice_date = order['created_date']

                result['deliveries'].append({
                    'document_number': delivery_num,
                    'created_date': delivery_date,
                    'actual_gi_date': gi_date,
                    'customer': order['customer'],
                    'shipping_point': first_row.get('shipping_point'),
                })

                result['invoices'].append({
                    'document_number': invoice_num,
                    'billing_date': invoice_date,
                    'customer': order['customer'],
                    'net_value': sum(item.get('net_value', 0) for item in order.get('items', [])),
                })

                # Document flow links
                result['doc_flow'].extend([
                    {
                        'preceding_doc': str(doc_num),
                        'subsequent_doc': delivery_num,
                        'preceding_category': 'C',  # Order
                        'subsequent_category': 'J',  # Delivery
                    },
                    {
                        'preceding_doc': delivery_num,
                        'subsequent_doc': invoice_num,
                        'preceding_category': 'J',  # Delivery
                        'subsequent_category': 'M',  # Invoice
                    },
                ])

        # Process customers
        if self._customers is not None:
            cust_df = self._normalize_columns(self._customers.copy(), self.CUSTOMER_MAPPING)
            for _, row in cust_df.iterrows():
                result['customers'].append({
                    'customer_id': str(row.get('customer_id', '')),
                    'name': row.get('name'),
                    'country': row.get('country'),
                    'region': row.get('region'),
                    'city': row.get('city'),
                    'account_group': row.get('account_group'),
                })

        # Extract unique materials from items
        if self._joined is not None or self._sales_items is not None:
            items_df = self._joined if self._joined is not None else self._sales_items
            if 'MATERIAL' in items_df.columns or 'material_id' in items_df.columns:
                mat_col = 'MATERIAL' if 'MATERIAL' in items_df.columns else 'material_id'
                unique_mats = items_df[mat_col].dropna().unique()
                for mat in unique_mats:
                    result['materials'].append({
                        'material_id': str(mat),
                    })

        logger.info(
            f"Converted to workflow format: "
            f"{len(result['sales_orders'])} orders, "
            f"{len(result.get('deliveries', []))} deliveries, "
            f"{len(result.get('invoices', []))} invoices, "
            f"{len(result['customers'])} customers"
        )

        return result

    def save_to_json(
        self,
        output_dir: str,
        **kwargs
    ) -> Dict[str, str]:
        """
        Convert and save SALT data to JSON files.

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

    def get_statistics(self) -> Dict[str, Any]:
        """Get statistics about loaded data."""
        stats = {
            'loaded': self._load_result is not None,
            'source': self.dataset_name,
        }

        if self._load_result:
            stats.update({
                'sales_documents': self._load_result.sales_documents,
                'sales_items': self._load_result.sales_items,
                'customers': self._load_result.customers,
                'addresses': self._load_result.addresses,
                'warnings': self._load_result.warnings,
            })

        if self._sales_documents is not None:
            stats['sales_document_columns'] = list(self._sales_documents.columns)

        return stats


def load_salt_dataset(
    split: str = "train",
    sample_size: Optional[int] = None,
    output_dir: Optional[str] = None
) -> Dict[str, List[Dict[str, Any]]]:
    """
    Convenience function to load SALT dataset.

    Args:
        split: Dataset split ("train" or "test")
        sample_size: Limit number of orders
        output_dir: If provided, save to JSON files

    Returns:
        Workflow mining format data
    """
    adapter = SALTAdapter()
    adapter.load_from_huggingface(split=split)

    if output_dir:
        adapter.save_to_json(output_dir, sample_size=sample_size)

    return adapter.to_workflow_format(sample_size=sample_size)
