# BPI Challenge 2019 - Purchase-to-Pay Analysis

> **Data Attribution**
> Dataset: BPI Challenge 2019
> Source: [4TU.ResearchData](https://data.4tu.nl/articles/dataset/BPI_Challenge_2019/12715853)
> License: [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
> Citation: van Dongen, B.F. (2019). BPI Challenge 2019. 4TU.ResearchData. https://doi.org/10.4121/uuid:d06aff4b-79f0-45e6-8ec8-e19730c248f1

## Executive Summary

This analysis examines the BPI Challenge 2019 dataset, which contains purchase order handling data from a large multinational coatings and paints company's SAP ERP system. The dataset covers the Purchase-to-Pay (P2P) process from January 2018 to January 2019.

### Key Metrics

| Metric | Value |
|--------|-------|
| Total Purchase Order Items (Traces) | 251,734 |
| Total Events | 1,595,923 |
| Unique Activities | 42 |
| Unique Resources (Users/Systems) | 628 |
| Average Events per Trace | 6.3 |

---

## 1. Activity Frequency Distribution

The following table shows how often each activity occurs in the process:

| Activity | Count | Percentage |
|----------|-------|------------|
| Record Goods Receipt | 314,097 | 19.7% |
| Create Purchase Order Item | 251,734 | 15.8% |
| Record Invoice Receipt | 228,760 | 14.3% |
| Vendor creates invoice | 219,919 | 13.8% |
| Clear Invoice | 194,393 | 12.2% |
| SRM: Created | 74,140 | 4.6% |
| Change Price | 53,119 | 3.3% |
| Remove Payment Block | 57,136 | 3.6% |
| SRM: Complete | 44,963 | 2.8% |
| SRM: Awaiting Approval | 37,685 | 2.4% |

### Activity Analysis

The most frequent activities reveal the core P2P process:

1. **Record Goods Receipt** (314,097 events) - The most common activity, indicating goods being received
2. **Create Purchase Order Item** (251,734 events) - Every trace has exactly one (this is the case identifier)
3. **Record Invoice Receipt** (228,760 events) - Invoice processing
4. **Vendor creates invoice** (219,919 events) - Invoice receipt from vendors
5. **Clear Invoice** (194,393 events) - Payment processing

---

## 2. Process Variants (Common Paths)

Process variants represent the different paths cases take through the process.

| Rank | Variant Path | Cases | % of Total |
|------|--------------|-------|------------|
| 1 | Create PO Item → Vendor creates invoice → Record Goods Receipt → Record Invoice Receipt → Clear Invoice | 50,286 | 20.0% |
| 2 | Create PO Item → Record Goods Receipt → Vendor creates invoice → Record Invoice Receipt → Clear Invoice | 30,798 | 12.2% |
| 3 | Create PO Item → Record Goods Receipt | 9,443 | 3.8% |
| 4 | Create PO Item → Vendor creates invoice → Record Goods Receipt → Record Invoice Receipt → Remove Payment Block → Clear Invoice | 6,931 | 2.8% |
| 5 | Create PO Item | 2,835 | 1.1% |

### Variant Analysis Insights

- **Top 2 variants cover 32%** of all cases - showing the classic "invoice before vs after goods receipt" split
- **Variant 3** (PO → GR only) represents incomplete cases or ongoing orders
- **Variant 5** (PO only) shows 2,835 cases that never progressed past creation
- High variant count indicates significant process variability

---

## 3. Throughput Times

Throughput time measures how long it takes for a purchase order to complete from first to last event.

| Metric | Hours | Days |
|--------|-------|------|
| Minimum | 0.0 | 0.0 |
| Maximum | 616,068 | 25,670 |
| Average | 1,735 | 72.3 |
| **Median** | **1,543** | **64.3** |

**Notes:**
- The median (64 days) is more reliable than average due to extreme outliers
- Maximum values indicate data quality issues (open/incomplete cases from years prior)
- Fast cases (< 1 day) likely represent automated or simplified workflows

---

## 4. Resource Workload Distribution

The following shows which resources (users/systems) handle the most events:

| Resource | Events | % of Total |
|----------|--------|------------|
| (None/System) | 399,030 | 25.0% |
| user_002 | 166,353 | 10.4% |
| user_001 | 95,338 | 6.0% |
| batch_001 | 74,140 | 4.6% |
| user_016 | 55,298 | 3.5% |
| user_015 | 54,691 | 3.4% |
| user_003 | 47,880 | 3.0% |
| user_009 | 43,780 | 2.7% |
| batch_002 | 37,685 | 2.4% |
| user_005 | 33,855 | 2.1% |

### Resource Analysis

- **25% of events have no assigned resource** - system-automated activities
- **user_002 handles 10.4%** of all events - potential bottleneck or key processor
- **batch_* resources** indicate automated/scheduled processes
- Workload is concentrated among top 10 resources (60%+ of events)

---

## 5. Document Types

| Document Type | Count | Percentage |
|---------------|-------|------------|
| Standard PO | 152,562 | 60.6% |
| Framework Order | 62,543 | 24.9% |
| Consignment | 36,629 | 14.6% |

---

## 6. Item Categories (Matching Types)

The matching type determines how invoice verification is performed:

| Category | Count | Percentage |
|----------|-------|------------|
| 3-way match, invoice after GR | 164,874 | 65.5% |
| 3-way match, invoice before GR | 67,583 | 26.9% |
| 2-way match | 19,277 | 7.7% |

### Matching Type Explanation

- **3-way match, invoice after GR**: Invoice must match PO and goods receipt (most common, most controlled)
- **3-way match, invoice before GR**: Invoice arrives before goods (requires follow-up verification)
- **2-way match**: Only PO and invoice comparison needed (for services/non-physical items)

---

## 7. Main Process Flow: Purchase-to-Pay

Based on the analysis, the typical P2P process flow is:

```
[SRM: Created] → [SRM: Complete] → [SRM: Awaiting Approval]
                                          |
                                          v
[Create Purchase Requisition Item] → [Create Purchase Order Item]
                                          |
                                          v
             [Receive Order Confirmation] (from vendor)
                                          |
                                          v
                   [Record Goods Receipt] (physical receipt)
                                          |
                                          v
             [Vendor Creates Invoice] → [Record Invoice Receipt]
                                          |
                                          v
             [Clear Invoice] (payment made)
```

### Key Process Steps

1. **Requisition Phase**: Request originates in SRM system, goes through approval
2. **Order Phase**: Purchase order created and sent to vendor
3. **Confirmation Phase**: Vendor confirms order
4. **Receipt Phase**: Goods physically received and recorded
5. **Invoice Phase**: Vendor submits invoice, company records it
6. **Payment Phase**: Invoice cleared (payment processed)

---

## 8. Patterns and Anomalies

### Observed Patterns

1. **High Automation**: Many activities performed by batch/system users
2. **SRM Integration**: Many orders start in Supplier Relationship Management system
3. **Variable Complexity**: Order complexity varies from 1 to 100+ events per case

### Anomalies and Issues Identified

| Issue | Count | Impact |
|-------|-------|--------|
| Single-event cases (PO only) | 2,835 | Incomplete or cancelled orders |
| Deleted orders | 5,298 | Cancelled after creation |
| Quantity changes | 21,449 | Order modifications required |
| Price changes | 12,423 | Contract/pricing issues |
| Payment blocks | 57,136 | Required manual intervention |

### Throughput Time Variability

The huge range between minimum and maximum throughput times suggests:
- Different process paths for different order types
- Potential delays/bottlenecks in some cases
- Seasonal or resource-based delays
- Data quality issues with unclosed cases

---

## 9. Recommendations for Process Improvement

Based on this analysis:

1. **Reduce Order Changes**: Investigate root causes of frequent price/quantity changes
2. **Optimize Approval Workflows**: Review approval bottlenecks in SRM
3. **Improve First-Time-Right**: Reduce need for cancellations and corrections
4. **Balance Workload**: Ensure even distribution across resources (user_002 overloaded)
5. **Address Payment Blocks**: 57,136 cases required payment block removal - automate where possible

---

## Tools Used

This analysis was performed using the SAP Workflow Mining MCP server tools:
- Event log parsing (XES format)
- Process discovery (directly-follows graphs)
- Conformance checking
- Resource analysis

---

*Analysis performed: January 2025*
*Dataset: BPI Challenge 2019 (CC BY 4.0)*
