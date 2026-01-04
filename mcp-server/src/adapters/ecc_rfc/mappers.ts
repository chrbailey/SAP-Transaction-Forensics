/**
 * Response Mappers for SAP RFC Data
 *
 * Transforms raw RFC/BAPI responses into the standardized types
 * used by the tool interface.
 */

import type {
  SalesDocHeader,
  SalesDocItem,
  DeliveryHeader,
  InvoiceHeader,
  DocFlowEntry,
  DocFlowResult,
  DeliveryTimingResult,
  InvoiceTimingResult,
  MasterStub,
  DocTextResult,
} from '../../types/sap.js';

import type {
  SalesDocHeader as RFCSalesDocHeader,
  SalesDocItem as RFCSalesDocItem,
  DeliveryHeader as RFCDeliveryHeader,
  DeliveryItem as RFCDeliveryItem,
  InvoiceHeader as RFCInvoiceHeader,
  InvoiceItem as RFCInvoiceItem,
  DocFlowEntry as RFCDocFlowEntry,
  CustomerMaster,
  MaterialMaster,
  ReadTextResult,
} from './rfc-calls.js';

import { createHash } from 'crypto';

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Conditionally include a property only if value is truthy
 * This helps avoid exactOptionalPropertyTypes errors by omitting undefined values
 */
function optionalProp<K extends string, V>(
  key: K,
  value: V | undefined | null | ''
): { [P in K]: V } | Record<string, never> {
  if (value === undefined || value === null || value === '') {
    return {} as Record<string, never>;
  }
  return { [key]: value } as { [P in K]: V };
}

// ============================================================================
// Date/Time Utilities
// ============================================================================

/**
 * Convert SAP date format (YYYYMMDD) to ISO format (YYYY-MM-DD)
 */
export function mapSAPDate(sapDate: string): string {
  if (!sapDate || sapDate === '00000000' || sapDate.length !== 8) {
    return '';
  }
  return `${sapDate.slice(0, 4)}-${sapDate.slice(4, 6)}-${sapDate.slice(6, 8)}`;
}

/**
 * Convert SAP time format (HHMMSS) to ISO format (HH:MM:SS)
 */
export function mapSAPTime(sapTime: string): string {
  if (!sapTime || sapTime === '000000' || sapTime.length !== 6) {
    return '';
  }
  return `${sapTime.slice(0, 2)}:${sapTime.slice(2, 4)}:${sapTime.slice(4, 6)}`;
}

/**
 * Parse SAP number string to JavaScript number
 * Handles SAP's decimal format (comma vs period) and negative notation
 */
export function mapSAPNumber(sapNum: string | number): number {
  if (typeof sapNum === 'number') {
    return sapNum;
  }
  if (!sapNum) {
    return 0;
  }
  // SAP sometimes uses comma as decimal separator
  const normalized = sapNum.replace(/,/g, '.').replace(/\s/g, '');
  // Handle negative notation (trailing -)
  const isNegative = normalized.endsWith('-');
  const numStr = isNegative ? '-' + normalized.slice(0, -1) : normalized;
  return parseFloat(numStr) || 0;
}

/**
 * Pad document number to 10 characters
 */
export function padDocNumber(docNum: string): string {
  const cleaned = docNum.replace(/\D/g, '');
  return cleaned.padStart(10, '0');
}

/**
 * Strip leading zeros from document number for display
 */
export function stripLeadingZeros(docNum: string): string {
  return docNum.replace(/^0+/, '') || '0';
}

// ============================================================================
// Sales Document Mappers
// ============================================================================

/**
 * Map RFC sales header to standard SalesDocHeader
 */
export function mapVBAKToSalesDocHeader(rfcHeader: RFCSalesDocHeader): SalesDocHeader {
  return {
    VBELN: rfcHeader.vbeln,
    AUART: rfcHeader.auart,
    VKORG: rfcHeader.vkorg,
    VTWEG: rfcHeader.vtweg,
    SPART: rfcHeader.spart,
    KUNNR: rfcHeader.kunnr,
    AUDAT: mapSAPDate(rfcHeader.erdat), // Use created date as doc date
    ERNAM: rfcHeader.ernam,
    ERDAT: mapSAPDate(rfcHeader.erdat),
    ERZET: mapSAPTime(rfcHeader.erzet),
    NETWR: rfcHeader.netwr,
    WAERK: rfcHeader.waerk,
    ...optionalProp('KUNWE', rfcHeader.kunwe),
    ...optionalProp('VDATU', mapSAPDate(rfcHeader.vdatu)),
    ...optionalProp('AEDAT', mapSAPDate(rfcHeader.aedat)),
    ...optionalProp('BSTNK', rfcHeader.bstnk),
    ...optionalProp('BSTKD', rfcHeader.bstdk),
  };
}

/**
 * Map RFC sales item to standard SalesDocItem
 */
export function mapVBAPToSalesDocItem(vbeln: string, rfcItem: RFCSalesDocItem): SalesDocItem {
  return {
    VBELN: vbeln,
    POSNR: rfcItem.posnr,
    MATNR: rfcItem.matnr,
    WERKS: rfcItem.werks,
    KWMENG: rfcItem.kwmeng,
    VRKME: rfcItem.vrkme,
    NETWR: rfcItem.netwr,
    WAERK: rfcItem.waerk,
    PSTYV: rfcItem.pstyv,
    ...optionalProp('ARKTX', rfcItem.arktx),
    ...optionalProp('LGORT', rfcItem.lgort),
    ...optionalProp('ABGRU', rfcItem.abgru),
  };
}

// ============================================================================
// Delivery Mappers
// ============================================================================

/**
 * Map RFC delivery header to standard DeliveryHeader
 */
export function mapLIKPToDeliveryHeader(rfcHeader: RFCDeliveryHeader): DeliveryHeader {
  return {
    VBELN: rfcHeader.vbeln,
    LFART: rfcHeader.lfart,
    VSTEL: '', // Not directly available in BAPI, would need separate call
    KUNNR: rfcHeader.kunnr,
    BTGEW: rfcHeader.btgew,
    GEWEI: rfcHeader.gewei,
    ERNAM: '', // Not in BAPI response
    ERDAT: mapSAPDate(rfcHeader.erdat),
    ERZET: mapSAPTime(rfcHeader.erzet),
    ...optionalProp('ROUTE', rfcHeader.route),
    ...optionalProp('WADAT', mapSAPDate(rfcHeader.wadat)),
    ...optionalProp('LFDAT', mapSAPDate(rfcHeader.lfdat)),
    ...optionalProp('LDDAT', mapSAPDate(rfcHeader.lddat)),
  };
}

/**
 * Map RFC delivery to DeliveryTimingResult
 */
export function mapDeliveryToTiming(
  rfcHeader: RFCDeliveryHeader,
  rfcItems: RFCDeliveryItem[]
): DeliveryTimingResult {
  const headerTiming: DeliveryTimingResult['header_timing'] = {};
  const plannedGiDate = mapSAPDate(rfcHeader.wadat);
  const loadingDate = mapSAPDate(rfcHeader.lddat);
  const actualGiDate = mapSAPDate(rfcHeader.podat);

  if (plannedGiDate) headerTiming.planned_gi_date = plannedGiDate;
  if (loadingDate) headerTiming.loading_date = loadingDate;
  if (actualGiDate) headerTiming.actual_gi_date = actualGiDate;

  return {
    delivery_number: rfcHeader.vbeln,
    header_timing: headerTiming,
    item_timing: rfcItems.map(item => ({
      item_number: item.posnr,
      material: item.matnr,
      // Item-level timing would require additional calls or VBEP schedule lines
    })),
  };
}

// ============================================================================
// Invoice Mappers
// ============================================================================

/**
 * Map RFC invoice header to standard InvoiceHeader
 */
export function mapVBRKToInvoiceHeader(rfcHeader: RFCInvoiceHeader): InvoiceHeader {
  return {
    VBELN: rfcHeader.vbeln,
    FKART: rfcHeader.fkart,
    FKDAT: mapSAPDate(rfcHeader.fkdat),
    KUNRG: rfcHeader.kunrg,
    VKORG: '', // Not in BAPI response
    VTWEG: '', // Not in BAPI response
    SPART: '', // Not in BAPI response
    NETWR: rfcHeader.netwr,
    WAERK: rfcHeader.waerk,
    ERNAM: '', // Not in BAPI response
    ERDAT: mapSAPDate(rfcHeader.erdat),
    ERZET: mapSAPTime(rfcHeader.erzet),
    ...optionalProp('KUNAG', rfcHeader.kunag),
  };
}

/**
 * Map RFC invoice to InvoiceTimingResult
 */
export function mapInvoiceToTiming(
  rfcHeader: RFCInvoiceHeader,
  rfcItems: RFCInvoiceItem[]
): InvoiceTimingResult {
  // Extract unique linked documents from items
  const linkedDeliveries = new Set<string>();
  const linkedOrders = new Set<string>();

  for (const item of rfcItems) {
    if (item.vgbel) {
      linkedDeliveries.add(item.vgbel);
    }
  }

  return {
    invoice_number: rfcHeader.vbeln,
    billing_date: mapSAPDate(rfcHeader.fkdat),
    created_date: mapSAPDate(rfcHeader.erdat),
    created_time: mapSAPTime(rfcHeader.erzet),
    linked_deliveries: Array.from(linkedDeliveries),
    linked_orders: Array.from(linkedOrders),
  };
}

// ============================================================================
// Document Flow Mappers
// ============================================================================

/**
 * Document category display names
 */
const DOC_CATEGORY_NAMES: Record<string, string> = {
  C: 'Sales Order',
  J: 'Delivery',
  M: 'Invoice',
  K: 'Credit Memo',
  L: 'Debit Memo',
  H: 'Returns',
  G: 'Contract',
  B: 'Quotation',
  E: 'Scheduling Agreement',
  I: 'Schedule Line Release',
};

/**
 * Map RFC document flow entries to DocFlowResult
 */
export function mapVBFAToDocFlow(
  rootDocument: string,
  rfcEntries: RFCDocFlowEntry[]
): DocFlowResult {
  // Group entries by subsequent document
  const docMap = new Map<
    string,
    {
      vbtyp: string;
      erdat: string;
      erzet: string;
      items: Array<{
        posnn: string;
        vbelv: string;
        posnv: string;
        rfmng: number;
      }>;
    }
  >();

  for (const entry of rfcEntries) {
    const key = entry.vbeln;
    let doc = docMap.get(key);
    if (!doc) {
      doc = {
        vbtyp: entry.vbtyp_n,
        erdat: entry.erdat,
        erzet: entry.erzet,
        items: [],
      };
      docMap.set(key, doc);
    }
    doc.items.push({
      posnn: entry.posnn,
      vbelv: entry.vbelv,
      posnv: entry.posnv,
      rfmng: entry.rfmng,
    });
  }

  // Convert to flow array, sorted by date
  const flow = Array.from(docMap.entries())
    .map(([docNum, data]) => {
      // Build items with conditional optional properties
      const items = data.items.map(item => {
        const mappedItem: {
          item_number: string;
          ref_doc?: string;
          ref_item?: string;
          quantity?: number;
        } = { item_number: item.posnn };

        if (item.vbelv && item.vbelv !== rootDocument) {
          mappedItem.ref_doc = item.vbelv;
        }
        if (item.posnv) {
          mappedItem.ref_item = item.posnv;
        }
        if (item.rfmng) {
          mappedItem.quantity = item.rfmng;
        }

        return mappedItem;
      });

      return {
        doc_type: DOC_CATEGORY_NAMES[data.vbtyp] || 'Unknown',
        doc_number: docNum,
        doc_category: data.vbtyp,
        created_date: mapSAPDate(data.erdat),
        created_time: mapSAPTime(data.erzet),
        items,
      };
    })
    .sort((a, b) => {
      const dateA = a.created_date + a.created_time;
      const dateB = b.created_date + b.created_time;
      return dateA.localeCompare(dateB);
    });

  return {
    root_document: rootDocument,
    flow,
  };
}

/**
 * Map RFC doc flow entry to standard DocFlowEntry
 */
export function mapRFCDocFlowEntry(entry: RFCDocFlowEntry): DocFlowEntry {
  return {
    VBELV: entry.vbelv,
    POSNV: entry.posnv,
    VBELN: entry.vbeln,
    POSNN: entry.posnn,
    VBTYP_N: entry.vbtyp_n,
    VBTYP_V: '', // Not available in BAPI response
    RFMNG: entry.rfmng,
    RFWRT: entry.rfwrt,
    ERDAT: mapSAPDate(entry.erdat),
    ERZET: mapSAPTime(entry.erzet),
  };
}

// ============================================================================
// Master Data Mappers
// ============================================================================

/**
 * Hash an ID for anonymization
 */
export function hashId(id: string, salt: string = 'sap-mining'): string {
  return createHash('sha256')
    .update(salt + id)
    .digest('hex')
    .slice(0, 16);
}

/**
 * Map customer master to MasterStub
 */
export function mapCustomerToStub(customer: CustomerMaster, hashIds: boolean = false): MasterStub {
  const stub: MasterStub = {
    ENTITY_TYPE: 'customer',
    ID: customer.kunnr,
  };

  if (hashIds) stub.HASHED_ID = hashId(customer.kunnr);
  if (customer.brsch) stub.INDUSTRY = customer.brsch;
  if (customer.regio) stub.REGION = customer.regio;
  if (customer.ktokd) stub.KTOKD = customer.ktokd;

  return stub;
}

/**
 * Map material master to MasterStub
 */
export function mapMaterialToStub(material: MaterialMaster, hashIds: boolean = false): MasterStub {
  const stub: MasterStub = {
    ENTITY_TYPE: 'material',
    ID: material.matnr,
  };

  if (hashIds) stub.HASHED_ID = hashId(material.matnr);
  if (material.matkl) {
    stub.CATEGORY = material.matkl;
    stub.MATKL = material.matkl;
  }
  if (material.mtart) stub.MTART = material.mtart;
  const erdat = mapSAPDate(material.ersda);
  if (erdat) stub.ERDAT = erdat;

  return stub;
}

// ============================================================================
// Text Mappers
// ============================================================================

/**
 * Text IDs and their meanings
 */
const TEXT_ID_NAMES: Record<string, string> = {
  '0001': 'Header Text',
  '0002': 'Internal Note',
  '0003': 'Shipping Instructions',
  '0004': 'Packing Instructions',
  '0005': 'Terms & Conditions',
  Z001: 'Custom Header Note',
  Z002: 'Custom Item Note',
};

/**
 * Map READ_TEXT result to document text format
 */
export function mapReadTextResult(
  results: Array<{
    textId: string;
    itemNumber: string;
    language: string;
    result: ReadTextResult;
  }>
): DocTextResult {
  const headerTexts: DocTextResult['header_texts'] = [];
  const itemTexts: DocTextResult['item_texts'] = [];

  for (const { textId, itemNumber, language, result } of results) {
    // Combine text lines into single string
    const text = result.lines
      .map(line => {
        // Handle paragraph markers
        if (line.tdformat === '*') {
          return '\n' + line.tdline;
        }
        return line.tdline;
      })
      .join('')
      .trim();

    if (!text) {
      continue;
    }

    if (itemNumber === '000000' || !itemNumber) {
      headerTexts.push({
        text_id: textId,
        lang: language,
        text,
      });
    } else {
      itemTexts.push({
        item_number: itemNumber,
        text_id: textId,
        lang: language,
        text,
      });
    }
  }

  return {
    header_texts: headerTexts,
    item_texts: itemTexts,
  };
}

/**
 * Get human-readable text type name
 */
export function getTextTypeName(textId: string): string {
  return TEXT_ID_NAMES[textId] || `Text Type ${textId}`;
}
