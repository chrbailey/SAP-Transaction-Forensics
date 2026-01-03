/**
 * Synthetic Data Adapter
 *
 * Reads SAP-like data from JSON files for development and testing.
 * Implements all 8 tool methods using in-memory data loaded from disk.
 *
 * Data is loaded from: ../../../synthetic-data/sample_output/*.json
 */

import { readFile } from 'fs/promises';
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
  OrgFilters,
  DOC_CATEGORY,
  RawSalesOrder,
  RawDelivery,
  RawInvoice,
  RawDocFlowEntry,
  RawCustomer,
  RawMaterial,
} from '../../types/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Loaded synthetic dataset structure
 */
interface LoadedDataset {
  salesOrders: RawSalesOrder[];
  deliveries: RawDelivery[];
  invoices: RawInvoice[];
  docFlows: RawDocFlowEntry[];
  customers: RawCustomer[];
  materials: RawMaterial[];
}

export class SyntheticAdapter extends BaseDataAdapter {
  readonly name = 'synthetic';

  private data: LoadedDataset | null = null;
  private dataPath: string;

  constructor(dataPath?: string) {
    super();
    this.dataPath =
      dataPath || join(__dirname, '..', '..', '..', '..', 'synthetic-data', 'sample_output');
  }

  protected async doInitialize(): Promise<void> {
    await this.loadData();
  }

  protected async doShutdown(): Promise<void> {
    this.data = null;
  }

  private async loadData(): Promise<void> {
    try {
      // Load all JSON files in parallel
      // Note: Generator produces flat arrays, not wrapped objects
      const [salesOrdersRaw, deliveriesRaw, invoicesRaw, docFlowsRaw, customersRaw, materialsRaw] =
        await Promise.all([
          this.loadJsonFile<any[]>('orders.json'), // Generator uses orders.json, not sales_orders.json
          this.loadJsonFile<any[]>('deliveries.json'),
          this.loadJsonFile<any[]>('invoices.json'),
          this.loadJsonFile<any[]>('doc_flows.json'), // Generator uses doc_flows.json, not doc_flow.json
          this.loadJsonFile<any[]>('customers.json'),
          this.loadJsonFile<any[]>('materials.json'),
        ]);

      // Transform generator output to adapter-expected format
      this.data = {
        salesOrders: this.transformSalesOrders(salesOrdersRaw),
        deliveries: this.transformDeliveries(deliveriesRaw),
        invoices: this.transformInvoices(invoicesRaw),
        docFlows: this.transformDocFlows(docFlowsRaw),
        customers: this.transformCustomers(customersRaw),
        materials: this.transformMaterials(materialsRaw),
      };

      console.log(
        `Loaded synthetic data: ${this.data.salesOrders.length} orders, ${this.data.deliveries.length} deliveries, ${this.data.invoices.length} invoices`
      );
    } catch (error) {
      console.error('Error loading synthetic data:', error);
      throw new Error(
        `Failed to load synthetic data from ${this.dataPath}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  // =========================================================================
  // Data Transformation: Map generator output to adapter-expected format
  // =========================================================================

  private transformSalesOrders(raw: any[]): RawSalesOrder[] {
    return raw.map(order => ({
      document_number: order.vbeln,
      document_type: order.auart,
      sales_org: order.vkorg,
      distribution_channel: order.vtweg,
      division: order.spart,
      customer: order.kunnr,
      created_date: order.erdat,
      created_time: order.erzet,
      created_by: order.ernam,
      requested_delivery_date: order.vdatu,
      status: 'C', // Complete - synthetic data doesn't track status
      net_value: order.netwr || this.sumItemValues(order.items),
      currency: order.waerk || 'USD',
      po_number: '',
      texts: (order.header_texts || []).map((t: any) => ({
        text_type: t.text_id || 'NOTE',
        text_content: t.text,
        language: t.lang || 'EN',
        created_at: t.changed_at || order.erdat,
      })),
      items: (order.items || []).map((item: any) => ({
        item_number: item.posnr,
        material: item.matnr,
        description: '', // Generator doesn't include description
        plant: item.werks,
        quantity: item.kwmeng,
        unit: 'EA',
        net_value: item.netwr,
        currency: item.waerk || 'USD',
        item_category: item.pstyv,
        rejection_reason: null,
        texts: (item.item_texts || []).map((t: any) => ({
          text_type: t.text_id || 'NOTE',
          text_content: t.text,
          language: t.lang || 'EN',
          created_at: t.changed_at || order.erdat,
        })),
        schedule_lines: item.schedule_lines || [], // VBEP data
      })),
      conditions: order.conditions || [], // KONV data
    }));
  }

  private transformDeliveries(raw: any[]): RawDelivery[] {
    return raw.map(delivery => ({
      document_number: delivery.vbeln,
      delivery_type: delivery.lfart || 'LF', // Standard outbound delivery
      shipping_point: delivery.vstel || '0001',
      ship_to: delivery.kunnr,
      planned_gi_date: delivery.wadat,
      actual_gi_date: delivery.wadat_ist || null,
      created_date: delivery.erdat,
      created_time: delivery.erzet || '00:00:00',
      created_by: delivery.ernam || 'SYSTEM',
      total_weight: delivery.btgew || 0,
      weight_unit: delivery.gewei || 'KG',
      status: delivery.wadat_ist ? 'C' : 'A', // Complete if actual GI exists
      texts: [], // Generator doesn't create delivery texts
      items: (delivery.items || []).map((item: any) => ({
        item_number: item.posnr,
        material: item.matnr,
        description: item.arktx || '',
        delivery_quantity: item.lfimg,
        unit: item.vrkme || 'EA',
        plant: item.werks,
        storage_location: item.lgort || '',
        batch: item.charg || null,
        reference_doc: item.vbeln_ref || item.vgbel || '',
        reference_item: item.posnr_ref || item.vgpos || '',
        picked_quantity: item.pikmg || item.lfimg,
        pick_status: 'C',
      })),
    }));
  }

  private transformInvoices(raw: any[]): RawInvoice[] {
    return raw.map(invoice => ({
      document_number: invoice.vbeln,
      invoice_type: invoice.fkart || 'F2', // Standard invoice
      billing_date: invoice.fkdat,
      payer: invoice.kunrg,
      net_value: invoice.netwr,
      tax_amount: invoice.mwsbk || 0,
      gross_value: (invoice.netwr || 0) + (invoice.mwsbk || 0),
      currency: invoice.waerk || 'USD',
      created_date: invoice.erdat,
      created_time: invoice.erzet || '00:00:00',
      created_by: invoice.ernam || 'SYSTEM',
      status: 'C', // All synthetic invoices are complete
      items: (invoice.items || []).map((item: any) => ({
        item_number: item.posnr,
        material: item.matnr,
        description: item.arktx || '',
        billed_quantity: item.fkimg,
        unit: item.vrkme || 'EA',
        net_price: item.netpr || 0,
        net_value: item.netwr,
        tax_amount: item.mwsbk || 0,
        reference_doc: item.vbeln_ref || item.vgbel || '',
        reference_item: item.posnr_ref || item.vgpos || '',
      })),
    }));
  }

  private transformDocFlows(raw: any[]): RawDocFlowEntry[] {
    return raw.map(flow => ({
      preceding_doc: flow.vbelv,
      preceding_item: flow.posnv,
      preceding_category: flow.vbtyp_v,
      subsequent_doc: flow.vbeln,
      subsequent_item: flow.posnn,
      subsequent_category: flow.vbtyp_n,
      transfer_quantity: flow.rfmng || 0,
      created_date: flow.erdat,
    }));
  }

  private transformCustomers(raw: any[]): RawCustomer[] {
    return raw.map(customer => ({
      customer_id: customer.kunnr,
      name: customer.name1,
      region: customer.regio || customer.land1 || '',
      industry: customer.brsch || '',
      tier: customer.ktokd || 'STANDARD',
      sales_org: customer.vkorg || '1000',
      created_date: customer.erdat || '2024-01-01',
    }));
  }

  private transformMaterials(raw: any[]): RawMaterial[] {
    return raw.map(material => ({
      material_id: material.matnr,
      description: material.maktx || '',
      category: material.mtart || 'FERT',
      product_group: material.matkl || 'GENERAL',
      base_price: material.stprs || 0,
      weight: material.brgew || 0,
      weight_unit: material.gewei || 'KG',
      unit_of_measure: material.meins || 'EA',
    }));
  }

  private sumItemValues(items: any[]): number {
    if (!items || !Array.isArray(items)) return 0;
    return items.reduce((sum, item) => sum + (item.netwr || 0), 0);
  }

  private async loadJsonFile<T>(filename: string): Promise<T> {
    const filePath = join(this.dataPath, filename);
    const content = await readFile(filePath, 'utf-8');
    return JSON.parse(content) as T;
  }

  private getData(): LoadedDataset {
    this.ensureInitialized();
    if (!this.data) {
      throw new Error('Data not loaded');
    }
    return this.data;
  }

  // =========================================================================
  // Tool 1: Search Document Text
  // =========================================================================
  async searchDocText(params: SearchDocTextParams): Promise<SearchResult[]> {
    const data = this.getData();
    const results: SearchResult[] = [];
    const limit = params.limit || 200;
    let pattern: RegExp;

    try {
      pattern = new RegExp(params.pattern, 'gi');
    } catch {
      throw new Error(`Invalid regex pattern: ${params.pattern}`);
    }

    // Helper to check date range
    const matchesDateRange = (dateStr: string): boolean => {
      if (!params.date_from && !params.date_to) return true;
      const date = new Date(dateStr);
      if (params.date_from && date < new Date(params.date_from)) return false;
      if (params.date_to && date > new Date(params.date_to)) return false;
      return true;
    };

    // Helper to check org filters
    const matchesOrgFilters = (orgKeys: OrgFilters): boolean => {
      if (!params.org_filters) return true;
      if (params.org_filters.VKORG && orgKeys.VKORG !== params.org_filters.VKORG) return false;
      if (params.org_filters.VTWEG && orgKeys.VTWEG !== params.org_filters.VTWEG) return false;
      if (params.org_filters.SPART && orgKeys.SPART !== params.org_filters.SPART) return false;
      if (params.org_filters.WERKS && orgKeys.WERKS !== params.org_filters.WERKS) return false;
      return true;
    };

    // Search sales order texts
    if (!params.doc_type || params.doc_type === 'sales') {
      for (const order of data.salesOrders) {
        if (results.length >= limit) break;
        if (!matchesDateRange(order.created_date)) continue;

        const orgKeys: OrgFilters = {
          VKORG: order.sales_org,
          VTWEG: order.distribution_channel,
          SPART: order.division,
        };
        if (!matchesOrgFilters(orgKeys)) continue;

        // Search header texts
        for (const text of order.texts) {
          if (results.length >= limit) break;

          const matches = text.text_content.match(pattern);
          if (!matches) continue;

          const snippet = this.createSnippet(text.text_content, matches[0] || '');
          const changedDate = text.created_at?.split('T')[0];
          results.push({
            doc_type: 'sales',
            doc_key: order.document_number,
            snippet,
            match_score: matches.length / Math.max(1, text.text_content.split(/\s+/).length),
            dates: {
              created: order.created_date,
              ...(changedDate ? { changed: changedDate } : {}),
            },
            org_keys: orgKeys,
          });
        }

        // Search item texts
        for (const item of order.items) {
          if (results.length >= limit) break;

          for (const text of item.texts) {
            if (results.length >= limit) break;

            const matches = text.text_content.match(pattern);
            if (!matches) continue;

            const snippet = this.createSnippet(text.text_content, matches[0] || '');
            const changedDate = text.created_at?.split('T')[0];
            results.push({
              doc_type: 'sales',
              doc_key: order.document_number,
              snippet,
              match_score: matches.length / Math.max(1, text.text_content.split(/\s+/).length),
              dates: {
                created: order.created_date,
                ...(changedDate ? { changed: changedDate } : {}),
              },
              org_keys: { ...orgKeys, WERKS: item.plant },
            });
          }
        }
      }
    }

    // Search delivery texts
    if (!params.doc_type || params.doc_type === 'delivery') {
      for (const delivery of data.deliveries) {
        if (results.length >= limit) break;
        if (!matchesDateRange(delivery.created_date)) continue;

        for (const text of delivery.texts) {
          if (results.length >= limit) break;

          const matches = text.text_content.match(pattern);
          if (!matches) continue;

          const snippet = this.createSnippet(text.text_content, matches[0] || '');
          const changedDate = text.created_at?.split('T')[0];
          results.push({
            doc_type: 'delivery',
            doc_key: delivery.document_number,
            snippet,
            match_score: matches.length / Math.max(1, text.text_content.split(/\s+/).length),
            dates: {
              created: delivery.created_date,
              ...(changedDate ? { changed: changedDate } : {}),
            },
            org_keys: {},
          });
        }
      }
    }

    return results.slice(0, limit);
  }

  private createSnippet(text: string, match: string): string {
    const matchIndex = text.toLowerCase().indexOf(match.toLowerCase());
    if (matchIndex === -1) return text.slice(0, 150);

    const snippetStart = Math.max(0, matchIndex - 50);
    const snippetEnd = Math.min(text.length, matchIndex + match.length + 50);
    return (
      (snippetStart > 0 ? '...' : '') +
      text.slice(snippetStart, snippetEnd) +
      (snippetEnd < text.length ? '...' : '')
    );
  }

  // =========================================================================
  // Tool 2: Get Document Text
  // =========================================================================
  async getDocText(params: DocTextParams): Promise<DocTextResult> {
    const data = this.getData();
    const result: DocTextResult = {
      header_texts: [],
      item_texts: [],
    };

    if (params.doc_type === 'sales') {
      const order = data.salesOrders.find(o => o.document_number === params.doc_key);
      if (order) {
        // Header texts
        for (const text of order.texts) {
          const changedAt = text.created_at?.split('T')[0];
          result.header_texts.push({
            text_id: text.text_type,
            lang: text.language,
            text: text.text_content,
            ...(changedAt ? { changed_at: changedAt } : {}),
          });
        }
        // Item texts
        for (const item of order.items) {
          for (const text of item.texts) {
            const changedAt = text.created_at?.split('T')[0];
            result.item_texts.push({
              item_number: item.item_number,
              text_id: text.text_type,
              lang: text.language,
              text: text.text_content,
              ...(changedAt ? { changed_at: changedAt } : {}),
            });
          }
        }
      }
    } else if (params.doc_type === 'delivery') {
      const delivery = data.deliveries.find(d => d.document_number === params.doc_key);
      if (delivery) {
        for (const text of delivery.texts) {
          const changedAt = text.created_at?.split('T')[0];
          result.header_texts.push({
            text_id: text.text_type,
            lang: text.language,
            text: text.text_content,
            ...(changedAt ? { changed_at: changedAt } : {}),
          });
        }
      }
    }
    // Invoices typically don't have texts in the synthetic data

    return result;
  }

  // =========================================================================
  // Tool 3: Get Document Flow
  // =========================================================================
  async getDocFlow(params: DocFlowParams): Promise<DocFlowResult> {
    const data = this.getData();
    const result: DocFlowResult = {
      root_document: params.vbeln,
      flow: [],
    };

    // Find the sales order
    const order = data.salesOrders.find(o => o.document_number === params.vbeln);
    if (order) {
      result.flow.push({
        doc_type: 'Sales Order',
        doc_number: order.document_number,
        doc_category: DOC_CATEGORY.ORDER,
        status: order.status,
        created_date: order.created_date,
        created_time: order.created_time,
        items: order.items.map(item => ({
          item_number: item.item_number,
          quantity: item.quantity,
        })),
      });
    }

    // Find subsequent documents via document flow
    const processedDocs = new Set<string>([params.vbeln]);
    const queue = [params.vbeln];

    while (queue.length > 0) {
      const currentDoc = queue.shift();
      if (!currentDoc) continue;

      const subsequentFlows = data.docFlows.filter(f => f.preceding_doc === currentDoc);

      for (const flow of subsequentFlows) {
        if (processedDocs.has(flow.subsequent_doc)) continue;
        processedDocs.add(flow.subsequent_doc);
        queue.push(flow.subsequent_doc);

        // Add delivery to flow
        if (flow.subsequent_category === DOC_CATEGORY.DELIVERY) {
          const delivery = data.deliveries.find(d => d.document_number === flow.subsequent_doc);
          if (delivery) {
            // Check if we already have this document
            const existing = result.flow.find(f => f.doc_number === delivery.document_number);
            if (!existing) {
              result.flow.push({
                doc_type: 'Delivery',
                doc_number: delivery.document_number,
                doc_category: DOC_CATEGORY.DELIVERY,
                status: delivery.status,
                created_date: delivery.created_date,
                created_time: delivery.created_time,
                items: delivery.items.map(item => ({
                  item_number: item.item_number,
                  ref_doc: item.reference_doc,
                  ref_item: item.reference_item,
                  quantity: item.delivery_quantity,
                })),
              });
            }
          }
        }

        // Add invoice to flow
        if (flow.subsequent_category === DOC_CATEGORY.INVOICE) {
          const invoice = data.invoices.find(i => i.document_number === flow.subsequent_doc);
          if (invoice) {
            const existing = result.flow.find(f => f.doc_number === invoice.document_number);
            if (!existing) {
              result.flow.push({
                doc_type: 'Invoice',
                doc_number: invoice.document_number,
                doc_category: DOC_CATEGORY.INVOICE,
                status: invoice.status,
                created_date: invoice.created_date,
                created_time: invoice.created_time,
                items: invoice.items.map(item => ({
                  item_number: item.item_number,
                  ref_doc: item.reference_doc,
                  ref_item: item.reference_item,
                  quantity: item.billed_quantity,
                })),
              });
            }
          }
        }
      }
    }

    return result;
  }

  // =========================================================================
  // Tool 4: Get Sales Document Header
  // =========================================================================
  async getSalesDocHeader(params: SalesDocHeaderParams): Promise<SalesDocHeader | null> {
    const data = this.getData();
    const order = data.salesOrders.find(o => o.document_number === params.vbeln);

    if (!order) return null;

    return {
      VBELN: order.document_number,
      AUART: order.document_type,
      VKORG: order.sales_org,
      VTWEG: order.distribution_channel,
      SPART: order.division,
      KUNNR: order.customer,
      AUDAT: order.created_date,
      VDATU: order.requested_delivery_date,
      ERNAM: order.created_by,
      ERDAT: order.created_date,
      ERZET: order.created_time,
      GBSTK: order.status,
      NETWR: order.net_value,
      WAERK: order.currency,
      ...(order.po_number ? { BSTNK: order.po_number } : {}),
    };
  }

  // =========================================================================
  // Tool 5: Get Sales Document Items
  // =========================================================================
  async getSalesDocItems(params: SalesDocItemsParams): Promise<SalesDocItem[]> {
    const data = this.getData();
    const order = data.salesOrders.find(o => o.document_number === params.vbeln);

    if (!order) return [];

    return order.items.map(item => ({
      VBELN: order.document_number,
      POSNR: item.item_number,
      MATNR: item.material,
      ARKTX: item.description,
      WERKS: item.plant,
      KWMENG: item.quantity,
      VRKME: item.unit,
      NETWR: item.net_value,
      WAERK: item.currency,
      PSTYV: item.item_category,
      ...(item.rejection_reason ? { ABGRU: item.rejection_reason } : {}),
    }));
  }

  // =========================================================================
  // Tool 6: Get Delivery Timing
  // =========================================================================
  async getDeliveryTiming(params: DeliveryTimingParams): Promise<DeliveryTimingResult | null> {
    const data = this.getData();
    const delivery = data.deliveries.find(d => d.document_number === params.vbeln);

    if (!delivery) return null;

    // Get requested dates from linked sales orders
    const itemTiming = delivery.items.map(item => {
      let requestedDate: string | undefined;

      // Find the linked sales order to get requested delivery date
      if (item.reference_doc) {
        const salesOrder = data.salesOrders.find(o => o.document_number === item.reference_doc);
        if (salesOrder) {
          requestedDate = salesOrder.requested_delivery_date;
        }
      }

      return {
        item_number: item.item_number,
        material: item.material,
        ...(requestedDate ? { requested_date: requestedDate } : {}),
        ...(delivery.planned_gi_date ? { confirmed_date: delivery.planned_gi_date } : {}),
        ...(delivery.actual_gi_date ? { actual_date: delivery.actual_gi_date } : {}),
      };
    });

    return {
      delivery_number: params.vbeln,
      header_timing: {
        ...(delivery.planned_gi_date ? { requested_date: delivery.planned_gi_date } : {}),
        ...(delivery.planned_gi_date ? { planned_gi_date: delivery.planned_gi_date } : {}),
        ...(delivery.actual_gi_date ? { actual_gi_date: delivery.actual_gi_date } : {}),
      },
      item_timing: itemTiming,
    };
  }

  // =========================================================================
  // Tool 7: Get Invoice Timing
  // =========================================================================
  async getInvoiceTiming(params: InvoiceTimingParams): Promise<InvoiceTimingResult | null> {
    const data = this.getData();
    const invoice = data.invoices.find(i => i.document_number === params.vbeln);

    if (!invoice) return null;

    // Get linked documents
    const linkedDeliveries = [...new Set(invoice.items.map(i => i.reference_doc))];

    // Find linked sales orders through deliveries
    const linkedOrders: string[] = [];
    for (const deliveryNum of linkedDeliveries) {
      const delivery = data.deliveries.find(d => d.document_number === deliveryNum);
      if (delivery) {
        for (const item of delivery.items) {
          if (item.reference_doc && !linkedOrders.includes(item.reference_doc)) {
            linkedOrders.push(item.reference_doc);
          }
        }
      }
    }

    return {
      invoice_number: params.vbeln,
      billing_date: invoice.billing_date,
      posting_date: invoice.created_date, // Using created_date as posting_date for synthetic
      created_date: invoice.created_date,
      created_time: invoice.created_time,
      linked_deliveries: linkedDeliveries,
      linked_orders: linkedOrders,
    };
  }

  // =========================================================================
  // Tool 8: Get Master Stub
  // =========================================================================
  async getMasterStub(params: MasterStubParams): Promise<MasterStub | null> {
    const data = this.getData();

    let entity: MasterStub | null = null;

    switch (params.entity_type) {
      case 'customer': {
        const customer = data.customers.find(c => c.customer_id === params.id);
        if (customer) {
          entity = {
            ENTITY_TYPE: 'customer',
            ID: customer.customer_id,
            INDUSTRY: customer.industry,
            REGION: customer.region,
            CATEGORY: customer.tier,
            ERDAT: customer.created_date,
          };
        }
        break;
      }
      case 'vendor': {
        // No vendors in synthetic data, return null
        return null;
      }
      case 'material': {
        const material = data.materials.find(m => m.material_id === params.id);
        if (material) {
          entity = {
            ENTITY_TYPE: 'material',
            ID: material.material_id,
            CATEGORY: material.category,
            MATKL: material.product_group,
          };
        }
        break;
      }
    }

    if (!entity) return null;

    // Optionally hash the ID
    if (params.hash_id) {
      entity = {
        ...entity,
        HASHED_ID: createHash('sha256').update(entity.ID).digest('hex').slice(0, 16),
      };
    }

    return entity;
  }
}

// Register the adapter
registerAdapter('synthetic', () => new SyntheticAdapter());

export default SyntheticAdapter;
