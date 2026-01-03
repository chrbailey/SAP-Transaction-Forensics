/**
 * SAP Document Type Definitions
 *
 * These interfaces mirror SAP's standard document structures with proper
 * SAP field naming conventions (VBELN, POSNR, MATNR, etc.)
 *
 * Field naming follows SAP's Data Dictionary (SE11) conventions:
 * - VBELN: Sales Document Number (Verkaufsbelegnummer)
 * - POSNR: Item Number (Positionsnummer)
 * - MATNR: Material Number (Materialnummer)
 * - KUNNR: Customer Number (Kundennummer)
 * - VKORG: Sales Organization (Verkaufsorganisation)
 * - VTWEG: Distribution Channel (Vertriebsweg)
 * - SPART: Division (Sparte)
 */

// ============================================================================
// Sales Document Types (VBAK/VBAP/VBKD)
// ============================================================================

/**
 * Sales Document Header (based on VBAK table)
 */
export interface SalesDocHeader {
  /** Sales Document Number (10 chars) */
  VBELN: string;
  /** Sales Document Type (4 chars, e.g., 'OR' for Standard Order) */
  AUART: string;
  /** Sales Organization (4 chars) */
  VKORG: string;
  /** Distribution Channel (2 chars) */
  VTWEG: string;
  /** Division (2 chars) */
  SPART: string;
  /** Sold-to Party (10 chars) */
  KUNNR: string;
  /** Ship-to Party (10 chars) */
  KUNWE?: string;
  /** Document Date */
  AUDAT: string;
  /** Requested Delivery Date */
  VDATU?: string;
  /** Created By (user ID) */
  ERNAM: string;
  /** Created On (date) */
  ERDAT: string;
  /** Created At (time) */
  ERZET: string;
  /** Changed By */
  AENAM?: string;
  /** Changed On */
  AEDAT?: string;
  /** Overall Status */
  GBSTK?: string;
  /** Net Value */
  NETWR?: number;
  /** Currency */
  WAERK?: string;
  /** Header Text (from VBKD) */
  BSTKD?: string;
  /** Purchase Order Number */
  BSTNK?: string;
}

/**
 * Sales Document Item (based on VBAP table)
 */
export interface SalesDocItem {
  /** Sales Document Number */
  VBELN: string;
  /** Item Number (6 chars) */
  POSNR: string;
  /** Material Number (18 chars) */
  MATNR: string;
  /** Item Description */
  ARKTX?: string;
  /** Plant (4 chars) */
  WERKS: string;
  /** Storage Location */
  LGORT?: string;
  /** Order Quantity */
  KWMENG: number;
  /** Sales Unit */
  VRKME: string;
  /** Net Value */
  NETWR: number;
  /** Currency */
  WAERK: string;
  /** Item Category (4 chars) */
  PSTYV: string;
  /** Rejection Reason */
  ABGRU?: string;
  /** Schedule Line Date */
  EDATU?: string;
  /** Confirmed Quantity */
  KBMENG?: number;
  /** Delivery Block */
  LIFSP?: string;
  /** Billing Block */
  FAKSP?: string;
}

/**
 * Sales Document Text (based on STXH/STXL text tables)
 */
export interface SalesDocText {
  /** Document Number */
  VBELN: string;
  /** Item Number (000000 for header texts) */
  POSNR: string;
  /** Text ID (e.g., '0001' for note, '0002' for internal note) */
  TDID: string;
  /** Language Key */
  SPRAS: string;
  /** Text Content */
  TEXT: string;
  /** Changed By */
  AENAM?: string;
  /** Changed On */
  AEDAT?: string;
}

// ============================================================================
// Delivery Document Types (LIKP/LIPS)
// ============================================================================

/**
 * Delivery Header (based on LIKP table)
 */
export interface DeliveryHeader {
  /** Delivery Number (10 chars) */
  VBELN: string;
  /** Delivery Type */
  LFART: string;
  /** Shipping Point */
  VSTEL: string;
  /** Route */
  ROUTE?: string;
  /** Ship-to Party */
  KUNNR: string;
  /** Planned Goods Movement Date */
  WADAT?: string;
  /** Actual Goods Movement Date */
  WADAT_IST?: string;
  /** Requested Delivery Date (from order) */
  LFDAT?: string;
  /** Loading Date */
  LDDAT?: string;
  /** Transportation Planning Date */
  TDDAT?: string;
  /** Pick/Pack Status */
  KOSTK?: string;
  /** Goods Movement Status */
  WBSTK?: string;
  /** Overall Status */
  GBSTK?: string;
  /** Total Weight */
  BTGEW?: number;
  /** Weight Unit */
  GEWEI?: string;
  /** Created By */
  ERNAM: string;
  /** Created On */
  ERDAT: string;
  /** Created At */
  ERZET: string;
}

/**
 * Delivery Item (based on LIPS table)
 */
export interface DeliveryItem {
  /** Delivery Number */
  VBELN: string;
  /** Delivery Item Number */
  POSNR: string;
  /** Material Number */
  MATNR: string;
  /** Material Description */
  ARKTX?: string;
  /** Plant */
  WERKS: string;
  /** Storage Location */
  LGORT?: string;
  /** Delivery Quantity */
  LFIMG: number;
  /** Sales Unit */
  VRKME: string;
  /** Picked Quantity */
  PIKMG?: number;
  /** Reference Document (Sales Order) */
  VGBEL?: string;
  /** Reference Item */
  VGPOS?: string;
  /** Batch Number */
  CHARG?: string;
  /** Serial Number Profile */
  SERAIL?: string;
}

// ============================================================================
// Invoice/Billing Document Types (VBRK/VBRP)
// ============================================================================

/**
 * Invoice/Billing Header (based on VBRK table)
 */
export interface InvoiceHeader {
  /** Billing Document Number */
  VBELN: string;
  /** Billing Type */
  FKART: string;
  /** Billing Date */
  FKDAT: string;
  /** Payer */
  KUNRG: string;
  /** Sold-to Party */
  KUNAG?: string;
  /** Sales Organization */
  VKORG: string;
  /** Distribution Channel */
  VTWEG: string;
  /** Division */
  SPART: string;
  /** Net Value */
  NETWR: number;
  /** Currency */
  WAERK: string;
  /** Tax Amount */
  MWSBK?: number;
  /** Accounting Document Number */
  BELNR?: string;
  /** Fiscal Year */
  GJAHR?: string;
  /** Posting Date */
  BUDAT?: string;
  /** Billing Status */
  FKSTO?: string;
  /** Created By */
  ERNAM: string;
  /** Created On */
  ERDAT: string;
  /** Created At */
  ERZET: string;
}

/**
 * Invoice/Billing Item (based on VBRP table)
 */
export interface InvoiceItem {
  /** Billing Document Number */
  VBELN: string;
  /** Billing Item Number */
  POSNR: string;
  /** Material Number */
  MATNR: string;
  /** Material Description */
  ARKTX?: string;
  /** Billed Quantity */
  FKIMG: number;
  /** Sales Unit */
  VRKME: string;
  /** Net Value */
  NETWR: number;
  /** Currency */
  WAERK: string;
  /** Reference Document (Delivery) */
  VGBEL?: string;
  /** Reference Item */
  VGPOS?: string;
  /** Sales Order Reference */
  AUBEL?: string;
  /** Sales Order Item Reference */
  AUPOS?: string;
  /** Plant */
  WERKS?: string;
}

// ============================================================================
// Document Flow (VBFA)
// ============================================================================

/**
 * Document Flow Entry (based on VBFA table)
 * Links documents in the order-to-cash chain
 */
export interface DocFlowEntry {
  /** Preceding Document Number */
  VBELV: string;
  /** Preceding Item Number */
  POSNV: string;
  /** Subsequent Document Number */
  VBELN: string;
  /** Subsequent Item Number */
  POSNN: string;
  /** Subsequent Document Category */
  VBTYP_N: string;
  /** Preceding Document Category */
  VBTYP_V: string;
  /** Reference Quantity */
  RFMNG?: number;
  /** Reference Value */
  RFWRT?: number;
  /** Created On */
  ERDAT: string;
  /** Created At */
  ERZET: string;
}

/**
 * Document category codes (VBTYP)
 */
export const DOC_CATEGORY = {
  ORDER: 'C', // Sales Order
  DELIVERY: 'J', // Delivery
  INVOICE: 'M', // Invoice
  CREDIT_MEMO: 'O', // Credit Memo
  DEBIT_MEMO: 'P', // Debit Memo
  QUOTATION: 'B', // Quotation
  CONTRACT: 'G', // Contract
  RETURNS: 'H', // Returns
} as const;

// ============================================================================
// Master Data Stubs (Safe Attributes Only)
// ============================================================================

/**
 * Master Data Stub - contains only safe/anonymized attributes
 * No PII or sensitive business data
 */
export interface MasterStub {
  /** Entity type identifier */
  ENTITY_TYPE: 'customer' | 'vendor' | 'material';
  /** Original ID (can be hashed) */
  ID: string;
  /** Hashed/anonymized ID option */
  HASHED_ID?: string;
  /** Industry classification */
  INDUSTRY?: string;
  /** Geographic region (coarse) */
  REGION?: string;
  /** Category/Classification */
  CATEGORY?: string;
  /** Account group (for customers/vendors) */
  KTOKD?: string;
  /** Material type (for materials) */
  MTART?: string;
  /** Material group */
  MATKL?: string;
  /** Division */
  SPART?: string;
  /** Created On */
  ERDAT?: string;
}

// ============================================================================
// Tool Parameter Types
// ============================================================================

export interface OrgFilters {
  VKORG?: string; // Sales Organization
  VTWEG?: string; // Distribution Channel
  SPART?: string; // Division
  WERKS?: string; // Plant
}

export interface SearchDocTextParams {
  pattern: string;
  doc_type?: 'sales' | 'delivery' | 'invoice';
  date_from?: string;
  date_to?: string;
  org_filters?: OrgFilters;
  limit?: number;
}

export interface SearchResult {
  doc_type: string;
  doc_key: string;
  snippet: string;
  match_score: number;
  dates: {
    created: string;
    changed?: string;
  };
  org_keys: OrgFilters;
}

export interface DocTextParams {
  doc_type: 'sales' | 'delivery' | 'invoice';
  doc_key: string;
}

export interface DocTextResult {
  header_texts: Array<{
    text_id: string;
    lang: string;
    text: string;
    changed_at?: string;
  }>;
  item_texts: Array<{
    item_number: string;
    text_id: string;
    lang: string;
    text: string;
    changed_at?: string;
  }>;
}

export interface DocFlowParams {
  vbeln: string;
}

export interface DocFlowResult {
  root_document: string;
  flow: Array<{
    doc_type: string;
    doc_number: string;
    doc_category: string;
    status?: string;
    created_date: string;
    created_time: string;
    items: Array<{
      item_number: string;
      ref_doc?: string;
      ref_item?: string;
      quantity?: number;
    }>;
  }>;
}

export interface SalesDocHeaderParams {
  vbeln: string;
}

export interface SalesDocItemsParams {
  vbeln: string;
}

export interface DeliveryTimingParams {
  vbeln: string;
}

export interface DeliveryTimingResult {
  delivery_number: string;
  header_timing: {
    requested_date?: string;
    planned_gi_date?: string;
    actual_gi_date?: string;
    loading_date?: string;
    transport_date?: string;
  };
  item_timing: Array<{
    item_number: string;
    material: string;
    requested_date?: string;
    confirmed_date?: string;
    actual_date?: string;
  }>;
}

export interface InvoiceTimingParams {
  vbeln: string;
}

export interface InvoiceTimingResult {
  invoice_number: string;
  billing_date: string;
  posting_date?: string;
  created_date: string;
  created_time: string;
  accounting_doc?: string;
  fiscal_year?: string;
  linked_deliveries: string[];
  linked_orders: string[];
}

export interface MasterStubParams {
  entity_type: 'customer' | 'vendor' | 'material';
  id: string;
  hash_id?: boolean;
}

// ============================================================================
// Synthetic Data File Structures
// ============================================================================

export interface SyntheticDataset {
  sales_orders: {
    headers: SalesDocHeader[];
    items: SalesDocItem[];
    texts: SalesDocText[];
  };
  deliveries: {
    headers: DeliveryHeader[];
    items: DeliveryItem[];
  };
  invoices: {
    headers: InvoiceHeader[];
    items: InvoiceItem[];
  };
  doc_flow: DocFlowEntry[];
  master_data: {
    customers: MasterStub[];
    vendors: MasterStub[];
    materials: MasterStub[];
  };
}
