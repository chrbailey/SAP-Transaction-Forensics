// ═══════════════════════════════════════════════════════════════════════════
// SAP WORKFLOW MINING - PROMPTSPEAK GOVERNANCE TYPES
// ═══════════════════════════════════════════════════════════════════════════
// Governance layer for SAP MCP Server using PromptSpeak symbolic frames
// ═══════════════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────────────────
// SYMBOL DEFINITIONS (SAP-Specific subset of PromptSpeak)
// ─────────────────────────────────────────────────────────────────────────────

export type Mode = '⊕' | '⊘' | '⊖' | '⊗'; // strict | neutral | flexible | forbidden
export type Domain = '◊' | '◐'; // financial | operational
export type Action = '◀' | '▲' | '●'; // retrieve | analyze | validate
export type Constraint = '⛔' | '✗' | '⚠' | '✓'; // forbidden | rejected | warning | approved
export type Entity = 'α' | 'β' | 'γ'; // primary | secondary | tertiary agent

export interface SymbolDefinition {
  symbol: string;
  name: string;
  category: 'mode' | 'domain' | 'action' | 'constraint' | 'entity';
  strength?: number; // For mode ordering
}

export const SYMBOL_ONTOLOGY: Record<string, SymbolDefinition> = {
  // Modes
  '⊕': { symbol: '⊕', name: 'strict', category: 'mode', strength: 1 },
  '⊘': { symbol: '⊘', name: 'neutral', category: 'mode', strength: 2 },
  '⊖': { symbol: '⊖', name: 'flexible', category: 'mode', strength: 3 },
  '⊗': { symbol: '⊗', name: 'forbidden', category: 'mode', strength: 4 },
  // Domains
  '◊': { symbol: '◊', name: 'financial', category: 'domain' },
  '◐': { symbol: '◐', name: 'operational', category: 'domain' },
  // Actions
  '◀': { symbol: '◀', name: 'retrieve', category: 'action' },
  '▲': { symbol: '▲', name: 'analyze', category: 'action' },
  '●': { symbol: '●', name: 'validate', category: 'action' },
  // Constraints
  '⛔': { symbol: '⛔', name: 'forbidden', category: 'constraint' },
  '✗': { symbol: '✗', name: 'rejected', category: 'constraint' },
  '⚠': { symbol: '⚠', name: 'warning', category: 'constraint' },
  '✓': { symbol: '✓', name: 'approved', category: 'constraint' },
  // Entities
  α: { symbol: 'α', name: 'primary', category: 'entity' },
  β: { symbol: 'β', name: 'secondary', category: 'entity' },
  γ: { symbol: 'γ', name: 'tertiary', category: 'entity' },
};

// ─────────────────────────────────────────────────────────────────────────────
// FRAME TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface ParsedFrame {
  raw: string;
  mode: SymbolDefinition | null;
  domain: SymbolDefinition | null;
  action: SymbolDefinition | null;
  constraint: SymbolDefinition | null;
  entity: SymbolDefinition | null;
  valid: boolean;
  parseErrors: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// VALIDATION TYPES
// ─────────────────────────────────────────────────────────────────────────────

export type ValidationSeverity = 'error' | 'warning' | 'info';

export interface ValidationResult {
  passed: boolean;
  severity: ValidationSeverity;
  code: string;
  message: string;
}

export interface ValidationReport {
  valid: boolean;
  frame: string;
  results: ValidationResult[];
  timestamp: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// EXECUTION CONTROL TYPES
// ─────────────────────────────────────────────────────────────────────────────

export type HoldReason =
  | 'broad_date_range'
  | 'high_row_limit'
  | 'sensitive_text_search'
  | 'forbidden_constraint'
  | 'drift_threshold_exceeded'
  | 'manual_review_required';

export interface HoldRequest {
  holdId: string;
  agentId: string;
  frame: string;
  tool: string;
  params: Record<string, unknown>;
  reason: HoldReason;
  severity: 'low' | 'medium' | 'high' | 'critical';
  evidence: Record<string, unknown>;
  createdAt: number;
  expiresAt: number;
  status: 'pending' | 'approved' | 'rejected' | 'expired';
}

export interface HoldDecision {
  holdId: string;
  approved: boolean;
  approvedBy?: string;
  reason?: string;
  modifiedParams?: Record<string, unknown>;
  decidedAt: number;
}

export interface ExecuteRequest {
  agentId: string;
  frame: string;
  tool: string;
  params: Record<string, unknown>;
  bypassHold?: boolean;
  holdDecision?: HoldDecision;
}

export interface PreFlightCheck {
  passed: boolean;
  blocked: boolean;
  held: boolean;
  blockReason?: string;
  holdRequest?: HoldRequest;
  checks: {
    circuitBreaker: { passed: boolean; reason?: string };
    frameValidation: { passed: boolean; errors?: string[] };
    policyLimits: { passed: boolean; violations?: string[] };
  };
}

export interface ExecuteResult {
  success: boolean;
  allowed: boolean;
  held: boolean;
  holdRequest?: HoldRequest;
  error?: string;
  preFlightCheck: PreFlightCheck;
  auditId: string;
  timestamp: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// CIRCUIT BREAKER TYPES
// ─────────────────────────────────────────────────────────────────────────────

export type CircuitState = 'closed' | 'open' | 'half-open';

export interface CircuitBreakerState {
  agentId: string;
  state: CircuitState;
  haltedAt?: number;
  haltReason?: string;
  failureCount: number;
  lastFailure?: number;
  lastSuccess?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// GOVERNANCE CONFIG
// ─────────────────────────────────────────────────────────────────────────────

export interface GovernanceConfig {
  // Circuit breaker
  enableCircuitBreaker: boolean;
  maxFailuresBeforeOpen: number;
  circuitResetTimeMs: number;

  // Hold thresholds
  enableHolds: boolean;
  dateRangeHoldThresholdDays: number;
  rowLimitHoldThreshold: number;
  sensitiveTextPatterns: RegExp[];

  // Audit
  enableAuditLogging: boolean;
  auditRetentionMs: number;

  // Hold expiration
  holdExpirationMs: number;
}

export const DEFAULT_GOVERNANCE_CONFIG: GovernanceConfig = {
  enableCircuitBreaker: true,
  maxFailuresBeforeOpen: 5,
  circuitResetTimeMs: 60000, // 1 minute

  enableHolds: true,
  dateRangeHoldThresholdDays: 90,
  rowLimitHoldThreshold: 500,
  sensitiveTextPatterns: [/\b(ssn|social.?security|password|secret|credit.?card)\b/i],

  enableAuditLogging: true,
  auditRetentionMs: 24 * 60 * 60 * 1000, // 24 hours

  holdExpirationMs: 30 * 60 * 1000, // 30 minutes
};
