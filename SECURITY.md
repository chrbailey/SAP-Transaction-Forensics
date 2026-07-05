# Security Documentation

> Transaction Forensics - Security Architecture & Compliance

This document describes the security architecture, data handling practices, and compliance considerations for Transaction Forensics.

---

## Executive Summary

Transaction Forensics is designed for enterprise security requirements:

- **Read-only access** - No write operations to SAP
- **Local by default** - Cloud LLM providers and SaaS adapters are opt-in
- **No telemetry** - No phone-home, no usage tracking (verified: the only
  outbound endpoints in the code are the opt-in LLM and SaaS adapters)
- **PII protection** - Redaction available in the Python pattern engine's
  shareable-output mode. Note: the MCP server's SAP/SFDC data tools return raw
  field text and are **not** redacted; treat all tool output as sensitive.
- **Audit logging** - Tool calls are logged with parameters and result
  **metadata** (row counts, duration, truncation) — not response bodies.
- **Minimal permissions** - Principle of least privilege on the SAP side

> **Authentication:** the product itself does not yet provide user
> authentication or authorization. The MCP server runs over a single-user stdio
> transport and the web viewer ships without auth or TLS. Deploy both behind
> your own network controls / reverse proxy. See the roadmap in
> [docs/GOVERNMENT-READINESS-REVIEW.md](docs/GOVERNMENT-READINESS-REVIEW.md).

---

## Data Flow Architecture

```
+============================================================================+
||                           YOUR CORPORATE NETWORK                          ||
||                                                                           ||
||   +---------------------------+       +-------------------------------+   ||
||   |      SAP ECC 6.0          |       |    Transaction Forensics      |   ||
||   |                           |       |          Server               |   ||
||   |   +-----------------+     |       |                               |   ||
||   |   |   SD Tables     |     |  RFC  |   +------------------------+  |   ||
||   |   |   VBAK, VBAP    |<----------->|   |     MCP Server         |  |   ||
||   |   |   LIKP, LIPS    |     | (1)   |   |  (Node.js/TypeScript)  |  |   ||
||   |   |   VBRK, VBRP    |     |       |   +------------------------+  |   ||
||   |   |   STXH, STXL    |     |       |            | (2)              |   ||
||   |   +-----------------+     |       |            v                  |   ||
||   |                           |       |   +------------------------+  |   ||
||   |   +-----------------+     |       |   |    Pattern Engine      |  |   ||
||   |   |  Master Data    |     |       |   |      (Python)          |  |   ||
||   |   |  KNA1, MARA     |     |       |   +------------------------+  |   ||
||   |   +-----------------+     |       |            | (3)              |   ||
||   |                           |       |            v                  |   ||
||   +---------------------------+       |   +------------------------+  |   ||
||                                       |   |   Local File System    |  |   ||
||                                       |   |   ./output/            |  |   ||
||   +---------------------------+       |   |   - pattern_cards.json |  |   ||
||   |     Analyst Workstation   |       |   |   - audit_log.json     |  |   ||
||   |                           |       |   +------------------------+  |   ||
||   |   +-------------------+   | HTTP  |            | (4)              |   ||
||   |   |    Browser        |<--------->|   +------------------------+  |   ||
||   |   | (localhost:8080)  |   | (5)   |   |     Web Viewer         |  |   ||
||   |   +-------------------+   |       |   |   (no built-in auth)   |  |   ||
||   |                           |       |   +------------------------+  |   ||
||   +---------------------------+       +-------------------------------+   ||
||                                                                           ||
||                  EXTERNAL CONNECTIONS ONLY WHEN CONFIGURED                ||
||                                                                           ||
+============================================================================+
                                    |
                                    |  (Optional outbound traffic)
                                    |
                         +--------------------+
                         |     Internet       |
                         +--------------------+

Data Flow Steps:
(1) RFC connection to SAP - read-only BAPIs only
(2) Internal processing - text extraction, normalization
(3) Pattern analysis and redaction
(4) Results stored locally
(5) Browser access to the viewer. Note: the viewer binds all interfaces and
    has no built-in authentication or TLS — restrict it to localhost or place
    it behind an authenticating reverse proxy on deployment.

Note: the MCP server communicates over a stdio transport (not an HTTP port);
the pattern engine and MCP tools are invoked in-process by the MCP host, not
over a network socket.
```

---

## What Data Is Accessed

### SAP Tables (via Read-Only BAPIs)

| Table | Description | Data Type | Sensitivity |
|-------|-------------|-----------|-------------|
| VBAK | Sales Order Header | Document metadata | Medium |
| VBAP | Sales Order Items | Line item details | Medium |
| LIKP | Delivery Header | Delivery metadata | Medium |
| LIPS | Delivery Items | Shipped quantities | Medium |
| VBRK | Invoice Header | Billing metadata | Medium |
| VBRP | Invoice Items | Billed amounts | Medium |
| VBFA | Document Flow | Document relationships | Low |
| STXH/STXL | Long Texts | Free-form text fields | High |
| KNA1 | Customer Master | Customer attributes | High |
| MARA | Material Master | Material attributes | Low |

### FI/CO Tables (via CSV import or Read-Only BAPIs)

The FI/CO forensic tools (`analyze_journal_entries`, `analyze_sod`,
`analyze_gl_balances`, `get_fi_document`, `generate_fi_assessment`) read
financial-accounting data when an FI/CO source is provided:

| Table | Description | Sensitivity |
|-------|-------------|-------------|
| BKPF / BSEG | Accounting document header / line items | High |
| BSAD | Cleared customer items | Medium |
| SKA1 / SKAT | G/L account master / texts | Low |
| T001 | Company codes | Low |
| CSKS / COEP | Cost centers / CO line items | Medium |

### Data NOT Accessed

- HR/HCM tables (employee data)
- Pricing conditions (KONV, A-tables)
- Credit management (KNKK)
- Bank details (BNKA, KNBK, LFBK) — no vendor-bank reads today
- Custom Z-tables (unless explicitly configured)

### BAPIs Used

All data access is through SAP BAPIs - no direct SQL or RFC_READ_TABLE by default:

```
BAPI_SALESORDER_GETLIST       - List sales orders (display only)
SD_SALESDOCUMENT_READ         - Read order details (display only)
BAPI_SALESDOCU_GETRELATIONS   - Document flow relationships
BAPI_OUTB_DELIVERY_GET_DETAIL - Delivery information
BAPI_BILLINGDOC_GETDETAIL     - Invoice information
READ_TEXT                     - Long text content
BAPI_CUSTOMER_GETDETAIL2      - Customer master (display only)
BAPI_MATERIAL_GET_DETAIL      - Material master (display only)
```

---

## Where Data Is Stored

### Local Storage Only

All data is stored on the local file system:

```
./output/
├── pattern_cards.json      # Analysis results (redacted)
├── evidence_ledger.json    # Document references (IDs only)
├── audit_log.json          # Request/response log
├── cluster_analysis.json   # Text clustering output
└── timing_analysis.json    # Document flow timing
```

### No Built-In Cloud Storage

- No AWS S3, Azure Blob, GCP Storage
- No SaaS analytics platforms
- No external databases
- No CDN or edge caching

### No Background External Connections

- No WebSocket connections to external servers
- No long-polling to cloud services
- No background sync operations

---

## Network Security

### Outbound Connections Are Opt-In

The synthetic, CSV, RFC, local viewer, and local Ollama paths do not require
public internet access. Configured SaaS adapters and cloud LLM providers do:

```
Outbound to Salesforce:  OPTIONAL
Outbound to NetSuite:    OPTIONAL
Outbound to OpenAI:      OPTIONAL
Outbound to Anthropic:   OPTIONAL
Outbound to CDN:         NONE
Outbound to Analytics:   NONE
Outbound to Telemetry:   NONE
```

### Required Network Access

Required connections depend on the selected adapters and LLM provider:

| Source | Destination | Port | Protocol | Purpose |
|--------|-------------|------|----------|---------|
| MCP Server | SAP ECC | 33XX | RFC | SAP data access |
| Browser | Web Viewer | 8080 | HTTP | Results viewing (bind to localhost / proxy) |
| MCP host | MCP Server | n/a | stdio | Tool calls (in-process, no network port) |
| MCP Server | Salesforce/NetSuite | 443 | HTTPS | Optional SaaS adapters |
| MCP Server | OpenAI/Anthropic | 443 | HTTPS | Optional cloud LLM |

### Firewall Configuration

```
# ALLOW (internal only)
ALLOW TCP from MCP-Server to SAP-ECC:33XX    # RFC
ALLOW TCP from Browser to localhost:8080      # Web viewer

# Optional: allow only configured SaaS/LLM endpoints.
# Otherwise deny external traffic.
DENY ALL from MCP-Server to Internet
DENY ALL from Pattern-Engine to Internet
DENY ALL from Web-Viewer to Internet
```

---

## No Telemetry

### What We Do NOT Collect

- Usage statistics
- Error reports
- Feature analytics
- User behavior
- Performance metrics
- Crash dumps

### No Phone-Home

- No update checks
- No license validation
- No heartbeat signals
- No capability negotiation

### Verification

You can verify that actual connections match your selected configuration with:

```bash
# Monitor network connections during operation
netstat -an | grep ESTABLISHED

# Or use tcpdump
tcpdump -i any 'not (host YOUR-SAP-SERVER or host localhost)'
```

---

## PII Handling & Redaction

### Default Redaction (Always On)

The following patterns are automatically redacted in all output:

| Pattern Type | Example | Redacted To |
|--------------|---------|-------------|
| Email addresses | john.doe@company.com | [EMAIL] |
| Phone numbers | +1-555-123-4567 | [PHONE] |
| SSN patterns | 123-45-6789 | [SSN] |
| Credit cards | 4111-1111-1111-1111 | [CARD] |
| IP addresses | 192.168.1.100 | [IP] |

### Shareable Mode (Additional Redaction)

When `--mode shareable` is enabled:

| Data Type | Treatment |
|-----------|-----------|
| Customer names | Hashed to anonymous IDs |
| Customer numbers | Hashed to anonymous IDs |
| Material numbers | Hashed to anonymous IDs |
| Pricing/values | Removed or bucketed |
| Addresses | Removed |
| PO numbers | Removed |

### Redaction Implementation

```python
# Redaction is applied BEFORE any data is written to disk
# Located in: pattern-engine/src/redaction/

def redact_text(text: str, mode: str = "default") -> str:
    # 1. Regex-based pattern matching
    text = redact_emails(text)
    text = redact_phones(text)
    text = redact_ssn(text)

    # 2. Named Entity Recognition (optional)
    if ner_enabled:
        text = redact_named_entities(text)

    # 3. Shareable mode additional redaction
    if mode == "shareable":
        text = hash_identifiers(text)
        text = remove_values(text)

    return text
```

---

## Audit Logging

### What Is Logged

Every tool call is logged with:

```json
{
  "timestamp": "2024-01-15T10:30:45.123Z",
  "tool": "search_doc_text",
  "parameters": {
    "pattern": "credit hold",
    "date_from": "2024-01-01",
    "date_to": "2024-01-15",
    "sales_org": ["1000"]
  },
  "result": {
    "row_count": 47,
    "execution_ms": 234,
    "truncated": false
  }
}
```

> Note: the audit log does not currently capture a user/session identity or
> client IP — the MCP server runs over a single-user stdio transport with no
> caller identity. Per-user attribution is on the roadmap and is a prerequisite
> for a full chain-of-custody story.

### What Is NOT Logged

- Actual document content (only metadata)
- Actual text field values (only match counts)
- Customer names or PII
- SAP credentials

### Log Retention

Logs are written locally by winston with **size-based rotation** (default 5
files × 10 MB); there is no time-based retention window today. Set the log
directory via the `LOG_DIR` environment variable.
- No automatic upload or external shipping
- Note: the audit log is a plaintext file with no integrity protection
  (hash-chaining / signing) yet — see the roadmap for the tamper-evident logging
  work required before it can serve as evidence.

---

## Access Controls

### SAP Authorization Requirements

See [docs/SAP_AUTHORIZATION.md](docs/SAP_AUTHORIZATION.md) for complete details.

Minimum required authorizations:

```
S_RFC          - RFC execution (Activity 16)
V_VBAK_VKO     - Sales org access (Activity 03 - Display)
V_VBAK_AAT     - Document type access (Activity 03 - Display)
```

### Principle of Least Privilege

The RFC user should have:
- **Only display access** (Activity 03)
- **Only required sales organizations**
- **Only required document types**
- **No write permissions anywhere**

### No Elevated Privileges Required

- No SAP_ALL
- No SAP_NEW
- No S_DEVELOP
- No S_TABU_DIS (unless RFC_READ_TABLE enabled)

---

## Compliance Considerations

> The tables below describe how the product can **support a customer's own
> compliance program** — they are not claims of independently audited or
> attested product controls. No SOC 2 report or third-party certification
> exists for this software today.

### GDPR

| Requirement | Implementation |
|-------------|----------------|
| Data minimization | Only SD/MM data accessed, no HR |
| Purpose limitation | Process analysis only |
| Storage limitation | Local only, configurable retention |
| Right to erasure | Delete output directory |
| Data portability | JSON output format |
| Privacy by design | Redaction available in the pattern engine's shareable-output mode (raw MCP tool output is not redacted) |

### SOC 2

| Control | How the product supports it |
|---------|----------------|
| Access control | Enforced on the **SAP side** via display-only authorizations. The product itself has no user auth yet — deploy behind your controls. |
| Audit logging | Tool-call metadata logging (parameters, row counts, timing) — not response bodies; no tamper-evidence yet |
| Data encryption | Deploy RFC with SNC and the viewer behind TLS — **not** currently configured by the product (no SNC parameters in the RFC client today) |
| Change management | Docker image versioning |
| Incident response | Local logs for investigation |

### HIPAA (if applicable)

| Safeguard | How the product supports it |
|-----------|----------------|
| Access controls | SAP authorization (product has no user auth of its own yet) |
| Audit controls | Tool-call metadata logging |
| Transmission security | SNC for RFC — configure at the OS/SAP layer; not set by the product today |
| No PHI processing | Verify no healthcare data in SD texts |

### PCI DSS (if applicable)

| Requirement | How the product supports it |
|-------------|----------------|
| No card data storage | Credit-card patterns redacted in the pattern engine's shareable mode (not in raw MCP tool output) |
| Access restriction | SAP authorization |
| Audit trails | Tool-call metadata logging |
| Network security | Outbound access limited to configured providers |

---

## Security Controls Summary

| Control | Implementation | Default |
|---------|----------------|---------|
| Read-only access | BAPIs only, no write | Enforced |
| Row limits | 200 per query | Enabled |
| Rate limiting | Configurable | Optional |
| PII redaction | Regex + patterns | Enabled |
| Shareable mode | Additional redaction | Optional |
| Audit logging | All requests | Enabled |
| No telemetry | No analytics or phone-home calls | Enforced |
| Input validation | Sanitized parameters | Enabled |
| Timeout enforcement | 2 min max | Enabled |

---

## Vulnerability Reporting

### Responsible Disclosure

If you discover a security vulnerability:

1. **Do NOT** open a public GitHub issue
2. Report via [GitHub Security Advisories](https://github.com/chrbailey/SAP-Transaction-Forensics/security/advisories), or email the repository owner with:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)
3. Allow 90 days for response before public disclosure

### Known Limitations

See [docs/threat_model.md](docs/threat_model.md) for:
- Known unmitigated threats
- Risk acceptance decisions
- Defense-in-depth architecture

---

## Security Checklist for Deployment

Before deploying Transaction Forensics:

- [ ] Create dedicated RFC user with minimal permissions
- [ ] Test authorization with SU53 after failed access
- [ ] Enable SNC (Secure Network Communications) for RFC at the SAP/OS layer
      (the product's RFC client does not set SNC parameters itself)
- [ ] Review SAP authorization trace (ST01)
- [ ] Restrict the web viewer to localhost or place it behind an
      authenticating, TLS-terminating reverse proxy (no built-in auth/TLS)
- [ ] Set `LOG_DIR` and manage log rotation/retention at the OS layer
- [ ] Restrict outbound access to explicitly configured providers
- [ ] Document data classification of output
- [ ] Establish output file handling procedures
- [ ] Define access control for analysis results
- [ ] Schedule periodic authorization review

---

## Questions?

- Security architecture: See [docs/architecture.md](docs/architecture.md)
- Threat model: See [docs/threat_model.md](docs/threat_model.md)
- SAP authorizations: See [docs/SAP_AUTHORIZATION.md](docs/SAP_AUTHORIZATION.md)
