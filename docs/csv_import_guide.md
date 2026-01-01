# CSV Import Guide

> **Bypass RFC Connections**: Load SAP data directly from SE16N table exports without requiring live SAP connectivity.

This guide explains how to use the Pattern Engine's CSV import mode to analyze SAP data exported from the table browser (SE16N) or similar export tools.

## Overview

CSV mode allows you to:
- Run pattern analysis without any SAP connection
- Use data exported by SAP administrators or business users
- Analyze historical data from SAP extracts
- Work in environments without network access to SAP

## Quick Start

1. Export VBAK and VBAP tables from SE16N to CSV
2. Place CSV files in a directory
3. Run the pattern engine with `--csv-mode`:

```bash
python -m src.main run --input-dir ./csv_exports --output-dir ./output --csv-mode
```

## Required Files

| File | SAP Table | Description | Required |
|------|-----------|-------------|----------|
| `VBAK.csv` | VBAK | Sales Order Headers | **Yes** |
| `VBAP.csv` | VBAP | Sales Order Items | **Yes** |
| `texts.csv` or `STXH.csv` | STXH/STXL | Document Texts | No |
| `VBFA.csv` | VBFA | Document Flow | No |

### Alternative File Names

The loader accepts these file names (case-insensitive):
- VBAK: `VBAK.csv`, `vbak.csv`, `sales_orders.csv`
- VBAP: `VBAP.csv`, `vbap.csv`, `sales_order_items.csv`
- Texts: `STXH.csv`, `STXL.csv`, `texts.csv`, `TEXTS.csv`
- Doc Flow: `VBFA.csv`, `vbfa.csv`, `doc_flow.csv`

---

## Exporting from SAP SE16N

### Step 1: Export VBAK (Sales Order Headers)

```
Transaction: SE16N
Table: VBAK
```

1. Open transaction **SE16N**
2. Enter table name: `VBAK`
3. Set selection criteria:
   - `ERDAT` (Created Date): Enter date range
   - `VKORG` (Sales Org): Limit to specific sales org if needed
   - `AUART` (Order Type): Limit to specific order types (OR, SO, RE, etc.)
4. Click **Execute** (F8)
5. Export to CSV:
   - Menu: `List > Export > Spreadsheet`
   - Or use keyboard: Ctrl+Shift+F7
   - Select format: **CSV with column headers**
6. Save as `VBAK.csv`

**Recommended fields to include:**
- VBELN - Sales Document Number
- AUART - Order Type
- VKORG - Sales Organization
- VTWEG - Distribution Channel
- SPART - Division
- ERDAT - Created Date
- NETWR - Net Value
- WAERK - Currency
- KUNNR - Customer Number
- VDATU - Requested Delivery Date

### Step 2: Export VBAP (Sales Order Items)

```
Transaction: SE16N
Table: VBAP
```

1. Open transaction **SE16N**
2. Enter table name: `VBAP`
3. Use the same date range as VBAK for `ERDAT`
4. Execute and export as `VBAP.csv`

**Recommended fields:**
- VBELN - Sales Document Number (links to VBAK)
- POSNR - Item Number
- MATNR - Material Number
- WERKS - Plant
- KWMENG - Order Quantity
- NETWR - Net Value
- PSTYV - Item Category

### Step 3: Export Texts (Optional)

Document texts are stored in cluster tables STXH/STXL, which cannot be exported directly via SE16N.

**Option A: Use READ_TEXT report**

Create or request a report that uses READ_TEXT function to extract texts:

```abap
REPORT ZEXTRACT_ORDER_TEXTS.
DATA: lt_lines TYPE TABLE OF tline.

CALL FUNCTION 'READ_TEXT'
  EXPORTING
    id       = '0001'
    language = 'E'
    name     = lv_vbeln  " Order number
    object   = 'VBBK'    " Order header text object
  TABLES
    lines    = lt_lines.
```

**Option B: Export via custom query**

Request IT to create a query joining STXH with text extraction.

**Option C: Skip text export**

If no text file is provided, the pattern engine generates synthetic texts based on order characteristics (order type, value, sales org). This still allows pattern discovery but with generated rather than actual text content.

### Step 4: Export VBFA (Optional)

Document flow links orders to deliveries and invoices.

```
Transaction: SE16N
Table: VBFA
```

1. Export with fields:
   - VBELV - Preceding Document
   - POSNV - Preceding Item
   - VBTYP_V - Preceding Category (C=Order, J=Delivery, M=Invoice)
   - VBELN - Subsequent Document
   - POSNN - Subsequent Item
   - VBTYP_N - Subsequent Category
   - ERDAT - Created Date

---

## CSV Format Requirements

### Column Headers

The loader accepts both:
- **SAP technical names**: `VBELN`, `AUART`, `ERDAT`
- **Descriptive names**: `Sales Document`, `Order Type`, `Created Date`

Mixed headers are supported in the same file.

### Delimiters

Auto-detected from file content:
- Comma (`,`) - most common
- Semicolon (`;`) - European Excel exports
- Tab (`\t`)
- Pipe (`|`)

### Date Formats

Supported formats:
- `YYYY-MM-DD` - ISO format
- `YYYYMMDD` - SAP internal format
- `DD.MM.YYYY` - German format
- `MM/DD/YYYY` - US format
- `DD/MM/YYYY` - European format

### Encoding

Supported encodings:
- UTF-8 (recommended)
- UTF-8 with BOM
- Latin-1 / ISO-8859-1
- Windows-1252

---

## Sample CSV Files

Sample files are provided in `pattern-engine/sample_csv/`:

```
sample_csv/
  VBAK.csv      # 20 sample sales orders
  VBAP.csv      # Corresponding line items
  texts.csv     # Document texts
  VBFA.csv      # Document flow
  README.md     # Format documentation
```

Test with sample data:

```bash
cd pattern-engine
python -m src.main run --input-dir ./sample_csv --output-dir ./test_output --csv-mode
```

---

## CLI Usage

### Full Pipeline

Run the complete analysis pipeline:

```bash
python -m src.main run \
    --input-dir ./csv_exports \
    --output-dir ./output \
    --csv-mode \
    --mode shareable
```

### Ingest Only

Just load and validate the CSV files:

```bash
python -m src.main ingest \
    --input-dir ./csv_exports \
    --csv-mode \
    --output ./ingested_data.json
```

### With Custom Seed

For reproducible analysis:

```bash
python -m src.main --seed 12345 run \
    --input-dir ./csv_exports \
    --output-dir ./output \
    --csv-mode
```

---

## Programmatic Usage

### Basic Loading

```python
from src.ingest.csv_loader import load_csv_directory

# Load all CSV files from directory
documents = load_csv_directory('./csv_exports', random_seed=42)

# Use with pipeline
for doc in documents:
    print(f"Order: {doc['doc_key']}")
    print(f"Text: {doc['consolidated_text'][:100]}...")
```

### Custom File Paths

```python
from src.ingest.csv_loader import CSVLoader

loader = CSVLoader(random_seed=42)

result = loader.load_from_csv(
    vbak_csv='./exports/orders_2024.csv',
    vbap_csv='./exports/items_2024.csv',
    text_csv='./exports/texts_2024.csv',  # Optional
    vbfa_csv=None  # Optional
)

if result.success:
    print(f"Loaded {len(result.documents)} documents")
    print(f"Stats: {result.stats}")
else:
    print(f"Errors: {result.errors}")
```

### Validation Only

```python
from src.ingest.csv_loader import CSVLoader

loader = CSVLoader()
validation = loader._validate_csv(
    file_path=Path('./VBAK.csv'),
    field_map=loader.VBAK_FIELD_MAP,
    required_key='vbeln'
)

print(f"Valid: {validation.valid}")
print(f"Rows: {validation.row_count}")
print(f"Mapped columns: {validation.mapped_columns}")
print(f"Unmapped columns: {validation.unmapped_columns}")
```

---

## Troubleshooting

### "VBAK CSV not found"

Ensure the file is named `VBAK.csv`, `vbak.csv`, or `sales_orders.csv`.

### "Required field 'vbeln' not found"

Your CSV needs a column for document number. Accepted names:
- `VBELN`
- `vbeln`
- `Sales Document`
- `sales_document`
- `order_number`

### Character encoding issues

Special characters appearing as garbage? Try:
1. Open CSV in Excel/Notepad++
2. Save As with encoding: UTF-8
3. Re-run import

### European decimal format

If your values use comma as decimal separator (1.234,56 instead of 1,234.56), the loader handles this automatically.

### Large files

For files with millions of rows, consider:
1. Filtering by date range in SE16N before export
2. Splitting into multiple files by sales org or date
3. Using the `--seed` option for reproducible sampling

---

## Comparison: CSV Mode vs. RFC Mode

| Aspect | CSV Mode | RFC Mode |
|--------|----------|----------|
| SAP Connection | Not required | Required |
| Data Freshness | Point-in-time export | Real-time |
| Setup Complexity | Low | High (authorizations, network) |
| Data Volume | Limited by export | API limits |
| Text Availability | Requires special export | Direct access |
| Best For | Proof of concept, historical analysis | Production monitoring |

---

## Security Considerations

### Data Handling

- CSV files may contain sensitive SAP data
- Apply same redaction policies as RFC mode
- Store CSV files securely; delete after analysis
- Use `--mode shareable` to redact PII in output

### Recommended Workflow

1. Export minimal required data from SAP
2. Transfer CSV files to analysis environment securely
3. Run pattern engine with shareable mode
4. Review and share only the redacted output
5. Delete source CSV files after analysis

---

## Synthetic Text Generation

When no text CSV is provided, the pattern engine generates synthetic document texts based on order characteristics:

### Text Patterns

| Characteristic | Generated Text Examples |
|----------------|------------------------|
| High value (>$100K) | "High-value order - requires manager approval" |
| Rush order (SO type) | "Rush order - expedite processing" |
| European sales org | "European region order" |
| Multi-item (>5 items) | "Multi-line order with N items" |
| Return order (RE type) | "Return Order processing" |

### Seed Control

The random seed controls synthetic text generation:

```bash
# Same seed = same synthetic texts
python -m src.main --seed 42 run --input-dir ./csv --output-dir ./out --csv-mode

# Different seed = different text variations
python -m src.main --seed 123 run --input-dir ./csv --output-dir ./out --csv-mode
```

---

## Field Reference

### VBAK Fields

| SAP Field | Description | Used For |
|-----------|-------------|----------|
| VBELN | Document Number | Primary key |
| AUART | Order Type | Text generation, analysis |
| VKORG | Sales Organization | Segmentation |
| ERDAT | Created Date | Timing analysis |
| NETWR | Net Value | Value-based patterns |
| WAERK | Currency | Value normalization |
| KUNNR | Customer | Correlation |
| VDATU | Requested Delivery | Delay calculation |

### VBAP Fields

| SAP Field | Description | Used For |
|-----------|-------------|----------|
| VBELN | Document Number | Link to header |
| POSNR | Item Number | Item identification |
| MATNR | Material | Product analysis |
| KWMENG | Order Quantity | Volume patterns |
| NETWR | Net Value | Item value |
| WERKS | Plant | Fulfillment analysis |

### Text Fields

| SAP Field | Description | Notes |
|-----------|-------------|-------|
| TDNAME | Object Key | Usually VBELN |
| TDID | Text ID | 0001=header, 0002=internal |
| TDSPRAS | Language | E=English, D=German |
| TDLINE | Text Content | Actual text line |

### VBFA Fields

| SAP Field | Description | Notes |
|-----------|-------------|-------|
| VBELV | Preceding Doc | Source document |
| VBTYP_V | Preceding Category | C=Order, J=Delivery |
| VBELN | Subsequent Doc | Target document |
| VBTYP_N | Subsequent Category | J=Delivery, M=Invoice |
