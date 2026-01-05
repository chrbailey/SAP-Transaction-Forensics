# Procure-to-Pay (P2P) Process Mining Analysis

> **Data Attribution**
> Dataset: SAP IDES Demo System Event Log
> Source: [sap-extractor](https://github.com/Agnesvgr96/sap-extractor)
> License: MIT
> Extracted from: EKKO (Purchase Orders), EKPO (PO Items), BKPF/BSEG (Accounting)

## Executive Summary

This report presents a comprehensive process mining analysis of the Procure-to-Pay (P2P) event log extracted from SAP IDES demo system data. The analysis reveals process patterns, **compliance issues**, and resource utilization insights.

### Key Findings at a Glance

| Metric | Value |
|--------|-------|
| Total Cases | 2,486 |
| Total Events | 7,420 |
| Unique Activities | 20 |
| Unique Resources | 45 |
| Average Events per Case | 2.98 |
| Process Variants | 142 |
| **Compliance Issues** | **7** |

---

## 1. Basic Statistics

### Dataset Overview

- **Number of cases**: 2,486
- **Number of events**: 7,420
- **Number of unique activities**: 20
- **Number of unique resources**: 45
- **Average events per case**: 2.98
- **Date range**: 1996-07-04 to 1999-10-27
- **Time span**: 1,210 days

### Activity Distribution

| Activity | Count | Percentage |
|----------|-------|------------|
| Vendor Invoice | 1,526 | 20.6% |
| G/L Account Document | 1,176 | 15.8% |
| Accounting Document | 1,124 | 15.1% |
| Goods Receipt | 528 | 7.1% |
| Invoice Receipt | 493 | 6.6% |
| Credit Memo | 462 | 6.2% |
| Process RV | 356 | 4.8% |
| Create Purchase Requisition | 234 | 3.2% |
| Goods Issue | 291 | 3.9% |
| Other activities | 1,230 | 16.6% |

### Resource Distribution (Top 10)

| Resource | Events | Percentage |
|----------|--------|------------|
| TRFC * TRIAL | 1,410 | 19.0% |
| SAPUSER * TRIAL | 948 | 12.8% |
| HAWA * TRIAL | 529 | 7.1% |
| VERR * TRIAL | 493 | 6.6% |
| UNBW * TRIAL | 462 | 6.2% |
| WE01 * TRIAL | 316 | 4.3% |
| WE06 * TRIAL | 212 | 2.9% |
| BANS * TRIAL | 234 | 3.2% |
| WA01 * TRIAL | 215 | 2.9% |
| WA06 * TRIAL | 76 | 1.0% |

---

## 2. Temporal Analysis

### Case Duration Statistics

| Metric | Value (days) |
|--------|--------------|
| Average | 45.2 |
| Median | 0.0 |
| Minimum | 0.0 |
| Maximum | 1,027.0 |
| Standard Deviation | 142.3 |

### Events per Case Statistics

| Metric | Value |
|--------|-------|
| Average | 3.0 |
| Median | 2.0 |
| Minimum | 1 |
| Maximum | 2,181 |

---

## 3. Process Flow Discovery

### Start Activities

| Activity | Count | Percentage |
|----------|-------|------------|
| G/L Account Document | 813 | 32.7% |
| Goods Issue | 291 | 11.7% |
| Create Purchase Requisition | 234 | 9.4% |
| Goods Receipt | 212 | 8.5% |
| Invoice Receipt | 181 | 7.3% |

### End Activities

| Activity | Count | Percentage |
|----------|-------|------------|
| G/L Account Document | 812 | 32.6% |
| Goods Issue | 291 | 11.7% |
| Create Purchase Requisition | 234 | 9.4% |
| Goods Receipt | 212 | 8.5% |
| Invoice Receipt | 181 | 7.3% |

### Activity Transitions (Top 15)

| From Activity | To Activity | Count |
|---------------|-------------|-------|
| Vendor Invoice | Vendor Invoice | 1,410 |
| Accounting Document | Accounting Document | 948 |
| G/L Account Document | G/L Account Document | 247 |
| Goods Receipt | Invoice Receipt | 200 |
| Process RV | Process RV | 195 |
| Credit Memo | Credit Memo | 168 |
| Process WA | Process WA | 141 |
| Invoice Receipt | Vendor Invoice | 114 |
| Goods Receipt | Vendor Invoice | 109 |
| Create Purchase Requisition | Create Purchase Order | 6 |

---

## 4. Process Variants

### Variant Analysis

- **Total unique variants**: 142
- **Top 10 variants coverage**: 84.0% of all cases

### Top 10 Process Variants

| Rank | Variant | Cases | % |
|------|---------|-------|---|
| 1 | G/L Account Document | 812 | 32.7% |
| 2 | Goods Issue | 291 | 11.7% |
| 3 | Create Purchase Requisition | 234 | 9.4% |
| 4 | Goods Receipt | 212 | 8.5% |
| 5 | Invoice Receipt | 181 | 7.3% |
| 6 | Goods Receipt → Invoice Receipt | 116 | 4.7% |
| 7 | Process WE → Goods Receipt | 104 | 4.2% |
| 8 | Goods Receipt → Invoice Receipt → Vendor Invoice | 77 | 3.1% |
| 9 | Accounting Document | 55 | 2.2% |
| 10 | Credit Memo | 12 | 0.5% |

---

## 5. Compliance and Anomaly Detection

### Expected P2P Process Flow

The standard Procure-to-Pay process should follow this sequence:

1. Create Purchase Requisition
2. Create Purchase Order
3. Record Goods Receipt
4. Record Invoice Receipt
5. Clear Invoice

### Compliance Issues Found

| Issue Type | Count | Description |
|------------|-------|-------------|
| MISSING_PR | 6 | Purchase Order without Purchase Requisition |
| PO_BEFORE_PR | 1 | Purchase Order created before Purchase Requisition |

**Total compliance issues**: 7 cases

### Issue Analysis

#### MISSING_PR (6 cases)
These cases have Purchase Orders created without an associated Purchase Requisition. This indicates:
- **Maverick buying**: Direct purchasing without proper approval workflow
- **Emergency orders**: Bypassing requisition for urgent needs
- **System configuration**: PO may be created directly in some processes

#### PO_BEFORE_PR (1 case)
One case shows a Purchase Order created before the Purchase Requisition. This is a clear process violation where:
- The approval workflow was bypassed
- Documentation was created retroactively

### Event Count Anomalies

- Cases with unusually few events (<1): 0
- Cases with unusually many events (>5): 369
- **One extreme outlier**: Case with 2,181 events (batch processing)

### Duplicate Sequential Activities

Consecutive duplicate activities indicate potential rework or batch processing:

| Activity | Consecutive Duplicates |
|----------|------------------------|
| Vendor Invoice | 1,410 |
| Accounting Document | 948 |
| G/L Account Document | 247 |
| Process RV | 195 |
| Credit Memo | 168 |
| Process WA | 141 |

---

## 6. Resource Analysis

### Resource Versatility

| Number of Activities | Resources |
|---------------------|----------|
| 1 activity | 36 |
| 2 activities | 2 |
| 3 activities | 2 |
| 4 activities | 3 |
| 5+ activities | 2 |

Most resources (36 out of 45) perform only one type of activity, indicating specialized roles.

### Segregation of Duties Analysis

**Cases where the same resource creates both PR and PO**: 1

This is a potential control weakness as it allows a single person to both request and approve purchases.

---

## 7. Document Types

### Document Type Distribution

| Document Type | Count | Percentage |
|---------------|-------|------------|
| BKPF (Accounting Document) | 7,058 | 95.1% |
| EBAN (Purchase Requisition) | 351 | 4.7% |
| EKKO (Purchase Order) | 11 | 0.1% |

### Activity-Document Type Mapping

| Activity | Document Type | Count |
|----------|---------------|-------|
| Create Purchase Requisition | EBAN | 234 |
| Create Purchase Order | EKKO | 5 |
| Change Purchase Order | EKKO | 6 |
| All others | BKPF | 7,175 |

---

## 8. Recommendations

Based on this process mining analysis:

### Process Compliance

1. **Enforce PR-before-PO Rule**: Implement system controls to ensure Purchase Requisitions are always created and approved before Purchase Orders are generated.

2. **Three-Way Matching**: Ensure proper sequence of Goods Receipt and Invoice Receipt to enable three-way matching (PO, GR, Invoice).

3. **Reduce Process Violations**: Investigate the 7 compliance issues identified and implement preventive controls.

### Process Efficiency

1. **Reduce Variants**: With 142 unique process variants, consider standardizing the process to reduce complexity.

2. **Address Rework**: The duplicate sequential activities indicate potential rework; investigate root causes.

3. **Optimize Long-Running Cases**: Cases taking up to 1,027 days should be analyzed for bottlenecks.

### Resource Management

1. **Segregation of Duties**: Review the 1 case where the same resource creates both PR and PO to ensure proper controls.

2. **Workload Distribution**: Some resources handle significantly more events than others; consider load balancing.

---

## 9. Data Quality Notes

- The dataset contains 7,420 events across 2,486 cases
- Date range spans from 1996-07-04 to 1999-10-27
- Some resource fields contain trial/placeholder values (marked as "* TRIAL")
- This is demo system data suitable for tool validation

---

## Tools Used

This analysis was performed using:
- SAP Workflow Mining MCP server
- Python pandas for event log processing
- Compliance checking against expected P2P flow
- Resource analysis and segregation of duties detection

---

*Analysis performed: January 2025*
*Dataset: SAP IDES via sap-extractor (MIT License)*
