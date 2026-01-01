#!/usr/bin/env python3
"""
External SAP Dataset Loader

Downloads and converts external SAP datasets into our synthetic data format.
Supports:
- SAP SALT dataset from Hugging Face (real anonymized ERP data)
- SAP Datasphere sample CSVs from GitHub
- BPI Challenge event logs (process mining format)

Usage:
    python src/load_external_datasets.py --source salt --output ./external_data
    python src/load_external_datasets.py --source datasphere --output ./external_data
    python src/load_external_datasets.py --source bpi2019 --output ./external_data
    python src/load_external_datasets.py --source all --output ./external_data

Requirements:
    pip install datasets pandas requests tqdm
"""

import argparse
import json
import os
import sys
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional
import random
import hashlib

# Check for required dependencies
try:
    import pandas as pd
    from tqdm import tqdm
except ImportError:
    print("Installing required dependencies...")
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "pandas", "tqdm", "requests"])
    import pandas as pd
    from tqdm import tqdm


# =============================================================================
# Configuration
# =============================================================================

SALT_DATASET = "SAP/SALT"
DATASPHERE_BASE_URL = "https://raw.githubusercontent.com/SAP-samples/datasphere-content/main"
BPI_2019_URL = "https://data.4tu.nl/file/d06aff4b-79f0-45e6-8ec8-e19730c248f1/cc98cc48-0171-4acd-a14e-2632d8f6cf04"

# Mapping from SALT columns to our format
SALT_COLUMN_MAP = {
    # Sales Document Header
    "SalesDocument": "vbeln",
    "SalesDocumentType": "auart",
    "SalesOrganization": "vkorg",
    "DistributionChannel": "vtweg",
    "Division": "spart",
    "SoldToParty": "kunnr",
    "ShipToParty": "kunwe",
    "CreationDate": "erdat",
    "CreationTime": "erzet",
    "CreatedByUser": "ernam",
    "RequestedDeliveryDate": "vdatu",
    "TotalNetAmount": "netwr",
    "TransactionCurrency": "waerk",
    "CustomerPurchaseOrderNumber": "bstnk",
    # Sales Document Item
    "SalesDocumentItem": "posnr",
    "Material": "matnr",
    "Plant": "werks",
    "OrderQuantity": "kwmeng",
    "NetAmount": "netwr",
    "SalesUnit": "vrkme",
    "ItemCategory": "pstyv",
    # Customer
    "Customer": "kunnr",
    "CustomerName": "name1",
    "Country": "land1",
    "Region": "regio",
    "IndustryKey": "brsch",
}


# =============================================================================
# SALT Dataset Loader (Hugging Face)
# =============================================================================

def load_salt_dataset(output_dir: Path, max_records: int = 50000) -> Dict[str, int]:
    """
    Load SAP SALT dataset from Hugging Face and convert to our format.

    Note: Requires Hugging Face account and agreement to dataset terms.
    """
    print("\n" + "=" * 60)
    print("Loading SAP SALT Dataset from Hugging Face")
    print("=" * 60)

    try:
        from datasets import load_dataset
    except ImportError:
        print("Installing datasets library...")
        import subprocess
        subprocess.check_call([sys.executable, "-m", "pip", "install", "datasets"])
        from datasets import load_dataset

    output_dir.mkdir(parents=True, exist_ok=True)
    stats = {}

    print("\nNote: You may need to login to Hugging Face and accept the dataset terms.")
    print("Run: huggingface-cli login")
    print()

    try:
        # Load sales documents
        print("Loading sales documents...")
        sales_docs = load_dataset(SALT_DATASET, "salesdocuments", split="train")
        sales_df = sales_docs.to_pandas()
        print(f"  Loaded {len(sales_df):,} sales documents")

        # Load sales document items
        print("Loading sales document items...")
        items = load_dataset(SALT_DATASET, "salesdocument_items", split="train")
        items_df = items.to_pandas()
        print(f"  Loaded {len(items_df):,} line items")

        # Load customers
        print("Loading customers...")
        customers = load_dataset(SALT_DATASET, "customers", split="train")
        customers_df = customers.to_pandas()
        print(f"  Loaded {len(customers_df):,} customers")

        # Load addresses (for region info)
        print("Loading addresses...")
        addresses = load_dataset(SALT_DATASET, "addresses", split="train")
        addresses_df = addresses.to_pandas()
        print(f"  Loaded {len(addresses_df):,} addresses")

    except Exception as e:
        print(f"\nError loading SALT dataset: {e}")
        print("\nTo use SALT dataset:")
        print("1. Create a Hugging Face account: https://huggingface.co/join")
        print("2. Accept dataset terms: https://huggingface.co/datasets/SAP/SALT")
        print("3. Login: huggingface-cli login")
        return {"error": str(e)}

    # Sample if too large
    if len(sales_df) > max_records:
        print(f"\nSampling {max_records:,} records from {len(sales_df):,}...")
        sample_ids = sales_df["SalesDocument"].sample(n=max_records, random_state=42).tolist()
        sales_df = sales_df[sales_df["SalesDocument"].isin(sample_ids)]
        items_df = items_df[items_df["SalesDocument"].isin(sample_ids)]

    # Convert to our format
    print("\nConverting to synthetic data format...")
    orders = convert_salt_to_orders(sales_df, items_df)
    customers_out = convert_salt_to_customers(customers_df, addresses_df)
    deliveries = generate_deliveries_from_orders(orders)
    invoices = generate_invoices_from_deliveries(deliveries)
    doc_flows = generate_doc_flows(orders, deliveries, invoices)

    # Save outputs
    print("\nSaving converted data...")

    with open(output_dir / "orders.json", "w") as f:
        json.dump(orders, f, indent=2, default=str)
    stats["orders"] = len(orders)

    with open(output_dir / "customers.json", "w") as f:
        json.dump(customers_out, f, indent=2, default=str)
    stats["customers"] = len(customers_out)

    with open(output_dir / "deliveries.json", "w") as f:
        json.dump(deliveries, f, indent=2, default=str)
    stats["deliveries"] = len(deliveries)

    with open(output_dir / "invoices.json", "w") as f:
        json.dump(invoices, f, indent=2, default=str)
    stats["invoices"] = len(invoices)

    with open(output_dir / "doc_flows.json", "w") as f:
        json.dump(doc_flows, f, indent=2, default=str)
    stats["doc_flows"] = len(doc_flows)

    # Create empty materials/vendors for compatibility
    with open(output_dir / "materials.json", "w") as f:
        json.dump([], f)
    with open(output_dir / "vendors.json", "w") as f:
        json.dump([], f)

    print(f"\nSALT dataset loaded successfully!")
    return stats


def convert_salt_to_orders(sales_df: pd.DataFrame, items_df: pd.DataFrame) -> List[Dict]:
    """Convert SALT sales documents to our order format."""
    orders = []

    # Group items by sales document
    items_grouped = items_df.groupby("SalesDocument")

    for _, row in tqdm(sales_df.iterrows(), total=len(sales_df), desc="Converting orders"):
        doc_id = row.get("SalesDocument", "")

        # Get items for this document
        doc_items = []
        if doc_id in items_grouped.groups:
            item_rows = items_grouped.get_group(doc_id)
            for _, item_row in item_rows.iterrows():
                doc_items.append({
                    "posnr": str(item_row.get("SalesDocumentItem", "")).zfill(6),
                    "matnr": str(item_row.get("Material", "")),
                    "werks": str(item_row.get("Plant", "")),
                    "kwmeng": float(item_row.get("OrderQuantity", 0) or 0),
                    "netwr": float(item_row.get("NetAmount", 0) or 0),
                    "waerk": str(item_row.get("TransactionCurrency", "USD")),
                    "pstyv": str(item_row.get("ItemCategory", "TAN")),
                    "item_texts": [],
                    "schedule_lines": [{
                        "etenr": "0001",
                        "edatu": format_date(row.get("RequestedDeliveryDate")),
                        "wmeng": float(item_row.get("OrderQuantity", 0) or 0),
                        "bmeng": float(item_row.get("OrderQuantity", 0) or 0),
                        "meins": str(item_row.get("SalesUnit", "EA"))
                    }]
                })

        order = {
            "vbeln": str(doc_id).zfill(10),
            "auart": str(row.get("SalesDocumentType", "OR")),
            "vkorg": str(row.get("SalesOrganization", "")),
            "vtweg": str(row.get("DistributionChannel", "")),
            "spart": str(row.get("Division", "")),
            "kunnr": str(row.get("SoldToParty", "")),
            "erdat": format_date(row.get("CreationDate")),
            "erzet": format_time(row.get("CreationTime")),
            "ernam": str(row.get("CreatedByUser", "SALT_USER")),
            "vdatu": format_date(row.get("RequestedDeliveryDate")),
            "knumv": f"K{str(doc_id).zfill(10)}",
            "netwr": float(row.get("TotalNetAmount", 0) or 0),
            "waerk": str(row.get("TransactionCurrency", "USD")),
            "header_texts": [],
            "items": doc_items,
            "conditions": []
        }
        orders.append(order)

    return orders


def convert_salt_to_customers(customers_df: pd.DataFrame, addresses_df: pd.DataFrame) -> List[Dict]:
    """Convert SALT customers to our customer format."""
    customers = []

    # Create address lookup
    addr_lookup = {}
    if "Customer" in addresses_df.columns:
        for _, row in addresses_df.iterrows():
            cust_id = row.get("Customer", "")
            addr_lookup[cust_id] = {
                "land1": str(row.get("Country", "")),
                "regio": str(row.get("Region", ""))
            }

    for _, row in tqdm(customers_df.iterrows(), total=len(customers_df), desc="Converting customers"):
        cust_id = str(row.get("Customer", ""))
        addr = addr_lookup.get(cust_id, {})

        customer = {
            "kunnr": cust_id,
            "name1": f"Customer {cust_id[-4:]}",  # Anonymized
            "land1": addr.get("land1", "US"),
            "regio": addr.get("regio", "NA"),
            "brsch": str(row.get("IndustryKey", "MISC")),
            "vkorg": str(row.get("SalesOrganization", "1000"))
        }
        customers.append(customer)

    return customers


# =============================================================================
# SAP Datasphere CSV Loader (GitHub)
# =============================================================================

def load_datasphere_dataset(output_dir: Path) -> Dict[str, int]:
    """
    Load SAP Datasphere sample CSVs from GitHub.
    """
    print("\n" + "=" * 60)
    print("Loading SAP Datasphere Sample Data from GitHub")
    print("=" * 60)

    import requests

    output_dir.mkdir(parents=True, exist_ok=True)
    stats = {}

    # Files to download
    csv_files = {
        "SalesOrders": f"{DATASPHERE_BASE_URL}/SAP_Sample_Content/CSV/Sales/SalesOrders.csv",
        "SalesOrderItems": f"{DATASPHERE_BASE_URL}/SAP_Sample_Content/CSV/Sales/SalesOrderItems.csv",
        "BusinessPartners": f"{DATASPHERE_BASE_URL}/SAP_Sample_Content/CSV/Sales/BusinessPartners.csv",
    }

    dataframes = {}

    for name, url in csv_files.items():
        print(f"Downloading {name}...")
        try:
            response = requests.get(url, timeout=30)
            response.raise_for_status()

            # Parse CSV - SAP uses semicolon delimiter and comma decimal
            from io import StringIO
            df = pd.read_csv(
                StringIO(response.text),
                sep=';',  # European CSV format
                decimal=','  # European decimal separator
            )
            dataframes[name] = df
            print(f"  Loaded {len(df):,} records")
            print(f"    Columns: {list(df.columns)}")
        except Exception as e:
            print(f"  Error: {e}")
            dataframes[name] = pd.DataFrame()

    # Convert to our format
    print("\nConverting to synthetic data format...")

    orders_df = dataframes.get("SalesOrders", pd.DataFrame())
    items_df = dataframes.get("SalesOrderItems", pd.DataFrame())
    partners_df = dataframes.get("BusinessPartners", pd.DataFrame())

    orders = convert_datasphere_to_orders(orders_df, items_df)
    customers = convert_datasphere_to_customers(partners_df)
    deliveries = generate_deliveries_from_orders(orders)
    invoices = generate_invoices_from_deliveries(deliveries)
    doc_flows = generate_doc_flows(orders, deliveries, invoices)

    # Save outputs
    print("\nSaving converted data...")

    with open(output_dir / "orders.json", "w") as f:
        json.dump(orders, f, indent=2, default=str)
    stats["orders"] = len(orders)

    with open(output_dir / "customers.json", "w") as f:
        json.dump(customers, f, indent=2, default=str)
    stats["customers"] = len(customers)

    with open(output_dir / "deliveries.json", "w") as f:
        json.dump(deliveries, f, indent=2, default=str)
    stats["deliveries"] = len(deliveries)

    with open(output_dir / "invoices.json", "w") as f:
        json.dump(invoices, f, indent=2, default=str)
    stats["invoices"] = len(invoices)

    with open(output_dir / "doc_flows.json", "w") as f:
        json.dump(doc_flows, f, indent=2, default=str)
    stats["doc_flows"] = len(doc_flows)

    # Create empty materials/vendors
    with open(output_dir / "materials.json", "w") as f:
        json.dump([], f)
    with open(output_dir / "vendors.json", "w") as f:
        json.dump([], f)

    print(f"\nDatasphere dataset loaded successfully!")
    return stats


def convert_datasphere_to_orders(orders_df: pd.DataFrame, items_df: pd.DataFrame) -> List[Dict]:
    """Convert Datasphere CSVs to our order format."""
    orders = []

    if orders_df.empty:
        return orders

    # Group items by order - need to convert to same type for matching
    items_grouped = {}
    if not items_df.empty and "SALESORDERID" in items_df.columns:
        # Convert order IDs to integers for consistent matching
        items_df["SALESORDERID_INT"] = pd.to_numeric(items_df["SALESORDERID"], errors="coerce")
        items_grouped = {k: v for k, v in items_df.groupby("SALESORDERID_INT")}

    for _, row in tqdm(orders_df.iterrows(), total=len(orders_df), desc="Converting orders"):
        order_id_raw = row.get("SALESORDERID", 0)
        order_id_int = int(order_id_raw) if pd.notna(order_id_raw) else 0
        order_id = str(order_id_int).zfill(10)

        # Get items for this order
        doc_items = []
        if order_id_int in items_grouped:
            item_rows = items_grouped[order_id_int]
            for item_num, (_, item_row) in enumerate(item_rows.iterrows(), start=1):
                doc_items.append({
                    "posnr": str(item_num * 10).zfill(6),
                    "matnr": str(item_row.get("PRODUCTID", f"MAT{item_num:04d}")),
                    "werks": "1000",
                    "kwmeng": float(item_row.get("QUANTITY", 1) or 1),
                    "netwr": float(item_row.get("NETAMOUNT", 0) or 0),
                    "waerk": str(item_row.get("CURRENCY", "USD")),
                    "pstyv": "TAN",
                    "item_texts": [],
                    "schedule_lines": [{
                        "etenr": "0001",
                        "edatu": format_date(item_row.get("DELIVERYDATE")),
                        "wmeng": float(item_row.get("QUANTITY", 1) or 1),
                        "meins": str(item_row.get("QUANTITYUNIT", "EA"))
                    }]
                })

        # Parse date from YYYYMMDD format
        created = str(row.get("CREATEDAT", "20240101"))
        erdat = f"{created[:4]}-{created[4:6]}-{created[6:8]}" if len(created) >= 8 else "2024-01-01"

        # Generate synthetic header text from order characteristics
        header_text = generate_order_text(row, doc_items)

        order = {
            "vbeln": order_id.zfill(10),
            "auart": "OR",
            "vkorg": str(row.get("SALESORG", "1000")),
            "vtweg": "10",
            "spart": "10",
            "kunnr": str(row.get("PARTNERID", "")),
            "erdat": erdat,
            "erzet": "12:00:00",
            "ernam": str(row.get("CREATEDBY", "DSPHR_USER")),
            "vdatu": erdat,
            "knumv": f"K{order_id.zfill(10)}",
            "netwr": float(row.get("NETAMOUNT", 0) or 0),
            "waerk": str(row.get("CURRENCY", "USD")),
            "header_texts": [{"tdid": "0001", "spras": "EN", "text": header_text}] if header_text else [],
            "items": doc_items if doc_items else [{
                "posnr": "000010",
                "matnr": "MAT0001",
                "werks": "1000",
                "kwmeng": 1.0,
                "netwr": float(row.get("NETAMOUNT", 0)),
                "waerk": str(row.get("CURRENCY", "USD")),
                "pstyv": "TAN",
                "item_texts": [],
                "schedule_lines": []
            }],
            "conditions": []
        }
        orders.append(order)

    return orders


def convert_datasphere_to_customers(partners_df: pd.DataFrame) -> List[Dict]:
    """Convert Datasphere business partners to customers."""
    customers = []

    if partners_df.empty:
        return customers

    for _, row in partners_df.iterrows():
        customer = {
            "kunnr": str(row.get("PARTNERID", "")),
            "name1": str(row.get("COMPANYNAME", "Unknown")),
            "land1": str(row.get("COUNTRY", "US")),
            "regio": str(row.get("REGION", "NA")),
            "brsch": "MISC",
            "vkorg": "1000"
        }
        customers.append(customer)

    return customers


# =============================================================================
# BPI Challenge 2019 Loader (Process Mining Event Log)
# =============================================================================

def load_bpi2019_dataset(output_dir: Path, max_cases: int = 10000) -> Dict[str, int]:
    """
    Load BPI Challenge 2019 (Purchase Order Handling) dataset.
    This is an event log in XES/CSV format useful for process mining validation.
    """
    print("\n" + "=" * 60)
    print("Loading BPI Challenge 2019 Dataset")
    print("=" * 60)

    import requests

    output_dir.mkdir(parents=True, exist_ok=True)
    stats = {}

    # BPI 2019 is quite large - use the CSV version
    csv_url = "https://data.4tu.nl/file/d06aff4b-79f0-45e6-8ec8-e19730c248f1/1a50ae23-8453-4750-8b93-4c2f1879e5d7"

    print("Downloading BPI 2019 CSV (this may take a while)...")
    print("Note: This is a 694MB file. Consider using --max-records to limit size.")

    try:
        # For large files, stream and process in chunks
        response = requests.get(csv_url, stream=True, timeout=60)
        response.raise_for_status()

        # Save to temp file first
        temp_file = output_dir / "bpi2019_temp.csv"
        total_size = int(response.headers.get('content-length', 0))

        with open(temp_file, 'wb') as f:
            with tqdm(total=total_size, unit='B', unit_scale=True, desc="Downloading") as pbar:
                for chunk in response.iter_content(chunk_size=8192):
                    f.write(chunk)
                    pbar.update(len(chunk))

        print("\nParsing event log...")
        # Read only first N rows if specified
        df = pd.read_csv(temp_file, nrows=max_cases * 20)  # Approx 20 events per case

        # Clean up temp file
        temp_file.unlink()

    except Exception as e:
        print(f"Error downloading BPI 2019: {e}")
        print("\nAlternative: Download manually from:")
        print("https://data.4tu.nl/articles/dataset/BPI_Challenge_2019/12715853")
        return {"error": str(e)}

    # Convert event log to our format
    print("Converting to order format...")
    orders, doc_flows = convert_bpi2019_to_orders(df, max_cases)

    # Generate downstream documents
    deliveries = generate_deliveries_from_orders(orders)
    invoices = generate_invoices_from_deliveries(deliveries)

    # Extend doc flows
    extra_flows = generate_doc_flows(orders, deliveries, invoices)
    doc_flows.extend(extra_flows)

    # Save outputs
    print("\nSaving converted data...")

    with open(output_dir / "orders.json", "w") as f:
        json.dump(orders, f, indent=2, default=str)
    stats["orders"] = len(orders)

    with open(output_dir / "deliveries.json", "w") as f:
        json.dump(deliveries, f, indent=2, default=str)
    stats["deliveries"] = len(deliveries)

    with open(output_dir / "invoices.json", "w") as f:
        json.dump(invoices, f, indent=2, default=str)
    stats["invoices"] = len(invoices)

    with open(output_dir / "doc_flows.json", "w") as f:
        json.dump(doc_flows, f, indent=2, default=str)
    stats["doc_flows"] = len(doc_flows)

    # Create empty master data
    with open(output_dir / "customers.json", "w") as f:
        json.dump([], f)
    with open(output_dir / "materials.json", "w") as f:
        json.dump([], f)
    with open(output_dir / "vendors.json", "w") as f:
        json.dump([], f)

    print(f"\nBPI 2019 dataset loaded successfully!")
    return stats


def convert_bpi2019_to_orders(df: pd.DataFrame, max_cases: int) -> tuple:
    """
    Convert BPI 2019 event log to purchase order format.
    BPI 2019 is about purchase orders, so we adapt it to sales orders.
    """
    orders = []
    doc_flows = []

    if df.empty:
        return orders, doc_flows

    # Identify case column
    case_col = None
    for col in ["case:concept:name", "Case ID", "case_id"]:
        if col in df.columns:
            case_col = col
            break

    if not case_col:
        print("Warning: Could not find case ID column")
        return orders, doc_flows

    # Get unique cases
    unique_cases = df[case_col].unique()[:max_cases]

    for case_id in tqdm(unique_cases, desc="Converting cases"):
        case_events = df[df[case_col] == case_id].sort_values(
            by=next((c for c in ["time:timestamp", "timestamp", "Timestamp"] if c in df.columns), df.columns[0])
        )

        if case_events.empty:
            continue

        first_event = case_events.iloc[0]

        # Extract order details from event attributes
        order_id = str(case_id).replace("-", "")[:10].zfill(10)

        order = {
            "vbeln": order_id,
            "auart": "OR",
            "vkorg": "1000",
            "vtweg": "10",
            "spart": "10",
            "kunnr": f"CUST{hash(str(case_id)) % 1000:04d}",
            "erdat": extract_date(first_event),
            "erzet": extract_time(first_event),
            "ernam": "BPI_USER",
            "vdatu": extract_date(first_event),
            "knumv": f"K{order_id}",
            "netwr": float(first_event.get("Cumulative net worth (EUR)", 0) or 0),
            "waerk": "EUR",
            "header_texts": [{
                "tdid": "0001",
                "spras": "EN",
                "text": f"BPI 2019 Case: {case_id}"
            }],
            "items": [{
                "posnr": "000010",
                "matnr": str(first_event.get("Item", "MAT0001")),
                "werks": "1000",
                "kwmeng": 1.0,
                "netwr": float(first_event.get("Cumulative net worth (EUR)", 0) or 0),
                "waerk": "EUR",
                "pstyv": "TAN",
                "item_texts": [],
                "schedule_lines": []
            }],
            "conditions": []
        }
        orders.append(order)

        # Create event flow from activities
        prev_doc = order_id
        for idx, (_, event) in enumerate(case_events.iterrows()):
            activity = str(event.get("concept:name", event.get("Activity", "")))
            event_doc = f"{order_id}{idx:02d}"

            doc_flows.append({
                "vbelv": prev_doc,
                "posnv": "000010",
                "vbtyp_v": "C",
                "vbeln": event_doc,
                "posnn": "000010",
                "vbtyp_n": "E",  # Event
                "rfmng": 1.0,
                "erdat": extract_date(event),
                "activity": activity  # Extra field for process mining
            })
            prev_doc = event_doc

    return orders, doc_flows


# =============================================================================
# Utility Functions
# =============================================================================

def generate_order_text(row: pd.Series, items: List[Dict]) -> str:
    """
    Generate synthetic document text based on order characteristics.
    Creates realistic-looking notes that contain patterns for analysis.
    """
    texts = []

    # Sales org specific patterns
    sales_org = str(row.get("SALESORG", ""))
    net_amount = float(row.get("NETAMOUNT", 0) or 0)
    lifecycle = str(row.get("LIFECYCLESTATUS", ""))

    # Region-based text patterns
    if sales_org == "EMEA":
        texts.append("European customer order.")
        if net_amount > 50000:
            texts.append("Priority handling required for major account.")
    elif sales_org == "APJ":
        texts.append("Asia-Pacific region order.")
        if net_amount > 30000:
            texts.append("Check customs documentation requirements.")
    elif sales_org == "AMER":
        texts.append("Americas region order.")
        if net_amount > 40000:
            texts.append("Coordinate with regional distribution center.")

    # Value-based patterns
    if net_amount > 100000:
        texts.append("High-value order - requires manager approval.")
        texts.append("Verify credit limit before processing.")
    elif net_amount > 50000:
        texts.append("Standard order processing applies.")
    elif net_amount < 1000:
        texts.append("Small order - consolidated shipping recommended.")

    # Item-based patterns
    num_items = len(items)
    if num_items > 5:
        texts.append(f"Multi-line order with {num_items} items.")
        texts.append("Check availability across all product lines.")
    elif num_items > 2:
        texts.append("Standard multi-item order.")

    # Product patterns based on product prefixes
    product_types = set()
    for item in items:
        matnr = str(item.get("matnr", ""))
        if matnr.startswith("MZ-FG"):
            product_types.add("finished goods")
        elif matnr.startswith("MZ-TG"):
            product_types.add("trading goods")
        elif matnr.startswith("HT-"):
            product_types.add("high-tech products")

    if product_types:
        texts.append(f"Order contains: {', '.join(product_types)}.")

    # Status patterns
    if lifecycle == "C":
        texts.append("Order completed successfully.")
    elif lifecycle == "N":
        texts.append("New order pending processing.")
    elif lifecycle == "X":
        texts.append("Order cancelled - see reason code.")

    # Add some variability based on order ID hash
    order_id = str(row.get("SALESORDERID", ""))
    hash_val = hash(order_id) % 10

    if hash_val < 2:
        texts.append("Customer requested expedited delivery.")
    elif hash_val < 4:
        texts.append("Standard delivery terms apply.")
    elif hash_val < 5:
        texts.append("Check special pricing agreements.")

    return " ".join(texts) if texts else ""


def format_date(value) -> str:
    """Convert various date formats to YYYY-MM-DD."""
    if pd.isna(value) or value is None:
        return datetime.now().strftime("%Y-%m-%d")

    if isinstance(value, (datetime, pd.Timestamp)):
        return value.strftime("%Y-%m-%d")

    value_str = str(value)

    # Try common formats
    for fmt in ["%Y-%m-%d", "%Y%m%d", "%d/%m/%Y", "%m/%d/%Y"]:
        try:
            return datetime.strptime(value_str[:10], fmt).strftime("%Y-%m-%d")
        except (ValueError, IndexError):
            continue

    return datetime.now().strftime("%Y-%m-%d")


def format_time(value) -> str:
    """Convert various time formats to HH:MM:SS."""
    if pd.isna(value) or value is None:
        return "12:00:00"

    if isinstance(value, (datetime, pd.Timestamp)):
        return value.strftime("%H:%M:%S")

    value_str = str(value)

    # Try common formats
    for fmt in ["%H:%M:%S", "%H%M%S", "%H:%M"]:
        try:
            return datetime.strptime(value_str, fmt).strftime("%H:%M:%S")
        except ValueError:
            continue

    return "12:00:00"


def extract_date(row) -> str:
    """Extract date from event log row."""
    for col in ["time:timestamp", "timestamp", "Timestamp", "Start Timestamp"]:
        if col in row.index and not pd.isna(row[col]):
            return format_date(row[col])
    return datetime.now().strftime("%Y-%m-%d")


def extract_time(row) -> str:
    """Extract time from event log row."""
    for col in ["time:timestamp", "timestamp", "Timestamp", "Start Timestamp"]:
        if col in row.index and not pd.isna(row[col]):
            return format_time(row[col])
    return "12:00:00"


def generate_deliveries_from_orders(orders: List[Dict]) -> List[Dict]:
    """Generate delivery documents from orders."""
    deliveries = []

    for order in orders:
        order_date = datetime.strptime(order["erdat"], "%Y-%m-%d")
        delivery_date = order_date + timedelta(days=random.randint(1, 7))
        actual_date = delivery_date + timedelta(days=random.randint(-1, 3))

        delivery = {
            "vbeln": f"8{order['vbeln'][1:]}",
            "erdat": delivery_date.strftime("%Y-%m-%d"),
            "wadat": delivery_date.strftime("%Y-%m-%d"),
            "wadat_ist": actual_date.strftime("%Y-%m-%d"),
            "kunnr": order["kunnr"],
            "items": [{
                "posnr": item["posnr"],
                "matnr": item["matnr"],
                "lfimg": item["kwmeng"],
                "werks": item["werks"],
                "vbeln_ref": order["vbeln"],
                "posnr_ref": item["posnr"]
            } for item in order.get("items", [])]
        }
        deliveries.append(delivery)

    return deliveries


def generate_invoices_from_deliveries(deliveries: List[Dict]) -> List[Dict]:
    """Generate invoices from deliveries."""
    invoices = []

    for delivery in deliveries:
        delivery_date = datetime.strptime(delivery["wadat_ist"], "%Y-%m-%d")
        invoice_date = delivery_date + timedelta(days=random.randint(1, 5))

        invoice = {
            "vbeln": f"9{delivery['vbeln'][1:]}",
            "fkdat": invoice_date.strftime("%Y-%m-%d"),
            "erdat": invoice_date.strftime("%Y-%m-%d"),
            "kunrg": delivery["kunnr"],
            "items": [{
                "posnr": item["posnr"],
                "matnr": item["matnr"],
                "fkimg": item["lfimg"],
                "vgbel": delivery["vbeln"],
                "vgpos": item["posnr"]
            } for item in delivery.get("items", [])]
        }
        invoices.append(invoice)

    return invoices


def generate_doc_flows(orders: List[Dict], deliveries: List[Dict], invoices: List[Dict]) -> List[Dict]:
    """Generate document flow entries linking orders -> deliveries -> invoices."""
    doc_flows = []

    # Order -> Delivery links
    for delivery in deliveries:
        for item in delivery.get("items", []):
            doc_flows.append({
                "vbelv": item.get("vbeln_ref", ""),
                "posnv": item.get("posnr_ref", ""),
                "vbtyp_v": "C",  # Order
                "vbeln": delivery["vbeln"],
                "posnn": item["posnr"],
                "vbtyp_n": "J",  # Delivery
                "rfmng": item.get("lfimg", 0),
                "erdat": delivery["erdat"]
            })

    # Delivery -> Invoice links
    for invoice in invoices:
        for item in invoice.get("items", []):
            doc_flows.append({
                "vbelv": item.get("vgbel", ""),
                "posnv": item.get("vgpos", ""),
                "vbtyp_v": "J",  # Delivery
                "vbeln": invoice["vbeln"],
                "posnn": item["posnr"],
                "vbtyp_n": "M",  # Invoice
                "rfmng": item.get("fkimg", 0),
                "erdat": invoice["erdat"]
            })

    return doc_flows


# =============================================================================
# Main Entry Point
# =============================================================================

def main():
    parser = argparse.ArgumentParser(
        description="Download and convert external SAP datasets",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
    python src/load_external_datasets.py --source salt --output ./salt_data
    python src/load_external_datasets.py --source datasphere --output ./datasphere_data
    python src/load_external_datasets.py --source bpi2019 --output ./bpi_data --max-records 5000
    python src/load_external_datasets.py --source all --output ./external_data
        """
    )
    parser.add_argument(
        "--source",
        choices=["salt", "datasphere", "bpi2019", "all"],
        default="datasphere",
        help="Dataset source to load (default: datasphere)"
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("./external_data"),
        help="Output directory for converted data"
    )
    parser.add_argument(
        "--max-records",
        type=int,
        default=50000,
        help="Maximum records to load (default: 50000)"
    )

    args = parser.parse_args()

    print("=" * 60)
    print("SAP External Dataset Loader")
    print("=" * 60)
    print(f"Source: {args.source}")
    print(f"Output: {args.output}")
    print(f"Max Records: {args.max_records:,}")

    all_stats = {}

    if args.source in ["salt", "all"]:
        stats = load_salt_dataset(args.output / "salt" if args.source == "all" else args.output, args.max_records)
        all_stats["salt"] = stats

    if args.source in ["datasphere", "all"]:
        stats = load_datasphere_dataset(args.output / "datasphere" if args.source == "all" else args.output)
        all_stats["datasphere"] = stats

    if args.source in ["bpi2019", "all"]:
        stats = load_bpi2019_dataset(args.output / "bpi2019" if args.source == "all" else args.output, args.max_records)
        all_stats["bpi2019"] = stats

    # Print summary
    print("\n" + "=" * 60)
    print("SUMMARY")
    print("=" * 60)

    for source, stats in all_stats.items():
        print(f"\n{source.upper()}:")
        if "error" in stats:
            print(f"  Error: {stats['error']}")
        else:
            for key, count in stats.items():
                print(f"  {key}: {count:,}")

    print(f"\nData saved to: {args.output.absolute()}")
    print("\nTo use with pattern engine:")
    print(f"  python -m src.main run --input-dir {args.output} --output-dir ./output")


if __name__ == "__main__":
    main()
