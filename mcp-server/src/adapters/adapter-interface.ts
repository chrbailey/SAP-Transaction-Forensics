/**
 * SAP Data Adapter Interface
 *
 * This interface defines the contract that all SAP data adapters must implement.
 * The architecture supports multiple adapter implementations:
 * - SyntheticAdapter: Reads from JSON files for development/testing
 * - ECCRFCAdapter: Connects to SAP ECC via RFC/BAPI calls
 * - S4ODataAdapter: Connects to S/4HANA via OData services
 *
 * Each adapter must implement all 8 tool methods with consistent return types.
 */

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
} from '../types/index.js';

/**
 * IDataAdapter Interface
 *
 * Core interface that all SAP data adapters must implement.
 * Provides the 8 tool methods corresponding to MCP tools.
 */
export interface IDataAdapter {
  /**
   * Adapter name for logging and identification
   */
  readonly name: string;

  /**
   * Initialize the adapter (load data, establish connections, etc.)
   */
  initialize(): Promise<void>;

  /**
   * Clean up resources (close connections, clear caches, etc.)
   */
  shutdown(): Promise<void>;

  /**
   * Check if the adapter is initialized and ready
   */
  isReady(): boolean;

  /**
   * Tool 1: Search document texts
   *
   * Full-text search across document texts with filtering options.
   * Supports regex patterns and organizational filters.
   *
   * @param params Search parameters including pattern, date range, org filters
   * @returns Array of search results with snippets and metadata
   */
  searchDocText(params: SearchDocTextParams): Promise<SearchResult[]>;

  /**
   * Tool 2: Get document texts
   *
   * Retrieve all text entries for a specific document.
   * Returns both header-level and item-level texts.
   *
   * @param params Document type and key
   * @returns Header and item texts with metadata
   */
  getDocText(params: DocTextParams): Promise<DocTextResult>;

  /**
   * Tool 3: Get document flow
   *
   * Retrieve the complete document chain starting from a sales order.
   * Traces through deliveries, invoices, and related documents.
   *
   * @param params Sales order number (VBELN)
   * @returns Document flow with statuses and dates
   */
  getDocFlow(params: DocFlowParams): Promise<DocFlowResult>;

  /**
   * Tool 4: Get sales document header
   *
   * Retrieve header data for a specific sales order.
   *
   * @param params Sales order number
   * @returns Sales document header with organizational data
   */
  getSalesDocHeader(params: SalesDocHeaderParams): Promise<SalesDocHeader | null>;

  /**
   * Tool 5: Get sales document items
   *
   * Retrieve all line items for a specific sales order.
   *
   * @param params Sales order number
   * @returns Array of sales document items
   */
  getSalesDocItems(params: SalesDocItemsParams): Promise<SalesDocItem[]>;

  /**
   * Tool 6: Get delivery timing
   *
   * Retrieve timing information for a delivery document.
   * Compares requested vs actual dates at header and item level.
   *
   * @param params Delivery number
   * @returns Timing data with requested/actual comparisons
   */
  getDeliveryTiming(params: DeliveryTimingParams): Promise<DeliveryTimingResult | null>;

  /**
   * Tool 7: Get invoice timing
   *
   * Retrieve timing and posting information for an invoice.
   *
   * @param params Invoice number
   * @returns Invoice timing with accounting references
   */
  getInvoiceTiming(params: InvoiceTimingParams): Promise<InvoiceTimingResult | null>;

  /**
   * Tool 8: Get master data stub
   *
   * Retrieve safe/anonymized attributes for master data entities.
   * Does NOT return PII or sensitive business data.
   *
   * @param params Entity type and ID
   * @returns Master data stub with safe attributes only
   */
  getMasterStub(params: MasterStubParams): Promise<MasterStub | null>;
}

/**
 * Base adapter class with common functionality
 * Provides initialization state management and error handling
 */
export abstract class BaseDataAdapter implements IDataAdapter {
  abstract readonly name: string;

  protected initialized = false;

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }
    await this.doInitialize();
    this.initialized = true;
  }

  async shutdown(): Promise<void> {
    if (!this.initialized) {
      return;
    }
    await this.doShutdown();
    this.initialized = false;
  }

  isReady(): boolean {
    return this.initialized;
  }

  protected abstract doInitialize(): Promise<void>;
  protected abstract doShutdown(): Promise<void>;

  protected ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error(`Adapter ${this.name} not initialized. Call initialize() first.`);
    }
  }

  abstract searchDocText(params: SearchDocTextParams): Promise<SearchResult[]>;
  abstract getDocText(params: DocTextParams): Promise<DocTextResult>;
  abstract getDocFlow(params: DocFlowParams): Promise<DocFlowResult>;
  abstract getSalesDocHeader(params: SalesDocHeaderParams): Promise<SalesDocHeader | null>;
  abstract getSalesDocItems(params: SalesDocItemsParams): Promise<SalesDocItem[]>;
  abstract getDeliveryTiming(params: DeliveryTimingParams): Promise<DeliveryTimingResult | null>;
  abstract getInvoiceTiming(params: InvoiceTimingParams): Promise<InvoiceTimingResult | null>;
  abstract getMasterStub(params: MasterStubParams): Promise<MasterStub | null>;
}

/**
 * Factory function type for creating adapters
 */
export type AdapterFactory = () => IDataAdapter;

/**
 * Adapter registry for runtime adapter selection
 */
export const adapterRegistry: Map<string, AdapterFactory> = new Map();

/**
 * Register an adapter factory
 */
export function registerAdapter(name: string, factory: AdapterFactory): void {
  adapterRegistry.set(name, factory);
}

/**
 * Get an adapter by name
 */
export function getAdapter(name: string): IDataAdapter {
  const factory = adapterRegistry.get(name);
  if (!factory) {
    throw new Error(
      `Unknown adapter: ${name}. Available: ${Array.from(adapterRegistry.keys()).join(', ')}`
    );
  }
  return factory();
}

/**
 * List all registered adapters
 */
export function listAdapters(): string[] {
  return Array.from(adapterRegistry.keys());
}
