// ═══════════════════════════════════════════════════════════════════════════
// SAP WORKFLOW MINING - CIRCUIT BREAKER
// ═══════════════════════════════════════════════════════════════════════════
// Pre-execution blocking for halted agents
// ═══════════════════════════════════════════════════════════════════════════

import { CircuitBreakerState, CircuitState, GovernanceConfig } from './types.js';

/**
 * Circuit breaker for agent-level pre-execution blocking.
 *
 * States:
 * - CLOSED: Normal operation, requests pass through
 * - OPEN: Agent halted, all requests blocked
 * - HALF-OPEN: Testing if agent can resume (after reset time)
 */
export class CircuitBreaker {
  private states: Map<string, CircuitBreakerState> = new Map();
  private config: GovernanceConfig;

  constructor(config: GovernanceConfig) {
    this.config = config;
  }

  /**
   * Check if an agent is allowed to execute.
   */
  isAllowed(agentId: string): boolean {
    if (!this.config.enableCircuitBreaker) {
      return true;
    }

    const state = this.getState(agentId);

    switch (state.state) {
      case 'closed':
        return true;

      case 'open':
        // Check if reset time has passed
        if (state.haltedAt && Date.now() - state.haltedAt > this.config.circuitResetTimeMs) {
          // Transition to half-open
          this.transitionTo(agentId, 'half-open');
          return true;
        }
        return false;

      case 'half-open':
        // Allow one request to test
        return true;
    }
  }

  /**
   * Get the current state for an agent.
   */
  getState(agentId: string): CircuitBreakerState {
    const existing = this.states.get(agentId);
    if (existing) return existing;

    // Initialize new agent state
    const newState: CircuitBreakerState = {
      agentId,
      state: 'closed',
      failureCount: 0,
    };
    this.states.set(agentId, newState);
    return newState;
  }

  /**
   * Record a successful operation.
   */
  recordSuccess(agentId: string): void {
    const state = this.getState(agentId);

    if (state.state === 'half-open') {
      // Reset to closed on success
      this.transitionTo(agentId, 'closed');
    }

    state.failureCount = 0;
    state.lastSuccess = Date.now();
  }

  /**
   * Record a failed operation.
   */
  recordFailure(agentId: string): void {
    const state = this.getState(agentId);
    state.failureCount++;
    state.lastFailure = Date.now();

    if (state.state === 'half-open') {
      // Immediately open on failure in half-open
      this.transitionTo(agentId, 'open', 'Failed during recovery test');
    } else if (state.failureCount >= this.config.maxFailuresBeforeOpen) {
      // Open circuit after max failures
      this.transitionTo(
        agentId,
        'open',
        `Exceeded ${this.config.maxFailuresBeforeOpen} consecutive failures`
      );
    }
  }

  /**
   * Manually halt an agent.
   */
  halt(agentId: string, reason: string): void {
    this.transitionTo(agentId, 'open', reason);
  }

  /**
   * Manually resume a halted agent.
   */
  resume(agentId: string): boolean {
    const state = this.getState(agentId);

    if (state.state === 'closed') {
      return false; // Already running
    }

    this.transitionTo(agentId, 'closed');
    return true;
  }

  /**
   * Transition to a new state.
   */
  private transitionTo(agentId: string, newState: CircuitState, reason?: string): void {
    const state = this.getState(agentId);
    const previousState = state.state;

    state.state = newState;

    if (newState === 'open') {
      state.haltedAt = Date.now();
      if (reason) {
        state.haltReason = reason;
      }
    } else if (newState === 'closed') {
      delete state.haltedAt;
      delete state.haltReason;
      state.failureCount = 0;
    }

    // Log transition
    console.log(
      `[CircuitBreaker] Agent ${agentId}: ${previousState} → ${newState}` +
        (reason ? ` (${reason})` : '')
    );
  }

  /**
   * Get all halted agents.
   */
  getHaltedAgents(): CircuitBreakerState[] {
    return Array.from(this.states.values()).filter(s => s.state === 'open');
  }

  /**
   * Clear all state (for testing).
   */
  reset(): void {
    this.states.clear();
  }
}
