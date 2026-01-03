// ═══════════════════════════════════════════════════════════════════════════
// SAP WORKFLOW MINING - HOLD MANAGER
// ═══════════════════════════════════════════════════════════════════════════
// Human-in-the-loop approval for risky operations
// ═══════════════════════════════════════════════════════════════════════════

import { randomUUID } from 'crypto';
import {
  HoldRequest,
  HoldDecision,
  HoldReason,
  GovernanceConfig,
  ExecuteRequest,
} from './types.js';

interface HoldTriggerResult {
  shouldHold: boolean;
  reason: HoldReason;
  severity: 'low' | 'medium' | 'high' | 'critical';
  evidence: Record<string, unknown>;
}

/**
 * Hold manager for human-in-the-loop approval.
 *
 * Holds are triggered for:
 * - Broad date ranges (>90 days by default)
 * - High row limits (>500 by default)
 * - Sensitive text search patterns
 * - Forbidden constraints in frames
 */
export class HoldManager {
  private holds: Map<string, HoldRequest> = new Map();
  private config: GovernanceConfig;

  constructor(config: GovernanceConfig) {
    this.config = config;
  }

  /**
   * Check if an operation should be held for approval.
   */
  shouldHold(request: ExecuteRequest): HoldTriggerResult | null {
    if (!this.config.enableHolds) {
      return null;
    }

    const { tool, params } = request;

    // Check 1: Broad date range
    const dateRangeResult = this.checkDateRange(params);
    if (dateRangeResult) return dateRangeResult;

    // Check 2: High row limit
    const rowLimitResult = this.checkRowLimit(params);
    if (rowLimitResult) return rowLimitResult;

    // Check 3: Sensitive text patterns
    const sensitiveResult = this.checkSensitivePatterns(tool, params);
    if (sensitiveResult) return sensitiveResult;

    return null;
  }

  /**
   * Check for broad date ranges.
   */
  private checkDateRange(params: Record<string, unknown>): HoldTriggerResult | null {
    const dateFrom = params['date_from'] as string | undefined;
    const dateTo = params['date_to'] as string | undefined;

    if (!dateFrom || !dateTo) return null;

    try {
      const from = new Date(dateFrom);
      const to = new Date(dateTo);
      const daysDiff = Math.abs(to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24);

      if (daysDiff > this.config.dateRangeHoldThresholdDays) {
        return {
          shouldHold: true,
          reason: 'broad_date_range',
          severity: daysDiff > 365 ? 'high' : 'medium',
          evidence: {
            date_from: dateFrom,
            date_to: dateTo,
            days: Math.round(daysDiff),
            threshold: this.config.dateRangeHoldThresholdDays,
          },
        };
      }
    } catch {
      // Invalid dates, don't hold
    }

    return null;
  }

  /**
   * Check for high row limits.
   */
  private checkRowLimit(params: Record<string, unknown>): HoldTriggerResult | null {
    const limit = params['limit'] as number | undefined;

    if (limit && limit > this.config.rowLimitHoldThreshold) {
      return {
        shouldHold: true,
        reason: 'high_row_limit',
        severity: limit > 1000 ? 'high' : 'medium',
        evidence: {
          requested_limit: limit,
          threshold: this.config.rowLimitHoldThreshold,
        },
      };
    }

    return null;
  }

  /**
   * Check for sensitive text search patterns.
   */
  private checkSensitivePatterns(
    tool: string,
    params: Record<string, unknown>
  ): HoldTriggerResult | null {
    if (tool !== 'search_doc_text') return null;

    const pattern = params['pattern'] as string | undefined;
    if (!pattern) return null;

    for (const sensitivePattern of this.config.sensitiveTextPatterns) {
      if (sensitivePattern.test(pattern)) {
        return {
          shouldHold: true,
          reason: 'sensitive_text_search',
          severity: 'high',
          evidence: {
            search_pattern: pattern,
            matched_rule: sensitivePattern.toString(),
          },
        };
      }
    }

    return null;
  }

  /**
   * Create a hold request.
   */
  createHold(
    request: ExecuteRequest,
    reason: HoldReason,
    severity: 'low' | 'medium' | 'high' | 'critical',
    evidence: Record<string, unknown>
  ): HoldRequest {
    const holdId = `hold_${randomUUID().slice(0, 8)}`;
    const now = Date.now();

    const holdRequest: HoldRequest = {
      holdId,
      agentId: request.agentId,
      frame: request.frame,
      tool: request.tool,
      params: request.params,
      reason,
      severity,
      evidence,
      createdAt: now,
      expiresAt: now + this.config.holdExpirationMs,
      status: 'pending',
    };

    this.holds.set(holdId, holdRequest);

    console.log(
      `[HoldManager] Created hold ${holdId} for ${request.tool}: ${reason} (${severity})`
    );

    return holdRequest;
  }

  /**
   * Get a pending hold by ID.
   */
  getHold(holdId: string): HoldRequest | undefined {
    const hold = this.holds.get(holdId);

    if (hold && hold.status === 'pending' && Date.now() > hold.expiresAt) {
      hold.status = 'expired';
    }

    return hold;
  }

  /**
   * List all pending holds.
   */
  listPendingHolds(): HoldRequest[] {
    const now = Date.now();
    const pending: HoldRequest[] = [];

    for (const hold of this.holds.values()) {
      if (hold.status === 'pending') {
        if (now > hold.expiresAt) {
          hold.status = 'expired';
        } else {
          pending.push(hold);
        }
      }
    }

    return pending.sort((a, b) => b.createdAt - a.createdAt);
  }

  /**
   * Approve a hold.
   */
  approve(
    holdId: string,
    approvedBy: string,
    modifiedParams?: Record<string, unknown>
  ): HoldDecision | null {
    const hold = this.getHold(holdId);

    if (!hold || hold.status !== 'pending') {
      return null;
    }

    hold.status = 'approved';

    const decision: HoldDecision = {
      holdId,
      approved: true,
      approvedBy,
      ...(modifiedParams ? { modifiedParams } : {}),
      decidedAt: Date.now(),
    };

    console.log(`[HoldManager] Approved hold ${holdId} by ${approvedBy}`);

    return decision;
  }

  /**
   * Reject a hold.
   */
  reject(holdId: string, rejectedBy: string, reason: string): HoldDecision | null {
    const hold = this.getHold(holdId);

    if (!hold || hold.status !== 'pending') {
      return null;
    }

    hold.status = 'rejected';

    const decision: HoldDecision = {
      holdId,
      approved: false,
      approvedBy: rejectedBy,
      reason,
      decidedAt: Date.now(),
    };

    console.log(`[HoldManager] Rejected hold ${holdId} by ${rejectedBy}: ${reason}`);

    return decision;
  }

  /**
   * Clean up expired holds.
   */
  cleanupExpired(): number {
    const now = Date.now();
    let count = 0;

    for (const [, hold] of this.holds) {
      if (hold.status === 'pending' && now > hold.expiresAt) {
        hold.status = 'expired';
        count++;
      }
    }

    return count;
  }

  /**
   * Get hold statistics.
   */
  getStats(): {
    total: number;
    pending: number;
    approved: number;
    rejected: number;
    expired: number;
  } {
    let pending = 0,
      approved = 0,
      rejected = 0,
      expired = 0;

    for (const hold of this.holds.values()) {
      switch (hold.status) {
        case 'pending':
          pending++;
          break;
        case 'approved':
          approved++;
          break;
        case 'rejected':
          rejected++;
          break;
        case 'expired':
          expired++;
          break;
      }
    }

    return {
      total: this.holds.size,
      pending,
      approved,
      rejected,
      expired,
    };
  }

  /**
   * Clear all holds (for testing).
   */
  reset(): void {
    this.holds.clear();
  }
}
