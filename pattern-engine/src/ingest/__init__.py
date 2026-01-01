"""
Ingest module for loading MCP tool outputs and synthetic data.

Supports:
- JSON format from MCP tools and synthetic data generator
- CSV format from SAP SE16N table exports (CSV mode)
"""

from .loader import DataLoader
from .csv_loader import CSVLoader, convert_csv_to_orders, load_csv_directory

__all__ = ['DataLoader', 'CSVLoader', 'convert_csv_to_orders', 'load_csv_directory']
