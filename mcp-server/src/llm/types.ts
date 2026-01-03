// ═══════════════════════════════════════════════════════════════════════════
// LLM TYPES - Type definitions for LLM integration
// ═══════════════════════════════════════════════════════════════════════════

export interface LLMConfig {
  provider: 'ollama' | 'openai' | 'anthropic';
  model: string;
  apiKey?: string;
  baseUrl?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface LLMResponse {
  content: string;
  model: string;
  usage?: LLMUsage | undefined;
}

/**
 * Process types supported by the system
 * - O2C: Order-to-Cash (SAP SD - Sales & Distribution)
 * - P2P: Purchase-to-Pay (SAP MM - Materials Management)
 */
export type ProcessType = 'O2C' | 'P2P';

/**
 * Base context shared by all process types
 */
export interface BaseProcessContext {
  processType: ProcessType;
  dateRange: { from: string; to: string };

  // Recent pattern discoveries
  patterns?: Array<{
    name: string;
    description: string;
    occurrence: number;
    confidence: string;
  }>;

  // Specific data for the query (populated dynamically)
  relevantData?: Record<string, unknown>;
}

/**
 * Order-to-Cash (O2C) Process Context
 * SAP SD Tables: VBAK, VBAP, LIKP, LIPS, VBRK, VBRP
 */
export interface O2CProcessContext extends BaseProcessContext {
  processType: 'O2C';

  // Document counts
  orderCount: number; // Sales Orders (VBAK)
  deliveryCount: number; // Deliveries (LIKP)
  invoiceCount: number; // Billing Documents (VBRK)

  // Organizational structure
  salesOrgs: string[]; // VKORG - Sales Organizations
  distributionChannels?: string[]; // VTWEG
  divisions?: string[]; // SPART
}

/**
 * Purchase-to-Pay (P2P) Process Context
 * SAP MM Tables: EBAN, EKKO, EKPO, EKBE, MKPF, MSEG, RBKP, RSEG
 */
export interface P2PProcessContext extends BaseProcessContext {
  processType: 'P2P';

  // Document counts
  purchaseReqCount?: number; // Purchase Requisitions (EBAN)
  purchaseOrderCount: number; // Purchase Orders (EKKO)
  goodsReceiptCount?: number; // Goods Receipts (MKPF with BWART=101)
  invoiceReceiptCount?: number; // Invoice Receipts (RBKP)

  // Organizational structure
  companies: string[]; // BUKRS - Company Codes
  plants?: string[]; // WERKS - Plants
  purchaseOrgs?: string[]; // EKORG - Purchasing Organizations

  // P2P-specific metrics
  vendorCount: number; // Unique vendors (LFA1)
  uniqueActivities: number; // Number of distinct activities

  // Matching configuration indicators
  threeWayMatchCount?: number; // Orders requiring 3-way match
  twoWayMatchCount?: number; // Orders with 2-way match only
  grBasedIVCount?: number; // GR-based Invoice Verification

  // BPI-specific activities (from BPI Challenge 2019)
  activities?: string[];
}

/**
 * Union type for all process contexts
 */
export type ProcessQueryContext = O2CProcessContext | P2PProcessContext;

/**
 * Type guard for O2C context
 */
export function isO2CContext(ctx: ProcessQueryContext): ctx is O2CProcessContext {
  return ctx.processType === 'O2C';
}

/**
 * Type guard for P2P context
 */
export function isP2PContext(ctx: ProcessQueryContext): ctx is P2PProcessContext {
  return ctx.processType === 'P2P';
}

export interface ProcessQueryResult {
  answer: string;
  confidence: 'high' | 'medium' | 'low';
  evidence: Array<{
    source: string;
    snippet: string;
    docKeys?: string[];
  }>;
  recommendations?: string[];
  followUpQuestions?: string[];
}

export interface LLMProvider {
  name: string;
  generate(messages: LLMMessage[]): Promise<LLMResponse>;
  isAvailable(): Promise<boolean>;
}

// Default configuration
export const DEFAULT_LLM_CONFIG: LLMConfig = {
  provider: 'ollama',
  model: 'llama3',
  temperature: 0.3,
  maxTokens: 2000,
};
