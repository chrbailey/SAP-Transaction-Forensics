/**
 * SALT Dataset Schema Mapper
 *
 * Maps SAP SALT dataset fields to our internal SAP document types.
 * SALT uses S/4HANA CDS view naming conventions (I_SalesDocument, etc.)
 * which we map to traditional SAP table field names (VBAK, VBAP, etc.)
 *
 * SALT Tables:
 * - I_SalesDocument → VBAK (Sales Document Header)
 * - I_SalesDocumentItem → VBAP (Sales Document Item)
 * - I_Customer → KNA1 (Customer Master)
 * - I_AddrOrgNamePostalAddress → Address data
 */

import type {
  SalesDocHeader,
  SalesDocItem,
  MasterStub,
  RawDocFlowEntry,
} from '../../types/index.js';

/**
 * Raw SALT Sales Document (I_SalesDocument)
 * Field names from the HuggingFace dataset
 */
export interface SaltSalesDocument {
  SALESDOCUMENT?: string;
  SALESDOCUMENTTYPE?: string;
  SALESORGANIZATION?: string;
  DISTRIBUTIONCHANNEL?: string;
  DIVISION?: string;
  SALESOFFICE?: string;
  SALESGROUP?: string;
  SOLDTOPARTY?: string;
  CREATIONDATE?: string;
  CREATEDBYUSER?: string;
  LASTCHANGEDATE?: string;
  LASTCHANGEDBYUSER?: string;
  TRANSACTIONCURRENCY?: string;
  PRICINGDATE?: string;
  REQUESTEDDELIVERYDATE?: string;
  SHIPPINGCONDITION?: string;
  COMPLETEDELIVERYISDEFINED?: boolean;
  HEADERINCOTERMSCLASSIFICATION?: string;
  CUSTOMERPAYMENTTERMS?: string;
  // May have additional fields depending on dataset version
  [key: string]: unknown;
}

/**
 * Raw SALT Sales Document Item (I_SalesDocumentItem)
 */
export interface SaltSalesDocumentItem {
  SALESDOCUMENT?: string;
  SALESDOCUMENTITEM?: string;
  MATERIAL?: string;
  MATERIALBYCUSTOMER?: string;
  PLANT?: string;
  STORAGELOCATION?: string;
  REQUESTEDQUANTITY?: number;
  REQUESTEDQUANTITYUNIT?: string;
  NETAMOUNT?: number;
  TRANSACTIONCURRENCY?: string;
  ITEMCATEGORY?: string;
  SHIPPINGPOINT?: string;
  ITEMINCOTERMSCLASSIFICATION?: string;
  REQUESTEDDELIVERYDATE?: string;
  // May have additional fields
  [key: string]: unknown;
}

/**
 * Raw SALT Customer (I_Customer)
 */
export interface SaltCustomer {
  CUSTOMER?: string;
  CUSTOMERNAME?: string;
  CUSTOMERACCOUNTGROUP?: string;
  COUNTRY?: string;
  REGION?: string;
  CITYNAME?: string;
  INDUSTRY?: string;
  CREATIONDATE?: string;
  // May have additional fields
  [key: string]: unknown;
}

/**
 * Raw SALT Address (I_AddrOrgNamePostalAddress)
 */
export interface SaltAddress {
  ADDRESSID?: string;
  COUNTRY?: string;
  REGION?: string;
  CITYNAME?: string;
  POSTALCODE?: string;
  STREETNAME?: string;
  // May have additional fields
  [key: string]: unknown;
}

/**
 * Map SALT Sales Document to our SalesDocHeader type
 */
export function mapSaltToSalesDocHeader(salt: SaltSalesDocument): SalesDocHeader {
  const header: SalesDocHeader = {
    VBELN: padDocNumber(salt.SALESDOCUMENT || ''),
    AUART: salt.SALESDOCUMENTTYPE || 'OR',
    VKORG: salt.SALESORGANIZATION || '',
    VTWEG: salt.DISTRIBUTIONCHANNEL || '',
    SPART: salt.DIVISION || '',
    KUNNR: padDocNumber(salt.SOLDTOPARTY || ''),
    AUDAT: formatDate(salt.CREATIONDATE),
    ERNAM: salt.CREATEDBYUSER || 'UNKNOWN',
    ERDAT: formatDate(salt.CREATIONDATE),
    ERZET: '000000', // Time not available in SALT
    WAERK: salt.TRANSACTIONCURRENCY || 'USD',
  };

  // Only add optional fields if they have values
  if (salt.REQUESTEDDELIVERYDATE) {
    header.VDATU = formatDate(salt.REQUESTEDDELIVERYDATE);
  }
  if (salt.LASTCHANGEDBYUSER) {
    header.AENAM = salt.LASTCHANGEDBYUSER;
  }
  if (salt.LASTCHANGEDATE) {
    header.AEDAT = formatDate(salt.LASTCHANGEDATE);
  }
  if (salt.CUSTOMERPAYMENTTERMS) {
    header.BSTNK = salt.CUSTOMERPAYMENTTERMS;
  }

  return header;
}

/**
 * Map SALT Sales Document Item to our SalesDocItem type
 */
export function mapSaltToSalesDocItem(salt: SaltSalesDocumentItem): SalesDocItem {
  const item: SalesDocItem = {
    VBELN: padDocNumber(salt.SALESDOCUMENT || ''),
    POSNR: padItemNumber(salt.SALESDOCUMENTITEM || ''),
    MATNR: salt.MATERIAL || '',
    WERKS: salt.PLANT || '',
    KWMENG: salt.REQUESTEDQUANTITY || 0,
    VRKME: salt.REQUESTEDQUANTITYUNIT || 'EA',
    NETWR: salt.NETAMOUNT || 0,
    WAERK: salt.TRANSACTIONCURRENCY || 'USD',
    PSTYV: salt.ITEMCATEGORY || 'TAN',
  };

  // Only add optional fields if they have values
  if (salt.MATERIALBYCUSTOMER) {
    item.ARKTX = salt.MATERIALBYCUSTOMER;
  }
  if (salt.STORAGELOCATION) {
    item.LGORT = salt.STORAGELOCATION;
  }
  if (salt.REQUESTEDDELIVERYDATE) {
    item.EDATU = formatDate(salt.REQUESTEDDELIVERYDATE);
  }

  return item;
}

/**
 * Map SALT Customer to our MasterStub type
 */
export function mapSaltToCustomerStub(salt: SaltCustomer): MasterStub {
  const stub: MasterStub = {
    ENTITY_TYPE: 'customer',
    ID: padDocNumber(salt.CUSTOMER || ''),
  };

  // Only add optional fields if they have values
  const region = salt.REGION || salt.COUNTRY;
  if (region) {
    stub.REGION = region;
  }
  if (salt.INDUSTRY) {
    stub.INDUSTRY = salt.INDUSTRY;
  }
  if (salt.CUSTOMERACCOUNTGROUP) {
    stub.CATEGORY = salt.CUSTOMERACCOUNTGROUP;
    stub.KTOKD = salt.CUSTOMERACCOUNTGROUP;
  }
  if (salt.CREATIONDATE) {
    stub.ERDAT = formatDate(salt.CREATIONDATE);
  }

  return stub;
}

/**
 * Generate synthetic document flow entries from sales documents and items
 * SALT doesn't have explicit doc flow, so we create order-only flows
 */
export function generateDocFlowFromSalt(
  salesDocs: SaltSalesDocument[],
  _items: SaltSalesDocumentItem[]
): RawDocFlowEntry[] {
  const flows: RawDocFlowEntry[] = [];

  // For SALT data, we only have sales orders (no deliveries/invoices)
  // Create self-referencing flows to enable doc flow queries
  for (const doc of salesDocs) {
    const docNum = padDocNumber(doc.SALESDOCUMENT || '');
    flows.push({
      preceding_doc: docNum,
      preceding_item: '000000',
      preceding_category: 'C', // Sales Order
      subsequent_doc: docNum,
      subsequent_item: '000000',
      subsequent_category: 'C',
      transfer_quantity: 1,
      created_date: formatDate(doc.CREATIONDATE),
    });
  }

  return flows;
}

/**
 * Pad document number to 10 characters with leading zeros
 */
function padDocNumber(num: string): string {
  if (!num) return '0000000000';
  const cleaned = num.replace(/\D/g, '');
  return cleaned.padStart(10, '0');
}

/**
 * Pad item number to 6 characters with leading zeros
 */
function padItemNumber(num: string): string {
  if (!num) return '000000';
  const cleaned = num.replace(/\D/g, '');
  return cleaned.padStart(6, '0');
}

/**
 * Format date to YYYYMMDD string
 */
function formatDate(date: string | undefined): string {
  const getDefaultDate = (): string => {
    const parts = new Date().toISOString().split('T');
    return (parts[0] ?? '19700101').replace(/-/g, '');
  };

  if (!date) return getDefaultDate();

  // Handle various date formats
  if (/^\d{8}$/.test(date)) {
    return date; // Already YYYYMMDD
  }

  if (/^\d{4}-\d{2}-\d{2}/.test(date)) {
    return date.substring(0, 10).replace(/-/g, '');
  }

  // Try to parse as date
  try {
    const d = new Date(date);
    if (!isNaN(d.getTime())) {
      const parts = d.toISOString().split('T');
      return (parts[0] ?? '19700101').replace(/-/g, '');
    }
  } catch {
    // Fall through to default
  }

  return getDefaultDate();
}

/**
 * Statistics about the loaded SALT data
 */
export interface SaltDatasetStats {
  salesDocuments: number;
  salesDocumentItems: number;
  customers: number;
  addresses: number;
  uniqueSalesOrgs: number;
  uniquePlants: number;
  dateRange: {
    earliest: string;
    latest: string;
  };
}

/**
 * Calculate statistics from loaded SALT data
 */
export function calculateSaltStats(
  salesDocs: SaltSalesDocument[],
  items: SaltSalesDocumentItem[],
  customers: SaltCustomer[],
  addresses: SaltAddress[]
): SaltDatasetStats {
  const salesOrgs = new Set<string>();
  const plants = new Set<string>();
  const dates: string[] = [];

  for (const doc of salesDocs) {
    if (doc.SALESORGANIZATION) salesOrgs.add(doc.SALESORGANIZATION);
    if (doc.CREATIONDATE) dates.push(doc.CREATIONDATE);
  }

  for (const item of items) {
    if (item.PLANT) plants.add(item.PLANT);
  }

  dates.sort();

  return {
    salesDocuments: salesDocs.length,
    salesDocumentItems: items.length,
    customers: customers.length,
    addresses: addresses.length,
    uniqueSalesOrgs: salesOrgs.size,
    uniquePlants: plants.size,
    dateRange: {
      earliest: dates[0] || 'N/A',
      latest: dates[dates.length - 1] || 'N/A',
    },
  };
}
