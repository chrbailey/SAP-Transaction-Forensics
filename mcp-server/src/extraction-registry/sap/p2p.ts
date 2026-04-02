/**
 * SAP Procure-to-Pay (P2P) Extraction Paths
 *
 * Four deterministic extraction paths for SAP MM (Materials Management)
 * procurement forensics. Covers the full P2P cycle:
 *   1. Purchase Orders (EKKO/EKPO)
 *   2. Purchase Requisitions (EBAN)
 *   3. Goods Receipts (EKBE)
 *   4. Invoice Verification (RBKP/RSEG)
 *
 * SAP table references validated against archived sap-extractor module
 * (incremental_p2p/01_form_queries.py) which uses identical table/field
 * structures for production P2P process mining.
 */

import type { ExtractionPath } from '../types.js';

// ═══════════════════════════════════════════════════════════════════════════
// PATH 1: PURCHASE ORDERS (EKKO header + EKPO items)
// ═══════════════════════════════════════════════════════════════════════════

const PURCHASE_ORDERS: ExtractionPath = {
  id: 'sap.p2p.purchase-orders',
  version: '1.0',
  name: 'SAP Purchase Orders',
  description:
    'Extract purchase order headers and items for procurement analysis — maverick buying, vendor concentration, split PO detection',
  systemType: 'SAP',
  domain: 'p2p',
  queryType: 'sql',
  query: [
    'SELECT H.EBELN, H.BUKRS, H.BSTYP, H.BSART, H.AEDAT, H.ERNAM,',
    '  H.LIFNR, H.EKORG, H.EKGRP,',
    '  I.EBELP, I.MATNR, I.MENGE, I.MEINS, I.NETPR, I.NETWR, I.WAERS, I.WERKS',
    'FROM EKKO H',
    'INNER JOIN EKPO I ON H.EBELN = I.EBELN',
    'WHERE H.BUKRS = :bukrs',
    '  AND H.AEDAT BETWEEN :date_from AND :date_to',
  ].join('\n'),
  parameters: [
    {
      name: 'bukrs',
      type: 'string',
      required: true,
      description: 'Company code (SAP BUKRS)',
    },
    {
      name: 'date_from',
      type: 'date',
      required: true,
      description: 'Start date for PO creation date range (AEDAT)',
    },
    {
      name: 'date_to',
      type: 'date',
      required: true,
      description: 'End date for PO creation date range (AEDAT)',
    },
  ],
  expectedFields: [
    { name: 'EBELN', type: 'string', sapFieldName: 'EBELN', description: 'Purchase order number' },
    { name: 'BUKRS', type: 'string', sapFieldName: 'BUKRS', description: 'Company code' },
    { name: 'BSTYP', type: 'string', sapFieldName: 'BSTYP', description: 'Document category' },
    { name: 'BSART', type: 'string', sapFieldName: 'BSART', description: 'Document type' },
    { name: 'AEDAT', type: 'date', sapFieldName: 'AEDAT', description: 'PO creation date' },
    { name: 'ERNAM', type: 'string', sapFieldName: 'ERNAM', description: 'Created by user' },
    { name: 'LIFNR', type: 'string', sapFieldName: 'LIFNR', description: 'Vendor number' },
    {
      name: 'EKORG',
      type: 'string',
      sapFieldName: 'EKORG',
      description: 'Purchasing organization',
    },
    { name: 'EKGRP', type: 'string', sapFieldName: 'EKGRP', description: 'Purchasing group' },
    { name: 'EBELP', type: 'string', sapFieldName: 'EBELP', description: 'PO item number' },
    { name: 'MATNR', type: 'string', sapFieldName: 'MATNR', description: 'Material number' },
    { name: 'MENGE', type: 'number', sapFieldName: 'MENGE', description: 'Order quantity' },
    { name: 'MEINS', type: 'string', sapFieldName: 'MEINS', description: 'Unit of measure' },
    { name: 'NETPR', type: 'amount', sapFieldName: 'NETPR', description: 'Net price per unit' },
    { name: 'NETWR', type: 'amount', sapFieldName: 'NETWR', description: 'Net order value' },
    { name: 'WAERS', type: 'string', sapFieldName: 'WAERS', description: 'Currency key' },
    { name: 'WERKS', type: 'string', sapFieldName: 'WERKS', description: 'Plant' },
  ],
  testData: {
    inputParams: { bukrs: '1000', date_from: '2024-01-01', date_to: '2024-12-31' },
    expectedRowCount: 500,
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// PATH 2: PURCHASE REQUISITIONS (EBAN)
// ═══════════════════════════════════════════════════════════════════════════

const PURCHASE_REQUISITIONS: ExtractionPath = {
  id: 'sap.p2p.purchase-requisitions',
  version: '1.0',
  name: 'SAP Purchase Requisitions',
  description:
    'Extract purchase requisitions for approval workflow analysis — approval bypass, auto-release patterns, req-to-PO conversion timing',
  systemType: 'SAP',
  domain: 'p2p',
  queryType: 'sql',
  query: [
    'SELECT BANFN, BNFPO, BSART, ERNAM, BADAT, FRGDT, FRGZU,',
    '  MATNR, MENGE, MEINS, PREIS, WAERS, EKGRP, WERKS, EBELN',
    'FROM EBAN',
    'WHERE WERKS = :werks',
    '  AND BADAT BETWEEN :date_from AND :date_to',
  ].join('\n'),
  parameters: [
    {
      name: 'werks',
      type: 'string',
      required: true,
      description: 'Plant code (SAP WERKS)',
    },
    {
      name: 'date_from',
      type: 'date',
      required: true,
      description: 'Start date for requisition date range (BADAT)',
    },
    {
      name: 'date_to',
      type: 'date',
      required: true,
      description: 'End date for requisition date range (BADAT)',
    },
  ],
  expectedFields: [
    {
      name: 'BANFN',
      type: 'string',
      sapFieldName: 'BANFN',
      description: 'Purchase requisition number',
    },
    {
      name: 'BNFPO',
      type: 'string',
      sapFieldName: 'BNFPO',
      description: 'Requisition item number',
    },
    { name: 'BSART', type: 'string', sapFieldName: 'BSART', description: 'Document type' },
    { name: 'ERNAM', type: 'string', sapFieldName: 'ERNAM', description: 'Created by user' },
    { name: 'BADAT', type: 'date', sapFieldName: 'BADAT', description: 'Requisition date' },
    { name: 'FRGDT', type: 'date', sapFieldName: 'FRGDT', description: 'Release date' },
    { name: 'FRGZU', type: 'string', sapFieldName: 'FRGZU', description: 'Release indicator' },
    { name: 'MATNR', type: 'string', sapFieldName: 'MATNR', description: 'Material number' },
    { name: 'MENGE', type: 'number', sapFieldName: 'MENGE', description: 'Requisition quantity' },
    { name: 'MEINS', type: 'string', sapFieldName: 'MEINS', description: 'Unit of measure' },
    { name: 'PREIS', type: 'amount', sapFieldName: 'PREIS', description: 'Price' },
    { name: 'WAERS', type: 'string', sapFieldName: 'WAERS', description: 'Currency key' },
    { name: 'EKGRP', type: 'string', sapFieldName: 'EKGRP', description: 'Purchasing group' },
    { name: 'WERKS', type: 'string', sapFieldName: 'WERKS', description: 'Plant' },
    {
      name: 'EBELN',
      type: 'string',
      sapFieldName: 'EBELN',
      description: 'Linked purchase order number',
    },
  ],
  testData: {
    inputParams: { werks: '1000', date_from: '2024-01-01', date_to: '2024-12-31' },
    expectedRowCount: 300,
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// PATH 3: GOODS RECEIPTS (EKBE with VGABE='1')
// ═══════════════════════════════════════════════════════════════════════════

const GOODS_RECEIPTS: ExtractionPath = {
  id: 'sap.p2p.goods-receipts',
  version: '1.0',
  name: 'SAP Goods Receipts',
  description:
    'Extract goods receipt history for a PO — three-way match verification, over-delivery detection, timing analysis',
  systemType: 'SAP',
  domain: 'p2p',
  queryType: 'sql',
  query: [
    'SELECT EBELN, EBELP, BELNR, GJAHR, BUZEI, VGABE,',
    '  MENGE, DMBTR, WAERS, BUDAT, CPUDT, USNAM, BWART',
    'FROM EKBE',
    "WHERE EBELN = :ebeln AND VGABE = '1'",
  ].join('\n'),
  parameters: [
    {
      name: 'ebeln',
      type: 'string',
      required: true,
      description: 'Purchase order number (SAP EBELN)',
    },
  ],
  expectedFields: [
    { name: 'EBELN', type: 'string', sapFieldName: 'EBELN', description: 'Purchase order number' },
    { name: 'EBELP', type: 'string', sapFieldName: 'EBELP', description: 'PO item number' },
    { name: 'BELNR', type: 'string', sapFieldName: 'BELNR', description: 'Document number' },
    { name: 'GJAHR', type: 'string', sapFieldName: 'GJAHR', description: 'Fiscal year' },
    { name: 'BUZEI', type: 'string', sapFieldName: 'BUZEI', description: 'Line item number' },
    {
      name: 'VGABE',
      type: 'string',
      sapFieldName: 'VGABE',
      description: 'Transaction type (1=goods receipt)',
    },
    { name: 'MENGE', type: 'number', sapFieldName: 'MENGE', description: 'Quantity received' },
    {
      name: 'DMBTR',
      type: 'amount',
      sapFieldName: 'DMBTR',
      description: 'Amount in local currency',
    },
    { name: 'WAERS', type: 'string', sapFieldName: 'WAERS', description: 'Currency key' },
    { name: 'BUDAT', type: 'date', sapFieldName: 'BUDAT', description: 'Posting date' },
    { name: 'CPUDT', type: 'date', sapFieldName: 'CPUDT', description: 'CPU entry date' },
    { name: 'USNAM', type: 'string', sapFieldName: 'USNAM', description: 'User name' },
    { name: 'BWART', type: 'string', sapFieldName: 'BWART', description: 'Movement type' },
  ],
  testData: {
    inputParams: { ebeln: '4500000001' },
    expectedRowCount: 10,
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// PATH 4: INVOICE VERIFICATION (RBKP header + RSEG items)
// ═══════════════════════════════════════════════════════════════════════════

const INVOICE_VERIFICATION: ExtractionPath = {
  id: 'sap.p2p.invoice-verification',
  version: '1.0',
  name: 'SAP Invoice Verification',
  description:
    'Extract invoice receipts for three-way match analysis — invoice without PO, price variance, duplicate invoice detection',
  systemType: 'SAP',
  domain: 'p2p',
  queryType: 'sql',
  query: [
    'SELECT H.BELNR, H.GJAHR, H.BUKRS, H.LIFNR, H.BLDAT, H.BUDAT,',
    '  H.CPUDT, H.USNAM, H.RMWWR, H.WAERS, H.SGTXT,',
    '  I.BUZEI, I.EBELN, I.EBELP, I.MENGE, I.WRBTR',
    'FROM RBKP H',
    'INNER JOIN RSEG I ON H.BELNR = I.BELNR AND H.GJAHR = I.GJAHR',
    'WHERE H.BUKRS = :bukrs',
    '  AND H.BUDAT BETWEEN :date_from AND :date_to',
  ].join('\n'),
  parameters: [
    {
      name: 'bukrs',
      type: 'string',
      required: true,
      description: 'Company code (SAP BUKRS)',
    },
    {
      name: 'date_from',
      type: 'date',
      required: true,
      description: 'Start date for posting date range (BUDAT)',
    },
    {
      name: 'date_to',
      type: 'date',
      required: true,
      description: 'End date for posting date range (BUDAT)',
    },
  ],
  expectedFields: [
    {
      name: 'BELNR',
      type: 'string',
      sapFieldName: 'BELNR',
      description: 'Invoice document number',
    },
    { name: 'GJAHR', type: 'string', sapFieldName: 'GJAHR', description: 'Fiscal year' },
    { name: 'BUKRS', type: 'string', sapFieldName: 'BUKRS', description: 'Company code' },
    { name: 'LIFNR', type: 'string', sapFieldName: 'LIFNR', description: 'Vendor number' },
    { name: 'BLDAT', type: 'date', sapFieldName: 'BLDAT', description: 'Document date' },
    { name: 'BUDAT', type: 'date', sapFieldName: 'BUDAT', description: 'Posting date' },
    { name: 'CPUDT', type: 'date', sapFieldName: 'CPUDT', description: 'CPU entry date' },
    { name: 'USNAM', type: 'string', sapFieldName: 'USNAM', description: 'User name' },
    { name: 'RMWWR', type: 'amount', sapFieldName: 'RMWWR', description: 'Invoice amount (gross)' },
    { name: 'WAERS', type: 'string', sapFieldName: 'WAERS', description: 'Currency key' },
    { name: 'SGTXT', type: 'string', sapFieldName: 'SGTXT', description: 'Text' },
    { name: 'BUZEI', type: 'string', sapFieldName: 'BUZEI', description: 'Line item number' },
    { name: 'EBELN', type: 'string', sapFieldName: 'EBELN', description: 'Purchase order number' },
    { name: 'EBELP', type: 'string', sapFieldName: 'EBELP', description: 'PO item number' },
    { name: 'MENGE', type: 'number', sapFieldName: 'MENGE', description: 'Quantity' },
    {
      name: 'WRBTR',
      type: 'amount',
      sapFieldName: 'WRBTR',
      description: 'Amount in document currency',
    },
  ],
  testData: {
    inputParams: { bukrs: '1000', date_from: '2024-01-01', date_to: '2024-12-31' },
    expectedRowCount: 400,
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// EXPORT
// ═══════════════════════════════════════════════════════════════════════════

export const SAP_P2P_PATHS: ExtractionPath[] = [
  PURCHASE_ORDERS,
  PURCHASE_REQUISITIONS,
  GOODS_RECEIPTS,
  INVOICE_VERIFICATION,
];
