/**
 * SAP Order-to-Cash (O2C) Extraction Paths
 *
 * Five deterministic extraction paths for the SAP SD process chain:
 *   1. Order Header (VBAK)
 *   2. Order Items (VBAP)
 *   3. Document Flow (VBFA)
 *   4. Delivery Timing (LIKP/LIPS)
 *   5. Invoice Timing (VBRK/VBRP)
 *
 * Each path is a named, versioned SQL query that produces identical
 * results given identical inputs. Field types align with SAP Data
 * Dictionary conventions (see src/types/sap.ts).
 */

import type { ExtractionPath } from '../types.js';

// ============================================================================
// Path 1: Sales Order Header (VBAK)
// ============================================================================

const sapO2cOrderHeader: ExtractionPath = {
  id: 'sap.o2c.order-header',
  version: '1.0',
  name: 'SAP Sales Order Header',
  description:
    'Extracts sales order header fields from VBAK including order type, ' +
    'org data, customer, net value, and block indicators. Foundation for ' +
    'O2C process tracing.',
  systemType: 'SAP',
  domain: 'o2c',
  queryType: 'sql',
  query:
    'SELECT VBELN, AUART, ERDAT, ERZET, ERNAM, VKORG, VTWEG, SPART, ' +
    'KUNNR, NETWR, WAERK, BUKRS, BSTNK, LIFSK, FAKSK, ABSTK ' +
    'FROM VBAK WHERE VBELN = :vbeln',
  parameters: [
    {
      name: 'vbeln',
      type: 'string',
      required: true,
      description: 'Sales document number, 10 chars',
    },
  ],
  expectedFields: [
    { name: 'VBELN', type: 'string', sapFieldName: 'VBELN', description: 'Sales document number' },
    { name: 'AUART', type: 'string', sapFieldName: 'AUART', description: 'Sales document type (e.g. OR=Standard Order)' },
    { name: 'ERDAT', type: 'date', sapFieldName: 'ERDAT', description: 'Created on date' },
    { name: 'ERZET', type: 'string', sapFieldName: 'ERZET', description: 'Created at time' },
    { name: 'ERNAM', type: 'string', sapFieldName: 'ERNAM', description: 'Created by user' },
    { name: 'VKORG', type: 'string', sapFieldName: 'VKORG', description: 'Sales organization' },
    { name: 'VTWEG', type: 'string', sapFieldName: 'VTWEG', description: 'Distribution channel' },
    { name: 'SPART', type: 'string', sapFieldName: 'SPART', description: 'Division' },
    { name: 'KUNNR', type: 'string', sapFieldName: 'KUNNR', description: 'Sold-to party (customer number)' },
    { name: 'NETWR', type: 'amount', sapFieldName: 'NETWR', description: 'Net value of the sales order' },
    { name: 'WAERK', type: 'string', sapFieldName: 'WAERK', description: 'Document currency' },
    { name: 'BUKRS', type: 'string', sapFieldName: 'BUKRS', description: 'Company code' },
    { name: 'BSTNK', type: 'string', sapFieldName: 'BSTNK', description: 'Customer purchase order number' },
    { name: 'LIFSK', type: 'string', sapFieldName: 'LIFSK', description: 'Delivery block' },
    { name: 'FAKSK', type: 'string', sapFieldName: 'FAKSK', description: 'Billing block' },
    { name: 'ABSTK', type: 'string', sapFieldName: 'ABSTK', description: 'Rejection status' },
  ],
  testData: {
    inputParams: { vbeln: '0000000001' },
    expectedRowCount: 1,
  },
};

// ============================================================================
// Path 2: Sales Order Items (VBAP)
// ============================================================================

const sapO2cOrderItems: ExtractionPath = {
  id: 'sap.o2c.order-items',
  version: '1.0',
  name: 'SAP Sales Order Items',
  description:
    'Extracts line item details from VBAP including material, quantity, ' +
    'price, plant, and item category. Used for value reconciliation ' +
    'and material-level tracing.',
  systemType: 'SAP',
  domain: 'o2c',
  queryType: 'sql',
  query:
    'SELECT VBELN, POSNR, MATNR, ARKTX, KWMENG, VRKME, NETWR, WAERK, ' +
    'WERKS, LGORT, ROUTE, PSTYV ' +
    'FROM VBAP WHERE VBELN = :vbeln',
  parameters: [
    {
      name: 'vbeln',
      type: 'string',
      required: true,
      description: 'Sales document number, 10 chars',
    },
  ],
  expectedFields: [
    { name: 'VBELN', type: 'string', sapFieldName: 'VBELN', description: 'Sales document number' },
    { name: 'POSNR', type: 'string', sapFieldName: 'POSNR', description: 'Item number (6 chars)' },
    { name: 'MATNR', type: 'string', sapFieldName: 'MATNR', description: 'Material number (18 chars)' },
    { name: 'ARKTX', type: 'string', sapFieldName: 'ARKTX', description: 'Item short text / description' },
    { name: 'KWMENG', type: 'number', sapFieldName: 'KWMENG', description: 'Order quantity in sales units' },
    { name: 'VRKME', type: 'string', sapFieldName: 'VRKME', description: 'Sales unit of measure' },
    { name: 'NETWR', type: 'amount', sapFieldName: 'NETWR', description: 'Net value of the item' },
    { name: 'WAERK', type: 'string', sapFieldName: 'WAERK', description: 'Document currency' },
    { name: 'WERKS', type: 'string', sapFieldName: 'WERKS', description: 'Plant (4 chars)' },
    { name: 'LGORT', type: 'string', sapFieldName: 'LGORT', description: 'Storage location' },
    { name: 'ROUTE', type: 'string', sapFieldName: 'ROUTE', description: 'Shipping route' },
    { name: 'PSTYV', type: 'string', sapFieldName: 'PSTYV', description: 'Item category (e.g. TAN=Standard)' },
  ],
  testData: {
    inputParams: { vbeln: '0000000001' },
  },
};

// ============================================================================
// Path 3: Document Flow (VBFA)
// ============================================================================

const sapO2cDocumentFlow: ExtractionPath = {
  id: 'sap.o2c.document-flow',
  version: '1.0',
  name: 'SAP Document Flow',
  description:
    'Traces the full document chain through VBFA for a given document number. ' +
    'Returns both preceding and subsequent documents, enabling reconstruction ' +
    'of the complete O2C lifecycle (order -> delivery -> invoice).',
  systemType: 'SAP',
  domain: 'o2c',
  queryType: 'sql',
  query:
    'SELECT VBELV, POSNV, VBELN, POSNN, VBTYP_N, RFMNG, RFWRT, ERDAT, ERZET ' +
    'FROM VBFA WHERE VBELV = :vbeln OR VBELN = :vbeln',
  parameters: [
    {
      name: 'vbeln',
      type: 'string',
      required: true,
      description: 'Document number to trace flow for',
    },
  ],
  expectedFields: [
    { name: 'VBELV', type: 'string', sapFieldName: 'VBELV', description: 'Preceding document number' },
    { name: 'POSNV', type: 'string', sapFieldName: 'POSNV', description: 'Preceding item number' },
    { name: 'VBELN', type: 'string', sapFieldName: 'VBELN', description: 'Subsequent document number' },
    { name: 'POSNN', type: 'string', sapFieldName: 'POSNN', description: 'Subsequent item number' },
    {
      name: 'VBTYP_N',
      type: 'string',
      sapFieldName: 'VBTYP_N',
      description:
        'Subsequent document category: C=Order, J=Delivery, M=Invoice, ' +
        'O=Credit Memo, P=Debit Memo, B=Quotation, G=Contract, H=Returns',
    },
    { name: 'RFMNG', type: 'number', sapFieldName: 'RFMNG', description: 'Reference quantity' },
    { name: 'RFWRT', type: 'amount', sapFieldName: 'RFWRT', description: 'Reference value' },
    { name: 'ERDAT', type: 'date', sapFieldName: 'ERDAT', description: 'Created on date' },
    { name: 'ERZET', type: 'string', sapFieldName: 'ERZET', description: 'Created at time' },
  ],
  testData: {
    inputParams: { vbeln: '0000000001' },
  },
};

// ============================================================================
// Path 4: Delivery Timing (LIKP + LIPS)
// ============================================================================

const sapO2cDeliveryTiming: ExtractionPath = {
  id: 'sap.o2c.delivery-timing',
  version: '1.0',
  name: 'SAP Delivery Timing',
  description:
    'Joins LIKP (delivery header) with LIPS (delivery items) to extract ' +
    'delivery timing data: planned vs actual goods issue dates, requested ' +
    'delivery dates, and item-level quantities. Used for on-time delivery ' +
    'analysis and gap detection.',
  systemType: 'SAP',
  domain: 'o2c',
  queryType: 'sql',
  query:
    'SELECT L.VBELN, L.ERDAT AS LIKP_ERDAT, L.LFDAT, L.WADAT, L.WADAT_IST, ' +
    'L.KUNNR, P.POSNR, P.MATNR, P.LFIMG, P.VRKME, P.VGBEL, P.VGPOS ' +
    'FROM LIKP L INNER JOIN LIPS P ON L.VBELN = P.VBELN ' +
    'WHERE P.VGBEL = :vbeln',
  parameters: [
    {
      name: 'vbeln',
      type: 'string',
      required: true,
      description: 'Sales order number to find deliveries for',
    },
  ],
  expectedFields: [
    { name: 'VBELN', type: 'string', sapFieldName: 'VBELN', description: 'Delivery document number' },
    { name: 'LIKP_ERDAT', type: 'date', sapFieldName: 'ERDAT', description: 'Delivery created on date (from LIKP)' },
    { name: 'LFDAT', type: 'date', sapFieldName: 'LFDAT', description: 'Requested delivery date' },
    { name: 'WADAT', type: 'date', sapFieldName: 'WADAT', description: 'Planned goods movement date' },
    { name: 'WADAT_IST', type: 'date', sapFieldName: 'WADAT_IST', description: 'Actual goods movement date' },
    { name: 'KUNNR', type: 'string', sapFieldName: 'KUNNR', description: 'Ship-to party (customer number)' },
    { name: 'POSNR', type: 'string', sapFieldName: 'POSNR', description: 'Delivery item number' },
    { name: 'MATNR', type: 'string', sapFieldName: 'MATNR', description: 'Material number' },
    { name: 'LFIMG', type: 'number', sapFieldName: 'LFIMG', description: 'Actual delivery quantity' },
    { name: 'VRKME', type: 'string', sapFieldName: 'VRKME', description: 'Sales unit of measure' },
    { name: 'VGBEL', type: 'string', sapFieldName: 'VGBEL', description: 'Reference document (sales order number)' },
    { name: 'VGPOS', type: 'string', sapFieldName: 'VGPOS', description: 'Reference item (sales order item)' },
  ],
  testData: {
    inputParams: { vbeln: '0000000001' },
  },
};

// ============================================================================
// Path 5: Invoice Timing (VBRK + VBRP)
// ============================================================================

const sapO2cInvoiceTiming: ExtractionPath = {
  id: 'sap.o2c.invoice-timing',
  version: '1.0',
  name: 'SAP Invoice Timing',
  description:
    'Joins VBRK (billing header) with VBRP (billing items) to extract ' +
    'invoice timing and value data. Links invoices back to source sales ' +
    'orders for end-to-end O2C cycle time analysis.',
  systemType: 'SAP',
  domain: 'o2c',
  queryType: 'sql',
  query:
    'SELECT K.VBELN, K.FKDAT, K.ERDAT AS VBRK_ERDAT, K.KUNAG, K.NETWR, ' +
    'K.WAERK, K.BUKRS, P.POSNR, P.VGBEL, P.VGPOS, P.FKIMG, ' +
    'P.NETWR AS ITEM_NETWR ' +
    'FROM VBRK K INNER JOIN VBRP P ON K.VBELN = P.VBELN ' +
    'WHERE P.VGBEL = :vbeln',
  parameters: [
    {
      name: 'vbeln',
      type: 'string',
      required: true,
      description: 'Sales order number to find invoices for',
    },
  ],
  expectedFields: [
    { name: 'VBELN', type: 'string', sapFieldName: 'VBELN', description: 'Billing document number' },
    { name: 'FKDAT', type: 'date', sapFieldName: 'FKDAT', description: 'Billing date' },
    { name: 'VBRK_ERDAT', type: 'date', sapFieldName: 'ERDAT', description: 'Invoice created on date (from VBRK)' },
    { name: 'KUNAG', type: 'string', sapFieldName: 'KUNAG', description: 'Sold-to party' },
    { name: 'NETWR', type: 'amount', sapFieldName: 'NETWR', description: 'Net value of the invoice' },
    { name: 'WAERK', type: 'string', sapFieldName: 'WAERK', description: 'Document currency' },
    { name: 'BUKRS', type: 'string', sapFieldName: 'BUKRS', description: 'Company code' },
    { name: 'POSNR', type: 'string', sapFieldName: 'POSNR', description: 'Billing item number' },
    { name: 'VGBEL', type: 'string', sapFieldName: 'VGBEL', description: 'Reference document (sales order number)' },
    { name: 'VGPOS', type: 'string', sapFieldName: 'VGPOS', description: 'Reference item (sales order item)' },
    { name: 'FKIMG', type: 'number', sapFieldName: 'FKIMG', description: 'Billed quantity' },
    { name: 'ITEM_NETWR', type: 'amount', sapFieldName: 'NETWR', description: 'Net value of the invoice item' },
  ],
  testData: {
    inputParams: { vbeln: '0000000001' },
  },
};

// ============================================================================
// Export
// ============================================================================

export const SAP_O2C_PATHS: ExtractionPath[] = [
  sapO2cOrderHeader,
  sapO2cOrderItems,
  sapO2cDocumentFlow,
  sapO2cDeliveryTiming,
  sapO2cInvoiceTiming,
];
