# Process Mining Diagrams

> **Data Attribution**
> Dataset: SAP IDES Demo System Event Logs
> Source: [sap-extractor](https://github.com/Agnesvgr96/sap-extractor)
> License: MIT

This page contains Mermaid flowchart diagrams showing the directly-follows relationships discovered in SAP process event logs.

## How to Read These Diagrams

- **Nodes** represent activities in the process
- **Arrows** show transitions between activities
- **Numbers on arrows** indicate how many times that transition occurred
- **Arrow styles**:
  - Solid lines with thick stroke = High frequency (most common paths)
  - Dashed lines = Medium frequency
  - Dotted lines = Low frequency

---

## Order-to-Cash (O2C) Process

The O2C process covers the flow from customer order to invoice creation.

### Statistics

| Metric | Value |
|--------|-------|
| Total events processed | 5,708 |
| Unique cases | 646 |
| Unique activities | 8 |
| Transitions shown (top 80%) | 5 |

### Process Flow Diagram

```mermaid
flowchart TD
    %% Style definitions
    classDef default fill:#f9f9f9,stroke:#333,stroke-width:2px
    classDef activity fill:#e1f5fe,stroke:#0288d1,stroke-width:2px

    %% Activity nodes
    CancelInvoice["Cancel Invoice"]
    CreateCreditMemo["Create Credit memo"]
    CreateDelivery["Create Delivery"]
    CreateGoodsMovement["Create Goods movement"]
    CreateInvoice["Create Invoice"]
    CreateReturns["Create Returns"]
    CreateWMSTransfer["Create WMS transfer"]
    Delivery["Delivery"]

    %% High frequency transitions (green)
    CreateInvoice -->|"1238"| CreateInvoice
    CreateGoodsMovement -->|"1227"| CreateGoodsMovement

    %% Medium frequency transitions (orange)
    CreateWMSTransfer -.->|"617"| CreateWMSTransfer
    CreateGoodsMovement -.->|"545"| CreateInvoice
    CreateDelivery -.->|"523"| CreateDelivery

    %% Lower frequency transitions
    CreateWMSTransfer -.->|"410"| CreateGoodsMovement
    CreateDelivery -.->|"293"| CreateWMSTransfer
    CreateDelivery -.->|"205"| CreateGoodsMovement

    %% Apply styles
    class CancelInvoice,CreateCreditMemo,CreateDelivery,CreateGoodsMovement,CreateInvoice,CreateReturns,CreateWMSTransfer,Delivery activity

    %% Link styles
    linkStyle 0,1 stroke:#2e7d32,stroke-width:3px
    linkStyle 2,3,4 stroke:#f57c00,stroke-width:2px
    linkStyle 5,6,7 stroke:#c62828,stroke-width:1px
```

### O2C Transition Details

| From | To | Count | Frequency |
|------|-----|-------|-----------|
| Create Invoice | Create Invoice | 1,238 | **High** |
| Create Goods movement | Create Goods movement | 1,227 | **High** |
| Create WMS transfer | Create WMS transfer | 617 | Medium |
| Create Goods movement | Create Invoice | 545 | Medium |
| Create Delivery | Create Delivery | 523 | Medium |
| Create WMS transfer | Create Goods movement | 410 | *Low* |
| Create Delivery | Create WMS transfer | 293 | *Low* |
| Create Delivery | Create Goods movement | 205 | *Low* |

### O2C Process Interpretation

The diagram reveals:

1. **Self-loops dominate**: Invoice→Invoice and Goods→Goods indicate multi-line order processing
2. **Main flow**: Delivery/WMS → Goods Movement → Invoice
3. **Warehouse handling**: WMS transfers feed into goods movements
4. **Financial completion**: Invoices are the typical endpoint

---

## Procure-to-Pay (P2P) Process

The P2P process covers the flow from purchase requisition to payment.

### Statistics

| Metric | Value |
|--------|-------|
| Total events processed | 7,420 |
| Unique cases | 2,486 |
| Unique activities | 20 |
| Transitions shown (top 80%) | 13 |

### Process Flow Diagram

```mermaid
flowchart TD
    %% Style definitions
    classDef default fill:#f9f9f9,stroke:#333,stroke-width:2px
    classDef activity fill:#fff3e0,stroke:#e65100,stroke-width:2px

    %% Activity nodes
    VendorInvoice["Vendor Invoice"]
    AccountingDocument["Accounting Document"]
    GLAccountDocument["G/L Account Document"]
    GoodsReceipt["Goods Receipt"]
    InvoiceReceipt["Invoice Receipt"]
    CreditMemo["Credit Memo"]
    ProcessRV["Process RV"]
    ProcessWA["Process WA"]
    CreatePR["Create Purchase Requisition"]
    CreatePO["Create Purchase Order"]

    %% High frequency transitions
    VendorInvoice -->|"1410"| VendorInvoice
    AccountingDocument -->|"948"| AccountingDocument

    %% Medium frequency transitions
    GLAccountDocument -.->|"247"| GLAccountDocument
    GoodsReceipt -.->|"200"| InvoiceReceipt
    ProcessRV -.->|"195"| ProcessRV
    CreditMemo -.->|"168"| CreditMemo
    ProcessWA -.->|"141"| ProcessWA

    %% Lower frequency transitions
    InvoiceReceipt -.-|"114"| VendorInvoice
    GoodsReceipt -.-|"109"| VendorInvoice
    CreatePR -.-|"6"| CreatePO

    %% Apply styles
    class VendorInvoice,AccountingDocument,GLAccountDocument,GoodsReceipt,InvoiceReceipt,CreditMemo,ProcessRV,ProcessWA,CreatePR,CreatePO activity

    %% Link styles
    linkStyle 0,1 stroke:#2e7d32,stroke-width:3px
    linkStyle 2,3,4,5,6 stroke:#f57c00,stroke-width:2px
    linkStyle 7,8,9 stroke:#c62828,stroke-width:1px
```

### P2P Transition Details

| From | To | Count | Frequency |
|------|-----|-------|-----------|
| Vendor Invoice | Vendor Invoice | 1,410 | **High** |
| Accounting Document | Accounting Document | 948 | **High** |
| G/L Account Document | G/L Account Document | 247 | Medium |
| Goods Receipt | Invoice Receipt | 200 | Medium |
| Process RV | Process RV | 195 | Medium |
| Credit Memo | Credit Memo | 168 | Medium |
| Process WA | Process WA | 141 | Medium |
| Invoice Receipt | Vendor Invoice | 114 | *Low* |
| Goods Receipt | Vendor Invoice | 109 | *Low* |
| Create Purchase Requisition | Create Purchase Order | 6 | *Low* |

### P2P Process Interpretation

The diagram reveals:

1. **Batch processing**: High self-loop counts (Vendor Invoice, Accounting Document) indicate batch posting
2. **Three-way match flow**: Goods Receipt → Invoice Receipt → Vendor Invoice shows proper matching
3. **Requisition-to-PO**: Only 6 direct transitions, indicating many POs created without PR (compliance issue)
4. **Financial documents dominate**: G/L and Accounting documents show financial recording activity

---

## Comparison: O2C vs P2P

| Aspect | O2C | P2P |
|--------|-----|-----|
| Cases | 646 | 2,486 |
| Events | 5,708 | 7,420 |
| Activities | 8 | 20 |
| Avg events/case | 8.8 | 3.0 |
| Dominant pattern | Multi-line order fulfillment | Batch financial posting |
| Primary flow | Delivery → Goods → Invoice | GR → IR → Vendor Invoice |
| Self-loops | Common (order lines) | Very common (batches) |

---

## Rendering These Diagrams

These Mermaid diagrams can be rendered in:

- **GitHub**: Automatically rendered in markdown files
- **GitLab**: Automatically rendered in markdown files
- **VS Code**: With Mermaid extension
- **Mermaid Live Editor**: [mermaid.live](https://mermaid.live/)
- **Any MCP-compatible viewer**: Supporting markdown with Mermaid

---

*Diagrams generated: January 2025*
*Dataset: SAP IDES via sap-extractor (MIT License)*
