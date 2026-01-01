# SAP Authorization Setup Guide

> Copy-paste ready authorization configuration for SAP Workflow Mining

This guide provides step-by-step instructions for SAP Basis Administrators to create a secure, minimal-permission RFC user for SAP Workflow Mining.

---

## Overview

SAP Workflow Mining requires **read-only access** to SD (Sales & Distribution) documents. This guide follows the principle of least privilege - the user gets exactly the permissions needed and nothing more.

**Time required:** 15-30 minutes
**Transactions used:** SU01, PFCG, SU53, ST01

---

## Quick Reference

### Authorization Objects Required

| Object | Description | Activity |
|--------|-------------|----------|
| S_RFC | RFC access | 16 (Execute) |
| V_VBAK_VKO | Sales organization | 03 (Display) |
| V_VBAK_AAT | Document type | 03 (Display) |
| S_TCODE | Transaction (optional) | N/A |

### Function Groups Required

| Function Group | Description | BAPIs |
|----------------|-------------|-------|
| STXR | Text reading | READ_TEXT |
| 2001 | Sales order | BAPI_SALESORDER_GETLIST |
| 2051 | Sales document | SD_SALESDOCUMENT_READ |
| 2056 | Document flow | BAPI_SALESDOCU_GETRELATIONS |
| 2074 | Delivery | BAPI_OUTB_DELIVERY_GET_DETAIL |
| 2077 | Billing | BAPI_BILLINGDOC_GETDETAIL |
| 0006 | Customer | BAPI_CUSTOMER_GETDETAIL2 |
| MG01 | Material | BAPI_MATERIAL_GET_DETAIL |

---

## Step 1: Create the Role (PFCG)

### 1.1 Start Transaction PFCG

```
/nPFCG
```

### 1.2 Enter Role Name

```
Role: Z_WORKFLOW_MINING_RFC
```

Click **Single Role** button.

### 1.3 Add Description

```
Description: Read-only RFC access for SAP Workflow Mining
             Process analysis tool - display only access to SD documents
```

### 1.4 Configure Authorizations Tab

Click the **Authorizations** tab, then **Change Authorization Data**.

---

## Step 2: Add Authorization Objects

### 2.1 S_RFC - RFC Authorization

This is the core authorization for RFC function execution.

```
Authorization Object: S_RFC

Fields:
  RFC_TYPE = FUGR              (Function Group)
  RFC_NAME = STXR              (Text Functions)
             2001              (Sales Order)
             2051              (Sales Document)
             2056              (Document Flow)
             2074              (Delivery)
             2077              (Billing)
             0006              (Customer Master)
             MG01              (Material Master)
  ACTVT    = 16                (Execute)
```

**Copy-paste for PFCG:**

```
Object: S_RFC
  RFC_TYPE: FUGR
  RFC_NAME: STXR, 2001, 2051, 2056, 2074, 2077, 0006, MG01
  ACTVT: 16
```

### 2.2 V_VBAK_VKO - Sales Organization Authorization

Controls which sales organizations the user can access.

```
Authorization Object: V_VBAK_VKO

Fields:
  VKORG = 1000                 (Your Sales Org 1)
          2000                 (Your Sales Org 2)
          ...                  (Add all required)
  ACTVT = 03                   (Display)
```

**Option A: Specific Sales Orgs (Recommended)**
```
Object: V_VBAK_VKO
  VKORG: 1000, 2000, 3000      (List your sales orgs)
  ACTVT: 03
```

**Option B: All Sales Orgs (Less Secure)**
```
Object: V_VBAK_VKO
  VKORG: *
  ACTVT: 03
```

### 2.3 V_VBAK_AAT - Document Type Authorization

Controls which sales document types the user can access.

```
Authorization Object: V_VBAK_AAT

Fields:
  AUART = OR                   (Standard Order)
          SO                   (Rush Order)
          ZOR                  (Custom Order Types)
          ...                  (Add as needed)
  ACTVT = 03                   (Display)
```

**Option A: Specific Document Types (Recommended)**
```
Object: V_VBAK_AAT
  AUART: OR, SO, RE, CR        (List your doc types)
  ACTVT: 03
```

**Option B: All Document Types (Less Secure)**
```
Object: V_VBAK_AAT
  AUART: *
  ACTVT: 03
```

### 2.4 Additional Objects (Optional)

If you need RFC_READ_TABLE access (not recommended unless required):

```
Authorization Object: S_TABU_DIS

Fields:
  ACTVT    = 03                (Display)
  DICBERCLS = &NC&             (No authorization group)
              SS               (SD tables)
              VV               (Sales tables)
```

---

## Step 3: Generate the Role Profile

### 3.1 Generate Profile

After adding all authorization objects:

1. Click **Generate** (or Ctrl+F3)
2. Confirm the profile generation
3. Note the profile name (e.g., `T-Z_WORKFLOW_MI`)

### 3.2 Save the Role

```
Status: Generated
Profile: T-Z_WORKFLOW_MI
```

---

## Step 4: Create the RFC User (SU01)

### 4.1 Start Transaction SU01

```
/nSU01
```

### 4.2 Create User

```
User: RFC_WORKFLOW_MINING
```

Click **Create** button.

### 4.3 Configure Address Tab

```
Last Name: Workflow Mining RFC User
```

### 4.4 Configure Logon Data Tab

```
User Type: System (S)         # Important: System user for RFC
Initial Password: [Set secure password]
```

**User Type Options:**
- **System (S)**: Best for RFC - no dialog logon, no password expiry
- **Service (C)**: Alternative if System not allowed
- **Communication (B)**: For background processing

### 4.5 Configure Roles Tab

Add the role created in PFCG:

```
Role: Z_WORKFLOW_MINING_RFC
```

### 4.6 Save User

Save and note the user ID.

---

## Step 5: Test Authorization

### 5.1 Test with SE37

From a dialog user session:

```
/nSE37
Function Module: BAPI_SALESORDER_GETLIST
```

Execute with test data and verify results.

### 5.2 Check Authorization Errors (SU53)

If any BAPI fails, check authorization errors:

```
/nSU53
User: RFC_WORKFLOW_MINING
```

This shows the last authorization failure with exact object and field values.

### 5.3 Authorization Trace (ST01)

For detailed analysis:

```
/nST01
```

1. Select **Authorization check**
2. Enter user: RFC_WORKFLOW_MINING
3. Activate trace
4. Run test queries
5. Deactivate and analyze trace

---

## Step 6: Configure RFC Connection

### 6.1 Environment Variables

Set these in your `.env.rfc` file:

```bash
# Connection
SAP_RFC_ASHOST=your-sap-server.company.com
SAP_RFC_SYSNR=00
SAP_RFC_CLIENT=100

# Credentials
SAP_RFC_USER=RFC_WORKFLOW_MINING
SAP_RFC_PASSWD=your-secure-password

# Optional
SAP_RFC_LANG=EN
SAP_RFC_POOL_SIZE=5
```

### 6.2 Test Connection

```bash
# Test RFC connection
docker-compose --profile rfc run mcp-server-rfc npm run test:connection
```

---

## Complete Role Definition (Export Format)

For transport or reference, here is the complete role definition:

```
Role: Z_WORKFLOW_MINING_RFC

Menu: (empty - RFC only, no menu required)

Authorizations:

1. S_RFC
   RFC_TYPE = FUGR
   RFC_NAME = STXR, 2001, 2051, 2056, 2074, 2077, 0006, MG01
   ACTVT = 16

2. V_VBAK_VKO
   VKORG = [Your Sales Organizations]
   ACTVT = 03

3. V_VBAK_AAT
   AUART = [Your Document Types or *]
   ACTVT = 03

Profile: T-Z_WORKFLOW_MI
```

---

## Troubleshooting

### Error: "No RFC authorization for function module"

**Check:** S_RFC object with correct function groups

```
SU53 -> Look for S_RFC failure
      -> Note missing RFC_NAME value
      -> Add to role and regenerate
```

### Error: "No authorization for sales organization"

**Check:** V_VBAK_VKO with your sales orgs

```
SU53 -> Look for V_VBAK_VKO failure
      -> Note missing VKORG value
      -> Add sales org to role
```

### Error: "No authorization for document type"

**Check:** V_VBAK_AAT with your document types

```
SU53 -> Look for V_VBAK_AAT failure
      -> Note missing AUART value
      -> Add document type to role
```

### Error: Connection timeout

**Check:** Network connectivity and system availability

```bash
# Test network connectivity
ping your-sap-server.company.com

# Check if SAP gateway is listening
telnet your-sap-server.company.com 3300
```

### Error: Password expired

**Check:** User type is System (S)

```
SU01 -> Logon Data tab
     -> User Type should be "System"
     -> System users don't have password expiry
```

---

## Security Best Practices

### Do:

- Use a dedicated RFC user (not a named user)
- Set user type to System (S) for no password expiry
- Limit to specific sales organizations
- Limit to specific document types
- Review authorizations quarterly
- Rotate password annually
- Monitor usage via SM21/STAD

### Don't:

- Grant SAP_ALL or SAP_NEW
- Use a dialog user account
- Share credentials across systems
- Store password in plain text files
- Grant write access (Activity 01, 02)
- Include sensitive transaction codes

---

## Authorization Comparison

| Access Level | Risk | Use Case |
|--------------|------|----------|
| **Minimal (Recommended)** | Low | Production analysis |
| Specific sales orgs | | |
| Specific doc types | | |
| No RFC_READ_TABLE | | |
| | | |
| **Moderate** | Medium | Multi-org analysis |
| All sales orgs (*) | | |
| All doc types (*) | | |
| No RFC_READ_TABLE | | |
| | | |
| **Extended** | Higher | Development/testing |
| All sales orgs (*) | | |
| All doc types (*) | | |
| RFC_READ_TABLE enabled | | |

---

## Role Transport

To transport the role to other systems:

### 1. Assign Transport Request

In PFCG:
```
Role: Z_WORKFLOW_MINING_RFC
Utilities -> Transport (Ctrl+F3)
Transport request: [Create or select]
```

### 2. Include User Assignment (Optional)

If transporting user-role assignments:
```
User -> Compare -> Transport
```

### 3. Release Transport

```
/nSE09 or /nSE10
Transport request: [Your request]
Release
```

---

## Audit & Compliance

### Quarterly Review Checklist

- [ ] Verify user is still required
- [ ] Check for authorization changes (SUIM)
- [ ] Review actual usage (STAD/SM21)
- [ ] Confirm no additional roles added
- [ ] Validate sales org restrictions still apply
- [ ] Check for failed authorizations (SU53 history)

### SUIM Reports for Review

```
/nSUIM

Useful reports:
- Users by authorization object (S_RFC)
- Role usage (Z_WORKFLOW_MINING_RFC)
- Authorization comparison over time
```

---

## Questions?

- Security documentation: See [SECURITY.md](../SECURITY.md)
- Threat model: See [threat_model.md](threat_model.md)
- Technical architecture: See [architecture.md](architecture.md)
