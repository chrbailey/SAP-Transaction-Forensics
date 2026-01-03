/**
 * Policy Enforcement Module
 *
 * Enforces security and operational policies for MCP tool calls:
 * - Maximum 200 rows per query
 * - No arbitrary field access (predefined schemas only)
 * - Timeout handling for long-running operations
 * - Rate limiting (optional)
 */

import { AuditContext } from '../logging/audit.js';

/**
 * Policy configuration
 */
export interface PolicyConfig {
  /** Maximum number of rows that can be returned per query */
  maxRowsPerQuery: number;
  /** Default timeout for operations in milliseconds */
  defaultTimeoutMs: number;
  /** Maximum timeout that can be requested */
  maxTimeoutMs: number;
  /** Enable strict field validation */
  strictFieldValidation: boolean;
  /** Rate limit: max requests per minute (0 = unlimited) */
  maxRequestsPerMinute: number;
}

/**
 * Default policy configuration
 */
export const DEFAULT_POLICY_CONFIG: PolicyConfig = {
  maxRowsPerQuery: 200,
  defaultTimeoutMs: 30000, // 30 seconds
  maxTimeoutMs: 120000, // 2 minutes
  strictFieldValidation: true,
  maxRequestsPerMinute: 0, // Unlimited by default
};

let currentConfig: PolicyConfig = { ...DEFAULT_POLICY_CONFIG };

/**
 * Update policy configuration
 */
export function updatePolicyConfig(updates: Partial<PolicyConfig>): void {
  currentConfig = { ...currentConfig, ...updates };
}

/**
 * Get current policy configuration
 */
export function getPolicyConfig(): PolicyConfig {
  return { ...currentConfig };
}

/**
 * Allowed fields by entity type
 * Only these fields can be accessed through the MCP tools
 */
export const ALLOWED_FIELDS = {
  sales_header: [
    'VBELN',
    'AUART',
    'VKORG',
    'VTWEG',
    'SPART',
    'KUNNR',
    'KUNWE',
    'AUDAT',
    'VDATU',
    'ERNAM',
    'ERDAT',
    'ERZET',
    'AENAM',
    'AEDAT',
    'GBSTK',
    'NETWR',
    'WAERK',
    'BSTKD',
    'BSTNK',
  ],
  sales_item: [
    'VBELN',
    'POSNR',
    'MATNR',
    'ARKTX',
    'WERKS',
    'LGORT',
    'KWMENG',
    'VRKME',
    'NETWR',
    'WAERK',
    'PSTYV',
    'ABGRU',
    'EDATU',
    'KBMENG',
    'LIFSP',
    'FAKSP',
  ],
  delivery_header: [
    'VBELN',
    'LFART',
    'VSTEL',
    'ROUTE',
    'KUNNR',
    'WADAT',
    'WADAT_IST',
    'LFDAT',
    'LDDAT',
    'TDDAT',
    'KOSTK',
    'WBSTK',
    'GBSTK',
    'BTGEW',
    'GEWEI',
    'ERNAM',
    'ERDAT',
    'ERZET',
  ],
  delivery_item: [
    'VBELN',
    'POSNR',
    'MATNR',
    'ARKTX',
    'WERKS',
    'LGORT',
    'LFIMG',
    'VRKME',
    'PIKMG',
    'VGBEL',
    'VGPOS',
    'CHARG',
    'SERAIL',
  ],
  invoice_header: [
    'VBELN',
    'FKART',
    'FKDAT',
    'KUNRG',
    'KUNAG',
    'VKORG',
    'VTWEG',
    'SPART',
    'NETWR',
    'WAERK',
    'MWSBK',
    'BELNR',
    'GJAHR',
    'BUDAT',
    'FKSTO',
    'ERNAM',
    'ERDAT',
    'ERZET',
  ],
  invoice_item: [
    'VBELN',
    'POSNR',
    'MATNR',
    'ARKTX',
    'FKIMG',
    'VRKME',
    'NETWR',
    'WAERK',
    'VGBEL',
    'VGPOS',
    'AUBEL',
    'AUPOS',
    'WERKS',
  ],
  master_stub: [
    'ENTITY_TYPE',
    'ID',
    'HASHED_ID',
    'INDUSTRY',
    'REGION',
    'CATEGORY',
    'KTOKD',
    'MTART',
    'MATKL',
    'SPART',
    'ERDAT',
  ],
} as const;

/**
 * Sensitive fields that should NEVER be exposed
 */
export const FORBIDDEN_FIELDS = [
  // Personal data
  'NAME1',
  'NAME2',
  'NAME3',
  'NAME4', // Names
  'STRAS',
  'PSTLZ',
  'ORT01', // Address
  'TELF1',
  'TELF2',
  'TELFX', // Phone/Fax
  'SMTP_ADDR',
  'EMAIL', // Email
  // Banking
  'BANKL',
  'BANKN',
  'BKONT',
  'BANKA',
  'IBAN',
  'SWIFT',
  // Tax IDs
  'STCEG',
  'STCD1',
  'STCD2',
  'STCD3',
  'STCD4',
  // Credit/Financial
  'KDGRP',
  'KLIMK',
  'SKFOR',
  'SESSION',
  // Authentication
  'USNAM',
  'ERNAM_FULL',
  'PASS',
  'BNAME',
];

/**
 * Policy violation error
 */
export class PolicyViolationError extends Error {
  readonly violation: string;
  readonly details?: Record<string, unknown>;

  constructor(violation: string, details?: Record<string, unknown>) {
    super(`Policy violation: ${violation}`);
    this.name = 'PolicyViolationError';
    this.violation = violation;
    if (details) {
      this.details = details;
    }
  }
}

/**
 * Timeout error
 */
export class TimeoutError extends Error {
  readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super(`Operation timed out after ${timeoutMs}ms`);
    this.name = 'TimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

/**
 * Enforce row limit on results
 * Returns a truncated array if limit is exceeded
 */
export function enforceRowLimit<T>(
  results: T[],
  requestedLimit?: number,
  auditContext?: AuditContext
): T[] {
  const maxLimit = currentConfig.maxRowsPerQuery;
  const effectiveLimit = Math.min(requestedLimit ?? maxLimit, maxLimit);

  if (results.length > effectiveLimit) {
    if (auditContext) {
      auditContext.policyViolation('row_limit_exceeded', {
        requested: results.length,
        limit: effectiveLimit,
        truncated_to: effectiveLimit,
      });
    }
    return results.slice(0, effectiveLimit);
  }

  return results;
}

/**
 * Validate that only allowed fields are being accessed
 */
export function validateFields(
  entityType: keyof typeof ALLOWED_FIELDS,
  fields: string[],
  auditContext?: AuditContext
): void {
  if (!currentConfig.strictFieldValidation) {
    return;
  }

  const allowedFields = ALLOWED_FIELDS[entityType];
  const forbiddenAccess = fields.filter(f => FORBIDDEN_FIELDS.includes(f));
  const unknownFields = fields.filter(
    f => !allowedFields.includes(f as never) && !FORBIDDEN_FIELDS.includes(f)
  );

  if (forbiddenAccess.length > 0) {
    if (auditContext) {
      auditContext.policyViolation('forbidden_field_access', {
        fields: forbiddenAccess,
      });
    }
    throw new PolicyViolationError('Access to forbidden fields', {
      fields: forbiddenAccess,
    });
  }

  if (unknownFields.length > 0) {
    if (auditContext) {
      auditContext.policyViolation('unknown_field_access', {
        fields: unknownFields,
      });
    }
    // Log but don't throw for unknown fields (might be custom fields)
  }
}

/**
 * Execute an operation with timeout
 */
export async function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs?: number,
  _operationName?: string
): Promise<T> {
  const effectiveTimeout = Math.min(
    timeoutMs ?? currentConfig.defaultTimeoutMs,
    currentConfig.maxTimeoutMs
  );

  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new TimeoutError(effectiveTimeout));
    }, effectiveTimeout);

    operation
      .then(result => {
        clearTimeout(timer);
        resolve(result);
      })
      .catch(error => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

/**
 * Rate limiter (simple in-memory implementation)
 */
class RateLimiter {
  private requests: number[] = [];
  private windowMs = 60000; // 1 minute

  canProceed(): boolean {
    if (currentConfig.maxRequestsPerMinute <= 0) {
      return true; // Unlimited
    }

    const now = Date.now();
    this.requests = this.requests.filter(t => now - t < this.windowMs);

    if (this.requests.length >= currentConfig.maxRequestsPerMinute) {
      return false;
    }

    this.requests.push(now);
    return true;
  }

  getRemainingRequests(): number {
    if (currentConfig.maxRequestsPerMinute <= 0) {
      return Infinity;
    }

    const now = Date.now();
    this.requests = this.requests.filter(t => now - t < this.windowMs);
    return Math.max(0, currentConfig.maxRequestsPerMinute - this.requests.length);
  }
}

const rateLimiter = new RateLimiter();

/**
 * Check rate limit before proceeding
 */
export function checkRateLimit(auditContext?: AuditContext): void {
  if (!rateLimiter.canProceed()) {
    if (auditContext) {
      auditContext.policyViolation('rate_limit_exceeded', {
        max_per_minute: currentConfig.maxRequestsPerMinute,
      });
    }
    throw new PolicyViolationError('Rate limit exceeded', {
      max_per_minute: currentConfig.maxRequestsPerMinute,
      retry_after_seconds: 60,
    });
  }
}

/**
 * Validate search pattern is not too broad
 */
export function validateSearchPattern(pattern: string, auditContext?: AuditContext): void {
  // Check for overly broad patterns
  const broadPatterns = ['^.*$', '.*', '.+', '.', '^$'];
  if (broadPatterns.includes(pattern)) {
    if (auditContext) {
      auditContext.policyViolation('overly_broad_pattern', { pattern });
    }
    throw new PolicyViolationError('Search pattern too broad', { pattern });
  }

  // Check pattern length
  if (pattern.length < 2) {
    if (auditContext) {
      auditContext.policyViolation('pattern_too_short', { pattern });
    }
    throw new PolicyViolationError('Search pattern too short (minimum 2 characters)', {
      pattern,
      minimum_length: 2,
    });
  }

  // Validate regex syntax
  try {
    new RegExp(pattern);
  } catch (e) {
    if (auditContext) {
      auditContext.policyViolation('invalid_regex_pattern', {
        pattern,
        error: (e as Error).message,
      });
    }
    throw new PolicyViolationError('Invalid regex pattern', {
      pattern,
      error: (e as Error).message,
    });
  }
}

/**
 * Validate date range is reasonable
 */
export function validateDateRange(
  dateFrom?: string,
  dateTo?: string,
  auditContext?: AuditContext
): void {
  if (!dateFrom && !dateTo) {
    return; // No date range specified is OK
  }

  const maxRangeDays = 365; // Maximum 1 year range

  if (dateFrom && dateTo) {
    const from = new Date(dateFrom);
    const to = new Date(dateTo);

    if (isNaN(from.getTime()) || isNaN(to.getTime())) {
      throw new PolicyViolationError('Invalid date format', { dateFrom, dateTo });
    }

    if (from > to) {
      throw new PolicyViolationError('date_from must be before date_to', {
        dateFrom,
        dateTo,
      });
    }

    const rangeDays = (to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24);
    if (rangeDays > maxRangeDays) {
      if (auditContext) {
        auditContext.policyViolation('date_range_too_large', {
          days: rangeDays,
          max_days: maxRangeDays,
        });
      }
      throw new PolicyViolationError('Date range exceeds maximum allowed', {
        requested_days: rangeDays,
        max_days: maxRangeDays,
      });
    }
  }
}

/**
 * Combined policy check for tool calls
 */
export function enforceToolPolicies(
  toolName: string,
  params: Record<string, unknown>,
  auditContext?: AuditContext
): void {
  // Check rate limit
  checkRateLimit(auditContext);

  // Tool-specific validations
  switch (toolName) {
    case 'search_doc_text':
      if (typeof params['pattern'] === 'string') {
        validateSearchPattern(params['pattern'], auditContext);
      }
      validateDateRange(
        params['date_from'] as string | undefined,
        params['date_to'] as string | undefined,
        auditContext
      );
      break;
  }
}
