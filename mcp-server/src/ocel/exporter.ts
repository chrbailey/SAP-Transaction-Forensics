// ═══════════════════════════════════════════════════════════════════════════
// OCEL 2.0 EXPORTER - Convert SAP data to Object-Centric Event Log format
// ═══════════════════════════════════════════════════════════════════════════

import {
  OCELLog,
  OCELEvent,
  OCELObject,
  OCELEventType,
  OCELEventAttribute,
  OCELEventRelationship,
  OCELObjectRelationship,
  P2P_EVENT_TYPES,
  P2P_OBJECT_TYPES,
  SAP_P2P_OBJECT_TYPES,
  SAP_QUALIFIERS,
} from './types.js';

/**
 * BPI Event structure (from converted JSON)
 */
interface BPIEvent {
  activity: string;
  timestamp: string;
  user?: string;
  org?: string;
  resource?: string;
  [key: string]: unknown;
}

/**
 * BPI Trace (case) structure
 */
interface BPITrace {
  case_id: string;
  vendor?: string;
  company?: string;
  spend_area_text?: string;
  item_category?: string;
  item_type?: string;
  po_document?: string;
  events: BPIEvent[];
}

/**
 * Export options
 */
export interface OCELExportOptions {
  /** Include object-to-object relationships */
  includeO2ORelationships?: boolean;
  /** Include all event attributes */
  includeAllAttributes?: boolean;
  /** Maximum number of traces to export (0 = all) */
  maxTraces?: number;
  /** Filter by date range */
  dateRange?: {
    from: string;
    to: string;
  };
}

/**
 * OCEL Exporter for BPI P2P data
 */
export class OCELExporter {
  private events: OCELEvent[] = [];
  private objects: Map<string, OCELObject> = new Map();
  private eventCounter = 0;

  /**
   * Export BPI traces to OCEL 2.0 format
   */
  exportP2P(traces: BPITrace[], options: OCELExportOptions = {}): OCELLog {
    this.reset();

    const maxTraces = options.maxTraces || traces.length;
    const tracesToProcess = traces.slice(0, maxTraces);

    for (const trace of tracesToProcess) {
      this.processP2PTrace(trace, options);
    }

    // Build unique event types from actual events
    const eventTypeNames = new Set(this.events.map(e => e.type));
    const eventTypes = this.buildEventTypes(eventTypeNames);

    return {
      eventTypes,
      objectTypes: P2P_OBJECT_TYPES,
      events: this.events,
      objects: Array.from(this.objects.values()),
    };
  }

  /**
   * Process a single P2P trace into OCEL events and objects
   */
  private processP2PTrace(trace: BPITrace, options: OCELExportOptions): void {
    // Create PO object if we have a PO document
    const poId = trace.po_document || trace.case_id;
    const poObjectId = `po_${poId}`;

    if (!this.objects.has(poObjectId)) {
      const poObject: OCELObject = {
        id: poObjectId,
        type: SAP_P2P_OBJECT_TYPES.PURCHASE_ORDER,
        attributes: [
          {
            name: 'document_number',
            time: trace.events[0]?.timestamp || new Date().toISOString(),
            value: poId,
          },
        ],
      };

      // Add optional attributes if present
      if (trace.company) {
        poObject.attributes.push({
          name: 'company_code',
          time: trace.events[0]?.timestamp || new Date().toISOString(),
          value: trace.company,
        });
      }
      if (trace.vendor) {
        poObject.attributes.push({
          name: 'vendor_id',
          time: trace.events[0]?.timestamp || new Date().toISOString(),
          value: trace.vendor,
        });
      }
      if (trace.spend_area_text) {
        poObject.attributes.push({
          name: 'spend_area',
          time: trace.events[0]?.timestamp || new Date().toISOString(),
          value: trace.spend_area_text,
        });
      }

      // Add O2O relationships
      if (options.includeO2ORelationships && trace.vendor) {
        const vendorObjectId = `vendor_${trace.vendor}`;
        this.ensureVendorObject(vendorObjectId, trace.vendor, trace.events[0]?.timestamp);

        poObject.relationships = [{ objectId: vendorObjectId, qualifier: SAP_QUALIFIERS.VENDOR }];
      }

      this.objects.set(poObjectId, poObject);
    }

    // Track created objects for relationship building
    let grObjectId: string | undefined;
    let invoiceObjectId: string | undefined;

    // Process each event
    for (const event of trace.events) {
      // Apply date filter if specified
      if (options.dateRange) {
        const eventDate = new Date(event.timestamp);
        const fromDate = new Date(options.dateRange.from);
        const toDate = new Date(options.dateRange.to);
        if (eventDate < fromDate || eventDate > toDate) {
          continue;
        }
      }

      const eventId = `e${++this.eventCounter}`;
      const relationships: OCELEventRelationship[] = [
        { objectId: poObjectId, qualifier: SAP_QUALIFIERS.HEADER },
      ];

      // Create objects based on activity type
      if (event.activity.toLowerCase().includes('goods receipt')) {
        grObjectId = `gr_${poId}_${this.eventCounter}`;
        const grObject: OCELObject = {
          id: grObjectId,
          type: SAP_P2P_OBJECT_TYPES.GOODS_RECEIPT,
          attributes: [
            { name: 'document_number', time: event.timestamp, value: grObjectId },
            { name: 'posting_date', time: event.timestamp, value: event.timestamp },
          ],
        };

        // Add O2O relationship to PO
        if (options.includeO2ORelationships) {
          grObject.relationships = [
            { objectId: poObjectId, qualifier: SAP_QUALIFIERS.PREDECESSOR },
          ];
        }

        this.objects.set(grObjectId, grObject);
        relationships.push({ objectId: grObjectId, qualifier: 'goods_receipt' });
      }

      if (event.activity.toLowerCase().includes('invoice')) {
        invoiceObjectId = `inv_${poId}_${this.eventCounter}`;
        const invoiceObject: OCELObject = {
          id: invoiceObjectId,
          type: SAP_P2P_OBJECT_TYPES.INVOICE,
          attributes: [
            { name: 'document_number', time: event.timestamp, value: invoiceObjectId },
            { name: 'posting_date', time: event.timestamp, value: event.timestamp },
            { name: 'status', time: event.timestamp, value: this.getInvoiceStatus(event.activity) },
          ],
        };

        // Add O2O relationships
        if (options.includeO2ORelationships) {
          const rels: OCELObjectRelationship[] = [
            { objectId: poObjectId, qualifier: SAP_QUALIFIERS.PREDECESSOR },
          ];
          if (grObjectId) {
            rels.push({ objectId: grObjectId, qualifier: 'goods_receipt' });
          }
          invoiceObject.relationships = rels;
        }

        this.objects.set(invoiceObjectId, invoiceObject);
        relationships.push({ objectId: invoiceObjectId, qualifier: 'invoice' });
      }

      // Build event attributes
      const attributes: OCELEventAttribute[] = [];
      if (event.user) {
        attributes.push({ name: 'user', value: event.user });
      }
      if (event.org) {
        attributes.push({ name: 'org', value: event.org });
      }
      if (event.resource) {
        attributes.push({ name: 'resource', value: event.resource });
      }

      // Include additional attributes if requested
      if (options.includeAllAttributes) {
        for (const [key, value] of Object.entries(event)) {
          if (
            !['activity', 'timestamp', 'user', 'org', 'resource'].includes(key) &&
            value !== undefined
          ) {
            attributes.push({ name: key, value: String(value) });
          }
        }
      }

      // Create OCEL event
      const ocelEvent: OCELEvent = {
        id: eventId,
        type: event.activity,
        time: event.timestamp,
        attributes,
        relationships,
      };

      this.events.push(ocelEvent);
    }
  }

  /**
   * Ensure vendor object exists
   */
  private ensureVendorObject(vendorObjectId: string, vendorId: string, timestamp?: string): void {
    if (!this.objects.has(vendorObjectId)) {
      this.objects.set(vendorObjectId, {
        id: vendorObjectId,
        type: SAP_P2P_OBJECT_TYPES.VENDOR,
        attributes: [
          { name: 'vendor_id', time: timestamp || new Date().toISOString(), value: vendorId },
        ],
      });
    }
  }

  /**
   * Get invoice status from activity name
   */
  private getInvoiceStatus(activity: string): string {
    const lowerActivity = activity.toLowerCase();
    if (lowerActivity.includes('clear')) return 'cleared';
    if (lowerActivity.includes('cancel')) return 'cancelled';
    if (lowerActivity.includes('block')) return 'blocked';
    if (lowerActivity.includes('create') || lowerActivity.includes('record')) return 'posted';
    return 'pending';
  }

  /**
   * Build event types from actual events
   */
  private buildEventTypes(eventTypeNames: Set<string>): OCELEventType[] {
    const types: OCELEventType[] = [];

    for (const name of eventTypeNames) {
      // Try to find predefined type
      const predefined = P2P_EVENT_TYPES.find(t => t.name === name);
      if (predefined) {
        types.push(predefined);
      } else {
        // Create generic type
        types.push({
          name,
          attributes: [
            { name: 'user', type: 'string' },
            { name: 'org', type: 'string' },
          ],
        });
      }
    }

    return types;
  }

  /**
   * Reset exporter state
   */
  private reset(): void {
    this.events = [];
    this.objects.clear();
    this.eventCounter = 0;
  }

  /**
   * Export to JSON string
   */
  toJSON(log: OCELLog, pretty = true): string {
    return JSON.stringify(log, null, pretty ? 2 : 0);
  }

  /**
   * Get export statistics
   */
  getStats(log: OCELLog): OCELExportStats {
    const objectsByType = new Map<string, number>();
    for (const obj of log.objects) {
      objectsByType.set(obj.type, (objectsByType.get(obj.type) || 0) + 1);
    }

    const eventsByType = new Map<string, number>();
    for (const event of log.events) {
      eventsByType.set(event.type, (eventsByType.get(event.type) || 0) + 1);
    }

    return {
      totalEvents: log.events.length,
      totalObjects: log.objects.length,
      eventTypes: log.eventTypes.length,
      objectTypes: log.objectTypes.length,
      eventsByType: Object.fromEntries(eventsByType),
      objectsByType: Object.fromEntries(objectsByType),
    };
  }
}

/**
 * Export statistics
 */
export interface OCELExportStats {
  totalEvents: number;
  totalObjects: number;
  eventTypes: number;
  objectTypes: number;
  eventsByType: Record<string, number>;
  objectsByType: Record<string, number>;
}

/**
 * Create a default exporter instance
 */
export function createOCELExporter(): OCELExporter {
  return new OCELExporter();
}
