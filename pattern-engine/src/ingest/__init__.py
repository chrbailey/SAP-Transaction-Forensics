"""
Ingest module for loading MCP tool outputs, synthetic data, and benchmark datasets.

Supports:
- JSON format from MCP tools and synthetic data generator
- CSV format from SAP SE16N table exports (CSV mode)
- SAP SALT dataset from Hugging Face (real SAP ERP data)
- BPI Challenge 2019 dataset (purchase order handling event log)

Benchmark Datasets:
    SAP SALT: Real SAP ERP sales data with linked tables
             https://huggingface.co/datasets/sap-ai-research/SALT

    BPI 2019: Purchase order handling from multinational company
             https://data.4tu.nl/articles/dataset/BPI_Challenge_2019/12715853/1
"""

from .loader import DataLoader
from .csv_loader import CSVLoader, convert_csv_to_orders, load_csv_directory
from .salt_adapter import SALTAdapter, SALTLoadResult, load_salt_dataset
from .bpi2019_adapter import BPI2019Adapter, BPI2019LoadResult, load_bpi2019_dataset

__all__ = [
    # Core loaders
    'DataLoader',
    'CSVLoader',
    'convert_csv_to_orders',
    'load_csv_directory',
    # SAP SALT adapter
    'SALTAdapter',
    'SALTLoadResult',
    'load_salt_dataset',
    # BPI 2019 adapter
    'BPI2019Adapter',
    'BPI2019LoadResult',
    'load_bpi2019_dataset',
]
