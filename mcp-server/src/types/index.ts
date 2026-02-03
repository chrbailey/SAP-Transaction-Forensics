/**
 * Types Module - Main Export
 *
 * Re-exports all SAP document types for use throughout the MCP server.
 */

export * from './sap.js';
export * from './fi-co.js';

// Additional convenience types for the synthetic data file format
// These match the structure of the JSON files in synthetic-data/sample_output/

/**
 * Raw sales order from synthetic JSON file
 */
export interface RawSalesOrder {
  document_number: string;
  document_type: string;
  sales_org: string;
  distribution_channel: string;
  division: string;
  customer: string;
  po_number?: string;
  created_date: string;
  created_time: string;
  created_by: string;
  requested_delivery_date: string;
  net_value: number;
  currency: string;
  status: string;
  items: RawSalesOrderItem[];
  texts: RawDocText[];
}

/**
 * Raw sales order item from synthetic JSON file
 */
export interface RawSalesOrderItem {
  item_number: string;
  material: string;
  description: string;
  quantity: number;
  unit: string;
  net_price: number;
  net_value: number;
  currency: string;
  plant: string;
  item_category: string;
  rejection_reason: string | null;
  texts: RawDocText[];
}

/**
 * Raw document text from synthetic JSON file
 */
export interface RawDocText {
  text_type: string;
  text_id: string;
  language: string;
  text_content: string;
  created_at: string;
  created_by: string;
}

/**
 * Raw delivery from synthetic JSON file
 */
export interface RawDelivery {
  document_number: string;
  delivery_type: string;
  shipping_point: string;
  ship_to: string;
  planned_gi_date: string;
  actual_gi_date: string | null;
  created_date: string;
  created_time: string;
  created_by: string;
  total_weight: number;
  weight_unit: string;
  status: string;
  items: RawDeliveryItem[];
  texts: RawDocText[];
}

/**
 * Raw delivery item from synthetic JSON file
 */
export interface RawDeliveryItem {
  item_number: string;
  material: string;
  description: string;
  delivery_quantity: number;
  unit: string;
  plant: string;
  storage_location: string;
  batch: string | null;
  reference_doc: string;
  reference_item: string;
  picked_quantity: number;
  pick_status: string;
}

/**
 * Raw invoice from synthetic JSON file
 */
export interface RawInvoice {
  document_number: string;
  invoice_type: string;
  billing_date: string;
  payer: string;
  net_value: number;
  tax_amount: number;
  gross_value: number;
  currency: string;
  created_date: string;
  created_time: string;
  created_by: string;
  status: string;
  items: RawInvoiceItem[];
}

/**
 * Raw invoice item from synthetic JSON file
 */
export interface RawInvoiceItem {
  item_number: string;
  material: string;
  description: string;
  billed_quantity: number;
  unit: string;
  net_price: number;
  net_value: number;
  tax_amount: number;
  reference_doc: string;
  reference_item: string;
}

/**
 * Raw document flow entry from synthetic JSON file
 */
export interface RawDocFlowEntry {
  preceding_doc: string;
  preceding_item: string;
  preceding_category: string;
  subsequent_doc: string;
  subsequent_item: string;
  subsequent_category: string;
  transfer_quantity: number;
  created_date: string;
}

/**
 * Raw customer from synthetic JSON file
 */
export interface RawCustomer {
  customer_id: string;
  name: string;
  region: string;
  industry: string;
  tier: string;
  sales_org: string;
  created_date: string;
}

/**
 * Raw material from synthetic JSON file
 */
export interface RawMaterial {
  material_id: string;
  description: string;
  category: string;
  product_group: string;
  base_price: number;
  weight: number;
  weight_unit: string;
  unit_of_measure: string;
}

/**
 * Raw user from synthetic JSON file
 */
export interface RawUser {
  user_id: string;
  name: string;
  department: string;
  role: string;
  created_date: string;
}

/**
 * Synthetic data file structure - Sales Orders
 */
export interface SalesOrdersFile {
  metadata: {
    generated_at: string;
    seed: number;
    config: {
      num_sales_orders: number;
      num_customers: number;
      num_materials: number;
      num_users: number;
      date_range: string;
    };
  };
  sales_orders: RawSalesOrder[];
}

/**
 * Synthetic data file structure - Deliveries
 */
export interface DeliveriesFile {
  metadata: {
    generated_at: string;
    seed: number;
    config: Record<string, unknown>;
  };
  deliveries: RawDelivery[];
}

/**
 * Synthetic data file structure - Invoices
 */
export interface InvoicesFile {
  metadata: {
    generated_at: string;
    seed: number;
    config: Record<string, unknown>;
  };
  invoices: RawInvoice[];
}

/**
 * Synthetic data file structure - Document Flow
 */
export interface DocFlowFile {
  metadata: {
    generated_at: string;
    seed: number;
    config: Record<string, unknown>;
  };
  document_flows: RawDocFlowEntry[];
}

/**
 * Synthetic data file structure - Customers
 */
export interface CustomersFile {
  metadata: {
    generated_at: string;
    seed: number;
    config: Record<string, unknown>;
  };
  customers: RawCustomer[];
}

/**
 * Synthetic data file structure - Materials
 */
export interface MaterialsFile {
  metadata: {
    generated_at: string;
    seed: number;
    config: Record<string, unknown>;
  };
  materials: RawMaterial[];
}

/**
 * Synthetic data file structure - Users
 */
export interface UsersFile {
  metadata: {
    generated_at: string;
    seed: number;
    config: Record<string, unknown>;
  };
  users: RawUser[];
}
