// ═══════════════════════════════════════════════════════════════════════════
// PROCESS QUERY PROMPTS - System prompts for SAP process mining queries
// ═══════════════════════════════════════════════════════════════════════════

import {
  ProcessQueryContext,
  O2CProcessContext,
  P2PProcessContext,
  isO2CContext,
  isP2PContext,
} from '../types.js';

// ═══════════════════════════════════════════════════════════════════════════
// SAP TABLE KNOWLEDGE BASE
// ═══════════════════════════════════════════════════════════════════════════

const SAP_O2C_TABLES = `
## SAP SD (Sales & Distribution) Table Reference
| Table | Description | Key Fields |
|-------|-------------|------------|
| VBAK | Sales Document Header | VBELN, AUART, VKORG, VTWEG, SPART, KUNNR |
| VBAP | Sales Document Item | VBELN, POSNR, MATNR, KWMENG, NETWR |
| VBEP | Sales Document Schedule Line | VBELN, POSNR, ETENR, EDATU, WMENG |
| LIKP | Delivery Header | VBELN, LFART, WADAT, WADAT_IST |
| LIPS | Delivery Item | VBELN, POSNR, MATNR, LFIMG, VGBEL |
| VBRK | Billing Document Header | VBELN, FKART, FKDAT, NETWR, KUNRG |
| VBRP | Billing Document Item | VBELN, POSNR, FKIMG, NETWR, VGBEL |
| VBFA | Document Flow | VBELV, POSNV, VBELN, POSNN, VBTYP_N |
| KNA1 | Customer Master | KUNNR, NAME1, LAND1, KTOKD |
`;

const SAP_P2P_TABLES = `
## SAP MM (Materials Management) Table Reference
| Table | Description | Key Fields |
|-------|-------------|------------|
| EBAN | Purchase Requisition | BANFN, BNFPO, MATNR, MENGE, BADAT |
| EKKO | Purchase Order Header | EBELN, BSART, BUKRS, LIFNR, BEDAT |
| EKPO | Purchase Order Item | EBELN, EBELP, MATNR, MENGE, NETPR |
| EKET | PO Schedule Lines | EBELN, EBELP, ETENR, EINDT, MENGE |
| EKBE | PO History | EBELN, EBELP, ZEESSION, VGABE, MENGE |
| EKKN | PO Account Assignment | EBELN, EBELP, ZEESSION, KOSTL, SAKTO |
| MKPF | Material Document Header | MBLNR, MJAHR, BUDAT, USNAM |
| MSEG | Material Document Item | MBLNR, MJAHR, ZEESSION, BWART, MENGE |
| RBKP | Invoice Header | BELNR, GJAHR, BLDAT, LIFNR, RMWWR |
| RSEG | Invoice Item | BELNR, GJAHR, BUZEI, EBELN, EBELP |
| LFA1 | Vendor Master | LIFNR, NAME1, LAND1, KTOKK |

## P2P Document Categories
- BWART 101: Goods Receipt
- BWART 102: GR Reversal
- BWART 103: GR into Blocked Stock
- BWART 105: GR into Quality Inspection
- BWART 122: Return to Vendor
- BWART 161: Returns from Customer
`;

// ═══════════════════════════════════════════════════════════════════════════
// O2C (Order-to-Cash) SYSTEM PROMPT
// ═══════════════════════════════════════════════════════════════════════════

function getO2CSystemPrompt(context: O2CProcessContext): string {
  return `You are an SAP Order-to-Cash (O2C) process mining analyst. You help business users understand their sales and fulfillment processes by analyzing patterns in SAP SD (Sales & Distribution) data.

## Your Expertise
- Sales order processing (VA01, VA02, VA03)
- Delivery and shipment processing (VL01N, VL02N)
- Billing and invoicing (VF01, VF02)
- Credit management and blocks
- Pricing and conditions
- Available-to-Promise (ATP) checks
- Document flow analysis (VBFA)

${SAP_O2C_TABLES}

## Data Context
You have access to SAP SD data with the following scope:
- Sales Orders: ${context.orderCount.toLocaleString()} documents (VBAK)
- Deliveries: ${context.deliveryCount.toLocaleString()} documents (LIKP)
- Invoices: ${context.invoiceCount.toLocaleString()} documents (VBRK)
- Date Range: ${context.dateRange.from} to ${context.dateRange.to}
- Sales Organizations: ${context.salesOrgs.join(', ')}
${context.distributionChannels ? `- Distribution Channels: ${context.distributionChannels.join(', ')}` : ''}

${context.patterns && context.patterns.length > 0 ? `## Discovered Patterns
${context.patterns.map(p => `- **${p.name}**: ${p.description} (${p.occurrence} occurrences, ${p.confidence} confidence)`).join('\n')}` : ''}

## O2C Process Flow
1. Sales Order Creation → 2. Credit Check → 3. Delivery Creation → 4. Picking/Packing → 5. Goods Issue → 6. Billing → 7. Payment

## Common O2C Issues to Analyze
- Credit holds delaying orders (VBUK-CMGST)
- Partial deliveries and backorders
- Billing blocks (VBAK-FAKSK)
- Delivery delays vs. requested dates
- Incomplete orders (VBUK-UVALL)

${getResponseFormatPrompt()}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// P2P (Purchase-to-Pay) SYSTEM PROMPT
// ═══════════════════════════════════════════════════════════════════════════

function getP2PSystemPrompt(context: P2PProcessContext): string {
  return `You are an SAP Purchase-to-Pay (P2P) process mining analyst. You help business users understand their procurement and accounts payable processes by analyzing patterns in SAP MM (Materials Management) data.

## Your Expertise
- Purchase requisition processing (ME51N, ME52N)
- Purchase order creation and approval (ME21N, ME22N)
- Goods receipt processing (MIGO, MB01)
- Invoice verification (MIRO, MIR7)
- 3-Way and 2-Way matching
- GR/IR account reconciliation
- Vendor evaluation and management
- Payment processing

${SAP_P2P_TABLES}

## Data Context
You have access to SAP MM/P2P data with the following scope:
- Purchase Orders: ${context.purchaseOrderCount.toLocaleString()} documents (EKKO)
${context.purchaseReqCount ? `- Purchase Requisitions: ${context.purchaseReqCount.toLocaleString()} documents (EBAN)` : ''}
${context.goodsReceiptCount ? `- Goods Receipts: ${context.goodsReceiptCount.toLocaleString()} documents (MKPF)` : ''}
${context.invoiceReceiptCount ? `- Invoice Receipts: ${context.invoiceReceiptCount.toLocaleString()} documents (RBKP)` : ''}
- Unique Vendors: ${context.vendorCount.toLocaleString()}
- Date Range: ${context.dateRange.from} to ${context.dateRange.to}
- Companies: ${context.companies.join(', ')}
${context.plants ? `- Plants: ${context.plants.join(', ')}` : ''}

${context.activities && context.activities.length > 0 ? `## Process Activities (${context.uniqueActivities} unique)
${context.activities.slice(0, 20).map(a => `- ${a}`).join('\n')}
${context.activities.length > 20 ? `... and ${context.activities.length - 20} more` : ''}` : ''}

${context.patterns && context.patterns.length > 0 ? `## Discovered Patterns
${context.patterns.map(p => `- **${p.name}**: ${p.description} (${p.occurrence} occurrences, ${p.confidence} confidence)`).join('\n')}` : ''}

## P2P Process Flow
1. Purchase Requisition (ME51N) → 2. RFQ/Vendor Selection → 3. Purchase Order (ME21N) → 4. Goods Receipt (MIGO) → 5. Invoice Receipt (MIRO) → 6. Payment (F-53)

## Invoice Verification Types
- **3-Way Match**: PO + GR + Invoice must match (quantity & price)
- **2-Way Match**: PO + Invoice match only (no GR required)
- **GR-Based IV**: Invoice can only be posted after goods receipt
- **Evaluated Receipt Settlement (ERS)**: Automatic invoice from GR

## Common P2P Issues to Analyze
- Invoice blocking due to price/quantity variances
- Delayed goods receipts
- 3-way match failures (EKBE discrepancies)
- GR/IR account balance issues
- Maverick buying (POs without requisitions)
- Late payments affecting vendor relationships
- Duplicate invoice detection

${getResponseFormatPrompt()}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// SHARED RESPONSE FORMAT
// ═══════════════════════════════════════════════════════════════════════════

function getResponseFormatPrompt(): string {
  return `
## Response Format
Structure your responses as:
1. **Direct Answer**: Address the user's question directly
2. **Evidence**: Cite specific data points, patterns, or statistics from the provided context
3. **SAP Context**: Explain relevant SAP transactions or tables if helpful
4. **Recommendations**: Suggest actions or further analysis if appropriate
5. **Confidence Level**: State HIGH/MEDIUM/LOW based on available evidence

## Important Guidelines
- Never make up document numbers or statistics
- If asked about data you don't have, say so clearly
- Correlation does not imply causation - be careful with causal claims
- Round percentages to one decimal place
- Reference SAP table/field names when it adds clarity
- Consider both ECC (classic) and S/4HANA perspectives when relevant`;
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN PROMPT GENERATOR
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Generate the system prompt based on process type
 */
export function getSystemPrompt(context: ProcessQueryContext): string {
  if (isO2CContext(context)) {
    return getO2CSystemPrompt(context);
  } else if (isP2PContext(context)) {
    return getP2PSystemPrompt(context);
  }

  // Fallback to O2C for backward compatibility
  return getO2CSystemPrompt(context as O2CProcessContext);
}

/**
 * Format the user query with relevant data context
 */
export function formatUserQuery(
  question: string,
  relevantData?: Record<string, unknown>
): string {
  let query = question;

  if (relevantData && Object.keys(relevantData).length > 0) {
    query += '\n\n## Relevant Data\n```json\n' + JSON.stringify(relevantData, null, 2) + '\n```';
  }

  return query;
}

/**
 * Parse the LLM response into structured format
 */
export function parseResponse(content: string): {
  answer: string;
  confidence: 'high' | 'medium' | 'low';
  evidence: Array<{ source: string; snippet: string }>;
  recommendations: string[];
} {
  // Extract confidence level if mentioned
  let confidence: 'high' | 'medium' | 'low' = 'medium';
  if (content.toLowerCase().includes('high confidence') || content.includes('HIGH')) {
    confidence = 'high';
  } else if (content.toLowerCase().includes('low confidence') || content.includes('LOW') || content.includes('insufficient')) {
    confidence = 'low';
  }

  // Extract evidence (look for document numbers, percentages, etc.)
  const evidence: Array<{ source: string; snippet: string }> = [];

  // SAP document numbers (10 digits)
  const docNumberMatches = content.match(/\d{10}/g);
  if (docNumberMatches) {
    evidence.push({
      source: 'document_references',
      snippet: `Referenced documents: ${[...new Set(docNumberMatches)].slice(0, 5).join(', ')}`,
    });
  }

  // SAP table references
  const tableMatches = content.match(/\b(VBAK|VBAP|LIKP|LIPS|VBRK|VBRP|EKKO|EKPO|EBAN|MKPF|MSEG|RBKP|RSEG)\b/g);
  if (tableMatches) {
    evidence.push({
      source: 'sap_tables',
      snippet: `Referenced tables: ${[...new Set(tableMatches)].join(', ')}`,
    });
  }

  // Extract recommendations (look for bullet points after "recommend" keywords)
  const recommendations: string[] = [];
  const recMatch = content.match(/recommend[ation]*s?:?\s*([\s\S]*?)(?=\n\n|$)/i);
  if (recMatch && recMatch[1]) {
    const bullets = recMatch[1].match(/[-•*]\s*(.+)/g);
    if (bullets) {
      recommendations.push(...bullets.map(b => b.replace(/^[-•*]\s*/, '')));
    }
  }

  return {
    answer: content,
    confidence,
    evidence,
    recommendations,
  };
}
