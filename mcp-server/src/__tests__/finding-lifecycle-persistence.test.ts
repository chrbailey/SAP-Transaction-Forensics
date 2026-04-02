/**
 * Tests for FindingLifecycleDB — unified finding lifecycle persistence.
 *
 * Covers: insert/get round-trip, state transitions, multiple transitions,
 * dedup key registration, query filters, stats, :memory: DB, resolved_at,
 * and edge cases.
 */

import { randomUUID } from 'node:crypto';
import {
  FindingLifecycleDB,
  type UnifiedFinding,
  type FindingKey,
} from '../finding-lifecycle/persistence.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeFinding(overrides?: Partial<UnifiedFinding>): UnifiedFinding {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    source: 'contradiction',
    sourceId: randomUUID(),
    state: 'DETECTED',
    title: 'Amount mismatch between SAP and Salesforce',
    description: 'SAP VBAK.NETWR diverges from Salesforce Opportunity.Amount by 15%',
    severity: 'HIGH',
    riskScore: 67.5,
    systemsCovered: ['SAP', 'Salesforce'],
    tablesCovered: ['VBAK', 'Opportunity'],
    extractionIds: ['ext-1', 'ext-2'],
    detectedAt: now,
    lastTransitionAt: now,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('FindingLifecycleDB', () => {
  let db: FindingLifecycleDB;

  beforeEach(() => {
    db = new FindingLifecycleDB(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  // 1. Insert + get round-trip
  it('insert + get finding round-trip preserves all fields', () => {
    const finding = makeFinding({
      assignedTo: 'auditor@example.com',
    });
    db.insertFinding(finding);

    const retrieved = db.getFinding(finding.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.id).toBe(finding.id);
    expect(retrieved!.source).toBe('contradiction');
    expect(retrieved!.sourceId).toBe(finding.sourceId);
    expect(retrieved!.state).toBe('DETECTED');
    expect(retrieved!.title).toBe('Amount mismatch between SAP and Salesforce');
    expect(retrieved!.description).toContain('diverges from Salesforce');
    expect(retrieved!.severity).toBe('HIGH');
    expect(retrieved!.riskScore).toBe(67.5);
    expect(retrieved!.assignedTo).toBe('auditor@example.com');
    expect(retrieved!.systemsCovered).toEqual(['SAP', 'Salesforce']);
    expect(retrieved!.tablesCovered).toEqual(['VBAK', 'Opportunity']);
    expect(retrieved!.extractionIds).toEqual(['ext-1', 'ext-2']);
    expect(retrieved!.detectedAt).toBe(finding.detectedAt);
    expect(retrieved!.lastTransitionAt).toBe(finding.lastTransitionAt);
    expect(retrieved!.resolvedAt).toBeUndefined();
    expect(retrieved!.transitions).toEqual([]);
  });

  // 2. State transitions persist
  it('state transition persists and is returned by getFinding', () => {
    const finding = makeFinding();
    db.insertFinding(finding);

    const transitionedAt = new Date().toISOString();
    db.insertTransition({
      findingId: finding.id,
      fromState: 'DETECTED',
      toState: 'INVESTIGATING',
      transitionedAt,
      transitionedBy: 'analyst@example.com',
      notes: 'Assigned for review',
    });
    db.updateState(finding.id, 'INVESTIGATING', transitionedAt);

    const retrieved = db.getFinding(finding.id);
    expect(retrieved!.state).toBe('INVESTIGATING');
    expect(retrieved!.lastTransitionAt).toBe(transitionedAt);
    expect(retrieved!.transitions).toHaveLength(1);
    expect(retrieved!.transitions![0]!.fromState).toBe('DETECTED');
    expect(retrieved!.transitions![0]!.toState).toBe('INVESTIGATING');
    expect(retrieved!.transitions![0]!.transitionedBy).toBe('analyst@example.com');
    expect(retrieved!.transitions![0]!.notes).toBe('Assigned for review');
  });

  // 3. Multiple transitions per finding
  it('multiple transitions per finding are ordered correctly', () => {
    const finding = makeFinding();
    db.insertFinding(finding);

    const t1 = '2026-01-01T10:00:00.000Z';
    const t2 = '2026-01-01T11:00:00.000Z';
    const t3 = '2026-01-01T12:00:00.000Z';

    db.insertTransition({
      findingId: finding.id,
      fromState: 'DETECTED',
      toState: 'INVESTIGATING',
      transitionedAt: t1,
      transitionedBy: 'analyst',
      notes: 'Started investigation',
    });
    db.insertTransition({
      findingId: finding.id,
      fromState: 'INVESTIGATING',
      toState: 'CONFIRMED',
      transitionedAt: t2,
      transitionedBy: 'senior-analyst',
      evidence: 'Cross-referenced with bank statement',
      notes: 'Verified divergence',
    });
    db.insertTransition({
      findingId: finding.id,
      fromState: 'CONFIRMED',
      toState: 'RESOLVED',
      transitionedAt: t3,
      transitionedBy: 'manager',
      notes: 'Resolved via journal entry',
    });

    const transitions = db.getTransitions(finding.id);
    expect(transitions).toHaveLength(3);
    expect(transitions[0]!.toState).toBe('INVESTIGATING');
    expect(transitions[1]!.toState).toBe('CONFIRMED');
    expect(transitions[1]!.evidence).toBe('Cross-referenced with bank statement');
    expect(transitions[2]!.toState).toBe('RESOLVED');
  });

  // 4. Dedup key registration + check
  it('registerDedupKey + isDuplicate detects registered keys', () => {
    const finding = makeFinding();
    db.insertFinding(finding);

    const key: FindingKey = {
      source: 'contradiction',
      systemLeft: 'SAP',
      tableLeft: 'VBAK',
      recordLeft: 'SAP-001',
      systemRight: 'Salesforce',
      tableRight: 'Opportunity',
      recordRight: 'SF-001',
    };

    expect(db.isDuplicate(key)).toBe(false);

    db.registerDedupKey(finding.id, key);

    expect(db.isDuplicate(key)).toBe(true);
  });

  // 5. isDuplicate returns false for different keys
  it('isDuplicate returns false for unregistered key', () => {
    const finding = makeFinding();
    db.insertFinding(finding);

    db.registerDedupKey(finding.id, {
      source: 'contradiction',
      systemLeft: 'SAP',
      tableLeft: 'VBAK',
      recordLeft: 'SAP-001',
      systemRight: 'Salesforce',
      tableRight: 'Opportunity',
      recordRight: 'SF-001',
    });

    const differentKey: FindingKey = {
      source: 'contradiction',
      systemLeft: 'SAP',
      tableLeft: 'VBAK',
      recordLeft: 'SAP-999',
      systemRight: 'Salesforce',
      tableRight: 'Opportunity',
      recordRight: 'SF-999',
    };

    expect(db.isDuplicate(differentKey)).toBe(false);
  });

  // 6. Query by state
  it('queryFindings filters by state', () => {
    const f1 = makeFinding({ state: 'DETECTED' });
    const f2 = makeFinding({ state: 'INVESTIGATING' });
    const f3 = makeFinding({ state: 'DETECTED' });
    db.insertFinding(f1);
    db.insertFinding(f2);
    db.insertFinding(f3);

    const detected = db.queryFindings({ state: 'DETECTED' });
    expect(detected).toHaveLength(2);
    for (const f of detected) {
      expect(f.state).toBe('DETECTED');
    }

    const investigating = db.queryFindings({ state: 'INVESTIGATING' });
    expect(investigating).toHaveLength(1);
    expect(investigating[0]!.id).toBe(f2.id);
  });

  // 7. Query by source
  it('queryFindings filters by source', () => {
    db.insertFinding(makeFinding({ source: 'contradiction' }));
    db.insertFinding(makeFinding({ source: 'reality_gap' }));
    db.insertFinding(makeFinding({ source: 'conformance' }));
    db.insertFinding(makeFinding({ source: 'contradiction' }));

    const contradictions = db.queryFindings({ source: 'contradiction' });
    expect(contradictions).toHaveLength(2);

    const gaps = db.queryFindings({ source: 'reality_gap' });
    expect(gaps).toHaveLength(1);
  });

  // 8. Query by severity
  it('queryFindings filters by severity', () => {
    db.insertFinding(makeFinding({ severity: 'CRITICAL', riskScore: 95 }));
    db.insertFinding(makeFinding({ severity: 'HIGH', riskScore: 70 }));
    db.insertFinding(makeFinding({ severity: 'LOW', riskScore: 20 }));

    const critical = db.queryFindings({ severity: 'CRITICAL' });
    expect(critical).toHaveLength(1);
    expect(critical[0]!.severity).toBe('CRITICAL');
  });

  // 9. Query by minRiskScore
  it('queryFindings filters by minRiskScore', () => {
    db.insertFinding(makeFinding({ riskScore: 30 }));
    db.insertFinding(makeFinding({ riskScore: 60 }));
    db.insertFinding(makeFinding({ riskScore: 90 }));

    const high = db.queryFindings({ minRiskScore: 55 });
    expect(high).toHaveLength(2);
  });

  // 10. Query by assignedTo
  it('queryFindings filters by assignedTo', () => {
    db.insertFinding(makeFinding({ assignedTo: 'alice@example.com' }));
    db.insertFinding(makeFinding({ assignedTo: 'bob@example.com' }));
    db.insertFinding(makeFinding({ assignedTo: 'alice@example.com' }));

    const alice = db.queryFindings({ assignedTo: 'alice@example.com' });
    expect(alice).toHaveLength(2);
  });

  // 11. getStats returns correct counts
  it('getStats returns correct breakdowns', () => {
    db.insertFinding(makeFinding({ state: 'DETECTED', source: 'contradiction', severity: 'HIGH' }));
    db.insertFinding(makeFinding({ state: 'DETECTED', source: 'contradiction', severity: 'HIGH' }));
    db.insertFinding(
      makeFinding({ state: 'INVESTIGATING', source: 'reality_gap', severity: 'CRITICAL' })
    );
    db.insertFinding(makeFinding({ state: 'RESOLVED', source: 'conformance', severity: 'LOW' }));

    const stats = db.getStats();
    expect(stats.total).toBe(4);
    expect(stats.byState).toEqual({ DETECTED: 2, INVESTIGATING: 1, RESOLVED: 1 });
    expect(stats.bySource).toEqual({ contradiction: 2, reality_gap: 1, conformance: 1 });
    expect(stats.bySeverity).toEqual({ HIGH: 2, CRITICAL: 1, LOW: 1 });
  });

  // 12. :memory: DB works (constructor creates tables)
  it(':memory: DB creates all tables successfully', () => {
    const freshDb = new FindingLifecycleDB(':memory:');

    // Should be able to insert finding, transition, and dedup key
    const finding = makeFinding();
    freshDb.insertFinding(finding);
    freshDb.insertTransition({
      findingId: finding.id,
      fromState: 'DETECTED',
      toState: 'INVESTIGATING',
      transitionedAt: new Date().toISOString(),
      transitionedBy: 'test',
      notes: '',
    });
    freshDb.registerDedupKey(finding.id, {
      source: 'contradiction',
      systemLeft: 'SAP',
      recordLeft: 'R1',
    });

    expect(freshDb.getFinding(finding.id)).not.toBeNull();
    expect(freshDb.getTransitions(finding.id)).toHaveLength(1);
    expect(freshDb.getStats().total).toBe(1);

    freshDb.close();
  });

  // 13. Resolved findings have resolved_at set
  it('resolved findings have resolved_at set via updateState', () => {
    const finding = makeFinding();
    db.insertFinding(finding);

    const resolvedAt = '2026-01-15T18:00:00.000Z';
    const transitionedAt = '2026-01-15T18:00:00.000Z';

    db.updateState(finding.id, 'RESOLVED', transitionedAt, resolvedAt);

    const retrieved = db.getFinding(finding.id);
    expect(retrieved!.state).toBe('RESOLVED');
    expect(retrieved!.resolvedAt).toBe(resolvedAt);
    expect(retrieved!.lastTransitionAt).toBe(transitionedAt);
  });

  // 14. getFinding returns null for nonexistent ID
  it('getFinding returns null for nonexistent ID', () => {
    expect(db.getFinding('nonexistent')).toBeNull();
  });

  // 15. queryFindings with no filter returns all ordered by risk_score DESC
  it('queryFindings with no filter returns all ordered by risk_score DESC', () => {
    db.insertFinding(makeFinding({ riskScore: 30 }));
    db.insertFinding(makeFinding({ riskScore: 90 }));
    db.insertFinding(makeFinding({ riskScore: 60 }));

    const all = db.queryFindings();
    expect(all).toHaveLength(3);
    expect(all[0]!.riskScore).toBe(90);
    expect(all[1]!.riskScore).toBe(60);
    expect(all[2]!.riskScore).toBe(30);
  });

  // 16. Transition evidence field is optional
  it('transition with undefined evidence stores null and returns undefined', () => {
    const finding = makeFinding();
    db.insertFinding(finding);

    db.insertTransition({
      findingId: finding.id,
      fromState: 'DETECTED',
      toState: 'INVESTIGATING',
      transitionedAt: new Date().toISOString(),
      transitionedBy: 'analyst',
      notes: 'No evidence attached',
    });

    const transitions = db.getTransitions(finding.id);
    expect(transitions).toHaveLength(1);
    expect(transitions[0]!.evidence).toBeUndefined();
  });

  // 17. getStats on empty DB returns zeros
  it('getStats on empty DB returns zeros', () => {
    const stats = db.getStats();
    expect(stats.total).toBe(0);
    expect(stats.byState).toEqual({});
    expect(stats.bySource).toEqual({});
    expect(stats.bySeverity).toEqual({});
  });
});
