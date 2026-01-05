# Process Mining Analysis Results

This directory contains process mining analysis results demonstrating the SAP Workflow Mining MCP tools on real-world datasets.

## Datasets Used

### 1. BPI Challenge 2019
- **Source**: [4TU.ResearchData](https://data.4tu.nl/articles/dataset/BPI_Challenge_2019/12715853)
- **License**: CC BY 4.0
- **Description**: Purchase-to-Pay process data from a large multinational coatings company
- **Size**: 251,734 purchase order items, 1.6M events
- **Period**: January 2018 - January 2019
- **Citation**: van Dongen, B.F. (2019). BPI Challenge 2019. 4TU.ResearchData. https://doi.org/10.4121/uuid:d06aff4b-79f0-45e6-8ec8-e19730c248f1

### 2. SAP IDES Event Logs (via sap-extractor)
- **Source**: [sap-extractor GitHub](https://github.com/Agnesvgr96/sap-extractor)
- **License**: MIT
- **Description**: Extracted event logs from SAP IDES demo system SQLite databases
- **Contains**:
  - Order-to-Cash (O2C): 646 cases, 5,708 events
  - Procure-to-Pay (P2P): 2,486 cases, 7,420 events

## Analysis Reports

| Report | Dataset | Key Findings |
|--------|---------|--------------|
| [BPI Challenge 2019](./bpi-challenge-2019.md) | BPI 2019 | 42 activities, 64-day median throughput |
| [Order-to-Cash Analysis](./order-to-cash.md) | SAP IDES | 158 variants, bottlenecks identified |
| [Procure-to-Pay Analysis](./procure-to-pay.md) | SAP IDES | 7 compliance violations detected |
| [Process Diagrams](./process-diagrams.md) | SAP IDES | Mermaid flowcharts for O2C and P2P |

## Key Metrics Summary

| Metric | BPI 2019 | O2C (IDES) | P2P (IDES) |
|--------|----------|------------|------------|
| Cases | 251,734 | 646 | 2,486 |
| Events | 1,595,923 | 5,708 | 7,420 |
| Activities | 42 | 8 | 20 |
| Process Variants | Many | 158 | 142 |
| Median Throughput | 64 days | 2.7 days | N/A |

## Tools Demonstrated

These analyses were performed using the SAP Workflow Mining MCP tools:

- `search_doc_text` - Pattern search across document flows
- `get_doc_flow` - Document flow extraction (VBFA)
- `get_sales_doc_header` / `get_sales_doc_items` - Sales order data
- Process discovery algorithms (directly-follows graphs)
- Conformance checking against expected P2P flow

## Test Suite Results

The MCP server test suite validates all tools function correctly:

```
Test Suites: 14 passed, 14 total
Tests:       427 passed, 4 skipped, 0 failed
Time:        1.396s
```

The 4 skipped tests require the HuggingFace SALT dataset (gated access).

## Reproducing Results

1. Download datasets:
   ```bash
   # BPI Challenge 2019
   wget https://data.4tu.nl/file/35bc3b3e-cc0a-4761-b76b-8ca28e2276b4/0e707e6e-c3a5-4182-be81-5dc2dd30bcf1

   # SAP IDES (sap-extractor)
   git clone https://github.com/Agnesvgr96/sap-extractor
   ```

2. Run MCP server and connect via Claude Desktop or MCP client

3. Use tools to extract and analyze event logs

---

*Analysis performed: January 2025*
