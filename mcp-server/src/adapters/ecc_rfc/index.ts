/**
 * SAP ECC RFC Adapter
 *
 * Connects to SAP ECC systems via RFC (Remote Function Call) using node-rfc.
 * Implements all 8 tool methods for document retrieval and analysis.
 *
 * Prerequisites:
 * - SAP NetWeaver RFC SDK installed
 * - node-rfc npm package
 * - SAP system connection parameters (via environment variables)
 * - Appropriate authorizations in SAP for the RFC user
 */

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
} from '../../types/index.js';

import { loadECCConfig, isRFCConfigAvailable, sanitizeConfigForLogging } from './config.js';
import { RFCConnectionPool } from './connection-pool.js';
import { RFCNotFoundError, isNotFoundError } from './errors.js';
import {
  callReadText,
  callBapiSalesorderGetlist,
  callSDSalesdocumentRead,
  callBapiSalesdocuGetrelations,
  callBapiOutbDeliveryGetDetail,
  callBapiBillingdocGetdetail,
  callBapiCustomerGetdetail2,
  callBapiMaterialGetDetail,
  callBapiVendorGetdetail,
  padDocNumber,
} from './rfc-calls.js';
import {
  mapVBAKToSalesDocHeader,
  mapVBAPToSalesDocItem,
  mapVBFAToDocFlow,
  mapDeliveryToTiming,
  mapInvoiceToTiming,
  mapCustomerToStub,
  mapMaterialToStub,
  mapVendorToStub,
  mapReadTextResult,
  mapSAPDate,
} from './mappers.js';

/**
 * Text objects for different document types
 */
const TEXT_OBJECTS = {
  sales: { header: 'VBBK', item: 'VBBP' },
  delivery: { header: 'VBLK', item: 'VBLP' },
  invoice: { header: 'VBRK', item: 'VBRP' },
} as const;

/**
 * Common text IDs to retrieve
 */
const TEXT_IDS = ['0001', '0002', '0003'];

/**
 * Logger interface for dependency injection
 */
interface Logger {
  info: (msg: string, meta?: Record<string, unknown>) => void;
  error: (msg: string, meta?: Record<string, unknown>) => void;
  warn: (msg: string, meta?: Record<string, unknown>) => void;
  debug: (msg: string, meta?: Record<string, unknown>) => void;
}

/**
 * SAP ECC RFC Adapter
 *
 * Provides real SAP connectivity via RFC/BAPI calls.
 */
export class ECCRFCAdapter extends BaseDataAdapter {
  readonly name = 'ecc_rfc';

  private pool: RFCConnectionPool | null = null;
  private logger: Logger;

  constructor(logger?: Logger) {
    super();
    this.logger = logger ?? {
      info: console.log,
      error: console.error,
      warn: console.warn,
      debug: () => {}, // Silent by default
    };
  }

  /**
   * Initialize the adapter by loading config and establishing connection pool
   */
  protected async doInitialize(): Promise<void> {
    this.logger.info('Initializing ECC RFC Adapter');

    // Check if configuration is available
    if (!isRFCConfigAvailable()) {
      throw new Error(
        'SAP RFC configuration not available. Set required environment variables: ' +
          'SAP_RFC_ASHOST, SAP_RFC_SYSNR, SAP_RFC_CLIENT, SAP_RFC_USER, SAP_RFC_PASSWD'
      );
    }

    // Load configuration
    const config = loadECCConfig();
    this.logger.info('RFC configuration loaded', { config: sanitizeConfigForLogging(config) });

    // Create and initialize connection pool
    this.pool = new RFCConnectionPool(config, {}, this.logger);
    await this.pool.initialize();

    this.logger.info('ECC RFC Adapter initialized successfully', {
      stats: this.pool.getStats(),
    });
  }

  /**
   * Shutdown the adapter by draining the connection pool
   */
  protected async doShutdown(): Promise<void> {
    this.logger.info('Shutting down ECC RFC Adapter');

    if (this.pool) {
      await this.pool.shutdown();
      this.pool = null;
    }

    this.logger.info('ECC RFC Adapter shut down');
  }

  /**
   * Get the connection pool (with initialization check)
   */
  private getPool(): RFCConnectionPool {
    this.ensureInitialized();
    if (!this.pool) {
      throw new Error('Connection pool not available');
    }
    return this.pool;
  }

  /**
   * Tool 1: Search Document Text
   *
   * Searches for text patterns across sales documents in a date range.
   * Implementation:
   * 1. Get list of sales orders in date range
   * 2. For each order, retrieve texts
   * 3. Apply regex pattern matching
   * 4. Return matching snippets with context
   */
  async searchDocText(params: SearchDocTextParams): Promise<SearchResult[]> {
    const pool = this.getPool();
    const results: SearchResult[] = [];
    const limit = params.limit ?? 50;

    this.logger.debug('Searching document texts', { params });

    try {
      // Build search params, only including dates if provided
      const searchParams: Parameters<typeof callBapiSalesorderGetlist>[1] = {
        maxRows: limit * 10, // Get more orders than limit since not all will match
      };
      if (params.date_from) {
        searchParams.documentDateFrom = params.date_from.replace(/-/g, '');
      }
      if (params.date_to) {
        searchParams.documentDateTo = params.date_to.replace(/-/g, '');
      }

      // Get list of sales orders in date range
      const orders = await callBapiSalesorderGetlist(pool, searchParams);

      this.logger.debug('Found orders for search', { count: orders.length });

      // Compile the search pattern
      const regex = new RegExp(params.pattern, 'gi');

      // Search through each order's texts
      for (const order of orders) {
        if (results.length >= limit) {
          break;
        }

        try {
          // Get order header text
          const textResult = await callReadText(pool, {
            object: 'VBBK',
            name: order.salesDocument,
            id: '0001',
            language: 'EN',
          });

          const fullText = textResult.lines.map(l => l.tdline).join('\n');
          const match = regex.exec(fullText);

          if (match) {
            // Extract snippet around match
            const matchStart = Math.max(0, match.index - 50);
            const matchEnd = Math.min(fullText.length, match.index + match[0].length + 50);
            const snippet = fullText.slice(matchStart, matchEnd);

            results.push({
              doc_type: 'sales',
              doc_key: order.salesDocument,
              snippet:
                (matchStart > 0 ? '...' : '') + snippet + (matchEnd < fullText.length ? '...' : ''),
              match_score: 1.0, // Exact match
              dates: {
                created: mapSAPDate(order.salesDocumentDate),
              },
              org_keys: {},
            });
          }

          // Reset regex for next iteration
          regex.lastIndex = 0;
        } catch (err) {
          // Skip documents where text retrieval fails
          if (!isNotFoundError(err)) {
            this.logger.debug('Failed to get text for order', {
              order: order.salesDocument,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
      }

      this.logger.info('Text search complete', { matches: results.length });
      return results;
    } catch (err) {
      this.logger.error('searchDocText failed', { error: err });
      throw err;
    }
  }

  /**
   * Tool 2: Get Document Text
   *
   * Retrieves all text entries for a specific document using READ_TEXT.
   */
  async getDocText(params: DocTextParams): Promise<DocTextResult> {
    const pool = this.getPool();

    this.logger.debug('Getting document texts', { params });

    const textObjects = TEXT_OBJECTS[params.doc_type];
    if (!textObjects) {
      throw new Error(`Unknown document type: ${params.doc_type}`);
    }

    const docNum = padDocNumber(params.doc_key);
    const textResults: Array<{
      textId: string;
      itemNumber: string;
      language: string;
      result: Awaited<ReturnType<typeof callReadText>>;
    }> = [];

    // Retrieve header texts
    for (const textId of TEXT_IDS) {
      try {
        const result = await callReadText(pool, {
          object: textObjects.header,
          name: docNum,
          id: textId,
          language: 'EN',
        });

        if (result.lines.length > 0) {
          textResults.push({
            textId,
            itemNumber: '000000',
            language: 'EN',
            result,
          });
        }
      } catch (err) {
        // Text not found is expected for many text IDs
        if (!isNotFoundError(err)) {
          this.logger.debug('Failed to get header text', {
            docKey: params.doc_key,
            textId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

    // For sales orders, also try to get item texts
    if (params.doc_type === 'sales') {
      try {
        const { items } = await callSDSalesdocumentRead(pool, params.doc_key);

        for (const item of items) {
          const textName = docNum + item.posnr.padStart(6, '0');

          for (const textId of TEXT_IDS) {
            try {
              const result = await callReadText(pool, {
                object: textObjects.item,
                name: textName,
                id: textId,
                language: 'EN',
              });

              if (result.lines.length > 0) {
                textResults.push({
                  textId,
                  itemNumber: item.posnr,
                  language: 'EN',
                  result,
                });
              }
            } catch {
              // Item text not found is common
            }
          }
        }
      } catch (err) {
        this.logger.debug('Failed to get item texts', {
          docKey: params.doc_key,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return mapReadTextResult(textResults);
  }

  /**
   * Tool 3: Get Document Flow
   *
   * Retrieves the complete document chain using BAPI_SALESDOCU_GETRELATIONS.
   */
  async getDocFlow(params: DocFlowParams): Promise<DocFlowResult> {
    const pool = this.getPool();

    this.logger.debug('Getting document flow', { params });

    try {
      const relations = await callBapiSalesdocuGetrelations(pool, params.vbeln);
      return mapVBFAToDocFlow(params.vbeln, relations);
    } catch (err) {
      if (err instanceof RFCNotFoundError) {
        // Return empty flow for non-existent documents
        return {
          root_document: params.vbeln,
          flow: [],
        };
      }
      throw err;
    }
  }

  /**
   * Tool 4: Get Sales Document Header
   *
   * Retrieves header data using SD_SALESDOCUMENT_READ.
   */
  async getSalesDocHeader(params: SalesDocHeaderParams): Promise<SalesDocHeader | null> {
    const pool = this.getPool();

    this.logger.debug('Getting sales document header', { params });

    try {
      const { header } = await callSDSalesdocumentRead(pool, params.vbeln);
      return mapVBAKToSalesDocHeader(header);
    } catch (err) {
      if (err instanceof RFCNotFoundError) {
        return null;
      }
      throw err;
    }
  }

  /**
   * Tool 5: Get Sales Document Items
   *
   * Retrieves all line items using SD_SALESDOCUMENT_READ.
   */
  async getSalesDocItems(params: SalesDocItemsParams): Promise<SalesDocItem[]> {
    const pool = this.getPool();

    this.logger.debug('Getting sales document items', { params });

    try {
      const { header, items } = await callSDSalesdocumentRead(pool, params.vbeln);
      return items.map(item => mapVBAPToSalesDocItem(header.vbeln, item));
    } catch (err) {
      if (err instanceof RFCNotFoundError) {
        return [];
      }
      throw err;
    }
  }

  /**
   * Tool 6: Get Delivery Timing
   *
   * Retrieves timing information using BAPI_OUTB_DELIVERY_GET_DETAIL.
   */
  async getDeliveryTiming(params: DeliveryTimingParams): Promise<DeliveryTimingResult | null> {
    const pool = this.getPool();

    this.logger.debug('Getting delivery timing', { params });

    try {
      const { header, items } = await callBapiOutbDeliveryGetDetail(pool, params.vbeln);
      return mapDeliveryToTiming(header, items);
    } catch (err) {
      if (err instanceof RFCNotFoundError) {
        return null;
      }
      throw err;
    }
  }

  /**
   * Tool 7: Get Invoice Timing
   *
   * Retrieves timing and posting info using BAPI_BILLINGDOC_GETDETAIL.
   */
  async getInvoiceTiming(params: InvoiceTimingParams): Promise<InvoiceTimingResult | null> {
    const pool = this.getPool();

    this.logger.debug('Getting invoice timing', { params });

    try {
      const { header, items } = await callBapiBillingdocGetdetail(pool, params.vbeln);
      return mapInvoiceToTiming(header, items);
    } catch (err) {
      if (err instanceof RFCNotFoundError) {
        return null;
      }
      throw err;
    }
  }

  /**
   * Tool 8: Get Master Stub
   *
   * Retrieves safe/anonymized master data attributes.
   * Routes to appropriate BAPI based on entity type.
   */
  async getMasterStub(params: MasterStubParams): Promise<MasterStub | null> {
    const pool = this.getPool();

    this.logger.debug('Getting master stub', { params });

    try {
      switch (params.entity_type) {
        case 'customer': {
          const customer = await callBapiCustomerGetdetail2(pool, params.id);
          return mapCustomerToStub(customer, params.hash_id ?? false);
        }

        case 'material': {
          const material = await callBapiMaterialGetDetail(pool, params.id);
          return mapMaterialToStub(material, params.hash_id ?? false);
        }

        case 'vendor': {
          const vendor = await callBapiVendorGetdetail(pool, params.id);
          return mapVendorToStub(vendor, params.hash_id ?? false);
        }

        default:
          throw new Error(`Unknown entity type: ${params.entity_type}`);
      }
    } catch (err) {
      if (err instanceof RFCNotFoundError) {
        return null;
      }
      throw err;
    }
  }

  /**
   * Get pool statistics for monitoring
   */
  getPoolStats(): Record<string, unknown> {
    if (!this.pool) {
      return { status: 'not_initialized' };
    }
    // Convert PoolStats to plain object for compatibility with Record<string, unknown>
    const stats = this.pool.getStats();
    return {
      total: stats.total,
      inUse: stats.inUse,
      available: stats.available,
      connectionsCreated: stats.connectionsCreated,
      connectionsClosed: stats.connectionsClosed,
      totalCalls: stats.totalCalls,
      createdAt: stats.createdAt.toISOString(),
    };
  }
}

// Register the adapter
registerAdapter('ecc_rfc', () => new ECCRFCAdapter());

export default ECCRFCAdapter;
