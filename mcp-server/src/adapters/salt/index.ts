/**
 * SALT Dataset Adapter
 *
 * Loads real ERP data from SAP's SALT (Sales Autocompletion Linked Business Tables)
 * dataset published on HuggingFace. This provides authentic SAP sales order data
 * for testing and development without requiring access to a live SAP system.
 *
 * Dataset: https://huggingface.co/datasets/SAP/SALT
 *
 * Features:
 * - Automatic download from HuggingFace on first use
 * - Caches data locally for subsequent runs
 * - Maps S/4HANA CDS view fields to traditional SAP field names
 * - Real customer behavior patterns for meaningful analysis
 *
 * Limitations:
 * - Sales documents only (no deliveries or invoices in SALT)
 * - No document texts (SALT doesn't include free-text fields)
 * - Document flow is synthetic (order self-references only)
 */

import { readFile, writeFile, mkdir, stat } from 'fs/promises';
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
  RawDocFlowEntry,
} from '../../types/index.js';

import {
  SaltSalesDocument,
  SaltSalesDocumentItem,
  SaltCustomer,
  SaltAddress,
  mapSaltToSalesDocHeader,
  mapSaltToSalesDocItem,
  mapSaltToCustomerStub,
  generateDocFlowFromSalt,
  calculateSaltStats,
  type SaltDatasetStats,
} from './schema-mapper.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// HuggingFace dataset URLs (parquet files) - reserved for future direct download
const _HUGGINGFACE_BASE = 'https://huggingface.co/datasets/SAP/SALT/resolve/main/data';
void _HUGGINGFACE_BASE;
const _DATASET_FILES = {
  salesDocuments: 'I_SalesDocument_train.parquet',
  salesDocumentItems: 'I_SalesDocumentItem_train.parquet',
  customers: 'I_Customer.parquet',
  addresses: 'I_AddrOrgNamePostalAddress.parquet',
};
void _DATASET_FILES;

// Default cache directory
const DEFAULT_CACHE_DIR = join(__dirname, '..', '..', '..', '..', 'data', 'salt');

/**
 * Configuration options for SALT adapter
 */
export interface SaltAdapterConfig {
  /** Directory to cache downloaded data */
  cacheDir?: string;
  /** Maximum number of sales documents to load (for memory management) */
  maxDocuments?: number;
  /** Force re-download even if cache exists */
  forceDownload?: boolean;
  /** Use test split instead of train split */
  useTestSplit?: boolean;
}

/**
 * Loaded SALT dataset structure
 */
interface LoadedSaltData {
  salesDocuments: SaltSalesDocument[];
  salesDocumentItems: SaltSalesDocumentItem[];
  customers: SaltCustomer[];
  addresses: SaltAddress[];
  // Mapped data
  salesHeaders: Map<string, SalesDocHeader>;
  salesItems: Map<string, SalesDocItem[]>;
  customerStubs: Map<string, MasterStub>;
  docFlows: RawDocFlowEntry[];
  stats: SaltDatasetStats;
}

/**
 * SALT Dataset Adapter
 *
 * Provides access to real SAP ERP data from the SALT dataset.
 */
export class SaltAdapter extends BaseDataAdapter {
  readonly name = 'salt';

  private data: LoadedSaltData | null = null;
  private config: Required<SaltAdapterConfig>;

  constructor(config: SaltAdapterConfig = {}) {
    super();
    this.config = {
      cacheDir: config.cacheDir || DEFAULT_CACHE_DIR,
      maxDocuments: config.maxDocuments || 100000,
      forceDownload: config.forceDownload || false,
      useTestSplit: config.useTestSplit || false,
    };
  }

  protected async doInitialize(): Promise<void> {
    console.log(`[SALT] Initializing adapter...`);
    console.log(`[SALT] Cache directory: ${this.config.cacheDir}`);

    // Ensure cache directory exists
    await mkdir(this.config.cacheDir, { recursive: true });

    // Check for cached JSON data first
    const cachedDataPath = join(this.config.cacheDir, 'salt_data.json');

    if (!this.config.forceDownload) {
      try {
        await stat(cachedDataPath);
        console.log(`[SALT] Loading from cache: ${cachedDataPath}`);
        const cached = JSON.parse(await readFile(cachedDataPath, 'utf-8'));
        this.data = this.processRawData(
          cached.salesDocuments,
          cached.salesDocumentItems,
          cached.customers,
          cached.addresses
        );
        console.log(`[SALT] Loaded ${this.data.stats.salesDocuments} sales documents from cache`);
        return;
      } catch {
        // Cache doesn't exist, need to download
      }
    }

    // Download from HuggingFace
    console.log(`[SALT] Downloading from HuggingFace...`);
    console.log(`[SALT] Note: First download requires 'datasets' Python package`);
    console.log(`[SALT] Run: pip install datasets pyarrow`);

    const rawData = await this.downloadFromHuggingFace();

    // Process and map the data
    this.data = this.processRawData(
      rawData.salesDocuments,
      rawData.salesDocumentItems,
      rawData.customers,
      rawData.addresses
    );

    // Cache for future use
    console.log(`[SALT] Caching data to: ${cachedDataPath}`);
    await writeFile(
      cachedDataPath,
      JSON.stringify({
        salesDocuments: rawData.salesDocuments.slice(0, this.config.maxDocuments),
        salesDocumentItems: rawData.salesDocumentItems,
        customers: rawData.customers,
        addresses: rawData.addresses,
      })
    );

    console.log(`[SALT] Initialization complete`);
    console.log(`[SALT] Stats:`, this.data.stats);
  }

  protected async doShutdown(): Promise<void> {
    this.data = null;
  }

  /**
   * Download SALT data from HuggingFace using the datasets library
   */
  private async downloadFromHuggingFace(): Promise<{
    salesDocuments: SaltSalesDocument[];
    salesDocumentItems: SaltSalesDocumentItem[];
    customers: SaltCustomer[];
    addresses: SaltAddress[];
  }> {
    // We'll use a Python script to download since parquet parsing is easier in Python
    const downloadScript = `
import json
import sys
try:
    from datasets import load_dataset
except ImportError:
    print(json.dumps({"error": "Please install datasets: pip install datasets pyarrow"}))
    sys.exit(1)

try:
    dataset_name = "SAP/SALT"
    split = "${this.config.useTestSplit ? 'test' : 'train'}"

    print(f"Loading SALT dataset ({split} split)...", file=sys.stderr)

    sales_docs = load_dataset(dataset_name, "salesdocuments", split=split)
    sales_items = load_dataset(dataset_name, "salesdocument_items", split=split)
    customers = load_dataset(dataset_name, "customers", split=split)
    addresses = load_dataset(dataset_name, "addresses", split=split)

    max_docs = ${this.config.maxDocuments}

    result = {
        "salesDocuments": [dict(row) for row in sales_docs.select(range(min(len(sales_docs), max_docs)))],
        "salesDocumentItems": [dict(row) for row in sales_items],
        "customers": [dict(row) for row in customers],
        "addresses": [dict(row) for row in addresses],
    }

    print(json.dumps(result))
except Exception as e:
    print(json.dumps({"error": str(e)}))
    sys.exit(1)
`;

    const scriptPath = join(this.config.cacheDir, 'download_salt.py');
    await writeFile(scriptPath, downloadScript);

    // Execute Python script
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);

    try {
      const { stdout, stderr } = await execAsync(`python3 "${scriptPath}"`, {
        maxBuffer: 500 * 1024 * 1024, // 500MB buffer for large datasets
        timeout: 600000, // 10 minute timeout
      });

      if (stderr) {
        console.log(`[SALT] ${stderr}`);
      }

      const result = JSON.parse(stdout);

      if (result.error) {
        throw new Error(result.error);
      }

      return result;
    } catch (error) {
      const err = error as Error;
      if (err.message.includes('datasets')) {
        throw new Error(
          'SALT adapter requires Python with datasets package.\n' +
            'Install with: pip install datasets pyarrow\n' +
            'Then retry initialization.'
        );
      }
      throw new Error(`Failed to download SALT dataset: ${err.message}`);
    }
  }

  /**
   * Process raw SALT data into our internal format
   */
  private processRawData(
    salesDocs: SaltSalesDocument[],
    salesItems: SaltSalesDocumentItem[],
    customers: SaltCustomer[],
    addresses: SaltAddress[]
  ): LoadedSaltData {
    // Map sales documents
    const salesHeaders = new Map<string, SalesDocHeader>();
    for (const doc of salesDocs) {
      const mapped = mapSaltToSalesDocHeader(doc);
      salesHeaders.set(mapped.VBELN, mapped);
    }

    // Map sales items, grouped by document
    const salesItemsMap = new Map<string, SalesDocItem[]>();
    for (const item of salesItems) {
      const mapped = mapSaltToSalesDocItem(item);
      const existing = salesItemsMap.get(mapped.VBELN) || [];
      existing.push(mapped);
      salesItemsMap.set(mapped.VBELN, existing);
    }

    // Map customers
    const customerStubs = new Map<string, MasterStub>();
    for (const customer of customers) {
      const mapped = mapSaltToCustomerStub(customer);
      customerStubs.set(mapped.ID, mapped);
    }

    // Generate document flows
    const docFlows = generateDocFlowFromSalt(salesDocs, salesItems);

    // Calculate statistics
    const stats = calculateSaltStats(salesDocs, salesItems, customers, addresses);

    return {
      salesDocuments: salesDocs,
      salesDocumentItems: salesItems,
      customers,
      addresses,
      salesHeaders,
      salesItems: salesItemsMap,
      customerStubs,
      docFlows,
      stats,
    };
  }

  // ============================================================================
  // IDataAdapter Implementation
  // ============================================================================

  async searchDocText(params: SearchDocTextParams): Promise<SearchResult[]> {
    this.ensureInitialized();

    const results: SearchResult[] = [];
    const pattern = new RegExp(params.pattern, 'i');
    const limit = params.limit || 200;

    // SALT doesn't have document texts, so we search in available fields
    // like customer name, material, plant, etc.
    for (const [vbeln, header] of this.data!.salesHeaders) {
      if (results.length >= limit) break;

      // Apply date filters
      if (params.date_from && header.ERDAT < params.date_from.replace(/-/g, '')) continue;
      if (params.date_to && header.ERDAT > params.date_to.replace(/-/g, '')) continue;

      // Apply org filters
      if (params.org_filters?.VKORG && header.VKORG !== params.org_filters.VKORG) continue;
      if (params.org_filters?.VTWEG && header.VTWEG !== params.org_filters.VTWEG) continue;
      if (params.org_filters?.SPART && header.SPART !== params.org_filters.SPART) continue;

      // Search in document fields
      const searchableText = [header.VBELN, header.AUART, header.KUNNR, header.BSTNK || ''].join(
        ' '
      );

      if (pattern.test(searchableText)) {
        const result: SearchResult = {
          doc_type: 'sales',
          doc_key: vbeln,
          snippet: `Order ${vbeln} - Type: ${header.AUART}, Customer: ${header.KUNNR}`,
          match_score: 1.0,
          dates: {
            created: header.ERDAT,
          },
          org_keys: {
            VKORG: header.VKORG,
            VTWEG: header.VTWEG,
            SPART: header.SPART,
          },
        };
        if (header.AEDAT) {
          result.dates.changed = header.AEDAT;
        }
        results.push(result);
      }
    }

    return results;
  }

  async getDocText(_params: DocTextParams): Promise<DocTextResult> {
    this.ensureInitialized();

    // SALT doesn't include document texts
    // Return empty result with informative message
    return {
      header_texts: [
        {
          text_id: '0001',
          lang: 'EN',
          text: '[SALT dataset does not include document texts. Use synthetic adapter for text analysis testing.]',
        },
      ],
      item_texts: [],
    };
  }

  async getDocFlow(params: DocFlowParams): Promise<DocFlowResult> {
    this.ensureInitialized();

    const vbeln = params.vbeln.padStart(10, '0');
    const header = this.data!.salesHeaders.get(vbeln);

    if (!header) {
      return {
        root_document: vbeln,
        flow: [],
      };
    }

    const items = this.data!.salesItems.get(vbeln) || [];

    // SALT only has sales orders, so flow is just the order itself
    return {
      root_document: vbeln,
      flow: [
        {
          doc_type: 'Sales Order',
          doc_number: vbeln,
          doc_category: DOC_CATEGORY.ORDER,
          status: 'SALT Data',
          created_date: header.ERDAT,
          created_time: header.ERZET,
          items: items.map(item => ({
            item_number: item.POSNR,
            quantity: item.KWMENG,
          })),
        },
      ],
    };
  }

  async getSalesDocHeader(params: SalesDocHeaderParams): Promise<SalesDocHeader | null> {
    this.ensureInitialized();

    const vbeln = params.vbeln.padStart(10, '0');
    return this.data!.salesHeaders.get(vbeln) || null;
  }

  async getSalesDocItems(params: SalesDocItemsParams): Promise<SalesDocItem[]> {
    this.ensureInitialized();

    const vbeln = params.vbeln.padStart(10, '0');
    return this.data!.salesItems.get(vbeln) || [];
  }

  async getDeliveryTiming(_params: DeliveryTimingParams): Promise<DeliveryTimingResult | null> {
    this.ensureInitialized();

    // SALT doesn't include delivery documents
    return null;
  }

  async getInvoiceTiming(_params: InvoiceTimingParams): Promise<InvoiceTimingResult | null> {
    this.ensureInitialized();

    // SALT doesn't include invoice documents
    return null;
  }

  async getMasterStub(params: MasterStubParams): Promise<MasterStub | null> {
    this.ensureInitialized();

    if (params.entity_type !== 'customer') {
      // SALT only has customer master data
      return null;
    }

    const id = params.id.padStart(10, '0');
    const stub = this.data!.customerStubs.get(id);

    if (!stub) return null;

    if (params.hash_id) {
      return {
        ...stub,
        HASHED_ID: createHash('sha256').update(stub.ID).digest('hex').substring(0, 16),
      };
    }

    return stub;
  }

  // ============================================================================
  // Additional Methods for SALT-specific functionality
  // ============================================================================

  /**
   * Get dataset statistics
   */
  getStats(): SaltDatasetStats | null {
    if (!this.data) return null;
    return this.data.stats;
  }

  /**
   * Get all sales document numbers
   */
  getAllSalesDocNumbers(): string[] {
    if (!this.data) return [];
    return Array.from(this.data.salesHeaders.keys());
  }

  /**
   * Get unique sales organizations in the dataset
   */
  getUniqueSalesOrgs(): string[] {
    if (!this.data) return [];
    const orgs = new Set<string>();
    for (const header of this.data.salesHeaders.values()) {
      orgs.add(header.VKORG);
    }
    return Array.from(orgs);
  }

  /**
   * Get documents by sales organization
   */
  getDocumentsBySalesOrg(salesOrg: string): SalesDocHeader[] {
    if (!this.data) return [];
    return Array.from(this.data.salesHeaders.values()).filter(h => h.VKORG === salesOrg);
  }
}

// Register the adapter
registerAdapter('salt', () => new SaltAdapter());

export default SaltAdapter;
