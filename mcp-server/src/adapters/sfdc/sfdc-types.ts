// mcp-server/src/adapters/sfdc/sfdc-types.ts

/**
 * Salesforce Native Type Definitions
 *
 * These represent Salesforce data as it exists natively, before
 * normalization to SAP types via the field mapper.
 */

// ============================================================================
// Account
// ============================================================================

export interface SFDCAccount {
  account_id: string;
  name: string;
  industry: string;
  billing_state: string;
  billing_country: string;
  type: string;
  number_of_employees: number;
  annual_revenue: number;
  sap_customer_number: string | null;
}

// ============================================================================
// Opportunity
// ============================================================================

export interface SFDCOpportunity {
  opportunity_id: string;
  name: string;
  account_id: string;
  record_type: string;
  stage_name: string;
  amount: number;
  currency_iso_code: string;
  owner_id: string;
  created_date: string;   // ISO 8601
  close_date: string;     // YYYY-MM-DD
  type: string;
  lead_source: string;
  probability: number;
  forecast_category: string;
  sap_order_number: string | null;
  is_closed: boolean;
  is_won: boolean;
  _pattern_flags?: string[];  // For test validation
}

// ============================================================================
// Stage History
// ============================================================================

export interface SFDCStageHistory {
  id: string;
  opportunity_id: string;
  stage_name: string;
  previous_stage: string | null;
  created_date: string;   // ISO 8601
  amount: number;
  probability: number;
  expected_revenue: number;
  close_date: string;
  duration_days: number;
  changed_by: string;
}

// ============================================================================
// Line Item
// ============================================================================

export interface SFDCLineItem {
  line_item_id: string;
  opportunity_id: string;
  product_id: string;
  product_code: string;
  product_name: string;
  product_family: string;
  quantity: number;
  unit_price: number;
  total_price: number;
  sort_order: number;
  service_date: string | null;
  description: string;
}

// ============================================================================
// Activity (Task/Event)
// ============================================================================

export interface SFDCActivity {
  activity_id: string;
  type: 'Task' | 'Event';
  subject: string;
  status: string;
  priority: string;
  activity_date: string;
  owner_id: string;
  what_id: string;         // Related Opportunity ID
  who_id: string | null;   // Related Contact ID
  description: string;
}

// ============================================================================
// Product (for master data)
// ============================================================================

export interface SFDCProduct {
  product_id: string;
  product_code: string;
  name: string;
  family: string;
  is_active: boolean;
  description: string;
}

// ============================================================================
// Loaded SFDC Dataset
// ============================================================================

export interface SFDCDataset {
  accounts: SFDCAccount[];
  opportunities: SFDCOpportunity[];
  stage_histories: SFDCStageHistory[];
  line_items: SFDCLineItem[];
  activities: SFDCActivity[];
  products: SFDCProduct[];
}

// ============================================================================
// Process Model Definition (TypeScript side)
// ============================================================================

export interface SFDCProcessModelDef {
  record_type: string;
  stages: string[];
  terminal_stages: string[];
  allowed_regressions: [string, string][];
}

// ============================================================================
// Record Type to AUART Mapping
// ============================================================================

export const RECORD_TYPE_TO_AUART: Record<string, string> = {
  'New Business': 'ZNEW',
  'Renewal': 'ZREN',
  'Upsell': 'ZUPS',
  'Cross-Sell': 'ZXSL',
  'Partner': 'ZPAR',
};

// ============================================================================
// Stage to Status Code Mapping
// ============================================================================

export const STAGE_STATUS_MAP: Record<string, string> = {
  'Prospecting': 'A',
  'Qualification': 'A',
  'Needs Analysis': 'B',
  'Value Proposition': 'B',
  'Id. Decision Makers': 'B',
  'Perception Analysis': 'B',
  'Proposal/Price Quote': 'B',
  'Negotiation/Review': 'B',
  'Discovery': 'B',
  'Proposal': 'B',
  'Negotiation': 'B',
  'Closed Won': 'C',
  'Closed Lost': 'X',
};
