/**
 * Finding Lifecycle Manager Tests
 *
 * Covers: creation, state transitions, validation, querying,
 * deduplication, summary, and full lifecycle workflows.
 */

import { FindingLifecycleManager } from '../finding-lifecycle/manager.js';
import { VALID_TRANSITIONS, TERMINAL_STATES } from '../finding-lifecycle/types.js';
import type {
  FindingSource,
  FindingSeverity,
  FindingKey,
  UnifiedFinding,
} from '../finding-lifecycle/types.js';

// --- Fixture helper ---

function makeParams(
  overrides: Partial<Parameters<FindingLifecycleManager['createFinding']>[0]> = {}
) {
  return {
    source: 'contradiction' as FindingSource,
    sourceId: 'ctr-001',
    title: 'Amount mismatch on PO 4500001234',
    description: 'SAP GR amount differs from invoice by 12%',
    severity: 'HIGH' as FindingSeverity,
    riskScore: 78,
    systemsCovered: ['SAP', 'Salesforce'],
    tablesCovered: ['EKKO', 'Opportunity'],
    extractionIds: ['ext-001', 'ext-002'],
    ...overrides,
  };
}

// --- Tests ---

describe('FindingLifecycleManager', () => {
  let mgr: FindingLifecycleManager;

  beforeEach(() => {
    mgr = new FindingLifecycleManager();
  });

  // 1. createFinding creates with state DETECTED
  test('createFinding creates with state DETECTED', () => {
    const f = mgr.createFinding(makeParams());
    expect(f.state).toBe('DETECTED');
  });

  // 2. createFinding sets detectedAt timestamp
  test('createFinding sets detectedAt timestamp', () => {
    const before = new Date().toISOString();
    const f = mgr.createFinding(makeParams());
    const after = new Date().toISOString();
    expect(f.detectedAt).toBeDefined();
    expect(f.detectedAt >= before).toBe(true);
    expect(f.detectedAt <= after).toBe(true);
  });

  // 3. transition from DETECTED to TRIAGED succeeds
  test('transition from DETECTED to TRIAGED succeeds', () => {
    const f = mgr.createFinding(makeParams());
    const updated = mgr.transition(f.id, 'TRIAGED', 'analyst-1', 'Initial triage');
    expect(updated.state).toBe('TRIAGED');
  });

  // 4. transition from DETECTED to CONFIRMED fails (invalid)
  test('transition from DETECTED to CONFIRMED throws', () => {
    const f = mgr.createFinding(makeParams());
    expect(() => mgr.transition(f.id, 'CONFIRMED', 'analyst-1', 'Skip triage')).toThrow(
      'Invalid transition from DETECTED to CONFIRMED'
    );
  });

  // 5. transition records in transitions array
  test('transition records in transitions array', () => {
    const f = mgr.createFinding(makeParams());
    mgr.transition(f.id, 'TRIAGED', 'analyst-1', 'Triaged');
    const updated = mgr.get(f.id)!;
    expect(updated.transitions).toHaveLength(1);
    expect(updated.transitions[0]!.fromState).toBe('DETECTED');
    expect(updated.transitions[0]!.toState).toBe('TRIAGED');
    expect(updated.transitions[0]!.transitionedBy).toBe('analyst-1');
    expect(updated.transitions[0]!.notes).toBe('Triaged');
  });

  // 6. transition updates lastTransitionAt
  test('transition updates lastTransitionAt', () => {
    const f = mgr.createFinding(makeParams());
    const originalTimestamp = f.lastTransitionAt;
    // Small delay to ensure different timestamp
    const updated = mgr.transition(f.id, 'TRIAGED', 'analyst-1', 'Triaged');
    expect(updated.lastTransitionAt).toBeDefined();
    expect(updated.lastTransitionAt >= originalTimestamp).toBe(true);
  });

  // 7. isValidTransition returns true for valid, false for invalid
  test('isValidTransition returns true for valid, false for invalid', () => {
    expect(mgr.isValidTransition('DETECTED', 'TRIAGED')).toBe(true);
    expect(mgr.isValidTransition('DETECTED', 'FALSE_POSITIVE')).toBe(true);
    expect(mgr.isValidTransition('DETECTED', 'CONFIRMED')).toBe(false);
    expect(mgr.isValidTransition('DETECTED', 'RESOLVED')).toBe(false);
    expect(mgr.isValidTransition('CONFIRMED', 'REMEDIATION')).toBe(true);
    expect(mgr.isValidTransition('CONFIRMED', 'ACCEPTED_RISK')).toBe(true);
  });

  // 8. Terminal states cannot transition
  test('terminal states cannot transition', () => {
    for (const terminal of TERMINAL_STATES) {
      const allowed = VALID_TRANSITIONS[terminal];
      expect(allowed).toEqual([]);
    }
  });

  // 9. query filters by state
  test('query filters by state', () => {
    const f1 = mgr.createFinding(makeParams());
    mgr.createFinding(makeParams({ sourceId: 'ctr-002' }));
    mgr.transition(f1.id, 'TRIAGED', 'system', 'auto');

    const detected = mgr.query({ state: 'DETECTED' });
    const triaged = mgr.query({ state: 'TRIAGED' });
    expect(detected).toHaveLength(1);
    expect(triaged).toHaveLength(1);
    expect(triaged[0]!.id).toBe(f1.id);
  });

  // 10. query filters by source
  test('query filters by source', () => {
    mgr.createFinding(makeParams({ source: 'contradiction' }));
    mgr.createFinding(makeParams({ source: 'reality_gap', sourceId: 'gap-001' }));
    mgr.createFinding(makeParams({ source: 'conformance', sourceId: 'conf-001' }));

    const contradictions = mgr.query({ source: 'contradiction' });
    const gaps = mgr.query({ source: 'reality_gap' });
    expect(contradictions).toHaveLength(1);
    expect(gaps).toHaveLength(1);
  });

  // 11. query filters by minRiskScore
  test('query filters by minRiskScore', () => {
    mgr.createFinding(makeParams({ riskScore: 30 }));
    mgr.createFinding(makeParams({ riskScore: 60, sourceId: 'ctr-002' }));
    mgr.createFinding(makeParams({ riskScore: 90, sourceId: 'ctr-003' }));

    const high = mgr.query({ minRiskScore: 60 });
    expect(high).toHaveLength(2);
    expect(high.every(f => f.riskScore >= 60)).toBe(true);
  });

  // 12. isDuplicate returns true for matching key
  test('isDuplicate returns true for matching key', () => {
    const f = mgr.createFinding(makeParams());
    const key: FindingKey = {
      source: 'contradiction',
      systemLeft: 'SAP',
      tableLeft: 'EKKO',
      recordLeft: 'PO-001',
    };
    mgr.registerKey(f.id, key);
    expect(mgr.isDuplicate(key)).toBe(true);
  });

  // 13. isDuplicate returns false for new key
  test('isDuplicate returns false for new key', () => {
    const key: FindingKey = {
      source: 'contradiction',
      systemLeft: 'SAP',
      tableLeft: 'BKPF',
      recordLeft: 'DOC-999',
    };
    expect(mgr.isDuplicate(key)).toBe(false);
  });

  // 14. getSummary counts by state
  test('getSummary counts by state', () => {
    const f1 = mgr.createFinding(makeParams());
    mgr.createFinding(makeParams({ sourceId: 'ctr-002' }));
    mgr.transition(f1.id, 'TRIAGED', 'system', 'auto');

    const summary = mgr.getSummary();
    expect(summary.byState.DETECTED).toBe(1);
    expect(summary.byState.TRIAGED).toBe(1);
    expect(summary.total).toBe(2);
  });

  // 15. getSummary counts by source
  test('getSummary counts by source', () => {
    mgr.createFinding(makeParams({ source: 'contradiction' }));
    mgr.createFinding(makeParams({ source: 'reality_gap', sourceId: 'gap-001' }));
    mgr.createFinding(makeParams({ source: 'fi_co_anomaly', sourceId: 'fi-001' }));

    const summary = mgr.getSummary();
    expect(summary.bySource.contradiction).toBe(1);
    expect(summary.bySource.reality_gap).toBe(1);
    expect(summary.bySource.fi_co_anomaly).toBe(1);
    expect(summary.bySource.conformance).toBe(0);
  });

  // 16. getResolved returns only terminal-state findings
  test('getResolved returns only terminal-state findings', () => {
    const f1 = mgr.createFinding(makeParams());
    mgr.createFinding(makeParams({ sourceId: 'ctr-002' }));

    // Move f1 to FALSE_POSITIVE (terminal)
    mgr.transition(f1.id, 'FALSE_POSITIVE', 'analyst-1', 'Not a real issue');

    const resolved = mgr.getResolved();
    expect(resolved).toHaveLength(1);
    expect(resolved[0]!.id).toBe(f1.id);
    expect(resolved[0]!.state).toBe('FALSE_POSITIVE');
  });

  // 17. getActive returns only non-terminal findings
  test('getActive returns only non-terminal findings', () => {
    const f1 = mgr.createFinding(makeParams());
    const f2 = mgr.createFinding(makeParams({ sourceId: 'ctr-002' }));

    mgr.transition(f1.id, 'FALSE_POSITIVE', 'analyst-1', 'Not real');

    const active = mgr.getActive();
    expect(active).toHaveLength(1);
    expect(active[0]!.id).toBe(f2.id);
  });

  // 18. Full lifecycle: DETECTED -> TRIAGED -> INVESTIGATING -> CONFIRMED -> REMEDIATION -> RESOLVED
  test('full lifecycle from DETECTED to RESOLVED', () => {
    const f = mgr.createFinding(makeParams());
    expect(f.state).toBe('DETECTED');

    mgr.transition(f.id, 'TRIAGED', 'analyst-1', 'Assigned to team');
    mgr.transition(f.id, 'INVESTIGATING', 'analyst-1', 'Pulling source data');
    mgr.transition(f.id, 'CONFIRMED', 'analyst-2', 'Verified mismatch');
    mgr.transition(f.id, 'REMEDIATION', 'manager-1', 'JV posted');
    mgr.transition(f.id, 'RESOLVED', 'manager-1', 'Closed after reconciliation');

    const resolved = mgr.get(f.id)!;
    expect(resolved.state).toBe('RESOLVED');
    expect(resolved.resolvedAt).toBeDefined();
    expect(resolved.transitions).toHaveLength(5);

    // Cannot transition further from terminal
    expect(() => mgr.transition(f.id, 'DETECTED', 'system', 'reopen')).toThrow(
      'Invalid transition'
    );
  });

  // 19. Transition includes evidence and notes
  test('transition includes evidence and notes', () => {
    const f = mgr.createFinding(makeParams());
    mgr.transition(f.id, 'TRIAGED', 'analyst-1', 'Looks suspicious', 'ext-005');

    const tx = mgr.get(f.id)!.transitions[0]!;
    expect(tx.evidence).toBe('ext-005');
    expect(tx.notes).toBe('Looks suspicious');
    expect(tx.transitionedBy).toBe('analyst-1');
  });

  // 20. Multiple findings tracked simultaneously
  test('multiple findings tracked simultaneously', () => {
    const f1 = mgr.createFinding(makeParams({ sourceId: 'ctr-001', riskScore: 80 }));
    const f2 = mgr.createFinding(
      makeParams({ source: 'reality_gap', sourceId: 'gap-001', riskScore: 50 })
    );
    const f3 = mgr.createFinding(
      makeParams({ source: 'conformance', sourceId: 'conf-001', riskScore: 95 })
    );

    mgr.transition(f1.id, 'TRIAGED', 'system', 'auto');
    mgr.transition(f2.id, 'FALSE_POSITIVE', 'analyst-1', 'Not an issue');
    mgr.transition(f3.id, 'TRIAGED', 'system', 'auto');
    mgr.transition(f3.id, 'INVESTIGATING', 'analyst-2', 'Deep dive');

    expect(mgr.get(f1.id)!.state).toBe('TRIAGED');
    expect(mgr.get(f2.id)!.state).toBe('FALSE_POSITIVE');
    expect(mgr.get(f3.id)!.state).toBe('INVESTIGATING');

    expect(mgr.getActive()).toHaveLength(2);
    expect(mgr.getResolved()).toHaveLength(1);

    const summary = mgr.getSummary();
    expect(summary.total).toBe(3);
    expect(summary.avgRiskScore).toBeCloseTo(75, 0);
  });
});
