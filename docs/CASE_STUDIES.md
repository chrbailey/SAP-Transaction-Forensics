# Field Case Studies

Three real consulting engagements, anonymized. **Company names, individual names,
and email addresses have been removed. Financial figures, ticket counts, record
counts, and category distributions are actual.** Used with permission for
educational purposes.

These engagements predate this open-source tool — they are the field experience
that motivated it. The patterns each case surfaced (license waste, organizational
stress, control-bypass) are the same classes of finding the detectors in this
repository are built to catch.

> **The thesis:** Structured data tells you *what happened*. Unstructured text
> tells you *why*. Every enterprise system generates both — timestamps, amounts,
> stage changes, user IDs on one side; emails, Slack threads, tickets, notes, SOWs
> on the other. The gap between them is where fraud, waste, and dysfunction hide.

---

## Case 1 — Healthcare Company: NetSuite License Optimization

**Engagement:** ERP user license audit
**Environment:** 289-user NetSuite

Automated license classification found **$103,896 in annual savings** — a **14.4×
ROI** with a **0.8-month payback period**.

| Metric | Value |
|---|---|
| Total users | 289 |
| Eliminable licenses | 69 |
| Annual savings identified | $103,896 |
| Payback period | 0.8 months |

**Savings by category**

| Category | Annual savings |
|---|---|
| Dormant full-access (8 users, no login 90+ days) | $46,464 |
| Departed-employee Center licenses (est. 53) | $31,800 |
| Approval-only users (4, replaceable with SuiteFlow) | $23,232 |
| Deprecated integrations (est. 4 of 8) | $2,400 |

**Structured data vs. what we found**

- **Structured:** the NetSuite user list shows 289 active users with assigned roles. Looks clean.
- **Unstructured signals:** login timestamps reveal 8 full-access users ($5,808/yr each) with no login in 90+ days. Cross-referencing HR termination dates shows ~53 Employee Center licenses still consumed by departed employees. 4 users' entire activity is clicking "Approve" on purchase orders — replaceable by a no-cost email workflow.
- **The gap:** $103,896/year in waste invisible to anyone reading the user list alone.

---

## Case 2 — MedTech Manufacturer: Help-Desk Ticket Forensics During Acquisition

**Engagement:** NetSuite implementation + post-acquisition support
**Context:** a diagnostics manufacturer acquired by a Fortune 500. Structured data
showed normal operations. **2,525 help-desk tickets told a different story.**

| Metric | Value |
|---|---|
| Help-desk tickets | 2,525 |
| Categories | 11 |
| Uncategorized | 38% |
| ERP users | 3,992 |
| Inventory items | 1,423 |

**Ticket category distribution:** Uncategorized 956 · Finance 469 · Access 257 ·
Procurement 215 · Inventory 119 · Manufacturing 107 · Warehouse 103 ·
Cost Accounting 84 · Quality 77 · Order Mgmt 66.

**What the ticket text revealed (real tickets):**

- **Data integrity —** *"How did 20413 turn into 20433?"* The inventory team can't explain an item-number mutation. Both items exist in structured data; the ticket reveals someone doesn't trust the data — and is right to.
- **System workarounds —** *"Explore creating dummy transactions for MRP."* Manufacturing is fabricating transactions to work around MRP limits. Structured data records them as real; auditors would never know.
- **Escalation culture —** repeated *"URGENT"* tickets for routine vendor payments. Payments posted on time, so the stress is invisible in transaction data.
- **Acquisition chaos —** 257 *"Request for NetSuite Access"* tickets (10% of all tickets), many from the acquiring company's domains. IT is drowning in onboarding.

**The contrast:** ERP data showed 3,992 employees, 1,044 active customers, 1,423
items, 307 BOMs, 465 GL accounts, 5,035 bin locations — *status: operational*.
The ticket text showed dummy transactions, mutating item numbers, an overwhelmed
team (38% uncategorized), and an "URGENT" escalation culture.

---

## Case 3 — Connected Hardware Manufacturer: High-Growth ERP Forensics

**Engagement:** ERP migration assessment + ITGC audit + international expansion (multi-year)
**Context:** a high-growth hardware manufacturer scaling rapidly, migrating
legacy → enterprise ERP. **3M+ ERP records** analyzed alongside ITGC audit
findings and process documentation.

| Metric | Value |
|---|---|
| CSV rows analyzed | 3M+ |
| Sales orders | 102K |
| RMA returns | 97K |
| Vendors | 43K |
| Customers | 10K |
| RMA rate | 28.6% |

**Data sources:** master data (10K customers, 43K vendors, 8.7K fixed assets, 5K
contacts); transaction data (102K sales orders, 1M+ EDI lines, 97K RMAs, 164K
credit memos); governance/text (ITGC audit, SOD analysis, 7,610 deductions, call notes).

**Forensic findings:**

- **ITGC violations (external audit):** 7 users with Administrator role; a terminated employee still active. 153 active users across 40 roles, with SOD violations at both role and user level. 4 generic shared accounts, no formalized change-management policy, admin access to both dev and prod, no post-implementation review — critical gaps for a publicly traded company.
- **Credit-hold overrides:** sales-order headers carry both a "Customer On Credit Hold" flag and a "Shipment Hold Released by Finance" field. Cross-referencing reveals orders shipped to customers already flagged for credit risk. The structured status says "shipped"; the override field says it shouldn't have been.
- **Return-rate anomaly:** of 1,090 customer accounts, 312 had at least one RMA event (**28.62%**), with only 67.5% on-time delivery. 97K RMA line items across 6 types (Open Box, Closed Box, Destroyed in Field, Stock Rotation, Warranty, Error Shipment) — reason codes hint at systemic quality/logistics failures the structured data can't explain.
- **Approval-chain complexity:** 7,610 customer deductions routed through "Next Approver" and "Set Rerouted Next Approver" chains. The rerouting field exists *specifically because the normal approval chain fails regularly.*

**The contrast:** ERP data said 102K orders processed, 97K returns authorized, 43K
vendors, orders shipped/invoiced/cleared, international entities operational —
*status: functioning*. The governance + text layer revealed credit holds overridden
to ship anyway, a 28.6% return rate signaling systemic issues, 7 admin users (SOX
risk for a public company), a terminated employee still in the system, and approval
chains so broken a "reroute" field had to exist.

---

## Why this matters for the tool

Each case is a real instance of a detector class shipped in this repo:

| Field finding | Maps to detector |
|---|---|
| Dormant / departed-employee licenses | access & lifecycle anomalies |
| Dummy transactions for MRP | fabricated-transaction / reality-gap detection |
| Credit-hold overrides | `POLICY_OVERRIDE` / `APPROVAL_BYPASS` contradiction types |
| Terminated employee still active; 7 admins | `SOD_VIOLATION`, segregation-of-duties analysis |
| PO created before PR | `TEMPORAL_IMPOSSIBILITY` / retroactive-documentation |
| Reroute-because-chain-fails | conformance deviation vs. reference process model |

The synthetic demo in [`demo/`](../demo/) plants these same pattern classes into
generated data so anyone can see the detectors fire — with zero access to a real
SAP or NetSuite system.
