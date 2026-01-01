# Security Documentation

> SAP Workflow Mining - Security Architecture & Compliance

This document describes the security architecture, data handling practices, and compliance considerations for SAP Workflow Mining.

---

## Executive Summary

SAP Workflow Mining is designed for enterprise security requirements:

- **Read-only access** - No write operations to SAP
- **On-premise only** - No cloud dependencies, no external APIs
- **No telemetry** - No phone-home, no usage tracking
- **PII protection** - Automatic redaction enabled by default
- **Audit logging** - Complete request/response logging
- **Minimal permissions** - Principle of least privilege

---

## Data Flow Architecture

```
+============================================================================+
||                           YOUR CORPORATE NETWORK                          ||
||                                                                           ||
||   +---------------------------+       +-------------------------------+   ||
||   |      SAP ECC 6.0          |       |    SAP Workflow Mining        |   ||
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
||   |   +-------------------+   |       |   |   (localhost only)     |  |   ||
||   |                           |       |   +------------------------+  |   ||
||   +---------------------------+       +-------------------------------+   ||
||                                                                           ||
||                         NO EXTERNAL CONNECTIONS                           ||
||                                                                           ||
+============================================================================+
                                    |
                                    X  (No outbound traffic)
                                    |
                         +--------------------+
                         |     Internet       |
                         +--------------------+

Data Flow Steps:
(1) RFC connection to SAP - read-only BAPIs only
(2) Internal processing - text extraction, normalization
(3) Pattern analysis and redaction
(4) Results stored locally
(5) Browser access via localhost only
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

### Data NOT Accessed

- FI/CO tables (financial accounting)
- HR/HCM tables (employee data)
- Pricing conditions (KONV, A-tables)
- Credit management (KNKK)
- Bank details (BNKA, KNBK)
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

### No Cloud Storage

- No AWS S3, Azure Blob, GCP Storage
- No SaaS analytics platforms
- No external databases
- No CDN or edge caching

### No Persistent External Connections

- No WebSocket connections to external servers
- No long-polling to cloud services
- No background sync operations

---

## Network Security

### No Outbound Connections

SAP Workflow Mining makes **zero outbound network connections**:

```
Outbound to Internet:    NONE
Outbound to Cloud:       NONE
Outbound to CDN:         NONE
Outbound to Analytics:   NONE
Outbound to Telemetry:   NONE
```

### Required Network Access

The only network connections are **within your corporate network**:

| Source | Destination | Port | Protocol | Purpose |
|--------|-------------|------|----------|---------|
| MCP Server | SAP ECC | 33XX | RFC | SAP data access |
| Browser | Web Viewer | 8080 | HTTP | Results viewing |
| Pattern Engine | MCP Server | 3000 | HTTP | Tool calls |

### Firewall Configuration

```
# ALLOW (internal only)
ALLOW TCP from MCP-Server to SAP-ECC:33XX    # RFC
ALLOW TCP from Browser to localhost:8080      # Web viewer

# DENY (external)
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

You can verify no external connections with:

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
  },
  "user_context": {
    "session_id": "abc123",
    "client_ip": "10.0.0.50"
  }
}
```

### What Is NOT Logged

- Actual document content (only metadata)
- Actual text field values (only match counts)
- Customer names or PII
- SAP credentials

### Log Retention

Logs are stored locally in `./output/logs/`:
- Default retention: 90 days
- Configurable via environment variable
- No automatic upload or external shipping

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

### GDPR

| Requirement | Implementation |
|-------------|----------------|
| Data minimization | Only SD/MM data accessed, no HR |
| Purpose limitation | Process analysis only |
| Storage limitation | Local only, configurable retention |
| Right to erasure | Delete output directory |
| Data portability | JSON output format |
| Privacy by design | Redaction enabled by default |

### SOC 2

| Control | Implementation |
|---------|----------------|
| Access control | SAP authorization, no shared accounts |
| Audit logging | Complete request logging |
| Data encryption | Use TLS for RFC (SNC) |
| Change management | Docker image versioning |
| Incident response | Local logs for investigation |

### HIPAA (if applicable)

| Safeguard | Implementation |
|-----------|----------------|
| Access controls | SAP authorization |
| Audit controls | Complete logging |
| Transmission security | SNC for RFC |
| No PHI processing | Verify no healthcare data in SD texts |

### PCI DSS (if applicable)

| Requirement | Implementation |
|-------------|----------------|
| No card data storage | Credit card patterns redacted |
| Access restriction | SAP authorization |
| Audit trails | Complete logging |
| Network security | No external connections |

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
| No telemetry | No external calls | Enforced |
| Input validation | Sanitized parameters | Enabled |
| Timeout enforcement | 2 min max | Enabled |

---

## Vulnerability Reporting

### Responsible Disclosure

If you discover a security vulnerability:

1. **Do NOT** open a public GitHub issue
2. Email security@your-org.com with:
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

Before deploying SAP Workflow Mining:

- [ ] Create dedicated RFC user with minimal permissions
- [ ] Test authorization with SU53 after failed access
- [ ] Enable SNC (Secure Network Communications) for RFC
- [ ] Review SAP authorization trace (ST01)
- [ ] Configure log retention policy
- [ ] Verify no outbound network access
- [ ] Document data classification of output
- [ ] Establish output file handling procedures
- [ ] Define access control for analysis results
- [ ] Schedule periodic authorization review

---

## Questions?

- Security architecture: See [docs/architecture.md](docs/architecture.md)
- Threat model: See [docs/threat_model.md](docs/threat_model.md)
- SAP authorizations: See [docs/SAP_AUTHORIZATION.md](docs/SAP_AUTHORIZATION.md)
