# Transaction Forensics - Threat Model

> **Assume breach. Assume misuse. Assume malfunction.**

This document catalogs known threats and mitigations for the Transaction Forensics system. It is not exhaustive. New threats should be added as discovered.

## Threat Categories

1. [Data Leakage Threats](#1-data-leakage-threats)
2. [Hallucination/Overreach Threats](#2-hallucinationoverreach-threats)
3. [Access Control Threats](#3-access-control-threats)
4. [Correlation Misuse Threats](#4-correlation-misuse-threats)
5. [Operational Risks](#5-operational-risks)

---

## 1. Data Leakage Threats

### 1.1 PII in Text Fields

**Threat**: SAP text fields frequently contain personally identifiable information (PII) that operators type in:
- Names: "John Smith called about this order"
- Email addresses: "Contact jane.doe@customer.com for scheduling"
- Phone numbers: "Customer callback: 555-123-4567"
- Addresses: Delivery instructions with specific locations

**Impact**: Privacy violations, regulatory non-compliance (GDPR, CCPA), reputational damage.

**Mitigations**:
| Control | Implementation | Residual Risk |
|---------|----------------|---------------|
| Redaction layer | Pattern matching + NER for names, emails, phones | May miss non-standard formats |
| Shareable mode default | Additional redaction enabled by default | Operators may disable |
| No raw text in logs | Audit logs capture metadata, not content | Log injection could bypass |
| Row limits | Max 200 rows limits blast radius | 200 records still a breach |

**Verification**: Test redaction with synthetic PII patterns. Run regex/NER against output to detect leakage.

### 1.2 Business-Sensitive Information

**Threat**: Text fields and documents contain competitively sensitive data:
- Pricing: "Special price $45.00 per unit approved"
- Customer names: Company names in partner data
- Volume discounts: Negotiated terms visible
- Margin information: Implicit from cost/price relationships

**Impact**: Competitive disadvantage, customer relationship damage, contract violations.

**Mitigations**:
| Control | Implementation | Residual Risk |
|---------|----------------|---------------|
| Shareable mode | Redacts prices, customer IDs in output | May miss calculated values |
| Master data stubs | Returns hashed IDs, not names | Hash collision (unlikely) |
| No FI data | v0 excludes financial tables entirely | Does not help SD pricing |
| Pattern aggregation | Reports patterns, not individual records | N=1 patterns leak data |

**Verification**: Review pattern cards for minimum N threshold. Audit shareable output for customer identifiability.

### 1.3 Aggregate Inference

**Threat**: Even with redaction, aggregate patterns may reveal sensitive information:
- "Customer X always expedites" (identifiable by pattern even if name redacted)
- "Plant Y has 3x more credit holds" (internal performance data)
- "Material Z has highest return rate" (product quality data)

**Impact**: Competitive intelligence leakage, internal performance exposure.

**Mitigations**:
| Control | Implementation | Residual Risk |
|---------|----------------|---------------|
| Minimum sample sizes | Require N >= 10 for pattern reporting | N=10 may still identify |
| Suppress rare patterns | Omit patterns with < threshold occurrences | Threshold selection is judgment |
| Review before sharing | Recommend manual review of shareable output | Human error |

**Verification**: Red team exercise: can you identify specific customers/plants from shareable output?

---

## 2. Hallucination/Overreach Threats

### 2.1 LLM Invents Patterns Not in Data

**Threat**: When an LLM interprets tool output, it may:
- See patterns that do not exist (pareidolia)
- Extrapolate beyond the data
- Confuse correlation with causation
- Generate plausible-sounding but false explanations

**Impact**: False conclusions drive bad business decisions, wasted investigation effort.

**Mitigations**:
| Control | Implementation | Residual Risk |
|---------|----------------|---------------|
| Tool-only facts | All claims must trace to tool responses | Model may still over-interpret |
| Evidence ledger | Every pattern links to specific documents | Ledger does not prove pattern |
| Explicit caveats | Mandatory uncertainty statements | Users may ignore caveats |
| Deterministic analysis | Pattern engine uses standard statistics | Statistics can still mislead |
| Prove-or-disprove culture | Documentation emphasizes skepticism | Culture is hard to enforce |

**Verification**:
- Run against synthetic data with known (planted) patterns
- Verify discovered patterns match planted patterns exactly
- Flag any "discovered" pattern that was not planted as a false positive

### 2.2 Overconfident Statistical Claims

**Threat**: Pattern engine produces statistics that appear more certain than warranted:
- Small sample sizes with narrow confidence intervals
- Multiple hypothesis testing without correction
- Selection bias in which documents were queried

**Impact**: Users trust findings that are not statistically reliable.

**Mitigations**:
| Control | Implementation | Residual Risk |
|---------|----------------|---------------|
| Confidence intervals | All statistics include CI | CI can still be too narrow |
| Sample size display | Prominent N on every pattern | Users may not understand |
| Bonferroni/FDR correction | Apply when testing multiple hypotheses | May be too conservative |
| Sampling notes | Indicate if row limits caused sampling | Does not fix the bias |

**Verification**: Bootstrap analysis - does the pattern replicate on different samples?

### 2.3 Model Updates Change Results

**Threat**: Different versions of the pattern engine (or underlying ML models) produce different results on the same data, leading to:
- Non-reproducible findings
- False confidence in results that were model-specific
- Confusion when re-running analysis

**Impact**: Loss of trust in system, inability to reproduce findings for audit.

**Mitigations**:
| Control | Implementation | Residual Risk |
|---------|----------------|---------------|
| Version pinning | Lock dependencies in requirements | May miss security updates |
| Seed specification | Deterministic random seeds | Some ops not seed-controlled |
| Artifact versioning | Tag output with code version | Does not make it reproducible |
| Model-free baseline | TF-IDF fallback, no neural models | Less capable |

**Verification**: Run same analysis twice, compare outputs byte-for-byte.

---

## 3. Access Control Threats

### 3.1 Unauthorized SAP Access

**Threat**: Attacker uses the MCP server to access SAP data they should not see:
- MCP server credentials have broader access than needed
- Attacker compromises MCP server
- Insider misuses legitimate access

**Impact**: Unauthorized data access, exfiltration, compliance violations.

**Mitigations**:
| Control | Implementation | Residual Risk |
|---------|----------------|---------------|
| Read-only adapters | No write APIs exposed | Does not prevent read abuse |
| No raw SQL | Tools are domain-specific, not generic queries | Determined attacker works around |
| Row limits | Max 200 per request | 200 * many requests = full table |
| Rate limiting | Throttle requests at adapter layer | Does not prevent slow exfil |
| Audit logging | Log every request with user context | Reactive, not preventive |
| Minimum authorization | Request only needed SAP auth objects | Misconfiguration risk |

**Verification**:
- Attempt to read unauthorized data through MCP tools
- Review SAP authorization trace after test queries
- Audit log review: are access patterns suspicious?

### 3.2 Credential Exposure

**Threat**: SAP credentials for RFC/OData adapters are exposed:
- Hardcoded in configuration files
- Logged accidentally
- Stored in version control
- Visible in process memory

**Impact**: Full SAP access compromise, lateral movement.

**Mitigations**:
| Control | Implementation | Residual Risk |
|---------|----------------|---------------|
| Environment variables | Credentials not in code | Env vars visible to process |
| Secret managers | Integration with vault/KMS | Added complexity, availability |
| Credential rotation | Regular password changes | Window of exposure |
| No logging of credentials | Sanitize before logging | Log injection bypass |

**Verification**:
- Grep codebase for hardcoded credentials
- Review logs for credential patterns
- Check git history for secrets

### 3.3 Authorization Creep

**Threat**: Over time, the SAP user gains more authorization than needed:
- "Just add this table for debugging"
- Copy of production user with full access
- Emergency access never revoked

**Impact**: Blast radius of breach increases.

**Mitigations**:
| Control | Implementation | Residual Risk |
|---------|----------------|---------------|
| Documented minimum | Specify exact auth objects needed | Documentation gets stale |
| Periodic review | Quarterly auth review | Review may be rubber-stamp |
| Separate users | Dev/test/prod each have own users | Operational overhead |

**Verification**: Compare actual SAP user authorizations against documented requirements.

---

## 4. Correlation Misuse Threats

### 4.1 Treating Correlation as Causation

**Threat**: Users interpret pattern cards as causal claims:
- "EXPEDITE text causes faster delivery" (vs. "is associated with")
- Business decisions based on spurious correlations
- Intervention on wrong variables

**Impact**: Ineffective or counterproductive business changes, wasted resources.

**Mitigations**:
| Control | Implementation | Residual Risk |
|---------|----------------|---------------|
| Explicit caveats | Every pattern includes "correlation, not causation" | Users skip reading |
| Language review | Avoid causal language in all output | Hard to enforce everywhere |
| Effect sizes | Show magnitude, not just significance | Users may not understand |
| Confound discussion | Note obvious confounders in pattern cards | Cannot identify all confounders |

**Verification**: User testing - ask users to interpret pattern cards, check for causal misreading.

### 4.2 Survivorship Bias

**Threat**: Analysis only sees completed document flows, missing:
- Cancelled orders (may have patterns worth noting)
- Incomplete deliveries
- Documents outside the query date range
- Deleted records

**Impact**: Patterns in surviving documents may not reflect full population.

**Mitigations**:
| Control | Implementation | Residual Risk |
|---------|----------------|---------------|
| Document completeness note | Pattern cards indicate flow requirements | Users may ignore |
| Cancelled order option | Tool can include cancelled (optional) | Adds noise |
| Date range display | Show query date parameters | Does not fix missing data |

**Verification**: Compare document counts to known SAP totals for sameness check.

### 4.3 Simpson's Paradox

**Threat**: Aggregate patterns reverse when segmented:
- "EXPEDITE correlates with delays overall" but
- "EXPEDITE correlates with faster delivery within each plant"
- (Because EXPEDITE is used more at slow plants)

**Impact**: Aggregate findings mislead; interventions backfire.

**Mitigations**:
| Control | Implementation | Residual Risk |
|---------|----------------|---------------|
| Segment analysis | Compute patterns within key segments | Combinatorial explosion |
| Confounder listing | Note major segment variables | Cannot list all |
| User guidance | Documentation explains Simpson's | Users may not read |

**Verification**: Spot-check major patterns with segment breakdown.

---

## 5. Operational Risks

### 5.1 Performance Impact on SAP

**Threat**: MCP server queries degrade SAP system performance:
- Long-running queries lock tables
- High query volume exhausts resources
- Peak-time queries impact business users

**Impact**: SAP unavailable or slow, business disruption.

**Mitigations**:
| Control | Implementation | Residual Risk |
|---------|----------------|---------------|
| Row limits | Max 200 rows per query | Many small queries still load |
| Rate limiting | Max N queries per minute at adapter | May throttle legitimate use |
| Off-peak scheduling | Run batch analysis overnight | Not always possible |
| Read replicas | Query against reporting system | Data lag, not always available |
| Index hints | Ensure queries use indexes | Requires DBA coordination |

**Verification**:
- Load test against development SAP
- Monitor SAP performance during query bursts
- SAP ST05 trace for expensive queries

### 5.2 Adapter Bugs Corrupt Analysis

**Threat**: Bugs in RFC/OData adapters return incorrect data:
- Wrong field mapping
- Missing null handling
- Date format errors
- Character encoding issues

**Impact**: Garbage in, garbage out - patterns are meaningless.

**Mitigations**:
| Control | Implementation | Residual Risk |
|---------|----------------|---------------|
| Synthetic data baseline | Validate adapters return same structure | Does not catch field-level errors |
| Schema validation | Zod schemas on tool responses | Schema may be wrong |
| Spot-check verification | Manual comparison of adapter vs SE16 | Does not scale |
| Unit tests | Adapter-specific tests with fixtures | Fixtures may not match prod |

**Verification**: Run analysis on synthetic, then on real SAP - compare structure and sanity of results.

### 5.3 Clock/Timezone Issues

**Threat**: Date/time fields interpreted incorrectly:
- SAP stores dates in factory timezone
- MCP server runs in different timezone
- UTC conversion errors
- Daylight saving edge cases

**Impact**: Timing analysis is wrong, patterns are spurious.

**Mitigations**:
| Control | Implementation | Residual Risk |
|---------|----------------|---------------|
| UTC normalization | Convert all dates to UTC at adapter | Conversion bugs |
| Timezone documentation | Note timezone assumptions in output | Users may miss |
| Known-date tests | Test with documents on DST boundaries | Does not catch all edge cases |

**Verification**: Query documents with known creation times, verify times match expectations.

### 5.4 Network Failures

**Threat**: Network issues between MCP server and SAP cause:
- Partial data retrieval
- Timeout mid-query
- Retry storms
- Inconsistent reads

**Impact**: Incomplete data, analysis is invalid.

**Mitigations**:
| Control | Implementation | Residual Risk |
|---------|----------------|---------------|
| Retry with backoff | Automatic retry on transient errors | May exacerbate load |
| Transaction boundaries | Ensure consistent read within tool call | SAP isolation limitations |
| Failure logging | Log all network errors | Reactive |
| Health checks | Verify SAP connectivity before analysis | Does not help mid-run |

**Verification**: Chaos testing - kill network mid-query, verify error handling.

---

## Threat Matrix Summary

| Category | Threat | Likelihood | Impact | Mitigation Strength |
|----------|--------|------------|--------|---------------------|
| Data Leakage | PII in text | High | High | Medium (redaction) |
| Data Leakage | Business sensitive | High | Medium | Medium (shareable mode) |
| Data Leakage | Aggregate inference | Medium | Medium | Low (N threshold) |
| Hallucination | LLM invents patterns | Medium | High | High (tool-only facts) |
| Hallucination | Overconfident stats | Medium | Medium | Medium (CI, N) |
| Hallucination | Version drift | Low | Medium | High (pinning) |
| Access Control | Unauthorized access | Low | High | Medium (read-only, limits) |
| Access Control | Credential exposure | Medium | High | Medium (env vars) |
| Access Control | Authorization creep | Medium | Medium | Low (review process) |
| Correlation | Causation confusion | High | High | Low (caveats only) |
| Correlation | Survivorship bias | Medium | Medium | Low (documentation) |
| Correlation | Simpson's paradox | Medium | Medium | Low (segment option) |
| Operational | SAP performance | Medium | High | Medium (limits, rate) |
| Operational | Adapter bugs | Medium | Medium | Medium (testing) |
| Operational | Timezone errors | Low | Medium | Medium (UTC) |
| Operational | Network failures | Low | Medium | Medium (retry) |

---

## Security Controls Summary

The following security controls are implemented across the system:

| Control | Implementation | Scope |
|---------|----------------|-------|
| **Row Limits** | 200 default, 1000 max per query | MCP Server |
| **Field Whitelisting** | Predefined allowed fields per document type | MCP Server |
| **Audit Logging** | Every tool call logged with parameters and results | MCP Server, Pattern Engine |
| **No Write Operations** | All adapters are read-only | MCP Server |
| **Redaction Default-On** | PII redaction enabled by default | Pattern Engine |
| **Shareable Mode** | Additional redaction for external sharing | Pattern Engine |
| **Input Sanitization** | Document numbers, dates, patterns validated | MCP Server |
| **Rate Limiting** | Configurable requests per minute | MCP Server |
| **Timeout Enforcement** | Maximum 2 minutes per operation | MCP Server |
| **No Arbitrary SQL** | Only predefined tool operations | MCP Server |

### Defense in Depth

```
    +-------------------+
    |   User/Client     |
    +-------------------+
            |
            v
    +-------------------+
    | Rate Limiting     |  <- First line of defense
    +-------------------+
            |
            v
    +-------------------+
    | Input Validation  |  <- Sanitize all inputs
    +-------------------+
            |
            v
    +-------------------+
    | Field Whitelisting|  <- Only allowed fields
    +-------------------+
            |
            v
    +-------------------+
    | Row Limits        |  <- Cap data volume
    +-------------------+
            |
            v
    +-------------------+
    | Audit Logging     |  <- Record everything
    +-------------------+
            |
            v
    +-------------------+
    | Redaction         |  <- Remove PII
    +-------------------+
            |
            v
    +-------------------+
    |   Output          |
    +-------------------+
```

---

## Unmitigated Threats (Known Gaps)

The following threats have no current mitigation:

1. **Insider threat with legitimate access**: A user with proper authorization can extract all 200-row pages and reconstruct tables.

2. **LLM misinterpretation beyond tool facts**: Even with tool-only facts, an LLM summarizing results can still mislead.

3. **Zero-day in dependencies**: Node.js, Python, or library vulnerabilities could compromise the system.

4. **Social engineering**: Users convinced to disable redaction, share credentials, etc.

5. **State-level adversary**: If your threat model includes nation-state actors, this system is insufficient.

---

## Review Cadence

This threat model should be reviewed:
- Before any production deployment
- After any security incident
- When adding new data sources or adapters
- Quarterly at minimum

**Last reviewed**: (date of document creation)
**Next review due**: (90 days from creation)
