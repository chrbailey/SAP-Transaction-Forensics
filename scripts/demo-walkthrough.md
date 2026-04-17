# Demo Walkthrough — 5 Questions to Ask Claude Code

After `make demo` and opening Claude Code in the repo, paste these five prompts one at a time. Each exercises a different MCP tool. All tool names are verified against `mcp-server/src/tools/index.ts`.

---

## 1. Conformance check against the O2C reference model

> **Prompt:** Run a conformance check against the o2c-simple reference model and summarise deviations by severity.

**Expected tool call:**
```json
{
  "tool": "check_conformance",
  "arguments": {
    "reference_model": "o2c-simple",
    "include_deviations": true
  }
}
```

**Sample response shape:**
```
Conformance against o2c-simple (Order → Delivery → GI → Invoice):

  Conformance rate:  87.4%   (412 / 471 cases)
  Non-conforming:    59 cases

  By severity:
    CRITICAL   3    invoice posted before goods issue
    MAJOR     24    skipped delivery step
    MINOR     32    duplicate order created

  Top deviation types:
    skipped_step         27
    wrong_order           3
    unexpected_activity  18
    repeated_activity    11

Want me to list the 3 critical cases with doc numbers?
```

---

## 2. Segregation-of-duties violations

> **Prompt:** Find any segregation of duties violations in the synthetic FI data and rank them by risk.

**Expected tool call:**
```json
{
  "tool": "analyze_sod",
  "arguments": {
    "min_occurrences": 1,
    "include_low_risk": false,
    "max_results": 50
  }
}
```

**Sample response:**
```
Found 4 SoD conflicts above the low-risk threshold:

  1. POST_AND_REVERSE   severity: HIGH
     User USER07 posted and reversed 3 documents within 24h.
     Sample docs: 4900000042, 4900000058, 4900000071

  2. PARK_AND_POST      severity: HIGH
     User USER12 parked and posted the same document, bypassing review.
     Sample doc: 4900000089

  3. CREATE_AND_PAY     severity: MEDIUM
     User USER03 created vendor master (XK01) AND ran payment (F110).
     Vendor: 0000100234, Payment run: 20250915-001

  4. POST_AND_APPROVE   severity: MEDIUM
     User USER15 posted and approved 2 journal entries.
```

---

## 3. Journal-entry anomalies

> **Prompt:** Look for suspicious patterns in the journal entries — weekend postings, round amounts, backdating, anything that feels off.

**Expected tool call:**
```json
{
  "tool": "analyze_journal_entries",
  "arguments": {
    "round_amount_threshold": 1000,
    "backdate_days_threshold": 15,
    "approval_threshold": 50000,
    "include_low_severity": false,
    "max_results": 100
  }
}
```

**Sample response:**
```
Journal-entry forensic scan returned 23 anomalies:

  Weekend/holiday postings     14    (medium)
  Backdated entries > 15 days   3    (high)     ← flag for review
  Round amounts ≥ $10,000       4    (low, but cluster at period-end)
  Split-below-threshold         2    (high)     ← possible approval bypass

Highest-risk finding:
  Doc 4900000112 (company 1000, posted 2025-09-30)
  BUDAT 2025-09-15, CPUDT 2025-10-14 — 29-day backdate
  Amount: $47,800 (just below the $50k approval threshold)
  Entered by USER07 via TCODE FB01
```

---

## 4. Unified FI/CO assessment

> **Prompt:** Generate a full FI/CO assessment report in markdown — executive summary, every finding, and prioritised recommendations.

**Expected tool call:**
```json
{
  "tool": "generate_fi_assessment",
  "arguments": {
    "format": "markdown",
    "round_amount_threshold": 1000,
    "backdate_days_threshold": 15,
    "approval_threshold": 50000
  }
}
```

**Sample response excerpt:**
```markdown
# FI/CO Forensic Assessment — Company 1000, FY 2025

## Executive Summary
Overall risk: **MEDIUM-HIGH**
Documents analysed: 1,842 (BKPF headers)
Line items analysed: 4,917 (BSEG)
Total findings: 27  (3 high, 11 medium, 13 low)

## Journal Entry Anomalies
- 3 backdated entries > 15 days (doc 4900000112, 4900000067, 4900000201)
- 14 weekend postings, concentrated in period 09
- 2 split-below-threshold patterns (USER07)

## Segregation of Duties
- 2 post-and-reverse conflicts (HIGH)
- 1 park-and-post conflict (HIGH)
- 1 create-and-pay conflict (MEDIUM)

## GL Balance Analysis
- Suspense account 199999 shows $12,450 net balance (should be zero)
- 2 one-sided postings detected

## Recommendations (prioritised)
1. Investigate the 3 backdated entries — posted after period close
2. Reassign USER07 duties — pattern of split-below-threshold
3. Clear suspense account 199999 before fiscal year-end
```

---

## 5. Discover new forensic patterns (critic-loop)

> **Prompt:** Run pattern discovery on this data. Propose candidate patterns, validate them with the critic, and add confirmed patterns to the library.

This exercises the **learning layer** — a Worker/Critic/Ralph loop that goes beyond the hardcoded rules in tools 1-4 and proposes new patterns the built-in tools didn't look for.

**What happens:**
1. Worker examines transaction data + prior confirmed patterns, proposes candidates
2. Critic validates each candidate against supporting transaction IDs, rejects speculation
3. Ralph routes: confirmed → pattern library, rejected → negative examples, uncertain → human review

**Sample output:**
```
Pattern discovery run complete:
  Candidates proposed:  7
  Critic passed:        4
  Critic rejected:      2
  Uncertain (flagged):  1

Confirmed new patterns:
  1. "Round-trip close-before-open"
     Same opportunity closed Lost then re-created as new within 30 days
     Supporting ops: 12 instances

  2. "Stage-skip on high-value deals"
     Opportunities > $200k skipping Proposal stage → Negotiation
     Supporting ops: 5 instances

  3. "Weekend close date / weekday created"
     Close dates on Saturday/Sunday while created mid-week
     Supporting ops: 18 instances

  4. "Unassigned owner close"
     Owner_id = default system user (005...001) on closed-won opps
     Supporting ops: 7 instances
```

Run directly from the command line: `python3 pattern-discovery/demo_discovery.py`
