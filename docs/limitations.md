# Transaction Forensics - Limitations and Caveats

> **Read this before trusting any output from this tool.**

This document catalogs known limitations. If you encounter outputs that seem too good to be true, they probably are. Patterns are hypotheses, not conclusions.

---

## 1. Statistical Limitations

### 1.1 Correlation Does Not Imply Causation

**What this means**: Just because two things appear together does not mean one causes the other.

**Example**:
- Pattern found: Orders with "RUSH" text have 40% faster delivery times
- Possible interpretations:
  - "RUSH" causes faster handling (maybe)
  - Faster orders get labeled "RUSH" retroactively (reverse causation)
  - Both "RUSH" and fast delivery are caused by VIP customers (confound)
  - Random chance in small sample (noise)

**What to do**:
- Treat all patterns as hypotheses for further investigation
- Design controlled experiments to test causal claims
- Look for confounders before acting

### 1.2 Sampling Bias from Row Limits

**What this means**: When queries hit the 200-row limit, the returned sample may not represent the full population.

**How it manifests**:
- Early documents over-represented (if sorted by date ascending)
- High-volume customers over-represented (if sorted by customer)
- Patterns in the tail may be missed entirely

**Example**:
- Query returns 200 orders out of 50,000 total
- Pattern engine finds "EXPEDITE" in 15% of returned orders
- Actual rate in full population might be 5% (or 25%)

**What to do**:
- Check "truncated" flag in tool responses
- Note sample size on all statistics
- Consider multiple queries with different filters
- Use "sampling_note" in pattern cards seriously

### 1.3 Confidence Intervals Are Estimates

**What this means**: The 95% confidence interval is not a guarantee. It's a frequentist statement about long-run coverage, not a probability about this specific estimate.

**Common misinterpretations**:
- "There's a 95% chance the true value is in this range" (wrong)
- "This interval definitely contains the true value" (wrong)

**What to do**:
- Treat intervals as rough guides, not precise bounds
- Wider intervals = less certainty = more skepticism needed
- Bootstrap or Bayesian methods if precision matters

### 1.4 Multiple Comparisons Problem

**What this means**: When testing many hypotheses, some will appear significant by chance.

**Example**:
- Test 100 text patterns for correlation with delays
- At p < 0.05, expect ~5 false positives even if no real effects exist
- Pattern engine may report these as "discoveries"

**What to do**:
- Apply Bonferroni or FDR correction for multiple tests
- Be extra skeptical of marginal findings
- Require replication on held-out data

### 1.5 Effect Size vs. Statistical Significance

**What this means**: A statistically significant effect can be too small to matter, and vice versa.

**Example**:
- Pattern found: "HOLD" text associated with 0.3 day longer cycle time (p < 0.01)
- 0.3 days might be operationally meaningless
- Conversely, 5-day difference might not be "significant" in small sample

**What to do**:
- Always look at effect size, not just p-value
- Define "meaningful" thresholds before analysis
- Consider practical significance for business decisions

---

## 2. Data Limitations

### 2.1 Text May Be in Multiple Languages

**What this means**: SAP is used globally. Text fields contain multiple languages, often within the same system.

**How it manifests**:
- German abbreviations: "LT" (Liefertermin = delivery date)
- Spanish notes: "URGENTE" vs. "URGENT"
- Mixed: "RUSH per Herr Mueller"

**Impact on analysis**:
- Pattern clustering may split same concept by language
- Keyword searches miss non-English variants
- Embeddings may not work well across languages

**What to do**:
- Check language distribution in your data
- Consider language-specific analysis
- Use multilingual embeddings if available
- Note language assumptions in pattern cards

### 2.2 Abbreviations Vary by Organization

**What this means**: Every SAP customer develops their own abbreviations.

**Examples**:
| Abbreviation | Meaning at Company A | Meaning at Company B |
|--------------|---------------------|---------------------|
| CR | Credit Hold | Customer Request |
| EXP | Expedite | Export |
| BO | Backorder | Bill Only |
| PRI | Priority | Price |

**Impact on analysis**:
- Synthetic data abbreviations may not match your organization
- Patterns learned from one company may not transfer
- False matches on ambiguous abbreviations

**What to do**:
- Build organization-specific abbreviation dictionary
- Validate pattern meanings with domain experts
- Do not assume synthetic patterns apply to real data

### 2.3 Historical Data Quality Varies

**What this means**: Older data may have:
- Different field usage conventions
- Missing fields that were added later
- Inconsistent entry practices
- Legacy system migration artifacts

**Example**:
- Text notes were optional before 2020, now mandatory
- Analysis finds "no text" correlates with old documents
- This is not a meaningful business pattern

**What to do**:
- Filter by date range for consistent periods
- Check for structural changes in data over time
- Consult SAP changelog/upgrade history

### 2.4 Incomplete Document Flows Are Excluded

**What this means**: The tool typically analyzes complete flows (order -> delivery -> invoice). Incomplete flows are often excluded.

**What's missing**:
- Cancelled orders (no delivery created)
- Open orders (delivery pending)
- Partial deliveries without invoices yet
- Returns in progress

**Impact on analysis**:
- Survivorship bias: only "successful" transactions analyzed
- Patterns in failed/abandoned transactions invisible
- May miss early warning signals

**What to do**:
- Explicitly include cancelled/open documents if needed
- Note document status requirements in pattern cards
- Consider separate analysis for incomplete flows

### 2.5 Master Data Staleness

**What this means**: Customer and material attributes change over time. The current master data may not reflect status at transaction time.

**Example**:
- Customer was "GOLD" tier when order placed in 2022
- Now "PLATINUM" tier (upgraded in 2023)
- Analysis shows current tier, not historical

**Impact on analysis**:
- Tier-based analysis may be misleading
- Geographic/industry changes affect segmentation
- Organizational changes (mergers, splits) confuse entity tracking

**What to do**:
- Consider historical master data snapshots if available
- Note "as-of" date for master data attributes
- Be cautious with long historical ranges

---

## 3. Technical Limitations

### 3.1 No Financial (FI) Data in v0

**What this means**: Version 0 deliberately excludes financial accounting data.

**Why**: Financial data is highly sensitive (audit, compliance, fraud risk). Including it requires additional security review.

**What's missing**:
- BKPF/BSEG (accounting documents)
- Payment data
- Cost/margin data
- GL postings
- Intercompany data

**Impact on analysis**:
- Cannot correlate text patterns to financial outcomes
- No profitability analysis
- Limited to operational metrics (timing, volume)

**What to do**:
- Accept this limitation for now
- Use proxy metrics from SD data (net value, currency)
- File feature request if FI data essential

### 3.2 No HR/Payroll Data Ever

**What this means**: HR data will never be exposed through this tool.

**Why**: HR data has extreme privacy requirements (employment law, GDPR, discrimination risk). The risk/reward ratio is unacceptable.

**What's missing**:
- Employee names (except as text in notes)
- User-to-employee mapping
- Performance data
- Organizational assignments
- Compensation data

**Impact on analysis**:
- Cannot analyze by employee performance
- User IDs are opaque identifiers
- No workforce planning integration

**What to do**:
- This is a feature, not a bug
- Use aggregated user metrics only
- Do not attempt to identify individuals

### 3.3 Row Limits May Miss Patterns

**What this means**: 200-row limits on queries mean rare patterns may never appear in returned data.

**Example**:
- Pattern occurs in 0.1% of documents (100 out of 100,000)
- Random 200-row sample has ~20% chance of containing zero instances
- Pattern is invisible to analysis

**Impact on analysis**:
- Rare but important patterns may be missed
- "No pattern found" does not mean "no pattern exists"
- High-frequency patterns over-represented

**What to do**:
- Use targeted queries for suspected rare patterns
- Multiple sampling passes with different seeds
- Note detection limits in pattern cards

### 3.4 Clustering Is Approximate

**What this means**: Text clustering (grouping similar phrases) uses heuristics. It is not perfect.

**Failure modes**:
- Synonyms in different clusters ("RUSH", "URGENT", "EXPEDITE")
- Unrelated terms in same cluster (hash collision)
- Granularity mismatch (too coarse or too fine)

**Impact on analysis**:
- Pattern counts may be off
- Related patterns split into separate cards
- Noise patterns may contaminate signal

**What to do**:
- Review cluster contents, not just labels
- Merge/split clusters manually if needed
- Use different algorithms and compare

### 3.5 Embedding Model Dependency

**What this means**: If using neural embeddings (optional), results depend on the specific model.

**Implications**:
- Different models produce different clusters
- Model updates change results
- Models trained on general text, not SAP-specific

**What to do**:
- Pin embedding model version
- Compare with TF-IDF baseline
- Consider domain-specific fine-tuning

---

## 4. Interpretation Limitations

### 4.1 Patterns Are Hypotheses, Not Conclusions

**What this means**: Every pattern card is a starting point for investigation, not a finished answer.

**What patterns can tell you**:
- "This text appears frequently"
- "This text co-occurs with this outcome"
- "This effect size was observed in this sample"

**What patterns cannot tell you**:
- Why the pattern exists
- Whether it will persist
- What to do about it
- Whether your intervention will work

**What to do**:
- Use patterns to generate hypotheses
- Design experiments to test hypotheses
- Involve domain experts in interpretation

### 4.2 Local Context Matters

**What this means**: Patterns that hold globally may not hold locally, and vice versa.

**Example**:
- Global: "EXPEDITE" correlates with 30% faster delivery
- Plant 1000: "EXPEDITE" has no effect (already fast)
- Plant 2000: "EXPEDITE" correlates with 60% faster (was slow)
- Customer X: "EXPEDITE" correlates with delays (overused, ignored)

**What to do**:
- Analyze by segment (plant, customer tier, region)
- Look for interaction effects
- Do not assume global patterns apply everywhere

### 4.3 Seasonal Effects Not Modeled

**What this means**: Many business patterns are seasonal. The tool does not automatically account for this.

**Examples**:
- Year-end rush increases all expedite requests
- Summer vacation delays responses
- Q4 inventory push skews volumes

**Impact on analysis**:
- Patterns may be seasonal artifacts
- Comparing Dec to June is misleading
- Cyclical effects confuse trend detection

**What to do**:
- Compare same periods year-over-year
- Analyze by season/quarter explicitly
- Control for known cyclical effects

### 4.4 User Behavior Changes Over Time

**What this means**: How people use text fields evolves. What "RUSH" meant in 2020 may differ from 2024.

**Drivers of change**:
- Training and process changes
- System updates (new fields available)
- Personnel turnover
- Management emphasis shifts
- COVID/remote work changes

**Impact on analysis**:
- Historical patterns may not predict future
- Trend analysis may reflect behavior change, not outcomes
- "New" patterns may just be new language

**What to do**:
- Segment analysis by time period
- Interview users about behavior changes
- Be cautious extrapolating old patterns

### 4.5 Absence of Evidence Is Not Evidence of Absence

**What this means**: If the tool does not find a pattern, that does not prove the pattern does not exist.

**Why patterns might be missed**:
- Sampling did not include relevant documents
- Search terms did not match actual language
- Clustering grouped pattern with noise
- Effect size too small to detect
- Pattern is real but not in text fields

**What to do**:
- State findings as "not detected" rather than "not present"
- Try different search strategies
- Consider non-text data sources

---

## 5. Deployment Limitations

### 5.1 Not Tested on Production SAP

**What this means**: This tool has only been tested against synthetic data and development systems. Production SAP environments have not been tested.

**Unknown risks**:
- Performance impact at production scale
- Data volume handling
- Concurrency with production workload
- Edge cases in real data

**What to do**:
- Test on development system first
- Gradually increase scope
- Monitor SAP performance during tests
- Have rollback plan

### 5.2 Performance Impact Unknown

**What this means**: We do not know how this tool affects SAP system performance in your specific environment.

**Variables**:
- SAP system sizing
- Database platform
- Network latency
- Concurrent user load
- Index configuration

**What to do**:
- Baseline SAP performance before testing
- Run during off-peak hours initially
- Monitor ST05, SM50, SM21 during runs
- Coordinate with SAP Basis team

### 5.3 May Require SAP Basis Support

**What this means**: Deploying adapters may require help from your SAP Basis team.

**Typical needs**:
- RFC destination configuration
- Authorization object setup
- Service activation (OData)
- Network/firewall configuration
- Performance tuning
- Index creation

**What to do**:
- Engage Basis team early
- Provide documentation (this guide)
- Allow time for security review
- Plan for iterative authorization tuning

### 5.4 Not a Supported SAP Product

**What this means**: This tool is not developed, supported, or endorsed by SAP SE.

**Implications**:
- No SAP support tickets for this tool
- SAP may change APIs/tables without notice
- No guaranteed compatibility with future versions
- No SLA or warranty

**What to do**:
- Treat as experimental/research tool
- Plan for maintenance as SAP evolves
- Do not depend on for critical business processes
- Consider this a proof-of-concept

---

## Interpretation Guidance

Before acting on any pattern discovered by this tool, follow these guidelines:

### Always Verify Against Business Knowledge

1. **Does this pattern make sense?** If "FRAGILE" handling notes correlate with fewer damaged shipments, that makes intuitive sense. If they correlate with more, investigate further.

2. **Could there be a simpler explanation?** A pattern linking "EXPORT" notes to longer delivery times might just reflect that international shipping takes longer, not anything about the note itself.

3. **Who created this data?** Text entered by one team may have different meanings than the same text from another team.

### Check Sample Sizes

| Sample Size | Confidence Level | Action |
|-------------|------------------|--------|
| N < 10 | Very low | Treat as anecdote, not pattern |
| 10 <= N < 30 | Low | Interesting hypothesis, needs validation |
| 30 <= N < 100 | Medium | Worth investigating, check confounders |
| N >= 100 | Higher | More reliable, but still correlation only |

### Drill Into Evidence

For any pattern you plan to act on:

1. **Read the actual documents** - Do not just trust the aggregate statistics
2. **Sample randomly** - The "best" examples may be cherry-picked by clustering
3. **Look for counterexamples** - Documents with the pattern that do NOT show the expected outcome
4. **Check edge cases** - Boundary conditions often reveal problems

### Consider Alternative Explanations

For every pattern, ask:
- **Reverse causation?** Maybe the outcome causes the text, not vice versa
- **Common cause?** Maybe both pattern and outcome are caused by a third factor
- **Selection effect?** Maybe only certain documents have this text
- **Temporal change?** Maybe the relationship changed over time

### Document Your Decisions

If you act on a pattern, document:
- Why you believe it is valid
- What alternative explanations you considered
- What validation you performed
- What the expected outcome of your action is
- How you will measure success

---

## Summary Table

| Category | Limitation | Severity | Mitigation |
|----------|------------|----------|------------|
| Statistical | Correlation != causation | High | Experimental validation |
| Statistical | Sampling bias | Medium | Note truncation, multiple samples |
| Statistical | CI are estimates | Low | Use intervals as guides |
| Statistical | Multiple comparisons | Medium | FDR correction |
| Data | Multiple languages | Medium | Language-aware analysis |
| Data | Abbreviation variance | Medium | Organization dictionary |
| Data | Historical quality | Medium | Date filtering |
| Data | Incomplete flows | Medium | Explicit inclusion |
| Technical | No FI data | Medium | Accept limitation |
| Technical | No HR data | Low | By design |
| Technical | Row limits | Medium | Targeted queries |
| Technical | Clustering approximate | Medium | Manual review |
| Interpretation | Patterns are hypotheses | High | Expert validation |
| Interpretation | Local context | Medium | Segment analysis |
| Interpretation | Seasonality | Medium | Time controls |
| Deployment | Untested on production | High | Staged rollout |
| Deployment | Performance unknown | High | Monitoring, off-peak |
| Deployment | Not SAP supported | Medium | Accept risk |

---

## Updating This Document

This document should be updated when:
- New limitations are discovered
- Mitigations are implemented
- Deployment experience reveals new issues
- Users report interpretation problems

**Maintainer**: Pattern Engine team
**Last updated**: (date of creation)
