/**
 * SAP RFC Call Wrappers
 *
 * Typed wrapper functions for specific SAP RFC/BAPI calls.
 * Each function handles parameter formatting and response structure.
 */

import type { RFCConnectionPool } from './connection-pool.js';
import { RFCNotFoundError, createErrorFromBapiReturn } from './errors.js';

/**
 * Document number padding utility
 * SAP document numbers are 10 characters, left-padded with zeros
 */
export function padDocNumber(docNum: string): string {
  const cleaned = docNum.replace(/\D/g, '');
  return cleaned.padStart(10, '0');
}

// ============================================================================
// READ_TEXT - Document Long Texts
// ============================================================================

/**
 * Parameters for READ_TEXT function module
 */
export interface ReadTextParams {
  /** Text Object (e.g., 'VBBK' for sales header, 'VBBP' for item) */
  object: string;
  /** Text Name (usually document number + optional line) */
  name: string;
  /** Text ID (e.g., '0001' for header text, '0002' for item text) */
  id: string;
  /** Language (e.g., 'EN') */
  language: string;
}

/**
 * READ_TEXT response structure
 */
export interface ReadTextResult {
  /** Text lines from LINES table */
  lines: Array<{
    /** Line formatting (e.g., '*' for paragraph) */
    tdformat: string;
    /** Text content */
    tdline: string;
  }>;
  /** Text header info */
  header: {
    tdobject: string;
    tdname: string;
    tdid: string;
    tdspras: string;
  };
}

/**
 * Call READ_TEXT to retrieve document long texts
 */
export async function callReadText(
  pool: RFCConnectionPool,
  params: ReadTextParams
): Promise<ReadTextResult> {
  const result = await pool.call<Record<string, unknown>>('READ_TEXT', {
    ID: params.id,
    LANGUAGE: params.language,
    NAME: params.name,
    OBJECT: params.object,
  });

  // READ_TEXT returns LINES table and HEADER structure
  const lines = (result.LINES as Array<Record<string, string>>) || [];
  const header = (result.HEADER as Record<string, string>) || {};

  return {
    lines: lines.map(line => ({
      tdformat: line.TDFORMAT || '',
      tdline: line.TDLINE || '',
    })),
    header: {
      tdobject: header.TDOBJECT || params.object,
      tdname: header.TDNAME || params.name,
      tdid: header.TDID || params.id,
      tdspras: header.TDSPRAS || params.language,
    },
  };
}

// ============================================================================
// BAPI_SALESORDER_GETLIST - List Sales Orders
// ============================================================================

/**
 * Parameters for BAPI_SALESORDER_GETLIST
 */
export interface SalesOrderListParams {
  /** Customer number (optional) */
  customerNumber?: string;
  /** Sales organization (optional) */
  salesOrganization?: string;
  /** Document date from (YYYYMMDD) */
  documentDateFrom?: string;
  /** Document date to (YYYYMMDD) */
  documentDateTo?: string;
  /** Maximum rows to return */
  maxRows?: number;
}

/**
 * Single order from list result
 */
export interface SalesOrderListItem {
  salesDocument: string;
  soldToParty: string;
  shipToParty: string;
  purchaseOrderNumber: string;
  salesDocumentDate: string;
  netValue: number;
  currency: string;
}

/**
 * Call BAPI_SALESORDER_GETLIST
 */
export async function callBapiSalesorderGetlist(
  pool: RFCConnectionPool,
  params: SalesOrderListParams
): Promise<SalesOrderListItem[]> {
  const rfcParams: Record<string, unknown> = {};

  if (params.customerNumber) {
    rfcParams.CUSTOMER_NUMBER = padDocNumber(params.customerNumber);
  }
  if (params.salesOrganization) {
    rfcParams.SALES_ORGANIZATION = params.salesOrganization;
  }
  if (params.documentDateFrom) {
    rfcParams.DOCUMENT_DATE_LOW = params.documentDateFrom;
  }
  if (params.documentDateTo) {
    rfcParams.DOCUMENT_DATE_HIGH = params.documentDateTo;
  }
  if (params.maxRows) {
    rfcParams.MAX_ROWS = params.maxRows;
  }

  const result = await pool.call<Record<string, unknown>>('BAPI_SALESORDER_GETLIST', rfcParams);

  // Check for BAPI errors
  const returnErr = createErrorFromBapiReturn(result.RETURN, 'BAPI_SALESORDER_GETLIST');
  if (returnErr) {
    throw returnErr;
  }

  const orders = (result.SALES_ORDERS as Array<Record<string, unknown>>) || [];

  return orders.map(order => ({
    salesDocument: String(order.SD_DOC || ''),
    soldToParty: String(order.SOLD_TO || ''),
    shipToParty: String(order.SHIP_TO || ''),
    purchaseOrderNumber: String(order.PURCH_NO || ''),
    salesDocumentDate: String(order.DOC_DATE || ''),
    netValue: Number(order.NET_VALUE || 0),
    currency: String(order.CURRENCY || ''),
  }));
}

// ============================================================================
// SD_SALESDOCUMENT_READ - Read Sales Document (Header + Items)
// ============================================================================

/**
 * Sales document header from SD_SALESDOCUMENT_READ
 */
export interface SalesDocHeader {
  vbeln: string; // Document number
  auart: string; // Document type
  vkorg: string; // Sales org
  vtweg: string; // Distribution channel
  spart: string; // Division
  kunnr: string; // Sold-to party
  kunwe: string; // Ship-to party
  bstnk: string; // PO number
  erdat: string; // Created date
  erzet: string; // Created time
  ernam: string; // Created by
  aedat: string; // Changed date
  netwr: number; // Net value
  waerk: string; // Currency
  vdatu: string; // Requested delivery date
  bstdk: string; // PO date
}

/**
 * Sales document item from SD_SALESDOCUMENT_READ
 */
export interface SalesDocItem {
  posnr: string; // Item number
  matnr: string; // Material
  arktx: string; // Description
  kwmeng: number; // Order quantity
  vrkme: string; // Unit
  netwr: number; // Net value
  waerk: string; // Currency
  werks: string; // Plant
  lgort: string; // Storage location
  pstyv: string; // Item category
  abgru: string; // Rejection reason
}

/**
 * Call SD_SALESDOCUMENT_READ to get order header and items
 */
export async function callSDSalesdocumentRead(
  pool: RFCConnectionPool,
  documentNumber: string
): Promise<{ header: SalesDocHeader; items: SalesDocItem[] }> {
  const result = await pool.call<Record<string, unknown>>('SD_SALESDOCUMENT_READ', {
    DOCUMENT_NUMBER: padDocNumber(documentNumber),
  });

  // Check if document exists
  const docHeader = result.SALES_HEADER as Record<string, unknown> | undefined;
  if (!docHeader || !docHeader.VBELN) {
    throw new RFCNotFoundError(`Sales document ${documentNumber} not found`);
  }

  const header: SalesDocHeader = {
    vbeln: String(docHeader.VBELN || ''),
    auart: String(docHeader.AUART || ''),
    vkorg: String(docHeader.VKORG || ''),
    vtweg: String(docHeader.VTWEG || ''),
    spart: String(docHeader.SPART || ''),
    kunnr: String(docHeader.KUNNR || ''),
    kunwe: String(docHeader.KUNWE || ''),
    bstnk: String(docHeader.BSTNK || ''),
    erdat: String(docHeader.ERDAT || ''),
    erzet: String(docHeader.ERZET || ''),
    ernam: String(docHeader.ERNAM || ''),
    aedat: String(docHeader.AEDAT || ''),
    netwr: Number(docHeader.NETWR || 0),
    waerk: String(docHeader.WAERK || ''),
    vdatu: String(docHeader.VDATU || ''),
    bstdk: String(docHeader.BSTDK || ''),
  };

  const itemsRaw = (result.SALES_ITEMS as Array<Record<string, unknown>>) || [];
  const items: SalesDocItem[] = itemsRaw.map(item => ({
    posnr: String(item.POSNR || ''),
    matnr: String(item.MATNR || ''),
    arktx: String(item.ARKTX || ''),
    kwmeng: Number(item.KWMENG || 0),
    vrkme: String(item.VRKME || ''),
    netwr: Number(item.NETWR || 0),
    waerk: String(item.WAERK || ''),
    werks: String(item.WERKS || ''),
    lgort: String(item.LGORT || ''),
    pstyv: String(item.PSTYV || ''),
    abgru: String(item.ABGRU || ''),
  }));

  return { header, items };
}

// ============================================================================
// BAPI_SALESDOCU_GETRELATIONS - Document Flow (VBFA)
// ============================================================================

/**
 * Document flow entry (predecessor/successor relationship)
 */
export interface DocFlowEntry {
  vbelv: string; // Preceding document
  posnv: string; // Preceding item
  vbeln: string; // Subsequent document
  posnn: string; // Subsequent item
  vbtyp_n: string; // Document category
  rfmng: number; // Reference quantity
  rfwrt: number; // Reference value
  waers: string; // Currency
  erdat: string; // Created date
  erzet: string; // Created time
}

/**
 * Call BAPI_SALESDOCU_GETRELATIONS to get document flow
 */
export async function callBapiSalesdocuGetrelations(
  pool: RFCConnectionPool,
  documentNumber: string
): Promise<DocFlowEntry[]> {
  const result = await pool.call<Record<string, unknown>>('BAPI_SALESDOCU_GETRELATIONS', {
    SD_DOC: padDocNumber(documentNumber),
  });

  // Check for BAPI errors
  const returnErr = createErrorFromBapiReturn(result.RETURN, 'BAPI_SALESDOCU_GETRELATIONS');
  if (returnErr) {
    throw returnErr;
  }

  const relations = (result.DOC_FLOW as Array<Record<string, unknown>>) || [];

  return relations.map(rel => ({
    vbelv: String(rel.VBELV || ''),
    posnv: String(rel.POSNV || ''),
    vbeln: String(rel.VBELN || ''),
    posnn: String(rel.POSNN || ''),
    vbtyp_n: String(rel.VBTYP_N || ''),
    rfmng: Number(rel.RFMNG || 0),
    rfwrt: Number(rel.RFWRT || 0),
    waers: String(rel.WAERS || ''),
    erdat: String(rel.ERDAT || ''),
    erzet: String(rel.ERZET || ''),
  }));
}

// ============================================================================
// BAPI_OUTB_DELIVERY_GET_DETAIL - Delivery Details
// ============================================================================

/**
 * Delivery header from BAPI
 */
export interface DeliveryHeader {
  vbeln: string; // Delivery number
  lfart: string; // Delivery type
  erdat: string; // Created date
  erzet: string; // Created time
  wadat: string; // Planned goods issue date
  lddat: string; // Loading date
  kodat: string; // Picking date
  podat: string; // Proof of delivery date
  lfdat: string; // Delivery date
  btgew: number; // Total weight
  ntgew: number; // Net weight
  gewei: string; // Weight unit
  kunag: string; // Sold-to party
  kunnr: string; // Ship-to party
  route: string; // Route
}

/**
 * Delivery item from BAPI
 */
export interface DeliveryItem {
  posnr: string; // Item number
  matnr: string; // Material
  arktx: string; // Description
  lfimg: number; // Delivered quantity
  vrkme: string; // Unit
  vgbel: string; // Reference document (order)
  vgpos: string; // Reference item
}

/**
 * Call BAPI_OUTB_DELIVERY_GET_DETAIL
 */
export async function callBapiOutbDeliveryGetDetail(
  pool: RFCConnectionPool,
  deliveryNumber: string
): Promise<{ header: DeliveryHeader; items: DeliveryItem[] }> {
  const result = await pool.call<Record<string, unknown>>('BAPI_OUTB_DELIVERY_GET_DETAIL', {
    DELIVERY: padDocNumber(deliveryNumber),
  });

  // Check for BAPI errors
  const returnErr = createErrorFromBapiReturn(result.RETURN, 'BAPI_OUTB_DELIVERY_GET_DETAIL');
  if (returnErr) {
    throw returnErr;
  }

  const headerRaw = (result.HEADER_DATA as Record<string, unknown>) || {};

  const header: DeliveryHeader = {
    vbeln: String(headerRaw.DELIV_NUMB || ''),
    lfart: String(headerRaw.DELIV_TYPE || ''),
    erdat: String(headerRaw.CREATED_ON || ''),
    erzet: String(headerRaw.CREATED_TIME || ''),
    wadat: String(headerRaw.GI_DATE || ''),
    lddat: String(headerRaw.LOAD_DATE || ''),
    kodat: String(headerRaw.PICK_DATE || ''),
    podat: String(headerRaw.POD_DATE || ''),
    lfdat: String(headerRaw.DELIV_DATE || ''),
    btgew: Number(headerRaw.GROSS_WGT || 0),
    ntgew: Number(headerRaw.NET_WEIGHT || 0),
    gewei: String(headerRaw.WGT_UOM || ''),
    kunag: String(headerRaw.SOLD_TO || ''),
    kunnr: String(headerRaw.SHIP_TO || ''),
    route: String(headerRaw.ROUTE || ''),
  };

  const itemsRaw = (result.ITEM_DATA as Array<Record<string, unknown>>) || [];
  const items: DeliveryItem[] = itemsRaw.map(item => ({
    posnr: String(item.DELIV_ITEM || ''),
    matnr: String(item.MATERIAL || ''),
    arktx: String(item.MATL_DESC || ''),
    lfimg: Number(item.DLV_QTY || 0),
    vrkme: String(item.SALES_UNIT || ''),
    vgbel: String(item.REF_DOC || ''),
    vgpos: String(item.REF_ITEM || ''),
  }));

  return { header, items };
}

// ============================================================================
// BAPI_BILLINGDOC_GETDETAIL - Invoice Details
// ============================================================================

/**
 * Invoice header from BAPI
 */
export interface InvoiceHeader {
  vbeln: string; // Invoice number
  fkart: string; // Billing type
  fkdat: string; // Billing date
  erdat: string; // Created date
  erzet: string; // Created time
  netwr: number; // Net value
  waerk: string; // Currency
  kunrg: string; // Payer
  kunag: string; // Sold-to party
  vbtyp: string; // Document category
}

/**
 * Invoice item from BAPI
 */
export interface InvoiceItem {
  posnr: string; // Item number
  matnr: string; // Material
  arktx: string; // Description
  fkimg: number; // Billed quantity
  vrkme: string; // Unit
  netwr: number; // Net value
  vgbel: string; // Reference document
  vgpos: string; // Reference item
}

/**
 * Call BAPI_BILLINGDOC_GETDETAIL
 */
export async function callBapiBillingdocGetdetail(
  pool: RFCConnectionPool,
  invoiceNumber: string
): Promise<{ header: InvoiceHeader; items: InvoiceItem[] }> {
  const result = await pool.call<Record<string, unknown>>('BAPI_BILLINGDOC_GETDETAIL', {
    SALESDOCUMENT: padDocNumber(invoiceNumber),
  });

  // Check for BAPI errors
  const returnErr = createErrorFromBapiReturn(result.RETURN, 'BAPI_BILLINGDOC_GETDETAIL');
  if (returnErr) {
    throw returnErr;
  }

  const headerRaw = (result.BILLINGDOCUMENTHEADER as Record<string, unknown>) || {};

  const header: InvoiceHeader = {
    vbeln: String(headerRaw.SD_DOC || ''),
    fkart: String(headerRaw.BILL_TYPE || ''),
    fkdat: String(headerRaw.BILL_DATE || ''),
    erdat: String(headerRaw.CREATED_ON || ''),
    erzet: String(headerRaw.CREATED_TIME || ''),
    netwr: Number(headerRaw.NET_VALUE || 0),
    waerk: String(headerRaw.CURRENCY || ''),
    kunrg: String(headerRaw.PAYER || ''),
    kunag: String(headerRaw.SOLD_TO || ''),
    vbtyp: String(headerRaw.SD_DOC_CAT || ''),
  };

  const itemsRaw = (result.BILLINGDOCUMENTITEM as Array<Record<string, unknown>>) || [];
  const items: InvoiceItem[] = itemsRaw.map(item => ({
    posnr: String(item.ITM_NUMBER || ''),
    matnr: String(item.MATERIAL || ''),
    arktx: String(item.SHORT_TEXT || ''),
    fkimg: Number(item.BILL_QTY || 0),
    vrkme: String(item.SALES_UNIT || ''),
    netwr: Number(item.NET_VALUE || 0),
    vgbel: String(item.REF_DOC || ''),
    vgpos: String(item.REF_DOC_IT || ''),
  }));

  return { header, items };
}

// ============================================================================
// BAPI_CUSTOMER_GETDETAIL2 - Customer Master
// ============================================================================

/**
 * Customer master data
 */
export interface CustomerMaster {
  kunnr: string; // Customer number
  name1: string; // Name 1
  name2: string; // Name 2
  name3: string; // Name 3
  name4: string; // Name 4
  stras: string; // Street
  ort01: string; // City
  pstlz: string; // Postal code
  regio: string; // Region
  land1: string; // Country
  telf1: string; // Phone
  telfx: string; // Fax
  ktokd: string; // Account group
  brsch: string; // Industry
}

/**
 * Call BAPI_CUSTOMER_GETDETAIL2
 */
export async function callBapiCustomerGetdetail2(
  pool: RFCConnectionPool,
  customerNumber: string
): Promise<CustomerMaster> {
  const result = await pool.call<Record<string, unknown>>('BAPI_CUSTOMER_GETDETAIL2', {
    CUSTOMERNO: padDocNumber(customerNumber),
  });

  // Check for BAPI errors
  const returnErr = createErrorFromBapiReturn(result.RETURN, 'BAPI_CUSTOMER_GETDETAIL2');
  if (returnErr) {
    throw returnErr;
  }

  const addr = (result.CUSTOMERADDRESS as Record<string, unknown>) || {};
  const general = (result.CUSTOMERGENERALDETAIL as Record<string, unknown>) || {};

  return {
    kunnr: String(general.CUSTOMER || customerNumber),
    name1: String(addr.NAME || ''),
    name2: String(addr.NAME_2 || ''),
    name3: String(addr.NAME_3 || ''),
    name4: String(addr.NAME_4 || ''),
    stras: String(addr.STREET || ''),
    ort01: String(addr.CITY || ''),
    pstlz: String(addr.POSTL_COD1 || ''),
    regio: String(addr.REGION || ''),
    land1: String(addr.COUNTRY || ''),
    telf1: String(addr.TEL1_NUMBR || ''),
    telfx: String(addr.FAX_NUMBER || ''),
    ktokd: String(general.ACCT_GRP || ''),
    brsch: String(general.INDUSTRY || ''),
  };
}

// ============================================================================
// BAPI_MATERIAL_GET_DETAIL - Material Master
// ============================================================================

/**
 * Material master data
 */
export interface MaterialMaster {
  matnr: string; // Material number
  maktx: string; // Description
  mtart: string; // Material type
  matkl: string; // Material group
  meins: string; // Base unit
  brgew: number; // Gross weight
  ntgew: number; // Net weight
  gewei: string; // Weight unit
  volum: number; // Volume
  voleh: string; // Volume unit
  ersda: string; // Created date
  laeda: string; // Changed date
}

/**
 * Call BAPI_MATERIAL_GET_DETAIL
 */
export async function callBapiMaterialGetDetail(
  pool: RFCConnectionPool,
  materialNumber: string
): Promise<MaterialMaster> {
  const result = await pool.call<Record<string, unknown>>('BAPI_MATERIAL_GET_DETAIL', {
    MATERIAL: materialNumber.toUpperCase().padStart(18, '0'),
  });

  // Check for BAPI errors
  const returnErr = createErrorFromBapiReturn(result.RETURN, 'BAPI_MATERIAL_GET_DETAIL');
  if (returnErr) {
    throw returnErr;
  }

  const data = (result.MATERIAL_GENERAL_DATA as Record<string, unknown>) || {};

  return {
    matnr: String(data.MATERIAL || materialNumber),
    maktx: String(data.MATL_DESC || ''),
    mtart: String(data.MATL_TYPE || ''),
    matkl: String(data.MATL_GROUP || ''),
    meins: String(data.BASE_UOM || ''),
    brgew: Number(data.GROSS_WT || 0),
    ntgew: Number(data.NET_WEIGHT || 0),
    gewei: String(data.UNIT_OF_WT || ''),
    volum: Number(data.VOLUME || 0),
    voleh: String(data.VOLUMEUNIT || ''),
    ersda: String(data.CREATED_ON || ''),
    laeda: String(data.CHANGED_ON || ''),
  };
}

// ============================================================================
// RFC_READ_TABLE - Generic Table Read (Fallback)
// ============================================================================

/**
 * Parameters for RFC_READ_TABLE
 */
export interface RfcReadTableParams {
  /** Table name (e.g., 'VBAK') */
  tableName: string;
  /** Fields to select (empty = all) */
  fields?: string[];
  /** WHERE clause conditions */
  options?: string[];
  /** Max rows (0 = no limit) */
  rowCount?: number;
  /** Delimiter for data (default '|') */
  delimiter?: string;
}

/**
 * Call RFC_READ_TABLE for generic table access
 * Note: This is a fallback - prefer specific BAPIs when available
 */
export async function callRfcReadTable(
  pool: RFCConnectionPool,
  params: RfcReadTableParams
): Promise<Array<Record<string, string>>> {
  const delimiter = params.delimiter || '|';

  const fields = (params.fields || []).map(f => ({ FIELDNAME: f }));
  const options = (params.options || []).map(o => ({ TEXT: o }));

  const result = await pool.call<Record<string, unknown>>('RFC_READ_TABLE', {
    QUERY_TABLE: params.tableName,
    DELIMITER: delimiter,
    FIELDS: fields,
    OPTIONS: options,
    ROWCOUNT: params.rowCount || 0,
  });

  // Parse the DATA table
  const dataRows = (result.DATA as Array<{ WA: string }>) || [];
  const fieldDefs = (result.FIELDS as Array<{ FIELDNAME: string }>) || [];

  const fieldNames = fieldDefs.map(f => f.FIELDNAME.trim());

  return dataRows.map(row => {
    const values = row.WA.split(delimiter);
    const record: Record<string, string> = {};
    fieldNames.forEach((name, idx) => {
      record[name] = (values[idx] || '').trim();
    });
    return record;
  });
}

// ============================================================================
// Document Type Detection
// ============================================================================

/**
 * SAP SD document type codes
 * First character indicates document category in VBFA
 */
export const DOC_TYPE_CATEGORIES = {
  C: 'ORDER', // Sales order
  J: 'DELIVERY', // Outbound delivery
  M: 'INVOICE', // Invoice
  K: 'CREDIT_MEMO', // Credit memo
  L: 'DEBIT_MEMO', // Debit memo
  H: 'RETURNS', // Returns
  I: 'ORDER_SCHED', // Scheduling agreement release
  G: 'CONTRACT', // Contract
  E: 'SCHEDULING', // Scheduling agreement
} as const;

/**
 * Get document category from VBTYP code
 */
export function getDocCategory(vbtyp: string): string {
  return DOC_TYPE_CATEGORIES[vbtyp as keyof typeof DOC_TYPE_CATEGORIES] || 'UNKNOWN';
}
