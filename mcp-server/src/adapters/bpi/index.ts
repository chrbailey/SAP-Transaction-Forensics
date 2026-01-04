/**
 * BPI Challenge 2019 Adapter
 *
 * Loads real SAP Purchase-to-Pay process data from the BPI Challenge 2019 dataset.
 * This dataset contains authentic event logs from a multinational coatings company's
 * procurement process across 60 subsidiaries.
 *
 * Dataset: https://data.4tu.nl/articles/dataset/BPI_Challenge_2019/12715853
 *
 * Features:
 * - 251,734 purchase order item traces
 * - 1.59M events across 42 activities
 * - Real vendor and user behavior patterns
 * - Full purchase-to-pay process: PO → GR → Invoice → Payment
 *
 * Note: This adapter maps purchase order data to sales document interfaces
 * for compatibility with the existing MCP tools.
 */

import { readFile, stat } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';

import { BaseDataAdapter, registerAdapter } from '../adapter-interface.js';
import {
  SearchDocTextParams,
  SearchResult,
  DocTextParams,
  DocTextResult,
  DocFlowParams,
  DocFlowResult,
  SalesDocHeaderParams,
  SalesDocHeader,
  SalesDocItemsParams,
  SalesDocItem,
  DeliveryTimingParams,
  DeliveryTimingResult,
  InvoiceTimingParams,
  InvoiceTimingResult,
  MasterStubParams,
  MasterStub,
  DOC_CATEGORY,
} from '../../types/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Default data directory
const DEFAULT_DATA_DIR = join(__dirname, '..', '..', '..', '..', 'data', 'bpi');

/**
 * BPI trace from converted JSON (internal format)
 */
interface BPITraceInternal {
  case_id: string;
  attributes: {
    'concept:name'?: string;
    'Purchasing Document'?: string;
    Item?: string;
    Vendor?: string;
    Name?: string;
    Company?: string;
    'Document Type'?: string;
    'Item Category'?: string;
    'Item Type'?: string;
    'Spend area text'?: string;
    'Sub spend area text'?: string;
    'Spend classification text'?: string;
    'Purch. Doc. Category name'?: string;
    'GR-Based Inv. Verif.'?: string;
    'Goods Receipt'?: string;
    Source?: string;
    [key: string]: unknown;
  };
  events: BPIEvent[];
}

/**
 * BPI trace export format for OCEL conversion
 */
export interface BPITrace {
  case_id: string;
  vendor?: string;
  company?: string;
  spend_area_text?: string;
  item_category?: string;
  item_type?: string;
  po_document?: string;
  events: Array<{
    activity: string;
    timestamp: string;
    user?: string;
    org?: string;
    resource?: string;
    [key: string]: unknown;
  }>;
}

/**
 * BPI event from converted JSON
 */
interface BPIEvent {
  'concept:name'?: string;
  'time:timestamp'?: string;
  User?: string;
  'org:resource'?: string;
  'Cumulative net worth (EUR)'?: string;
  [key: string]: unknown;
}

/**
 * BPI dataset statistics
 */
interface BPIStats {
  total_cases: number;
  processed_cases: number;
  total_events: number;
  unique_activities: number;
  unique_vendors: number;
  unique_companies: number;
  unique_po_documents: number;
  unique_users: number;
  date_range: {
    earliest: string | null;
    latest: string | null;
  };
  activities: string[];
  companies: string[];
}

/**
 * Loaded BPI data structure
 */
interface LoadedBPIData {
  traces: BPITraceInternal[];
  stats: BPIStats;
  // Indexes for fast lookup
  tracesByPO: Map<string, BPITraceInternal[]>;
  tracesByVendor: Map<string, BPITraceInternal[]>;
  vendorNames: Map<string, string>;
}

/**
 * Configuration for BPI adapter
 */
export interface BPIAdapterConfig {
  /** Directory containing bpi_2019.json */
  dataDir?: string;
}

/**
 * BPI Challenge 2019 Adapter
 *
 * Provides access to real SAP P2P process data.
 */
export class BPIAdapter extends BaseDataAdapter {
  readonly name = 'bpi';

  private data: LoadedBPIData | null = null;
  private config: Required<BPIAdapterConfig>;

  constructor(config: BPIAdapterConfig = {}) {
    super();
    this.config = {
      dataDir: config.dataDir || DEFAULT_DATA_DIR,
    };
  }

  /**
   * Get data with type assertion after ensureInitialized()
   * This avoids non-null assertions throughout the code
   */
  private getData(): LoadedBPIData {
    this.ensureInitialized();
    if (!this.data) {
      throw new Error('BPI adapter not initialized');
    }
    return this.data;
  }

  protected async doInitialize(): Promise<void> {
    console.log(`[BPI] Initializing adapter...`);
    console.log(`[BPI] Data directory: ${this.config.dataDir}`);

    const dataPath = join(this.config.dataDir, 'bpi_2019.json');

    try {
      await stat(dataPath);
    } catch {
      throw new Error(
        `BPI data not found at ${dataPath}.\n` +
          'Run: python scripts/convert-bpi-xes.py to convert the dataset.'
      );
    }

    console.log(`[BPI] Loading data from ${dataPath}...`);
    const raw = JSON.parse(await readFile(dataPath, 'utf-8'));

    // Build indexes
    const tracesByPO = new Map<string, BPITraceInternal[]>();
    const tracesByVendor = new Map<string, BPITraceInternal[]>();
    const vendorNames = new Map<string, string>();

    for (const trace of raw.traces as BPITraceInternal[]) {
      // Index by PO
      const po = trace.attributes['Purchasing Document'];
      if (po) {
        const existing = tracesByPO.get(po) || [];
        existing.push(trace);
        tracesByPO.set(po, existing);
      }

      // Index by vendor
      const vendor = trace.attributes['Vendor'];
      if (vendor) {
        const existing = tracesByVendor.get(vendor) || [];
        existing.push(trace);
        tracesByVendor.set(vendor, existing);

        // Store vendor name
        const vendorName = trace.attributes['Name'];
        if (vendorName && !vendorNames.has(vendor)) {
          vendorNames.set(vendor, vendorName);
        }
      }
    }

    this.data = {
      traces: raw.traces,
      stats: raw.stats,
      tracesByPO,
      tracesByVendor,
      vendorNames,
    };

    console.log(`[BPI] Loaded ${this.data.stats.processed_cases} cases`);
    console.log(`[BPI] Total events: ${this.data.stats.total_events}`);
    console.log(`[BPI] Unique PO documents: ${this.data.stats.unique_po_documents}`);
    console.log(`[BPI] Unique vendors: ${this.data.stats.unique_vendors}`);
  }

  protected async doShutdown(): Promise<void> {
    this.data = null;
  }

  /**
   * Get dataset statistics
   */
  getStats(): BPIStats | null {
    if (!this.data) return null;
    return this.data.stats;
  }

  /**
   * Get all PO document numbers
   */
  getAllPONumbers(): string[] {
    if (!this.data) return [];
    return Array.from(this.data.tracesByPO.keys());
  }

  /**
   * Get all traces for OCEL export
   * Returns traces in a format suitable for OCEL 2.0 conversion
   */
  getTraces(): BPITrace[] {
    if (!this.data) return [];

    return this.data.traces.map(trace => {
      const attrs = trace.attributes;
      const vendor = attrs['Vendor'] as string | undefined;
      const company = attrs['Company'] as string | undefined;
      const spendAreaText = attrs['Spend area text'] as string | undefined;
      const itemCategory = attrs['Item Category'] as string | undefined;
      const itemType = attrs['Item Type'] as string | undefined;
      const poDoc = attrs['Purchasing Document'] as string | undefined;

      // Build result with conditional properties for exactOptionalPropertyTypes
      const result: BPITrace = {
        case_id: (attrs['concept:name'] as string) || trace.case_id || '',
        events: trace.events.map(event => {
          const eventResult: BPITrace['events'][0] = {
            activity: (event['concept:name'] as string) || '',
            timestamp: (event['time:timestamp'] as string) || '',
          };
          const user = event['org:resource'] as string | undefined;
          if (user) {
            eventResult.user = user;
            eventResult.resource = user;
          }
          if (company) {
            eventResult.org = company;
          }
          return eventResult;
        }),
      };

      // Add optional properties only if they have values
      if (vendor) result.vendor = vendor;
      if (company) result.company = company;
      if (spendAreaText) result.spend_area_text = spendAreaText;
      if (itemCategory) result.item_category = itemCategory;
      if (itemType) result.item_type = itemType;
      if (poDoc) result.po_document = poDoc;

      return result;
    });
  }

  // ============================================================================
  // IDataAdapter Implementation
  // ============================================================================

  async searchDocText(params: SearchDocTextParams): Promise<SearchResult[]> {
    const data = this.getData();

    const results: SearchResult[] = [];
    const pattern = new RegExp(params.pattern, 'i');
    const limit = params.limit || 200;

    for (const trace of data.traces) {
      if (results.length >= limit) break;

      // Get first and last event dates for filtering
      const events = trace.events;
      const firstEvent = events[0];
      const lastEvent = events[events.length - 1];

      const firstDate = firstEvent?.['time:timestamp']?.split('T')[0]?.replace(/-/g, '');
      const lastDate = lastEvent?.['time:timestamp']?.split('T')[0]?.replace(/-/g, '');

      // Apply date filters
      if (params.date_from && lastDate && lastDate < params.date_from.replace(/-/g, '')) continue;
      if (params.date_to && firstDate && firstDate > params.date_to.replace(/-/g, '')) continue;

      // Build searchable text from trace
      const searchableText = [
        trace.attributes['Purchasing Document'] || '',
        trace.attributes['Vendor'] || '',
        trace.attributes['Name'] || '',
        trace.attributes['Spend area text'] || '',
        trace.attributes['Sub spend area text'] || '',
        trace.attributes['Document Type'] || '',
        trace.attributes['Item Category'] || '',
      ].join(' ');

      if (pattern.test(searchableText)) {
        const po = trace.attributes['Purchasing Document'] || 'unknown';
        const item = trace.attributes['Item'] || '00001';
        const vendor = trace.attributes['Vendor'] || 'unknown';
        const vendorName = trace.attributes['Name'] || '';

        const result: SearchResult = {
          doc_type: 'purchase',
          doc_key: `${po}_${item}`,
          snippet: `PO ${po} Item ${item} - Vendor: ${vendorName || vendor} - ${trace.attributes['Item Category'] || ''}`,
          match_score: 1.0,
          dates: {
            created: firstDate || '',
          },
          org_keys: {
            VKORG: trace.attributes['Company'] || '',
          },
        };
        if (lastDate) {
          result.dates.changed = lastDate;
        }
        results.push(result);
      }
    }

    return results;
  }

  async getDocText(params: DocTextParams): Promise<DocTextResult> {
    const data = this.getData();

    // BPI doesn't have document texts, but we can return event activities
    const traces = data.tracesByPO.get(params.doc_key) || [];

    if (traces.length === 0) {
      return {
        header_texts: [],
        item_texts: [],
      };
    }

    // Return activities as "texts"
    const headerTexts = traces.slice(0, 1).map((trace, idx) => ({
      text_id: String(idx + 1).padStart(4, '0'),
      lang: 'EN',
      text: `${trace.attributes['Document Type'] || 'Purchase Order'} - ${trace.attributes['Spend area text'] || ''} - ${trace.attributes['Item Category'] || ''}`,
    }));

    return {
      header_texts: headerTexts,
      item_texts: [],
    };
  }

  async getDocFlow(params: DocFlowParams): Promise<DocFlowResult> {
    const data = this.getData();

    // Look up by PO number
    const traces = data.tracesByPO.get(params.vbeln) || [];

    if (traces.length === 0) {
      return {
        root_document: params.vbeln,
        flow: [],
      };
    }

    // Build flow from events across all items
    const flowDocs: DocFlowResult['flow'] = [];

    for (const trace of traces) {
      const item = trace.attributes['Item'] || '00001';

      for (const event of trace.events) {
        const activity = event['concept:name'] || 'Unknown';
        const timestamp = event['time:timestamp'] || '';
        const datePart = timestamp.split('T')[0]?.replace(/-/g, '') || '';
        const timePart = timestamp.split('T')[1]?.split(':').join('').substring(0, 6) || '000000';

        // Map activities to document categories
        let docCategory: string = DOC_CATEGORY.ORDER;
        let docType = 'Purchase Order';

        if (activity.includes('Goods Receipt')) {
          docCategory = DOC_CATEGORY.DELIVERY;
          docType = 'Goods Receipt';
        } else if (activity.includes('Invoice') || activity.includes('Clear Invoice')) {
          docCategory = DOC_CATEGORY.INVOICE;
          docType = 'Invoice';
        } else if (activity.includes('SRM:')) {
          docType = 'SRM Process';
        }

        flowDocs.push({
          doc_type: docType,
          doc_number: `${params.vbeln}_${activity.replace(/[^a-zA-Z0-9]/g, '_')}`,
          doc_category: docCategory,
          status: activity,
          created_date: datePart,
          created_time: timePart,
          items: [
            {
              item_number: item,
              quantity: 1,
            },
          ],
        });
      }
    }

    // Sort by date/time
    flowDocs.sort((a, b) => {
      const dateA = `${a.created_date}${a.created_time}`;
      const dateB = `${b.created_date}${b.created_time}`;
      return dateA.localeCompare(dateB);
    });

    return {
      root_document: params.vbeln,
      flow: flowDocs,
    };
  }

  async getSalesDocHeader(params: SalesDocHeaderParams): Promise<SalesDocHeader | null> {
    const data = this.getData();

    // Look up by PO number (mapped to VBELN)
    const traces = data.tracesByPO.get(params.vbeln);

    if (!traces || traces.length === 0) {
      return null;
    }

    const firstTrace = traces[0];
    if (!firstTrace) {
      return null;
    }
    const firstEvent = firstTrace.events[0];
    const firstDate = firstEvent?.['time:timestamp']?.split('T')[0]?.replace(/-/g, '') || '';

    // Map purchase order to sales doc header format
    return {
      VBELN: params.vbeln.padStart(10, '0'),
      AUART: firstTrace.attributes['Document Type'] || 'PO',
      VKORG: firstTrace.attributes['Company'] || '',
      VTWEG: '',
      SPART: firstTrace.attributes['Spend area text'] || '',
      KUNNR: (firstTrace.attributes['Vendor'] || '').padStart(10, '0'),
      AUDAT: firstDate,
      ERNAM: firstEvent?.['User'] || 'UNKNOWN',
      ERDAT: firstDate,
      ERZET: '000000',
      WAERK: 'EUR',
    };
  }

  async getSalesDocItems(params: SalesDocItemsParams): Promise<SalesDocItem[]> {
    const data = this.getData();

    const traces = data.tracesByPO.get(params.vbeln);

    if (!traces || traces.length === 0) {
      return [];
    }

    return traces.map(trace => {
      const lastEvent = trace.events[trace.events.length - 1];
      const netWorth = parseFloat(lastEvent?.['Cumulative net worth (EUR)'] || '0');

      return {
        VBELN: params.vbeln.padStart(10, '0'),
        POSNR: (trace.attributes['Item'] || '00001').padStart(6, '0'),
        MATNR: trace.attributes['Item Type'] || '',
        WERKS: trace.attributes['Source'] || '',
        KWMENG: 1,
        VRKME: 'EA',
        NETWR: netWorth,
        WAERK: 'EUR',
        PSTYV: trace.attributes['Item Category'] || '',
      };
    });
  }

  async getDeliveryTiming(params: DeliveryTimingParams): Promise<DeliveryTimingResult | null> {
    const data = this.getData();

    // Find goods receipt events for this PO
    const traces = data.tracesByPO.get(params.vbeln);

    if (!traces || traces.length === 0) {
      return null;
    }

    // Find GR events
    const grEvents: { item: string; date: string; time: string }[] = [];

    for (const trace of traces) {
      for (const event of trace.events) {
        if (
          event['concept:name']?.includes('Goods Receipt') &&
          !event['concept:name']?.includes('Cancel')
        ) {
          const timestamp = event['time:timestamp'] || '';
          grEvents.push({
            item: trace.attributes['Item'] || '00001',
            date: timestamp.split('T')[0]?.replace(/-/g, '') || '',
            time: timestamp.split('T')[1]?.split(':').join('').substring(0, 6) || '',
          });
        }
      }
    }

    if (grEvents.length === 0) {
      return null;
    }

    // Use first GR as the delivery
    const firstGR = grEvents[0];
    if (!firstGR) {
      return null;
    }

    return {
      delivery_number: params.vbeln.padStart(10, '0'),
      header_timing: {
        requested_date: firstGR.date,
        actual_gi_date: firstGR.date,
      },
      item_timing: grEvents.map(gr => ({
        item_number: gr.item.padStart(6, '0'),
        material: 'BPI_ITEM',
        requested_date: gr.date,
        actual_date: gr.date,
      })),
    };
  }

  async getInvoiceTiming(params: InvoiceTimingParams): Promise<InvoiceTimingResult | null> {
    const data = this.getData();

    // Find invoice events for this PO
    const traces = data.tracesByPO.get(params.vbeln);

    if (!traces || traces.length === 0) {
      return null;
    }

    // Find invoice events
    let invoiceDate = '';
    let clearDate = '';

    for (const trace of traces) {
      for (const event of trace.events) {
        const activity = event['concept:name'] || '';
        if (
          activity.includes('Record Invoice Receipt') ||
          activity.includes('Vendor creates invoice')
        ) {
          const timestamp = event['time:timestamp'] || '';
          invoiceDate = timestamp.split('T')[0]?.replace(/-/g, '') || '';
          // Net worth available in event['Cumulative net worth (EUR)'] if needed
        }
        if (activity === 'Clear Invoice') {
          const timestamp = event['time:timestamp'] || '';
          clearDate = timestamp.split('T')[0]?.replace(/-/g, '') || '';
        }
      }
    }

    if (!invoiceDate) {
      return null;
    }

    const result: InvoiceTimingResult = {
      invoice_number: params.vbeln.padStart(10, '0'),
      billing_date: invoiceDate,
      created_date: invoiceDate,
      created_time: '000000',
      accounting_doc: `INV_${params.vbeln}`,
      fiscal_year: invoiceDate.substring(0, 4),
      linked_deliveries: [],
      linked_orders: [params.vbeln],
    };
    if (clearDate) {
      result.posting_date = clearDate;
    }
    return result;
  }

  async getMasterStub(params: MasterStubParams): Promise<MasterStub | null> {
    const data = this.getData();

    if (params.entity_type !== 'vendor') {
      return null;
    }

    // Look up vendor
    const traces = data.tracesByVendor.get(params.id);

    if (!traces || traces.length === 0) {
      return null;
    }

    // traces[0] available if needed for additional attributes
    const stub: MasterStub = {
      ENTITY_TYPE: 'vendor',
      ID: params.id.padStart(10, '0'),
    };

    // Add optional fields if available
    const name = data.vendorNames.get(params.id);
    if (name) {
      // Don't expose actual name, just indicate category
      stub.CATEGORY = 'BPI Vendor';
    }

    if (params.hash_id) {
      stub.HASHED_ID = createHash('sha256').update(stub.ID).digest('hex').substring(0, 16);
    }

    return stub;
  }
}

// Register the adapter
registerAdapter('bpi', () => new BPIAdapter());

export default BPIAdapter;
