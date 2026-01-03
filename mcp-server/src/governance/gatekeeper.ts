// ═══════════════════════════════════════════════════════════════════════════
// SAP WORKFLOW MINING - GATEKEEPER
// ═══════════════════════════════════════════════════════════════════════════
// Central governance layer that enforces PromptSpeak frames on SAP operations
//
// Execution Order (pre-execution blocking):
// 1. CIRCUIT BREAKER - Block halted agents immediately
// 2. FRAME VALIDATION - Parse and validate symbolic frame
// 3. HOLD CHECK - Determine if human approval needed
// 4. EXECUTE - Only if all checks pass
// ═══════════════════════════════════════════════════════════════════════════

import { randomUUID } from 'crypto';
import {
  ExecuteRequest,
  ExecuteResult,
  PreFlightCheck,
  GovernanceConfig,
  DEFAULT_GOVERNANCE_CONFIG,
  HoldRequest,
} from './types.js';
import { quickValidate, defaultSAPFrame } from './validator.js';
import { CircuitBreaker } from './circuit-breaker.js';
import { HoldManager } from './hold-manager.js';

export class Gatekeeper {
  private circuitBreaker: CircuitBreaker;
  private holdManager: HoldManager;
  private config: GovernanceConfig;

  // Audit log (in-memory, would be persisted in production)
  private auditLog: Array<{
    auditId: string;
    timestamp: number;
    agentId: string;
    frame: string;
    tool: string;
    allowed: boolean;
    reason?: string;
  }> = [];

  constructor(config?: Partial<GovernanceConfig>) {
    this.config = { ...DEFAULT_GOVERNANCE_CONFIG, ...config };
    this.circuitBreaker = new CircuitBreaker(this.config);
    this.holdManager = new HoldManager(this.config);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // MAIN EXECUTION PIPELINE
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Execute an SAP operation through the governance pipeline.
   *
   * @param request - The execution request with frame and parameters
   * @returns ExecuteResult indicating if execution is allowed
   */
  execute(request: ExecuteRequest): ExecuteResult {
    const auditId = `audit_${randomUUID().slice(0, 8)}`;
    const timestamp = Date.now();

    // Initialize pre-flight check
    const preFlightCheck: PreFlightCheck = {
      passed: false,
      blocked: false,
      held: false,
      checks: {
        circuitBreaker: { passed: true },
        frameValidation: { passed: true },
        policyLimits: { passed: true },
      },
    };

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 1: CIRCUIT BREAKER CHECK (deterministic pre-execution blocking)
    // ═══════════════════════════════════════════════════════════════════════
    if (!this.circuitBreaker.isAllowed(request.agentId)) {
      const state = this.circuitBreaker.getState(request.agentId);
      preFlightCheck.checks.circuitBreaker = {
        passed: false,
        reason: state.haltReason || 'Agent is halted',
      };
      preFlightCheck.blocked = true;
      preFlightCheck.blockReason = `Agent halted: ${state.haltReason || 'Circuit breaker open'}`;

      this.logAudit(auditId, request, false, preFlightCheck.blockReason);

      return {
        success: false,
        allowed: false,
        held: false,
        error: preFlightCheck.blockReason,
        preFlightCheck,
        auditId,
        timestamp,
      };
    }

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 2: FRAME VALIDATION
    // ═══════════════════════════════════════════════════════════════════════
    const frameToUse = request.frame || defaultSAPFrame(request.tool);
    const validation = quickValidate(frameToUse);

    if (!validation.valid) {
      const errorMsg = validation.reason || 'Invalid frame';
      preFlightCheck.checks.frameValidation = {
        passed: false,
        errors: [errorMsg],
      };
      preFlightCheck.blocked = true;
      preFlightCheck.blockReason = errorMsg;

      this.circuitBreaker.recordFailure(request.agentId);
      this.logAudit(auditId, request, false, errorMsg);

      return {
        success: false,
        allowed: false,
        held: false,
        error: errorMsg,
        preFlightCheck,
        auditId,
        timestamp,
      };
    }

    if (validation.blocked) {
      const blockMsg = validation.reason || 'Blocked by frame validation';
      preFlightCheck.blocked = true;
      preFlightCheck.blockReason = blockMsg;

      this.logAudit(auditId, request, false, blockMsg);

      return {
        success: false,
        allowed: false,
        held: false,
        error: blockMsg,
        preFlightCheck,
        auditId,
        timestamp,
      };
    }

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 3: HOLD CHECK (Human-in-the-Loop)
    // ═══════════════════════════════════════════════════════════════════════
    // SECURITY: bypassHold requires a valid, approved holdDecision
    let holdBypassed = false;
    if (request.bypassHold && request.holdDecision) {
      // Validate that the hold exists and was properly approved
      const existingHold = this.holdManager.getHold(request.holdDecision.holdId);
      if (existingHold && existingHold.status === 'approved') {
        holdBypassed = true;
      } else {
        // Invalid bypass attempt - log and reject
        this.logAudit(auditId, request, false, 'Invalid hold bypass attempt');
        return {
          success: false,
          allowed: false,
          held: false,
          error: 'Invalid hold bypass: holdDecision must reference an approved hold',
          preFlightCheck,
          auditId,
          timestamp,
        };
      }
    }

    if (!holdBypassed) {
      const holdTrigger = this.holdManager.shouldHold(request);

      if (holdTrigger) {
        const holdRequest = this.holdManager.createHold(
          request,
          holdTrigger.reason,
          holdTrigger.severity,
          holdTrigger.evidence
        );

        preFlightCheck.held = true;
        preFlightCheck.holdRequest = holdRequest;

        this.logAudit(auditId, request, false, `Held for approval: ${holdTrigger.reason}`);

        return {
          success: false,
          allowed: false,
          held: true,
          holdRequest,
          preFlightCheck,
          auditId,
          timestamp,
        };
      }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 4: ALL CHECKS PASSED - ALLOW EXECUTION
    // ═══════════════════════════════════════════════════════════════════════
    preFlightCheck.passed = true;
    this.circuitBreaker.recordSuccess(request.agentId);
    this.logAudit(auditId, request, true);

    return {
      success: true,
      allowed: true,
      held: false,
      preFlightCheck,
      auditId,
      timestamp,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PRE-CHECK (DRY RUN)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Check if an operation would be allowed without executing.
   */
  precheck(request: ExecuteRequest): {
    wouldAllow: boolean;
    wouldHold: boolean;
    reason?: string;
    frame: string;
  } {
    const frameToUse = request.frame || defaultSAPFrame(request.tool);

    // Check circuit breaker
    if (!this.circuitBreaker.isAllowed(request.agentId)) {
      const state = this.circuitBreaker.getState(request.agentId);
      return {
        wouldAllow: false,
        wouldHold: false,
        reason: state.haltReason || 'Agent is halted',
        frame: frameToUse,
      };
    }

    // Check frame validation
    const validation = quickValidate(frameToUse);
    if (!validation.valid || validation.blocked) {
      return {
        wouldAllow: false,
        wouldHold: false,
        ...(validation.reason ? { reason: validation.reason } : {}),
        frame: frameToUse,
      };
    }

    // Check hold triggers
    const holdTrigger = this.holdManager.shouldHold(request);
    if (holdTrigger) {
      return {
        wouldAllow: false,
        wouldHold: true,
        reason: `Would hold for: ${holdTrigger.reason}`,
        frame: frameToUse,
      };
    }

    return {
      wouldAllow: true,
      wouldHold: false,
      frame: frameToUse,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // HOLD MANAGEMENT
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * List pending holds awaiting approval.
   */
  listHolds(): HoldRequest[] {
    return this.holdManager.listPendingHolds();
  }

  /**
   * Approve a held operation.
   */
  approveHold(
    holdId: string,
    approvedBy: string,
    modifiedParams?: Record<string, unknown>
  ): ExecuteResult | null {
    const decision = this.holdManager.approve(holdId, approvedBy, modifiedParams);
    if (!decision) return null;

    const hold = this.holdManager.getHold(holdId);
    if (!hold) return null;

    // Re-execute with bypass
    return this.execute({
      agentId: hold.agentId,
      frame: hold.frame,
      tool: hold.tool,
      params: modifiedParams || hold.params,
      bypassHold: true,
      holdDecision: decision,
    });
  }

  /**
   * Reject a held operation.
   */
  rejectHold(holdId: string, rejectedBy: string, reason: string): boolean {
    const decision = this.holdManager.reject(holdId, rejectedBy, reason);
    return decision !== null;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // AGENT CONTROL
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Halt an agent (open circuit breaker).
   */
  haltAgent(agentId: string, reason: string): void {
    this.circuitBreaker.halt(agentId, reason);
  }

  /**
   * Resume a halted agent.
   */
  resumeAgent(agentId: string): boolean {
    return this.circuitBreaker.resume(agentId);
  }

  /**
   * Get agent status.
   */
  getAgentStatus(agentId: string): {
    isAllowed: boolean;
    state: string;
    haltReason?: string;
  } {
    const state = this.circuitBreaker.getState(agentId);
    return {
      isAllowed: this.circuitBreaker.isAllowed(agentId),
      state: state.state,
      ...(state.haltReason ? { haltReason: state.haltReason } : {}),
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // AUDIT & STATS
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Log an audit entry.
   */
  private logAudit(
    auditId: string,
    request: ExecuteRequest,
    allowed: boolean,
    reason?: string
  ): void {
    if (!this.config.enableAuditLogging) return;

    this.auditLog.push({
      auditId,
      timestamp: Date.now(),
      agentId: request.agentId,
      frame: request.frame || defaultSAPFrame(request.tool),
      tool: request.tool,
      allowed,
      ...(reason ? { reason } : {}),
    });

    // Trim old entries
    const cutoff = Date.now() - this.config.auditRetentionMs;
    this.auditLog = this.auditLog.filter(e => e.timestamp > cutoff);
  }

  /**
   * Get recent audit entries.
   */
  getAuditLog(limit: number = 100): typeof this.auditLog {
    return this.auditLog.slice(-limit);
  }

  /**
   * Get governance statistics.
   */
  getStats(): {
    holds: ReturnType<HoldManager['getStats']>;
    haltedAgents: number;
    auditEntries: number;
    recentBlocked: number;
    recentAllowed: number;
  } {
    const recentCutoff = Date.now() - 3600000; // Last hour
    const recent = this.auditLog.filter(e => e.timestamp > recentCutoff);

    return {
      holds: this.holdManager.getStats(),
      haltedAgents: this.circuitBreaker.getHaltedAgents().length,
      auditEntries: this.auditLog.length,
      recentBlocked: recent.filter(e => !e.allowed).length,
      recentAllowed: recent.filter(e => e.allowed).length,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // CONFIGURATION
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Update configuration.
   */
  setConfig(config: Partial<GovernanceConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current configuration.
   */
  getConfig(): GovernanceConfig {
    return { ...this.config };
  }

  /**
   * Reset all state (for testing).
   */
  reset(): void {
    this.circuitBreaker.reset();
    this.holdManager.reset();
    this.auditLog = [];
  }
}

// Export singleton instance
export const gatekeeper = new Gatekeeper();
