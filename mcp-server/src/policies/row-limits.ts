/**
 * Row Limits Policy
 *
 * Enforces maximum row limits on query results to prevent:
 * - Excessive data transfer
 * - Memory exhaustion
 * - Long-running operations
 *
 * Default: 200 rows per query
 * Absolute Maximum: 1000 rows (cannot be overridden)
 */

import { AuditContext } from '../logging/audit-logger.js';

/**
 * Row limit configuration
 */
export interface RowLimitConfig {
  /** Default maximum rows per query (default: 200) */
  defaultLimit: number;
  /** Absolute maximum rows that cannot be exceeded (default: 1000) */
  absoluteMaxLimit: number;
  /** Whether to log when limits are applied */
  logLimitApplication: boolean;
}

/**
 * Default row limit configuration
 */
const DEFAULT_ROW_LIMIT_CONFIG: RowLimitConfig = {
  defaultLimit: 200,
  absoluteMaxLimit: 1000,
  logLimitApplication: true,
};

let currentConfig: RowLimitConfig = { ...DEFAULT_ROW_LIMIT_CONFIG };

/**
 * Update row limit configuration
 */
export function updateRowLimitConfig(updates: Partial<RowLimitConfig>): void {
  currentConfig = { ...currentConfig, ...updates };

  // Ensure absoluteMaxLimit is always >= defaultLimit
  if (currentConfig.defaultLimit > currentConfig.absoluteMaxLimit) {
    currentConfig.defaultLimit = currentConfig.absoluteMaxLimit;
  }
}

/**
 * Get current row limit configuration
 */
export function getRowLimitConfig(): RowLimitConfig {
  return { ...currentConfig };
}

/**
 * Reset row limit configuration to defaults
 */
export function resetRowLimitConfig(): void {
  currentConfig = { ...DEFAULT_ROW_LIMIT_CONFIG };
}

/**
 * Calculate the effective limit for a query
 *
 * @param requestedLimit - The limit requested by the caller (optional)
 * @returns The effective limit to apply
 */
export function getEffectiveLimit(requestedLimit?: number): number {
  // If no limit requested, use default
  if (requestedLimit === undefined || requestedLimit === null) {
    return currentConfig.defaultLimit;
  }

  // If requested limit exceeds absolute max, cap it
  if (requestedLimit > currentConfig.absoluteMaxLimit) {
    return currentConfig.absoluteMaxLimit;
  }

  // If requested limit exceeds default, cap at default (unless explicitly allowed)
  if (requestedLimit > currentConfig.defaultLimit) {
    return currentConfig.defaultLimit;
  }

  // Use requested limit
  return Math.max(1, requestedLimit);
}

/**
 * Result of applying row limits
 */
export interface RowLimitResult<T> {
  /** The limited data */
  data: T[];
  /** Original count before limiting */
  originalCount: number;
  /** Applied limit */
  appliedLimit: number;
  /** Whether truncation occurred */
  wasTruncated: boolean;
  /** Number of rows removed */
  rowsRemoved: number;
}

/**
 * Apply row limit to results array
 *
 * @param results - The full results array
 * @param requestedLimit - The limit requested by the caller (optional)
 * @param auditContext - Audit context for logging (optional)
 * @returns Limited results with metadata
 */
export function applyRowLimit<T>(
  results: T[],
  requestedLimit?: number,
  auditContext?: AuditContext
): RowLimitResult<T> {
  const effectiveLimit = getEffectiveLimit(requestedLimit);
  const originalCount = results.length;
  const wasTruncated = originalCount > effectiveLimit;
  const limitedData = wasTruncated ? results.slice(0, effectiveLimit) : results;

  const result: RowLimitResult<T> = {
    data: limitedData,
    originalCount,
    appliedLimit: effectiveLimit,
    wasTruncated,
    rowsRemoved: originalCount - limitedData.length,
  };

  // Log if truncation occurred
  if (wasTruncated && currentConfig.logLimitApplication && auditContext) {
    auditContext.policyViolation('row_limit_applied', {
      original_count: originalCount,
      applied_limit: effectiveLimit,
      rows_removed: result.rowsRemoved,
      requested_limit: requestedLimit,
    });
  }

  return result;
}

/**
 * Simple function to enforce row limit (returns just the data)
 *
 * @param results - The full results array
 * @param requestedLimit - The limit requested by the caller (optional)
 * @param auditContext - Audit context for logging (optional)
 * @returns Limited results array
 */
export function enforceRowLimit<T>(
  results: T[],
  requestedLimit?: number,
  auditContext?: AuditContext
): T[] {
  return applyRowLimit(results, requestedLimit, auditContext).data;
}

/**
 * Validate that a requested limit is within acceptable bounds
 *
 * @param requestedLimit - The limit to validate
 * @returns Validation result with error message if invalid
 */
export function validateLimit(requestedLimit: number): {
  valid: boolean;
  error?: string;
  correctedValue?: number;
} {
  if (typeof requestedLimit !== 'number' || isNaN(requestedLimit)) {
    return {
      valid: false,
      error: 'Limit must be a valid number',
      correctedValue: currentConfig.defaultLimit,
    };
  }

  if (requestedLimit < 1) {
    return {
      valid: false,
      error: 'Limit must be at least 1',
      correctedValue: 1,
    };
  }

  if (requestedLimit > currentConfig.absoluteMaxLimit) {
    return {
      valid: false,
      error: `Limit exceeds absolute maximum of ${currentConfig.absoluteMaxLimit}`,
      correctedValue: currentConfig.absoluteMaxLimit,
    };
  }

  if (requestedLimit > currentConfig.defaultLimit) {
    return {
      valid: true, // Still valid, but will be capped
      correctedValue: currentConfig.defaultLimit,
    };
  }

  return { valid: true };
}

/**
 * Row limit error class
 */
export class RowLimitExceededError extends Error {
  readonly originalCount: number;
  readonly appliedLimit: number;

  constructor(originalCount: number, appliedLimit: number) {
    super(`Row limit exceeded: ${originalCount} rows requested, limit is ${appliedLimit}`);
    this.name = 'RowLimitExceededError';
    this.originalCount = originalCount;
    this.appliedLimit = appliedLimit;
  }
}
