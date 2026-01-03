/**
 * Tool: export_ocel
 *
 * Exports SAP data in OCEL 2.0 (Object-Centric Event Log) format.
 * Supports both O2C (Order-to-Cash) and P2P (Purchase-to-Pay) processes.
 * Compatible with PM4Py, Celonis, and other OCEL-compliant tools.
 */

import { z } from 'zod';
import { SAPAdapter } from '../adapters/adapter.js';
import { createAuditContext } from '../logging/audit.js';
import {
  enforceToolPolicies,
  withTimeout,
  getPolicyConfig,
  validateDateRange,
} from '../policies/limits.js';
import { OCELLog, createOCELExporter } from '../ocel/index.js';

/**
 * OCEL 2.0 Type Definitions (legacy format for O2C)
 */
interface OCELObjectType {
  attributes: Array<{
    name: string;
    type: string;
  }>;
}

interface OCELEventType {
  attributes: Array<{
    name: string;
    type: string;
  }>;
}

interface OCELObject {
  type: string;
  attributes: Array<{
    name: string;
    value: string | number | boolean;
    time?: string;
  }>;
  relationships?: Array<{
    objectId: string;
    qualifier: string;
  }>;
}

interface OCELEvent {
  type: string;
  time: string;
  attributes?: Array<{
    name: string;
    value: string | number | boolean;
  }>;
  relationships: Array<{
    objectId: string;
    qualifier: string;
  }>;
}

interface OCEL2Structure {
  objectTypes: Record<string, OCELObjectType>;
  eventTypes: Record<string, OCELEventType>;
  objects: Record<string, OCELObject>;
  events: Record<string, OCELEvent>;
}

/**
 * Extended result type supporting both formats
 */
export interface ExportOcelResult {
  format: 'ocel2' | 'legacy';
  processType: 'O2C' | 'P2P';
  ocel?: OCELLog;
  legacy?: OCEL2Structure;
  stats: {
    totalEvents: number;
    totalObjects: number;
    eventTypes: number;
    objectTypes: number;
  };
}

/**
 * Zod schema for input validation
 */
export const ExportOcelSchema = z.object({
  date_from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD format')
    .optional(),
  date_to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD format')
    .optional(),
  sales_org: z.string().optional(),
  output_format: z.enum(['json', 'jsonocel']).default('json'),
  include_items: z.boolean().default(true),
  include_relationships: z.boolean().default(true),
  max_traces: z.number().int().min(0).max(100000).default(0),
});

export type ExportOcelInput = z.infer<typeof ExportOcelSchema>;

/**
 * Tool definition for MCP registration
 */
export const exportOcelTool = {
  name: 'export_ocel',
  description: `Export SAP data in OCEL 2.0 (Object-Centric Event Log) format for process mining.

Supports both process types:
- **O2C (Order-to-Cash)**: Sales orders → Deliveries → Invoices
- **P2P (Purchase-to-Pay)**: Purchase orders → Goods receipts → Invoices

Compatible with PM4Py, Celonis, Apromore, and other OCEL 2.0 compliant tools.

Use this tool to:
- Extract process mining data for external analysis tools
- Build object-centric event logs capturing multi-object relationships
- Export data for conformance checking and process discovery
- Enable variant analysis across interacting business objects

Parameters:
- date_from: Start date filter (YYYY-MM-DD, optional)
- date_to: End date filter (YYYY-MM-DD, optional)
- sales_org: Filter by sales/purchasing organization (optional)
- output_format: 'json' (standard) or 'jsonocel' (OCEL 2.0), default 'json'
- include_items: Include line item objects and events (default true)
- include_relationships: Include object-to-object relationships (default true)
- max_traces: Maximum traces to export, 0 = all (default 0)

Returns OCEL 2.0 structure with:
**For P2P:**
- Object types: purchase_order, po_item, goods_receipt, invoice, vendor
- Event types: Create PO, Record GR, Record Invoice, Clear Invoice, etc.

**For O2C:**
- Object types: order, order_item, delivery, delivery_item, invoice, invoice_item
- Event types: order_created, item_added, delivery_created, goods_issued, invoice_created`,
  inputSchema: {
    type: 'object' as const,
    properties: {
      date_from: {
        type: 'string',
        description: 'Start date for filtering (YYYY-MM-DD, optional)',
      },
      date_to: {
        type: 'string',
        description: 'End date for filtering (YYYY-MM-DD, optional)',
      },
      sales_org: {
        type: 'string',
        description: 'Sales/purchasing organization filter (optional)',
      },
      output_format: {
        type: 'string',
        enum: ['json', 'jsonocel'],
        description: 'Output format: json (standard) or jsonocel (OCEL 2.0)',
      },
      include_items: {
        type: 'boolean',
        description: 'Include line item objects and events (default true)',
      },
      include_relationships: {
        type: 'boolean',
        description: 'Include object-to-object relationships (default true)',
      },
      max_traces: {
        type: 'number',
        description: 'Maximum traces to export, 0 = all (default 0)',
      },
    },
    required: [],
  },
};

/**
 * Build OCEL object types schema
 */
function buildObjectTypes(includeItems: boolean): Record<string, OCELObjectType> {
  const types: Record<string, OCELObjectType> = {
    order: {
      attributes: [
        { name: 'order_type', type: 'string' },
        { name: 'sales_org', type: 'string' },
        { name: 'customer', type: 'string' },
        { name: 'net_value', type: 'float' },
        { name: 'currency', type: 'string' },
      ],
    },
    delivery: {
      attributes: [
        { name: 'delivery_type', type: 'string' },
        { name: 'shipping_point', type: 'string' },
        { name: 'customer', type: 'string' },
        { name: 'status', type: 'string' },
      ],
    },
    invoice: {
      attributes: [
        { name: 'invoice_type', type: 'string' },
        { name: 'sales_org', type: 'string' },
        { name: 'payer', type: 'string' },
        { name: 'net_value', type: 'float' },
        { name: 'currency', type: 'string' },
      ],
    },
  };

  if (includeItems) {
    types['order_item'] = {
      attributes: [
        { name: 'material', type: 'string' },
        { name: 'quantity', type: 'float' },
        { name: 'plant', type: 'string' },
        { name: 'net_value', type: 'float' },
      ],
    };
    types['delivery_item'] = {
      attributes: [
        { name: 'material', type: 'string' },
        { name: 'quantity', type: 'float' },
        { name: 'plant', type: 'string' },
      ],
    };
    types['invoice_item'] = {
      attributes: [
        { name: 'material', type: 'string' },
        { name: 'quantity', type: 'float' },
        { name: 'net_value', type: 'float' },
      ],
    };
  }

  return types;
}

/**
 * Build OCEL event types schema
 */
function buildEventTypes(includeItems: boolean): Record<string, OCELEventType> {
  const types: Record<string, OCELEventType> = {
    order_created: {
      attributes: [{ name: 'user', type: 'string' }],
    },
    delivery_created: {
      attributes: [{ name: 'user', type: 'string' }],
    },
    goods_issued: {
      attributes: [],
    },
    invoice_created: {
      attributes: [{ name: 'user', type: 'string' }],
    },
  };

  if (includeItems) {
    types['item_added'] = {
      attributes: [{ name: 'item_category', type: 'string' }],
    };
    types['item_delivered'] = {
      attributes: [],
    };
    types['item_invoiced'] = {
      attributes: [],
    };
  }

  return types;
}

/**
 * Format SAP date and time to ISO 8601
 */
function formatSAPDateTime(date: string, time: string): string {
  // SAP date format: YYYYMMDD or YYYY-MM-DD
  // SAP time format: HHMMSS or HH:MM:SS
  const cleanDate = date.replace(/-/g, '');
  const cleanTime = time.replace(/:/g, '');

  const year = cleanDate.substring(0, 4);
  const month = cleanDate.substring(4, 6);
  const day = cleanDate.substring(6, 8);
  const hour = cleanTime.substring(0, 2) || '00';
  const minute = cleanTime.substring(2, 4) || '00';
  const second = cleanTime.substring(4, 6) || '00';

  return `${year}-${month}-${day}T${hour}:${minute}:${second}Z`;
}

/**
 * Detect if adapter is P2P (BPI)
 */
function isP2PAdapter(adapter: SAPAdapter): boolean {
  return adapter.name === 'bpi';
}

/**
 * BPI Trace interface for P2P export
 */
interface BPITrace {
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
 * Execute the export_ocel tool
 */
export async function executeExportOcel(
  adapter: SAPAdapter,
  rawInput: unknown
): Promise<ExportOcelResult> {
  // Validate input
  const input = ExportOcelSchema.parse(rawInput);

  // Create audit context
  const auditContext = createAuditContext(
    'export_ocel',
    input as Record<string, unknown>,
    adapter.name
  );

  try {
    // Detect adapter type and route accordingly
    if (isP2PAdapter(adapter)) {
      return await executeP2PExport(adapter, input, auditContext);
    }

    // O2C export (legacy)
    return await executeO2CExport(adapter, input, auditContext);
  } catch (error) {
    auditContext.error(error as Error);
    throw error;
  }
}

/**
 * Execute P2P export using the new OCEL exporter
 */
async function executeP2PExport(
  adapter: SAPAdapter,
  input: ExportOcelInput,
  auditContext: ReturnType<typeof createAuditContext>
): Promise<ExportOcelResult> {
  // Get traces from BPI adapter
  const bpiAdapter = adapter as SAPAdapter & {
    getTraces: () => BPITrace[];
  };

  if (!bpiAdapter.getTraces) {
    throw new Error('BPI adapter does not support getTraces method');
  }

  const traces = bpiAdapter.getTraces();

  // Create OCEL exporter
  const exporter = createOCELExporter();

  // Build export options
  const exportOptions: Parameters<typeof exporter.exportP2P>[1] = {
    includeO2ORelationships: input.include_relationships,
    includeAllAttributes: true,
    maxTraces: input.max_traces || traces.length,
  };

  // Add date range only if both dates are provided
  if (input.date_from && input.date_to) {
    exportOptions.dateRange = { from: input.date_from, to: input.date_to };
  }

  // Export to OCEL 2.0 format
  const ocelLog = exporter.exportP2P(traces, exportOptions);

  // Get stats
  const stats = exporter.getStats(ocelLog);

  // Log success
  auditContext.success(stats.totalEvents + stats.totalObjects);

  return {
    format: 'ocel2',
    processType: 'P2P',
    ocel: ocelLog,
    stats: {
      totalEvents: stats.totalEvents,
      totalObjects: stats.totalObjects,
      eventTypes: stats.eventTypes,
      objectTypes: stats.objectTypes,
    },
  };
}

/**
 * Execute O2C export (legacy format)
 */
async function executeO2CExport(
  adapter: SAPAdapter,
  input: ExportOcelInput,
  auditContext: ReturnType<typeof createAuditContext>
): Promise<ExportOcelResult> {
  // Enforce policies
  enforceToolPolicies('export_ocel', input as Record<string, unknown>, auditContext);

  // Validate date range if provided
  if (input.date_from && input.date_to) {
    validateDateRange(input.date_from, input.date_to, auditContext);
  }

  const config = getPolicyConfig();

  // Initialize OCEL structure
  const ocel: OCEL2Structure = {
    objectTypes: buildObjectTypes(input.include_items),
    eventTypes: buildEventTypes(input.include_items),
    objects: {},
    events: {},
  };

  let eventCounter = 0;

  // Build search params
  const searchParams: Parameters<typeof adapter.searchDocText>[0] = {
    pattern: '.*', // Match all - we're filtering by date
    doc_type: 'sales',
    limit: 200,
  };

  // Add optional filters
  if (input.date_from) searchParams.date_from = input.date_from;
  if (input.date_to) searchParams.date_to = input.date_to;
  if (input.sales_org) searchParams.org_filters = { VKORG: input.sales_org };

  // Step 1: Search for orders in the date range
  const searchResults = await withTimeout(
    adapter.searchDocText(searchParams),
    config.defaultTimeoutMs,
    'export_ocel:search'
  ).catch(() => {
    // If pattern search fails, return empty - will rely on doc flow
    return [];
  });

  // Get unique order numbers from search results
  const orderNumbers = new Set<string>();
  for (const result of searchResults) {
    if (result.doc_type === 'sales' || result.doc_type === 'order') {
      orderNumbers.add(result.doc_key);
    }
  }

  // Process each order
  for (const orderNum of orderNumbers) {
    // Get order header
    const orderHeader = await withTimeout(
      adapter.getSalesDocHeader({ vbeln: orderNum }),
      config.defaultTimeoutMs,
      'export_ocel:header'
    );

    if (!orderHeader) {
      continue;
    }

    // Filter by date range if specified
    if (input.date_from && input.date_to) {
      const orderDate = orderHeader.ERDAT.replace(/-/g, '');
      const fromDate = input.date_from.replace(/-/g, '');
      const toDate = input.date_to.replace(/-/g, '');

      if (orderDate < fromDate || orderDate > toDate) {
        continue;
      }
    }

    // Filter by sales org if specified
    if (input.sales_org && orderHeader.VKORG !== input.sales_org) {
      continue;
    }

    // Add order object
    const orderId = `order:${orderNum}`;
    ocel.objects[orderId] = {
      type: 'order',
      attributes: [
        { name: 'order_type', value: orderHeader.AUART },
        { name: 'sales_org', value: orderHeader.VKORG },
        { name: 'customer', value: orderHeader.KUNNR },
        { name: 'net_value', value: orderHeader.NETWR ?? 0 },
        { name: 'currency', value: orderHeader.WAERK ?? 'USD' },
      ],
    };

    // Add order_created event
    const orderCreatedEventId = `event:${++eventCounter}`;
    ocel.events[orderCreatedEventId] = {
      type: 'order_created',
      time: formatSAPDateTime(orderHeader.ERDAT, orderHeader.ERZET),
      attributes: [{ name: 'user', value: orderHeader.ERNAM }],
      relationships: [{ objectId: orderId, qualifier: 'order' }],
    };

    // Get order items if requested
    if (input.include_items) {
      const orderItems = await withTimeout(
        adapter.getSalesDocItems({ vbeln: orderNum }),
        config.defaultTimeoutMs,
        'export_ocel:items'
      );

      for (const item of orderItems) {
        const itemId = `order_item:${orderNum}:${item.POSNR}`;
        ocel.objects[itemId] = {
          type: 'order_item',
          attributes: [
            { name: 'material', value: item.MATNR },
            { name: 'quantity', value: item.KWMENG },
            { name: 'plant', value: item.WERKS },
            { name: 'net_value', value: item.NETWR },
          ],
          relationships: [{ objectId: orderId, qualifier: 'parent_order' }],
        };

        // Add item_added event (use order creation time as approximation)
        const itemAddedEventId = `event:${++eventCounter}`;
        ocel.events[itemAddedEventId] = {
          type: 'item_added',
          time: formatSAPDateTime(orderHeader.ERDAT, orderHeader.ERZET),
          attributes: [{ name: 'item_category', value: item.PSTYV }],
          relationships: [
            { objectId: orderId, qualifier: 'order' },
            { objectId: itemId, qualifier: 'item' },
          ],
        };
      }
    }

    // Get document flow for deliveries and invoices
    const docFlow = await withTimeout(
      adapter.getDocFlow({ vbeln: orderNum }),
      config.defaultTimeoutMs,
      'export_ocel:docflow'
    );

    // Process flow documents
    for (const flowDoc of docFlow.flow) {
      if (flowDoc.doc_category === 'J' || flowDoc.doc_type === 'delivery') {
        // Delivery document
        const deliveryId = `delivery:${flowDoc.doc_number}`;

        if (!ocel.objects[deliveryId]) {
          // Get delivery timing for more details
          const deliveryTiming = await withTimeout(
            adapter.getDeliveryTiming({ vbeln: flowDoc.doc_number }),
            config.defaultTimeoutMs,
            'export_ocel:delivery_timing'
          );

          ocel.objects[deliveryId] = {
            type: 'delivery',
            attributes: [
              { name: 'delivery_type', value: flowDoc.doc_type },
              { name: 'shipping_point', value: '' },
              { name: 'customer', value: orderHeader.KUNNR },
              { name: 'status', value: flowDoc.status ?? '' },
            ],
            relationships: [{ objectId: orderId, qualifier: 'source_order' }],
          };

          // Add delivery_created event
          const deliveryCreatedEventId = `event:${++eventCounter}`;
          ocel.events[deliveryCreatedEventId] = {
            type: 'delivery_created',
            time: formatSAPDateTime(flowDoc.created_date, flowDoc.created_time),
            attributes: [],
            relationships: [
              { objectId: orderId, qualifier: 'order' },
              { objectId: deliveryId, qualifier: 'delivery' },
            ],
          };

          // Add goods_issued event if we have actual GI date
          if (deliveryTiming?.header_timing.actual_gi_date) {
            const giEventId = `event:${++eventCounter}`;
            ocel.events[giEventId] = {
              type: 'goods_issued',
              time: formatSAPDateTime(deliveryTiming.header_timing.actual_gi_date, '000000'),
              relationships: [
                { objectId: orderId, qualifier: 'order' },
                { objectId: deliveryId, qualifier: 'delivery' },
              ],
            };
          }

          // Add delivery items if requested
          if (input.include_items && flowDoc.items) {
            for (const item of flowDoc.items) {
              const deliveryItemId = `delivery_item:${flowDoc.doc_number}:${item.item_number}`;
              ocel.objects[deliveryItemId] = {
                type: 'delivery_item',
                attributes: [
                  { name: 'material', value: '' },
                  { name: 'quantity', value: item.quantity ?? 0 },
                  { name: 'plant', value: '' },
                ],
                relationships: [
                  { objectId: deliveryId, qualifier: 'parent_delivery' },
                  ...(item.ref_doc && item.ref_item
                    ? [
                        {
                          objectId: `order_item:${item.ref_doc}:${item.ref_item}`,
                          qualifier: 'source_item',
                        },
                      ]
                    : []),
                ],
              };

              // Add item_delivered event
              const itemDeliveredEventId = `event:${++eventCounter}`;
              ocel.events[itemDeliveredEventId] = {
                type: 'item_delivered',
                time: formatSAPDateTime(flowDoc.created_date, flowDoc.created_time),
                relationships: [
                  { objectId: deliveryId, qualifier: 'delivery' },
                  { objectId: deliveryItemId, qualifier: 'item' },
                ],
              };
            }
          }
        }
      } else if (flowDoc.doc_category === 'M' || flowDoc.doc_type === 'invoice') {
        // Invoice document
        const invoiceId = `invoice:${flowDoc.doc_number}`;

        if (!ocel.objects[invoiceId]) {
          ocel.objects[invoiceId] = {
            type: 'invoice',
            attributes: [
              { name: 'invoice_type', value: flowDoc.doc_type },
              { name: 'sales_org', value: orderHeader.VKORG },
              { name: 'payer', value: orderHeader.KUNNR },
              { name: 'net_value', value: 0 },
              { name: 'currency', value: orderHeader.WAERK ?? 'USD' },
            ],
            relationships: [{ objectId: orderId, qualifier: 'source_order' }],
          };

          // Add invoice_created event
          const invoiceCreatedEventId = `event:${++eventCounter}`;
          ocel.events[invoiceCreatedEventId] = {
            type: 'invoice_created',
            time: formatSAPDateTime(flowDoc.created_date, flowDoc.created_time),
            attributes: [],
            relationships: [
              { objectId: orderId, qualifier: 'order' },
              { objectId: invoiceId, qualifier: 'invoice' },
            ],
          };

          // Add invoice items if requested
          if (input.include_items && flowDoc.items) {
            for (const item of flowDoc.items) {
              const invoiceItemId = `invoice_item:${flowDoc.doc_number}:${item.item_number}`;
              ocel.objects[invoiceItemId] = {
                type: 'invoice_item',
                attributes: [
                  { name: 'material', value: '' },
                  { name: 'quantity', value: item.quantity ?? 0 },
                  { name: 'net_value', value: 0 },
                ],
                relationships: [{ objectId: invoiceId, qualifier: 'parent_invoice' }],
              };

              // Add item_invoiced event
              const itemInvoicedEventId = `event:${++eventCounter}`;
              ocel.events[itemInvoicedEventId] = {
                type: 'item_invoiced',
                time: formatSAPDateTime(flowDoc.created_date, flowDoc.created_time),
                relationships: [
                  { objectId: invoiceId, qualifier: 'invoice' },
                  { objectId: invoiceItemId, qualifier: 'item' },
                ],
              };
            }
          }
        }
      }
    }
  }

  // Log success
  const objectCount = Object.keys(ocel.objects).length;
  const eventCount = Object.keys(ocel.events).length;
  auditContext.success(objectCount + eventCount);

  return {
    format: 'legacy',
    processType: 'O2C',
    legacy: ocel,
    stats: {
      totalEvents: eventCount,
      totalObjects: objectCount,
      eventTypes: Object.keys(ocel.eventTypes).length,
      objectTypes: Object.keys(ocel.objectTypes).length,
    },
  };
}
