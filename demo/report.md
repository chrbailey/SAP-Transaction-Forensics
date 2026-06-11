# SFDC Forensic Analysis Report

_Generated: 2026-06-11 06:21:34_

_Data directory: `/home/user/SAP-Transaction-Forensics/synthetic-data/sfdc_output`_

---

## 1. Dataset Summary

| Entity | Count |
|--------|-------|
| Opportunities | 214 |
| Accounts | 50 |
| Stage histories | 1162 |
| Activities | 1255 |
| Line items | 495 |
| SAP orders | 33 |
| Event log records | 2417 |

**Opportunity types:**
- New Business: 138
- Renewal: 55
- Upsell: 21

---

## 2. Win Rate & Deal Metrics

| Metric | Value |
|--------|-------|
| Total opportunities | 214 |
| Closed Won | 63 |
| Closed Lost | 51 |
| Open (not closed) | 100 |
| Win rate (of closed) | 55.3% |
| Avg deal size (Closed Won) | $261,857 |
| Median close time (days) | 74 |

---

## 3. Conformance Analysis — New Business Pipeline

Model: `sfdc_new_business` | Cases analyzed: 131

| Metric | Value |
|--------|-------|
| Total cases | 131 |
| Conformant (no critical deviations) | 131 (100.0%) |
| Fully conformant (zero deviations) | 28 (21.4%) |
| Average fitness score | 0.6912 |
| Min fitness | 0.0500 |
| Max fitness | 1.0000 |
| Total deviations | 271 |

**Deviation types:**
- `missing_activity`: 222
- `skipped_activity`: 25
- `wrong_order`: 22
- `duplicate_activity`: 2

**Deviation severity breakdown:**
- major: 269
- minor: 2

---

## 4. Pattern Detection

Flags set on SFDC opportunities (total flagged opps: 97):

| Pattern Flag | Opp Count | Description |
|-------------|-----------|-------------|
| `QUARTER_END_COMPRESSION` | 32 | Close dates clustered at quarter-end (pipeline gaming) |
| `SPLIT_DEAL` | 28 | Deal split across multiple opportunities to stay under approval thresholds |
| `STALE_PIPELINE` | 15 | Opportunity age far exceeds expected sales cycle |
| `AMOUNT_INFLATION` | 14 | Deal amount inflated relative to account history |
| `GHOST_PIPELINE` | 10 | No activity logged after initial creation (abandoned opportunity) |
| `SPEED_ANOMALY` | 8 | Stage progression far faster or slower than baseline |
| `STAGE_SKIP` | 3 | One or more mandatory pipeline stages skipped |
| `STAGE_REGRESSION` | 3 | Stage moved backward (e.g., from Proposal back to Prospecting) |
| `CROSS_SYSTEM_GAP` | 2 | Large timing gap between SFDC close and SAP order creation |
| `OWNER_SWAP_AT_CLOSE` | 2 | Owner changed within final stage before close |

**SAP-level flags:**
- `CROSS_SYSTEM_GAP`: 2 orders

---

## 5. Cross-System Correlation (SFDC ↔ SAP)

| Metric | Value |
|--------|-------|
| Total SFDC opportunities | 214 |
| Total SAP orders | 33 |
| Matched pairs | 33 |
| Unmatched SFDC opps | 181 |
| Unmatched SAP orders | 0 |
| Match rate | 15.4% |
| Avg timing gap (days) | 9.7 |

**Cross-system anomalies detected: 2**

| Anomaly Type | Count | High Severity | Medium Severity |
|-------------|-------|---------------|-----------------|
| `timing_gap` | 2 | 2 | 0 |
| `amount_discrepancy` | 0 | 0 | 0 |
| `sequence_violation` | 0 | 0 | 0 |
| `missing_handoff` | 0 | 0 | 0 |

**Sample anomaly evidence (up to 5):**
- [HIGH] `timing_gap` — Gap of 84 days between SFDC close (2024-06-28) and SAP erdat (2024-09-20)
- [HIGH] `timing_gap` — Gap of 79 days between SFDC close (2025-09-02) and SAP erdat (2025-11-20)

---

## 6. Stage Distribution

| Stage | Count | % of Total |
|-------|-------|------------|
| Closed Won | 63 | 29.4% |
| Closed Lost | 51 | 23.8% |
| Perception Analysis | 28 | 13.1% |
| Negotiation/Review | 21 | 9.8% |
| Proposal | 20 | 9.3% |
| Proposal/Price Quote | 17 | 7.9% |
| Qualification | 10 | 4.7% |
| Discovery | 2 | 0.9% |
| Negotiation | 2 | 0.9% |

---

## 7. Quarter-End Close Date Analysis

Based on 114 closed opportunities with valid close dates.

| Month | Count | % of Closed |
|-------|-------|-------------|
| January | 2 | 1.8% |
| February | 2 | 1.8% |
| March **[QTR END]** | 11 | 9.6% |
| April | 6 | 5.3% |
| May | 8 | 7.0% |
| June **[QTR END]** | 18 | 15.8% |
| July | 5 | 4.4% |
| August | 11 | 9.6% |
| September **[QTR END]** | 16 | 14.0% |
| October | 8 | 7.0% |
| November | 7 | 6.1% |
| December **[QTR END]** | 20 | 17.5% |

**Quarter-end months (Mar/Jun/Sep/Dec):** 65 of 114 closed opps (57.0%) closed in a quarter-end month.
Expected baseline if uniform: ~33%

> **Finding**: Quarter-end concentration (57.0%) is 1.7x the expected baseline — consistent with pipeline compression / sandbagging behavior.

---

## 8. Key Findings Summary

- **Dominant pattern flag**: `QUARTER_END_COMPRESSION` detected on 32 opportunities (15.0% of all opps).

- **Cross-system risk**: 2 high-severity anomalies between SFDC and SAP across 33 matched pairs.

- **Low SAP coverage**: Only 15.4% of SFDC opportunities have a linked SAP order — 181 opps have no SAP record.

- **Win rate**: 55.3% on closed opportunities. Average deal size for Closed Won: $261,857. Median cycle: 74 days.

---

_End of report._
