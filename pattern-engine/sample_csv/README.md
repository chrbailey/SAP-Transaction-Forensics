# Sample CSV Files for Pattern Engine

This directory contains sample CSV files demonstrating the expected format for SAP SE16N exports.

## Files

| File | SAP Table | Description | Required |
|------|-----------|-------------|----------|
| `VBAK.csv` | VBAK | Sales Order Headers | Yes |
| `VBAP.csv` | VBAP | Sales Order Items | Yes |
| `texts.csv` | STXH/STXL | Document Texts | No |
| `VBFA.csv` | VBFA | Document Flow | No |

## Usage

Run the pattern engine in CSV mode:

```bash
python -m src.main run --input-dir ./sample_csv --output-dir ./output --csv-mode
```

## Exporting from SAP SE16N

### Step 1: Export VBAK (Sales Order Headers)

1. Open transaction SE16N
2. Enter table name: `VBAK`
3. Set selection criteria (e.g., date range, sales org)
4. Execute (F8)
5. Download as CSV: `List > Export > Spreadsheet`
6. Save as `VBAK.csv`

Required columns:
- VBELN (Sales Document Number)
- AUART (Order Type)
- VKORG (Sales Organization)
- ERDAT (Created Date)
- NETWR (Net Value)
- WAERK (Currency)
- KUNNR (Customer)

### Step 2: Export VBAP (Sales Order Items)

1. Open transaction SE16N
2. Enter table name: `VBAP`
3. Use same selection criteria as VBAK
4. Execute and download as `VBAP.csv`

Required columns:
- VBELN (Sales Document Number)
- POSNR (Item Number)
- MATNR (Material Number)
- KWMENG (Order Quantity)
- NETWR (Net Value)

### Step 3: Export Texts (Optional but Recommended)

For document texts, you have two options:

**Option A: Combined Text Export**
Use a custom report or SQL query to extract texts from STXH/STXL tables.

**Option B: Skip Text Export**
If no text file is provided, the pattern engine will generate synthetic texts
based on order characteristics (value, order type, sales org, etc.).

### Step 4: Export VBFA (Optional)

For document flow (order -> delivery -> invoice relationships):

1. Open transaction SE16N
2. Enter table name: `VBFA`
3. Execute and download as `VBFA.csv`

## Column Format

The CSV loader automatically handles:
- Both SAP technical names (VBELN) and descriptive names (Sales Document)
- Different date formats (YYYY-MM-DD, YYYYMMDD, DD.MM.YYYY)
- Different delimiters (comma, semicolon, tab)
- Different encodings (UTF-8, Latin-1, Windows-1252)

## Troubleshooting

### "VBAK CSV not found" Error
Ensure the file is named exactly `VBAK.csv` (case insensitive) or `sales_orders.csv`.

### "Required field 'vbeln' not found" Error
Check that your CSV has a column named VBELN, Sales Document, or order_number.

### Encoding Issues
If special characters appear garbled, try saving your CSV with UTF-8 encoding.
