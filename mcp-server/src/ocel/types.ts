// ═══════════════════════════════════════════════════════════════════════════
// OCEL 2.0 TYPES - Object-Centric Event Log Standard
// Based on: https://www.ocel-standard.org/specification/formats/json/
// ═══════════════════════════════════════════════════════════════════════════

/**
 * OCEL 2.0 Attribute Types
 * Supported types as per specification
 */
export type OCELAttributeType = 'string' | 'time' | 'integer' | 'float' | 'boolean';

/**
 * Attribute definition for event/object types
 */
export interface OCELAttributeDefinition {
  name: string;
  type: OCELAttributeType;
}

/**
 * Event type definition
 * Defines the schema for a category of events
 */
export interface OCELEventType {
  name: string;
  attributes: OCELAttributeDefinition[];
}

/**
 * Object type definition
 * Defines the schema for a category of objects
 */
export interface OCELObjectType {
  name: string;
  attributes: OCELAttributeDefinition[];
}

/**
 * Event attribute value
 */
export interface OCELEventAttribute {
  name: string;
  value: string | number | boolean;
}

/**
 * Object attribute value (with timestamp for change tracking)
 */
export interface OCELObjectAttribute {
  name: string;
  time: string; // ISO 8601
  value: string | number | boolean;
}

/**
 * Event-to-Object relationship
 * Links an event to an object with a qualifier describing the role
 */
export interface OCELEventRelationship {
  objectId: string;
  qualifier: string;
}

/**
 * Object-to-Object relationship
 * Links objects that have relationships outside of shared events
 */
export interface OCELObjectRelationship {
  objectId: string;
  qualifier: string;
}

/**
 * OCEL 2.0 Event
 */
export interface OCELEvent {
  id: string;
  type: string;
  time: string; // ISO 8601
  attributes: OCELEventAttribute[];
  relationships: OCELEventRelationship[];
}

/**
 * OCEL 2.0 Object
 */
export interface OCELObject {
  id: string;
  type: string;
  attributes: OCELObjectAttribute[];
  relationships?: OCELObjectRelationship[];
}

/**
 * OCEL 2.0 Log - Complete structure
 */
export interface OCELLog {
  eventTypes: OCELEventType[];
  objectTypes: OCELObjectType[];
  events: OCELEvent[];
  objects: OCELObject[];
}

// ═══════════════════════════════════════════════════════════════════════════
// SAP-SPECIFIC OCEL TYPES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * SAP P2P Object Types for OCEL export
 */
export const SAP_P2P_OBJECT_TYPES = {
  PURCHASE_ORDER: 'purchase_order',
  PO_ITEM: 'po_item',
  GOODS_RECEIPT: 'goods_receipt',
  INVOICE: 'invoice',
  VENDOR: 'vendor',
  MATERIAL: 'material',
} as const;

/**
 * SAP O2C Object Types for OCEL export
 */
export const SAP_O2C_OBJECT_TYPES = {
  SALES_ORDER: 'sales_order',
  SO_ITEM: 'so_item',
  DELIVERY: 'delivery',
  INVOICE: 'invoice',
  CUSTOMER: 'customer',
  MATERIAL: 'material',
} as const;

/**
 * Common event qualifiers for SAP processes
 */
export const SAP_QUALIFIERS = {
  // Document relationships
  HEADER: 'header',
  ITEM: 'item',
  PREDECESSOR: 'predecessor',
  SUCCESSOR: 'successor',

  // Actor relationships
  CREATOR: 'creator',
  APPROVER: 'approver',
  VENDOR: 'vendor',
  CUSTOMER: 'customer',

  // Material relationships
  MATERIAL: 'material',
  PLANT: 'plant',
} as const;

/**
 * P2P Event Types based on BPI Challenge 2019 activities
 */
export const P2P_EVENT_TYPES: OCELEventType[] = [
  {
    name: 'Create Purchase Requisition Item',
    attributes: [
      { name: 'user', type: 'string' },
      { name: 'org', type: 'string' },
    ],
  },
  {
    name: 'Create Purchase Order Item',
    attributes: [
      { name: 'user', type: 'string' },
      { name: 'vendor', type: 'string' },
      { name: 'spend_area', type: 'string' },
    ],
  },
  {
    name: 'Record Goods Receipt',
    attributes: [
      { name: 'user', type: 'string' },
      { name: 'quantity', type: 'float' },
    ],
  },
  {
    name: 'Record Invoice Receipt',
    attributes: [
      { name: 'user', type: 'string' },
      { name: 'amount', type: 'float' },
    ],
  },
  {
    name: 'Clear Invoice',
    attributes: [{ name: 'user', type: 'string' }],
  },
  {
    name: 'Vendor creates invoice',
    attributes: [
      { name: 'vendor', type: 'string' },
      { name: 'amount', type: 'float' },
    ],
  },
  {
    name: 'Change Quantity',
    attributes: [
      { name: 'user', type: 'string' },
      { name: 'old_value', type: 'float' },
      { name: 'new_value', type: 'float' },
    ],
  },
  {
    name: 'Change Price',
    attributes: [
      { name: 'user', type: 'string' },
      { name: 'old_value', type: 'float' },
      { name: 'new_value', type: 'float' },
    ],
  },
  {
    name: 'SRM: Awaiting Approval',
    attributes: [
      { name: 'user', type: 'string' },
      { name: 'level', type: 'string' },
    ],
  },
  {
    name: 'SRM: Complete',
    attributes: [{ name: 'user', type: 'string' }],
  },
];

/**
 * P2P Object Type Definitions
 */
export const P2P_OBJECT_TYPES: OCELObjectType[] = [
  {
    name: SAP_P2P_OBJECT_TYPES.PURCHASE_ORDER,
    attributes: [
      { name: 'document_number', type: 'string' },
      { name: 'company_code', type: 'string' },
      { name: 'vendor_id', type: 'string' },
      { name: 'spend_area', type: 'string' },
      { name: 'total_value', type: 'float' },
    ],
  },
  {
    name: SAP_P2P_OBJECT_TYPES.PO_ITEM,
    attributes: [
      { name: 'item_number', type: 'string' },
      { name: 'material', type: 'string' },
      { name: 'quantity', type: 'float' },
      { name: 'unit_price', type: 'float' },
    ],
  },
  {
    name: SAP_P2P_OBJECT_TYPES.GOODS_RECEIPT,
    attributes: [
      { name: 'document_number', type: 'string' },
      { name: 'quantity', type: 'float' },
      { name: 'posting_date', type: 'time' },
    ],
  },
  {
    name: SAP_P2P_OBJECT_TYPES.INVOICE,
    attributes: [
      { name: 'document_number', type: 'string' },
      { name: 'amount', type: 'float' },
      { name: 'posting_date', type: 'time' },
      { name: 'status', type: 'string' },
    ],
  },
  {
    name: SAP_P2P_OBJECT_TYPES.VENDOR,
    attributes: [
      { name: 'vendor_id', type: 'string' },
      { name: 'name', type: 'string' },
      { name: 'country', type: 'string' },
    ],
  },
];

/**
 * O2C Object Type Definitions
 */
export const O2C_OBJECT_TYPES: OCELObjectType[] = [
  {
    name: SAP_O2C_OBJECT_TYPES.SALES_ORDER,
    attributes: [
      { name: 'document_number', type: 'string' },
      { name: 'order_type', type: 'string' },
      { name: 'sales_org', type: 'string' },
      { name: 'customer_id', type: 'string' },
      { name: 'total_value', type: 'float' },
    ],
  },
  {
    name: SAP_O2C_OBJECT_TYPES.SO_ITEM,
    attributes: [
      { name: 'item_number', type: 'string' },
      { name: 'material', type: 'string' },
      { name: 'quantity', type: 'float' },
      { name: 'net_value', type: 'float' },
    ],
  },
  {
    name: SAP_O2C_OBJECT_TYPES.DELIVERY,
    attributes: [
      { name: 'document_number', type: 'string' },
      { name: 'delivery_type', type: 'string' },
      { name: 'ship_date', type: 'time' },
    ],
  },
  {
    name: SAP_O2C_OBJECT_TYPES.INVOICE,
    attributes: [
      { name: 'document_number', type: 'string' },
      { name: 'amount', type: 'float' },
      { name: 'billing_date', type: 'time' },
    ],
  },
  {
    name: SAP_O2C_OBJECT_TYPES.CUSTOMER,
    attributes: [
      { name: 'customer_id', type: 'string' },
      { name: 'name', type: 'string' },
      { name: 'country', type: 'string' },
    ],
  },
];
