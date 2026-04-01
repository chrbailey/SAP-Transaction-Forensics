/**
 * IDES Reference Schema
 *
 * Hardcoded reference schema derived from SAP IDES (Internet Demo
 * and Education System) database dump. Field types, lengths, and
 * decimal positions are extracted from the sap_data_dictionary table
 * in the archived sap.sqlite (45 MB) at:
 *   /Volumes/OWC drive/Archive/dev-archive/sap-extractor/sap.sqlite
 *
 * This is the baseline against which client schemas are compared
 * to detect customizations (Z-tables, custom fields, type changes).
 *
 * Coverage (19 tables):
 *   O2C    — VBAK, VBAP, VBFA, LIKP, LIPS, VBRK, VBRP
 *   FI/CO  — BKPF, BSEG, SKA1
 *   P2P    — EKKO, EKPO, EBAN, EKBE, RBKP, RSEG
 *   Master — KNA1, LFA1, MARA
 *
 * Every field referenced in an extraction path (o2c.ts, fi-co.ts, p2p.ts)
 * is present here so that schema validation against extraction queries
 * passes without gaps.
 */

import type { ReferenceTable, ReferenceField } from './types.js';

// ============================================================================
// Helper: compact field builder
// ============================================================================

function field(
  name: string,
  dataType: string,
  length: number,
  decimals: number,
  description: string,
): ReferenceField {
  return { name, dataType, length, decimals, description };
}

// ============================================================================
// O2C Tables
// ============================================================================

function buildVBAK(): ReferenceTable {
  return {
    name: 'VBAK',
    description: 'Sales Document: Header Data',
    fields: [
      field('MANDT', 'CLNT', 3, 0, 'Client'),
      field('VBELN', 'CHAR', 10, 0, 'Sales Document Number'),
      field('ERDAT', 'DATS', 8, 0, 'Created On'),
      field('ERZET', 'TIMS', 6, 0, 'Created Time'),
      field('ERNAM', 'CHAR', 12, 0, 'Created By'),
      field('AUDAT', 'DATS', 8, 0, 'Document Date'),
      field('VBTYP', 'CHAR', 1, 0, 'Document Category'),
      field('AUART', 'CHAR', 4, 0, 'Sales Document Type'),
      field('LIFSK', 'CHAR', 2, 0, 'Delivery Block'),
      field('FAKSK', 'CHAR', 2, 0, 'Billing Block'),
      field('NETWR', 'CURR', 15, 2, 'Net Value'),
      field('WAERK', 'CUKY', 5, 0, 'Currency'),
      field('VKORG', 'CHAR', 4, 0, 'Sales Organization'),
      field('VTWEG', 'CHAR', 2, 0, 'Distribution Channel'),
      field('SPART', 'CHAR', 2, 0, 'Division'),
      field('KUNNR', 'CHAR', 10, 0, 'Sold-to Party'),
      field('BSTNK', 'CHAR', 20, 0, 'Customer Purchase Order Number'),
      field('BUKRS', 'CHAR', 4, 0, 'Company Code'),
      field('ABSTK', 'CHAR', 1, 0, 'Rejection Status'),
      field('AEDAT', 'DATS', 8, 0, 'Changed On'),
      field('AENAM', 'CHAR', 12, 0, 'Changed By'),
      field('GBSTK', 'CHAR', 1, 0, 'Overall Status'),
      field('KNUMV', 'CHAR', 10, 0, 'Condition Number'),
      field('BNAME', 'CHAR', 12, 0, 'Name of Orderer'),
      field('KOSTL', 'CHAR', 10, 0, 'Cost Center'),
      field('XBLNR', 'CHAR', 16, 0, 'Reference Document Number'),
    ],
  };
}

function buildVBAP(): ReferenceTable {
  return {
    name: 'VBAP',
    description: 'Sales Document: Item Data',
    fields: [
      field('MANDT', 'CLNT', 3, 0, 'Client'),
      field('VBELN', 'CHAR', 10, 0, 'Sales Document Number'),
      field('POSNR', 'NUMC', 6, 0, 'Item Number'),
      field('MATNR', 'CHAR', 18, 0, 'Material Number'),
      field('ARKTX', 'CHAR', 40, 0, 'Item Short Text'),
      field('KWMENG', 'QUAN', 13, 3, 'Order Quantity in Sales Units'),
      field('VRKME', 'UNIT', 3, 0, 'Sales Unit'),
      field('MEINS', 'UNIT', 3, 0, 'Base Unit of Measure'),
      field('NETWR', 'CURR', 13, 2, 'Net Value'),
      field('WAERK', 'CUKY', 5, 0, 'Currency'),
      field('NETPR', 'CURR', 11, 2, 'Net Price'),
      field('WERKS', 'CHAR', 4, 0, 'Plant'),
      field('LGORT', 'CHAR', 4, 0, 'Storage Location'),
      field('ROUTE', 'CHAR', 6, 0, 'Route'),
      field('PSTYV', 'CHAR', 4, 0, 'Item Category'),
      field('ABGRU', 'CHAR', 2, 0, 'Rejection Reason'),
      field('ERDAT', 'DATS', 8, 0, 'Created On'),
      field('ERNAM', 'CHAR', 12, 0, 'Created By'),
      field('ERZET', 'TIMS', 6, 0, 'Created Time'),
      field('AEDAT', 'DATS', 8, 0, 'Changed On'),
      field('PRCTR', 'CHAR', 10, 0, 'Profit Center'),
      field('KOSTL', 'CHAR', 10, 0, 'Cost Center'),
      field('KBMENG', 'QUAN', 13, 3, 'Cumulative Confirmed Quantity'),
      field('SHKZG', 'CHAR', 1, 0, 'Returns Item'),
      field('FAKSP', 'CHAR', 2, 0, 'Billing Block'),
    ],
  };
}

function buildVBFA(): ReferenceTable {
  return {
    name: 'VBFA',
    description: 'Sales Document: Document Flow',
    fields: [
      field('MANDT', 'CLNT', 3, 0, 'Client'),
      field('VBELV', 'CHAR', 10, 0, 'Preceding Document'),
      field('POSNV', 'NUMC', 6, 0, 'Preceding Item'),
      field('VBELN', 'CHAR', 10, 0, 'Subsequent Document'),
      field('POSNN', 'NUMC', 6, 0, 'Subsequent Item'),
      field('VBTYP_N', 'CHAR', 1, 0, 'Subsequent Document Category'),
      field('VBTYP_V', 'CHAR', 1, 0, 'Preceding Document Category'),
      field('RFMNG', 'QUAN', 13, 3, 'Reference Quantity'),
      field('RFWRT', 'CURR', 13, 2, 'Reference Value'),
      field('ERDAT', 'DATS', 8, 0, 'Created On'),
      field('ERZET', 'TIMS', 6, 0, 'Created Time'),
      field('AEDAT', 'DATS', 8, 0, 'Changed On'),
    ],
  };
}

function buildLIKP(): ReferenceTable {
  return {
    name: 'LIKP',
    description: 'Delivery: Header Data',
    fields: [
      field('MANDT', 'CLNT', 3, 0, 'Client'),
      field('VBELN', 'CHAR', 10, 0, 'Delivery Number'),
      field('ERNAM', 'CHAR', 12, 0, 'Created By'),
      field('ERZET', 'TIMS', 6, 0, 'Created Time'),
      field('ERDAT', 'DATS', 8, 0, 'Created On'),
      field('VSTEL', 'CHAR', 4, 0, 'Shipping Point'),
      field('VKORG', 'CHAR', 4, 0, 'Sales Organization'),
      field('LFART', 'CHAR', 4, 0, 'Delivery Type'),
      field('WADAT', 'DATS', 8, 0, 'Planned Goods Movement Date'),
      field('WADAT_IST', 'DATS', 8, 0, 'Actual Goods Movement Date'),
      field('LDDAT', 'DATS', 8, 0, 'Loading Date'),
      field('TDDAT', 'DATS', 8, 0, 'Transportation Planning Date'),
      field('LFDAT', 'DATS', 8, 0, 'Requested Delivery Date'),
      field('ROUTE', 'CHAR', 6, 0, 'Route'),
      field('KUNNR', 'CHAR', 10, 0, 'Ship-to Party'),
      field('KUNAG', 'CHAR', 10, 0, 'Sold-to Party'),
      field('BTGEW', 'QUAN', 15, 3, 'Total Weight'),
      field('NTGEW', 'QUAN', 15, 3, 'Net Weight'),
      field('GEWEI', 'UNIT', 3, 0, 'Weight Unit'),
      field('WBSTK', 'CHAR', 1, 0, 'Total Goods Movement Status'),
      field('LIFSK', 'CHAR', 2, 0, 'Delivery Block'),
      field('FAKSK', 'CHAR', 2, 0, 'Billing Block'),
      field('WAERK', 'CUKY', 5, 0, 'Currency'),
      field('NETWR', 'CURR', 15, 2, 'Net Value'),
      field('AEDAT', 'DATS', 8, 0, 'Changed On'),
      field('AENAM', 'CHAR', 12, 0, 'Changed By'),
      field('BLDAT', 'DATS', 8, 0, 'Document Date'),
      field('TCODE', 'CHAR', 20, 0, 'Transaction Code'),
    ],
  };
}

function buildLIPS(): ReferenceTable {
  return {
    name: 'LIPS',
    description: 'Delivery: Item Data',
    fields: [
      field('MANDT', 'CLNT', 3, 0, 'Client'),
      field('VBELN', 'CHAR', 10, 0, 'Delivery Number'),
      field('POSNR', 'NUMC', 6, 0, 'Item Number'),
      field('MATNR', 'CHAR', 18, 0, 'Material Number'),
      field('ARKTX', 'CHAR', 40, 0, 'Item Short Text'),
      field('LFIMG', 'QUAN', 13, 3, 'Actual Delivery Quantity'),
      field('VRKME', 'UNIT', 3, 0, 'Sales Unit'),
      field('MEINS', 'UNIT', 3, 0, 'Base Unit of Measure'),
      field('ERNAM', 'CHAR', 12, 0, 'Created By'),
      field('ERDAT', 'DATS', 8, 0, 'Created On'),
      field('ERZET', 'TIMS', 6, 0, 'Created Time'),
      field('WERKS', 'CHAR', 4, 0, 'Plant'),
      field('LGORT', 'CHAR', 4, 0, 'Storage Location'),
      field('VGBEL', 'CHAR', 10, 0, 'Reference Document (Sales Order)'),
      field('VGPOS', 'NUMC', 6, 0, 'Reference Item'),
      field('CHARG', 'CHAR', 10, 0, 'Batch Number'),
      field('BWART', 'CHAR', 3, 0, 'Movement Type'),
      field('MTART', 'CHAR', 4, 0, 'Material Type'),
      field('KOSTL', 'CHAR', 10, 0, 'Cost Center'),
      field('NETWR', 'CURR', 13, 2, 'Net Value'),
      field('NETPR', 'CURR', 11, 2, 'Net Price'),
      field('FAKSP', 'CHAR', 2, 0, 'Billing Block'),
    ],
  };
}

function buildVBRK(): ReferenceTable {
  return {
    name: 'VBRK',
    description: 'Billing Document: Header Data',
    fields: [
      field('MANDT', 'CLNT', 3, 0, 'Client'),
      field('VBELN', 'CHAR', 10, 0, 'Billing Document Number'),
      field('FKART', 'CHAR', 4, 0, 'Billing Type'),
      field('FKDAT', 'DATS', 8, 0, 'Billing Date'),
      field('VBTYP', 'CHAR', 1, 0, 'Document Category'),
      field('ERNAM', 'CHAR', 12, 0, 'Created By'),
      field('ERZET', 'TIMS', 6, 0, 'Created Time'),
      field('ERDAT', 'DATS', 8, 0, 'Created On'),
      field('KUNAG', 'CHAR', 10, 0, 'Sold-to Party'),
      field('KUNRG', 'CHAR', 10, 0, 'Payer'),
      field('NETWR', 'CURR', 15, 2, 'Net Value'),
      field('WAERK', 'CUKY', 5, 0, 'Currency'),
      field('MWSBK', 'CURR', 13, 2, 'Tax Amount'),
      field('BUKRS', 'CHAR', 4, 0, 'Company Code'),
      field('BELNR', 'CHAR', 10, 0, 'Accounting Document Number'),
      field('GJAHR', 'NUMC', 4, 0, 'Fiscal Year'),
      field('FKSTO', 'CHAR', 1, 0, 'Billing Document Is Cancelled'),
      field('AEDAT', 'DATS', 8, 0, 'Changed On'),
      field('VKORG', 'CHAR', 4, 0, 'Sales Organization'),
      field('VTWEG', 'CHAR', 2, 0, 'Distribution Channel'),
      field('SPART', 'CHAR', 2, 0, 'Division'),
      field('ZTERM', 'CHAR', 4, 0, 'Payment Terms'),
      field('LAND1', 'CHAR', 3, 0, 'Country Key'),
      field('XBLNR', 'CHAR', 16, 0, 'Reference Document Number'),
    ],
  };
}

function buildVBRP(): ReferenceTable {
  return {
    name: 'VBRP',
    description: 'Billing Document: Item Data',
    fields: [
      field('MANDT', 'CLNT', 3, 0, 'Client'),
      field('VBELN', 'CHAR', 10, 0, 'Billing Document Number'),
      field('POSNR', 'NUMC', 6, 0, 'Item Number'),
      field('FKIMG', 'QUAN', 13, 3, 'Billed Quantity'),
      field('VRKME', 'UNIT', 3, 0, 'Sales Unit'),
      field('MEINS', 'UNIT', 3, 0, 'Base Unit of Measure'),
      field('NETWR', 'CURR', 13, 2, 'Net Value'),
      field('MATNR', 'CHAR', 18, 0, 'Material Number'),
      field('ARKTX', 'CHAR', 40, 0, 'Item Short Text'),
      field('WERKS', 'CHAR', 4, 0, 'Plant'),
      field('VGBEL', 'CHAR', 10, 0, 'Reference Document (Delivery)'),
      field('VGPOS', 'NUMC', 6, 0, 'Reference Item'),
      field('AUBEL', 'CHAR', 10, 0, 'Sales Order Reference'),
      field('AUPOS', 'NUMC', 6, 0, 'Sales Order Item Reference'),
      field('VBELV', 'CHAR', 10, 0, 'Preceding Document'),
      field('POSNV', 'NUMC', 6, 0, 'Preceding Item'),
      field('ERNAM', 'CHAR', 12, 0, 'Created By'),
      field('ERDAT', 'DATS', 8, 0, 'Created On'),
      field('ERZET', 'TIMS', 6, 0, 'Created Time'),
      field('KOSTL', 'CHAR', 10, 0, 'Cost Center'),
      field('MWSKZ', 'CHAR', 2, 0, 'Tax Code'),
      field('MATKL', 'CHAR', 9, 0, 'Material Group'),
    ],
  };
}

// ============================================================================
// FI/CO Tables
// ============================================================================

function buildBKPF(): ReferenceTable {
  return {
    name: 'BKPF',
    description: 'Accounting Document: Header',
    fields: [
      field('MANDT', 'CLNT', 3, 0, 'Client'),
      field('BUKRS', 'CHAR', 4, 0, 'Company Code'),
      field('BELNR', 'CHAR', 10, 0, 'Accounting Document Number'),
      field('GJAHR', 'NUMC', 4, 0, 'Fiscal Year'),
      field('BLART', 'CHAR', 2, 0, 'Document Type'),
      field('BLDAT', 'DATS', 8, 0, 'Document Date'),
      field('BUDAT', 'DATS', 8, 0, 'Posting Date'),
      field('MONAT', 'NUMC', 2, 0, 'Posting Period'),
      field('CPUDT', 'DATS', 8, 0, 'Entry Date'),
      field('CPUTM', 'TIMS', 6, 0, 'Entry Time'),
      field('USNAM', 'CHAR', 12, 0, 'User Name'),
      field('TCODE', 'CHAR', 20, 0, 'Transaction Code'),
      field('XBLNR', 'CHAR', 16, 0, 'Reference Document Number'),
      field('BKTXT', 'CHAR', 25, 0, 'Document Header Text'),
      field('WAERS', 'CUKY', 5, 0, 'Currency Key'),
      field('STBLG', 'CHAR', 10, 0, 'Reversal Document Number'),
      field('STJAH', 'NUMC', 4, 0, 'Reversal Fiscal Year'),
      field('BSTAT', 'CHAR', 1, 0, 'Document Status'),
      field('AWTYP', 'CHAR', 5, 0, 'Reference Transaction'),
      field('AWKEY', 'CHAR', 20, 0, 'Reference Key'),
      field('PPNAM', 'CHAR', 12, 0, 'Parked By'),
      field('AEDAT', 'DATS', 8, 0, 'Changed On'),
      field('GRPID', 'CHAR', 12, 0, 'Group ID'),
      field('STGRD', 'CHAR', 2, 0, 'Reversal Reason'),
      field('DBBLG', 'CHAR', 10, 0, 'Recurring Entry Document'),
      field('KURSF', 'DEC', 9, 5, 'Exchange Rate'),
    ],
  };
}

function buildBSEG(): ReferenceTable {
  return {
    name: 'BSEG',
    description: 'Accounting Document: Line Items',
    fields: [
      field('MANDT', 'CLNT', 3, 0, 'Client'),
      field('BUKRS', 'CHAR', 4, 0, 'Company Code'),
      field('BELNR', 'CHAR', 10, 0, 'Accounting Document Number'),
      field('GJAHR', 'NUMC', 4, 0, 'Fiscal Year'),
      field('BUZEI', 'NUMC', 3, 0, 'Line Item Number'),
      field('BSCHL', 'CHAR', 2, 0, 'Posting Key'),
      field('KOART', 'CHAR', 1, 0, 'Account Type'),
      field('HKONT', 'CHAR', 10, 0, 'GL Account Number'),
      field('SAKNR', 'CHAR', 10, 0, 'GL Account (Chart of Accounts level)'),
      field('SHKZG', 'CHAR', 1, 0, 'Debit/Credit Indicator'),
      field('DMBTR', 'CURR', 13, 2, 'Amount in Local Currency'),
      field('WRBTR', 'CURR', 13, 2, 'Amount in Document Currency'),
      field('WAERS', 'CUKY', 5, 0, 'Currency Key'),
      field('MWSKZ', 'CHAR', 2, 0, 'Tax Code'),
      field('KOSTL', 'CHAR', 10, 0, 'Cost Center'),
      field('PRCTR', 'CHAR', 10, 0, 'Profit Center'),
      field('AUFNR', 'CHAR', 12, 0, 'Internal Order Number'),
      field('ZUONR', 'CHAR', 18, 0, 'Assignment Number'),
      field('SGTXT', 'CHAR', 50, 0, 'Line Item Text'),
      field('KUNNR', 'CHAR', 10, 0, 'Customer Number'),
      field('LIFNR', 'CHAR', 10, 0, 'Vendor Number'),
      field('AUGBL', 'CHAR', 10, 0, 'Clearing Document Number'),
      field('AUGDT', 'DATS', 8, 0, 'Clearing Date'),
      field('ZFBDT', 'DATS', 8, 0, 'Baseline Date for Payment'),
      field('ZTERM', 'CHAR', 4, 0, 'Payment Terms'),
      field('GSBER', 'CHAR', 4, 0, 'Business Area'),
      field('VBUND', 'CHAR', 6, 0, 'Trading Partner'),
      field('XBILK', 'CHAR', 1, 0, 'Balance Sheet Indicator'),
      field('KOKRS', 'CHAR', 4, 0, 'Controlling Area'),
      field('VBELN', 'CHAR', 10, 0, 'Sales Document Number'),
      field('EBELN', 'CHAR', 10, 0, 'Purchase Order Number'),
      field('EBELP', 'NUMC', 5, 0, 'Purchase Order Item'),
      field('MATNR', 'CHAR', 18, 0, 'Material Number'),
      field('WERKS', 'CHAR', 4, 0, 'Plant'),
      field('KSTAR', 'CHAR', 10, 0, 'Cost Element'),
    ],
  };
}

function buildSKA1(): ReferenceTable {
  return {
    name: 'SKA1',
    description: 'GL Account Master: Chart of Accounts',
    fields: [
      field('MANDT', 'CLNT', 3, 0, 'Client'),
      field('KTOPL', 'CHAR', 4, 0, 'Chart of Accounts'),
      field('SAKNR', 'CHAR', 10, 0, 'GL Account Number'),
      field('XBILK', 'CHAR', 1, 0, 'Balance Sheet Account Indicator'),
      field('KTOKS', 'CHAR', 4, 0, 'Account Group'),
      field('TXT20', 'CHAR', 20, 0, 'Short Description'),
      field('TXT50', 'CHAR', 50, 0, 'Long Description'),
    ],
  };
}

// ============================================================================
// P2P Tables
// ============================================================================

function buildEKKO(): ReferenceTable {
  return {
    name: 'EKKO',
    description: 'Purchasing Document: Header',
    fields: [
      field('MANDT', 'CLNT', 3, 0, 'Client'),
      field('EBELN', 'CHAR', 10, 0, 'Purchase Order Number'),
      field('BUKRS', 'CHAR', 4, 0, 'Company Code'),
      field('BSTYP', 'CHAR', 1, 0, 'Document Category'),
      field('BSART', 'CHAR', 4, 0, 'Document Type'),
      field('LOEKZ', 'CHAR', 1, 0, 'Deletion Indicator'),
      field('STATU', 'CHAR', 1, 0, 'Status'),
      field('AEDAT', 'DATS', 8, 0, 'Changed On / Creation Date'),
      field('ERNAM', 'CHAR', 12, 0, 'Created By'),
      field('LIFNR', 'CHAR', 10, 0, 'Vendor Number'),
      field('SPRAS', 'LANG', 1, 0, 'Language Key'),
      field('ZTERM', 'CHAR', 4, 0, 'Payment Terms'),
      field('EKORG', 'CHAR', 4, 0, 'Purchasing Organization'),
      field('EKGRP', 'CHAR', 3, 0, 'Purchasing Group'),
      field('WAERS', 'CUKY', 5, 0, 'Currency Key'),
      field('BEDAT', 'DATS', 8, 0, 'Purchase Order Date'),
      field('KUNNR', 'CHAR', 10, 0, 'Customer Number'),
      field('KONNR', 'CHAR', 10, 0, 'Outline Agreement Number'),
      field('FRGGR', 'CHAR', 2, 0, 'Release Group'),
      field('FRGSX', 'CHAR', 2, 0, 'Release Strategy'),
      field('FRGKE', 'CHAR', 1, 0, 'Release Indicator'),
      field('FRGZU', 'CHAR', 8, 0, 'Release Status'),
      field('FRGRL', 'CHAR', 1, 0, 'Release Not Yet Complete'),
      field('RLWRT', 'CURR', 15, 2, 'Total Value at Release'),
      field('LANDS', 'CHAR', 3, 0, 'Country Key'),
      field('LIFRE', 'CHAR', 10, 0, 'Invoicing Party'),
      field('INCO1', 'CHAR', 3, 0, 'Incoterms Part 1'),
      field('INCO2', 'CHAR', 28, 0, 'Incoterms Part 2'),
      field('KTWRT', 'CURR', 15, 2, 'Target Value'),
    ],
  };
}

function buildEKPO(): ReferenceTable {
  return {
    name: 'EKPO',
    description: 'Purchasing Document: Item Data',
    fields: [
      field('MANDT', 'CLNT', 3, 0, 'Client'),
      field('EBELN', 'CHAR', 10, 0, 'Purchase Order Number'),
      field('EBELP', 'NUMC', 5, 0, 'Item Number'),
      field('LOEKZ', 'CHAR', 1, 0, 'Deletion Indicator'),
      field('STATU', 'CHAR', 1, 0, 'Status'),
      field('AEDAT', 'DATS', 8, 0, 'Changed On'),
      field('TXZ01', 'CHAR', 40, 0, 'Short Text'),
      field('MATNR', 'CHAR', 18, 0, 'Material Number'),
      field('BUKRS', 'CHAR', 4, 0, 'Company Code'),
      field('WERKS', 'CHAR', 4, 0, 'Plant'),
      field('LGORT', 'CHAR', 4, 0, 'Storage Location'),
      field('MATKL', 'CHAR', 9, 0, 'Material Group'),
      field('MENGE', 'QUAN', 13, 3, 'Order Quantity'),
      field('MEINS', 'UNIT', 3, 0, 'Unit of Measure'),
      field('BPRME', 'UNIT', 3, 0, 'Order Price Unit'),
      field('NETPR', 'CURR', 11, 2, 'Net Price'),
      field('NETWR', 'CURR', 13, 2, 'Net Order Value'),
      field('BRTWR', 'CURR', 13, 2, 'Gross Order Value'),
      field('MWSKZ', 'CHAR', 2, 0, 'Tax Code'),
      field('BANFN', 'CHAR', 10, 0, 'Linked Purchase Requisition'),
      field('BNFPO', 'NUMC', 5, 0, 'Linked Requisition Item'),
      field('MTART', 'CHAR', 4, 0, 'Material Type'),
      field('KONNR', 'CHAR', 10, 0, 'Outline Agreement Number'),
      field('ANFNR', 'CHAR', 10, 0, 'RFQ Number'),
      field('ANFPS', 'NUMC', 5, 0, 'RFQ Item'),
      field('WEBRE', 'CHAR', 1, 0, 'GR-Based Invoice Verification'),
      field('REPOS', 'CHAR', 1, 0, 'Invoice Receipt Indicator'),
      field('KUNNR', 'CHAR', 10, 0, 'Customer Number'),
      field('WAERS', 'CUKY', 5, 0, 'Currency Key'),
    ],
  };
}

function buildEBAN(): ReferenceTable {
  return {
    name: 'EBAN',
    description: 'Purchase Requisition',
    fields: [
      field('MANDT', 'CLNT', 3, 0, 'Client'),
      field('BANFN', 'CHAR', 10, 0, 'Purchase Requisition Number'),
      field('BNFPO', 'NUMC', 5, 0, 'Item Number'),
      field('BSART', 'CHAR', 4, 0, 'Document Type'),
      field('BSTYP', 'CHAR', 1, 0, 'Document Category'),
      field('LOEKZ', 'CHAR', 1, 0, 'Deletion Indicator'),
      field('STATU', 'CHAR', 1, 0, 'Processing Status'),
      field('FRGKZ', 'CHAR', 1, 0, 'Release Indicator'),
      field('FRGZU', 'CHAR', 8, 0, 'Release Status'),
      field('FRGDT', 'DATS', 8, 0, 'Release Date'),
      field('EKGRP', 'CHAR', 3, 0, 'Purchasing Group'),
      field('ERNAM', 'CHAR', 12, 0, 'Created By'),
      field('ERDAT', 'DATS', 8, 0, 'Created On'),
      field('TXZ01', 'CHAR', 40, 0, 'Short Text'),
      field('MATNR', 'CHAR', 18, 0, 'Material Number'),
      field('WERKS', 'CHAR', 4, 0, 'Plant'),
      field('LGORT', 'CHAR', 4, 0, 'Storage Location'),
      field('MATKL', 'CHAR', 9, 0, 'Material Group'),
      field('MENGE', 'QUAN', 13, 3, 'Requisition Quantity'),
      field('MEINS', 'UNIT', 3, 0, 'Unit of Measure'),
      field('BADAT', 'DATS', 8, 0, 'Requisition Date'),
      field('LFDAT', 'DATS', 8, 0, 'Requested Delivery Date'),
      field('PREIS', 'CURR', 11, 2, 'Price'),
      field('WAERS', 'CUKY', 5, 0, 'Currency Key'),
      field('LIFNR', 'CHAR', 10, 0, 'Preferred Vendor'),
      field('EBELN', 'CHAR', 10, 0, 'Linked Purchase Order'),
      field('EBELP', 'NUMC', 5, 0, 'Linked PO Item'),
      field('BEDAT', 'DATS', 8, 0, 'Purchase Order Date'),
      field('EKORG', 'CHAR', 4, 0, 'Purchasing Organization'),
      field('RLWRT', 'CURR', 15, 2, 'Total Value at Release'),
    ],
  };
}

function buildEKBE(): ReferenceTable {
  return {
    name: 'EKBE',
    description: 'Purchasing Document: History',
    fields: [
      field('MANDT', 'CLNT', 3, 0, 'Client'),
      field('EBELN', 'CHAR', 10, 0, 'Purchase Order Number'),
      field('EBELP', 'NUMC', 5, 0, 'Item Number'),
      field('ZEKKN', 'NUMC', 2, 0, 'Sequential Account Assignment'),
      field('VGABE', 'CHAR', 1, 0, 'Transaction Type'),
      field('GJAHR', 'NUMC', 4, 0, 'Fiscal Year'),
      field('BELNR', 'CHAR', 10, 0, 'Document Number'),
      field('BUZEI', 'NUMC', 4, 0, 'Line Item Number'),
      field('BEWTP', 'CHAR', 1, 0, 'PO History Category'),
      field('BUDAT', 'DATS', 8, 0, 'Posting Date'),
      field('CPUDT', 'DATS', 8, 0, 'Entry Date'),
      field('USNAM', 'CHAR', 12, 0, 'User Name'),
      field('MENGE', 'QUAN', 13, 3, 'Quantity'),
      field('DMBTR', 'CURR', 13, 2, 'Amount in Local Currency'),
      field('WRBTR', 'CURR', 13, 2, 'Amount in Document Currency'),
      field('WAERS', 'CUKY', 5, 0, 'Currency Key'),
      field('BWART', 'CHAR', 3, 0, 'Movement Type'),
      field('MATNR', 'CHAR', 18, 0, 'Material Number'),
      field('WERKS', 'CHAR', 4, 0, 'Plant'),
      field('XBLNR', 'CHAR', 16, 0, 'Reference Document Number'),
    ],
  };
}

function buildRBKP(): ReferenceTable {
  return {
    name: 'RBKP',
    description: 'Invoice Verification: Document Header',
    fields: [
      field('MANDT', 'CLNT', 3, 0, 'Client'),
      field('BELNR', 'CHAR', 10, 0, 'Invoice Document Number'),
      field('GJAHR', 'NUMC', 4, 0, 'Fiscal Year'),
      field('BUKRS', 'CHAR', 4, 0, 'Company Code'),
      field('LIFNR', 'CHAR', 10, 0, 'Vendor Number'),
      field('BLDAT', 'DATS', 8, 0, 'Document Date'),
      field('BUDAT', 'DATS', 8, 0, 'Posting Date'),
      field('CPUDT', 'DATS', 8, 0, 'Entry Date'),
      field('USNAM', 'CHAR', 12, 0, 'User Name'),
      field('TCODE', 'CHAR', 20, 0, 'Transaction Code'),
      field('RMWWR', 'CURR', 13, 2, 'Invoice Amount (Gross)'),
      field('WAERS', 'CUKY', 5, 0, 'Currency Key'),
      field('SGTXT', 'CHAR', 50, 0, 'Document Text'),
      field('XBLNR', 'CHAR', 16, 0, 'Reference Document Number'),
      field('STBLG', 'CHAR', 10, 0, 'Reversal Document Number'),
      field('STJAH', 'NUMC', 4, 0, 'Reversal Fiscal Year'),
      field('ZTERM', 'CHAR', 4, 0, 'Payment Terms'),
    ],
  };
}

function buildRSEG(): ReferenceTable {
  return {
    name: 'RSEG',
    description: 'Invoice Verification: Document Items',
    fields: [
      field('MANDT', 'CLNT', 3, 0, 'Client'),
      field('BELNR', 'CHAR', 10, 0, 'Invoice Document Number'),
      field('GJAHR', 'NUMC', 4, 0, 'Fiscal Year'),
      field('BUZEI', 'NUMC', 4, 0, 'Line Item Number'),
      field('EBELN', 'CHAR', 10, 0, 'Purchase Order Number'),
      field('EBELP', 'NUMC', 5, 0, 'Purchase Order Item'),
      field('MATNR', 'CHAR', 18, 0, 'Material Number'),
      field('WERKS', 'CHAR', 4, 0, 'Plant'),
      field('MENGE', 'QUAN', 13, 3, 'Quantity'),
      field('WRBTR', 'CURR', 13, 2, 'Amount in Document Currency'),
      field('DMBTR', 'CURR', 13, 2, 'Amount in Local Currency'),
      field('WAERS', 'CUKY', 5, 0, 'Currency Key'),
      field('BWART', 'CHAR', 3, 0, 'Movement Type'),
      field('SHKZG', 'CHAR', 1, 0, 'Debit/Credit Indicator'),
      field('MWSKZ', 'CHAR', 2, 0, 'Tax Code'),
    ],
  };
}

// ============================================================================
// Master Data Tables
// ============================================================================

function buildKNA1(): ReferenceTable {
  return {
    name: 'KNA1',
    description: 'Customer Master: General Data',
    fields: [
      field('MANDT', 'CLNT', 3, 0, 'Client'),
      field('KUNNR', 'CHAR', 10, 0, 'Customer Number'),
      field('LAND1', 'CHAR', 3, 0, 'Country Key'),
      field('NAME1', 'CHAR', 35, 0, 'Name 1'),
      field('NAME2', 'CHAR', 35, 0, 'Name 2'),
      field('ORT01', 'CHAR', 35, 0, 'City'),
      field('PSTLZ', 'CHAR', 10, 0, 'Postal Code'),
      field('REGIO', 'CHAR', 3, 0, 'Region'),
      field('STRAS', 'CHAR', 35, 0, 'Street'),
      field('KTOKD', 'CHAR', 4, 0, 'Account Group'),
      field('ERDAT', 'DATS', 8, 0, 'Created On'),
      field('ERNAM', 'CHAR', 12, 0, 'Created By'),
      field('LOEVM', 'CHAR', 1, 0, 'Deletion Flag'),
      field('SPERR', 'CHAR', 1, 0, 'Central Posting Block'),
      field('SPRAS', 'LANG', 1, 0, 'Language Key'),
      field('BRSCH', 'CHAR', 4, 0, 'Industry Key'),
      field('KUKLA', 'CHAR', 2, 0, 'Customer Classification'),
      field('LIFNR', 'CHAR', 10, 0, 'Vendor Account (linked)'),
      field('AUFSD', 'CHAR', 2, 0, 'Order Block'),
      field('LIFSD', 'CHAR', 2, 0, 'Delivery Block'),
      field('FAKSD', 'CHAR', 2, 0, 'Billing Block'),
      field('STCD1', 'CHAR', 16, 0, 'Tax Number 1'),
      field('STCEG', 'CHAR', 20, 0, 'VAT Registration Number'),
      field('KONZS', 'CHAR', 10, 0, 'Group Key'),
      field('VBUND', 'CHAR', 6, 0, 'Trading Partner'),
      field('KDKG1', 'CHAR', 2, 0, 'Customer Condition Group 1'),
    ],
  };
}

function buildLFA1(): ReferenceTable {
  return {
    name: 'LFA1',
    description: 'Vendor Master: General Data',
    fields: [
      field('MANDT', 'CLNT', 3, 0, 'Client'),
      field('LIFNR', 'CHAR', 10, 0, 'Vendor Number'),
      field('LAND1', 'CHAR', 3, 0, 'Country Key'),
      field('NAME1', 'CHAR', 35, 0, 'Name 1'),
      field('NAME2', 'CHAR', 35, 0, 'Name 2'),
      field('ORT01', 'CHAR', 35, 0, 'City'),
      field('PSTLZ', 'CHAR', 10, 0, 'Postal Code'),
      field('REGIO', 'CHAR', 3, 0, 'Region'),
      field('STRAS', 'CHAR', 35, 0, 'Street'),
      field('KTOKK', 'CHAR', 4, 0, 'Account Group'),
      field('ERDAT', 'DATS', 8, 0, 'Created On'),
      field('ERNAM', 'CHAR', 12, 0, 'Created By'),
      field('LOEVM', 'CHAR', 1, 0, 'Deletion Flag'),
      field('SPERR', 'CHAR', 1, 0, 'Central Posting Block'),
      field('SPERM', 'CHAR', 1, 0, 'Purchasing Block'),
      field('STCD1', 'CHAR', 16, 0, 'Tax Number 1'),
      field('STCD2', 'CHAR', 11, 0, 'Tax Number 2'),
      field('STCEG', 'CHAR', 20, 0, 'VAT Registration Number'),
      field('KUNNR', 'CHAR', 10, 0, 'Customer Account (linked)'),
      field('LNRZA', 'CHAR', 10, 0, 'Alternative Payee'),
      field('VBUND', 'CHAR', 6, 0, 'Trading Partner'),
      field('BRSCH', 'CHAR', 4, 0, 'Industry Key'),
      field('SPERQ', 'CHAR', 2, 0, 'Quality Management Block'),
      field('REVDB', 'DATS', 8, 0, 'Last Review Date'),
      field('WERKS', 'CHAR', 4, 0, 'Plant'),
      field('TXJCD', 'CHAR', 15, 0, 'Tax Jurisdiction'),
    ],
  };
}

function buildMARA(): ReferenceTable {
  return {
    name: 'MARA',
    description: 'Material Master: General Data',
    fields: [
      field('MANDT', 'CLNT', 3, 0, 'Client'),
      field('MATNR', 'CHAR', 18, 0, 'Material Number'),
      field('ERSDA', 'DATS', 8, 0, 'Created On'),
      field('ERNAM', 'CHAR', 12, 0, 'Created By'),
      field('LAEDA', 'DATS', 8, 0, 'Last Changed On'),
      field('AENAM', 'CHAR', 12, 0, 'Changed By'),
      field('LVORM', 'CHAR', 1, 0, 'Deletion Flag'),
      field('MTART', 'CHAR', 4, 0, 'Material Type'),
      field('MATKL', 'CHAR', 9, 0, 'Material Group'),
      field('MEINS', 'UNIT', 3, 0, 'Base Unit of Measure'),
      field('BSTME', 'UNIT', 3, 0, 'Order Unit'),
      field('GEWEI', 'UNIT', 3, 0, 'Weight Unit'),
      field('VOLEH', 'UNIT', 3, 0, 'Volume Unit'),
      field('EAN11', 'CHAR', 18, 0, 'EAN/UPC Code'),
      field('BEGRU', 'CHAR', 4, 0, 'Authorization Group'),
      field('MFRPN', 'CHAR', 40, 0, 'Manufacturer Part Number'),
      field('MFRNR', 'CHAR', 10, 0, 'Manufacturer Number'),
      field('SPART', 'CHAR', 2, 0, 'Division'),
      field('KUNNR', 'CHAR', 10, 0, 'Customer Number'),
    ],
  };
}

// ============================================================================
// Public API
// ============================================================================

/** Build the complete IDES reference schema (19 tables) */
export function buildIDESReferenceSchema(): Map<string, ReferenceTable> {
  const schema = new Map<string, ReferenceTable>();

  // O2C tables
  schema.set('VBAK', buildVBAK());
  schema.set('VBAP', buildVBAP());
  schema.set('VBFA', buildVBFA());
  schema.set('LIKP', buildLIKP());
  schema.set('LIPS', buildLIPS());
  schema.set('VBRK', buildVBRK());
  schema.set('VBRP', buildVBRP());

  // FI/CO tables
  schema.set('BKPF', buildBKPF());
  schema.set('BSEG', buildBSEG());
  schema.set('SKA1', buildSKA1());

  // P2P tables
  schema.set('EKKO', buildEKKO());
  schema.set('EKPO', buildEKPO());
  schema.set('EBAN', buildEBAN());
  schema.set('EKBE', buildEKBE());
  schema.set('RBKP', buildRBKP());
  schema.set('RSEG', buildRSEG());

  // Master data tables
  schema.set('KNA1', buildKNA1());
  schema.set('LFA1', buildLFA1());
  schema.set('MARA', buildMARA());

  return schema;
}

/** Get a sorted list of all reference table names */
export function getReferenceTableNames(): string[] {
  const schema = buildIDESReferenceSchema();
  return [...schema.keys()].sort();
}

/** Get field names for a specific reference table (undefined if table not found) */
export function getReferenceFields(tableName: string): string[] | undefined {
  const schema = buildIDESReferenceSchema();
  const table = schema.get(tableName);
  if (!table) return undefined;
  return table.fields.map(f => f.name);
}

/** Get total table/field counts across the reference schema */
export function getReferenceStats(): { tableCount: number; totalFields: number } {
  const schema = buildIDESReferenceSchema();
  let totalFields = 0;
  for (const table of schema.values()) {
    totalFields += table.fields.length;
  }
  return { tableCount: schema.size, totalFields };
}
