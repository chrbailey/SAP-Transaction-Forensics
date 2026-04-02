/**
 * Tests for ContradictionDB — SQLite persistence layer.
 *
 * Covers: insert/get round-trip, batch transactionality, query filters,
 * lifecycle resolution, deduplication, stats, schema validations, and
 * table creation.
 */

import { randomUUID } from 'node:crypto';
import { ContradictionDB } from '../contradiction/persistence.js';
import type { ContradictionFinding } from '../contradiction/types.js';
import Database from 'better-sqlite3';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeFinding(overrides?: Partial<ContradictionFinding>): ContradictionFinding {
  return {
    id: randomUUID(),
    type: 'AMOUNT_DIVERGENCE',
    severity: 'HIGH',
    confidence: 0.9,
    description: 'SAP amount diverges from Salesforce by 15%',
    leftSystem: 'SAP',
    leftTable: 'VBAK',
    leftRecordId: 'SAP-001',
    leftField: 'NETWR',
    leftValue: '10000',
    leftExtractionId: 'ext-left-1',
    rightSystem: 'Salesforce',
    rightTable: 'Opportunity',
    rightRecordId: 'SF-001',
    rightField: 'Amount',
    rightValue: '8500',
    rightExtractionId: 'ext-right-1',
    scoringDetails: { percentDivergence: 0.15, absoluteAmount: 1500 },
    detectedAt: new Date().toISOString(),
    resolutionStatus: 'open',
    reviewerNotes: '',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ContradictionDB', () => {
  let db: ContradictionDB;

  beforeEach(() => {
    db = new ContradictionDB(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  // 1. Insert + get finding round-trip
  it('insert + get finding round-trip', () => {
    const finding = makeFinding();
    db.insertFinding(finding, 67.5);

    const retrieved = db.getFinding(finding.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.id).toBe(finding.id);
    expect(retrieved!.type).toBe('AMOUNT_DIVERGENCE');
    expect(retrieved!.severity).toBe('HIGH');
    expect(retrieved!.confidence).toBe(0.9);
    expect(retrieved!.description).toBe('SAP amount diverges from Salesforce by 15%');
    expect(retrieved!.leftSystem).toBe('SAP');
    expect(retrieved!.leftTable).toBe('VBAK');
    expect(retrieved!.leftRecordId).toBe('SAP-001');
    expect(retrieved!.leftField).toBe('NETWR');
    expect(retrieved!.leftValue).toBe('10000');
    expect(retrieved!.rightSystem).toBe('Salesforce');
    expect(retrieved!.rightTable).toBe('Opportunity');
    expect(retrieved!.rightRecordId).toBe('SF-001');
    expect(retrieved!.rightField).toBe('Amount');
    expect(retrieved!.rightValue).toBe('8500');
    expect(retrieved!.scoringDetails).toEqual({ percentDivergence: 0.15, absoluteAmount: 1500 });
    expect(retrieved!.resolutionStatus).toBe('open');
    expect(retrieved!.reviewerNotes).toBe('');
  });

  // 2. insertBatch is transactional
  it('insertBatch is transactional — all or nothing', () => {
    const f1 = makeFinding();
    const f2 = makeFinding();
    // f3 has a duplicate ID of f1 — should cause UNIQUE constraint failure
    const f3 = makeFinding({ id: f1.id });

    const scores = new Map<string, number>();
    scores.set(f1.id, 50);
    scores.set(f2.id, 60);

    expect(() => db.insertBatch([f1, f2, f3], scores)).toThrow();

    // Transaction should have rolled back — nothing persisted
    expect(db.getFinding(f1.id)).toBeNull();
    expect(db.getFinding(f2.id)).toBeNull();
  });

  // 3. queryFindings with no filter returns all
  it('queryFindings with no filter returns all', () => {
    const f1 = makeFinding();
    const f2 = makeFinding({ type: 'STATUS_INCOMPATIBLE', severity: 'CRITICAL' });
    db.insertFinding(f1, 67.5);
    db.insertFinding(f2, 85.0);

    const results = db.queryFindings();
    expect(results).toHaveLength(2);
  });

  // 4. queryFindings filters by type
  it('queryFindings filters by type', () => {
    db.insertFinding(makeFinding({ type: 'AMOUNT_DIVERGENCE' }), 50);
    db.insertFinding(makeFinding({ type: 'STATUS_INCOMPATIBLE' }), 60);
    db.insertFinding(makeFinding({ type: 'AMOUNT_DIVERGENCE' }), 70);

    const results = db.queryFindings({ type: 'AMOUNT_DIVERGENCE' });
    expect(results).toHaveLength(2);
    for (const r of results) {
      expect(r.type).toBe('AMOUNT_DIVERGENCE');
    }
  });

  // 5. queryFindings filters by severity
  it('queryFindings filters by severity', () => {
    db.insertFinding(makeFinding({ severity: 'HIGH' }), 50);
    db.insertFinding(makeFinding({ severity: 'CRITICAL' }), 90);
    db.insertFinding(makeFinding({ severity: 'LOW' }), 20);

    const results = db.queryFindings({ severity: 'CRITICAL' });
    expect(results).toHaveLength(1);
    expect(results[0]!.severity).toBe('CRITICAL');
  });

  // 6. queryFindings filters by minRiskScore
  it('queryFindings filters by minRiskScore', () => {
    db.insertFinding(makeFinding(), 30);
    db.insertFinding(makeFinding(), 60);
    db.insertFinding(makeFinding(), 90);

    const results = db.queryFindings({ minRiskScore: 55 });
    expect(results).toHaveLength(2);
  });

  // 7. resolveFinding updates status and metadata
  it('resolveFinding updates status and metadata', () => {
    const finding = makeFinding();
    db.insertFinding(finding, 67.5);

    db.resolveFinding(
      finding.id,
      'explained',
      'auditor@example.com',
      'Currency conversion difference'
    );

    const resolved = db.getFinding(finding.id);
    expect(resolved).not.toBeNull();
    expect(resolved!.resolutionStatus).toBe('explained');
    expect(resolved!.reviewerNotes).toBe('Currency conversion difference');
  });

  // 8. isDuplicate returns true for same type + left/right records
  it('isDuplicate returns true for same type + left/right records', () => {
    const finding = makeFinding({
      leftSystem: 'SAP',
      leftTable: 'VBAK',
      leftRecordId: 'SAP-100',
      rightSystem: 'Salesforce',
      rightTable: 'Opportunity',
      rightRecordId: 'SF-100',
      type: 'AMOUNT_DIVERGENCE',
    });
    db.insertFinding(finding, 50);

    const duplicate = makeFinding({
      id: randomUUID(), // different ID
      leftSystem: 'SAP',
      leftTable: 'VBAK',
      leftRecordId: 'SAP-100',
      rightSystem: 'Salesforce',
      rightTable: 'Opportunity',
      rightRecordId: 'SF-100',
      type: 'AMOUNT_DIVERGENCE',
    });

    expect(db.isDuplicate(duplicate)).toBe(true);
  });

  // 9. isDuplicate returns false for different records
  it('isDuplicate returns false for different records', () => {
    const finding = makeFinding({
      leftRecordId: 'SAP-100',
      rightRecordId: 'SF-100',
    });
    db.insertFinding(finding, 50);

    const different = makeFinding({
      leftRecordId: 'SAP-200',
      rightRecordId: 'SF-200',
    });

    expect(db.isDuplicate(different)).toBe(false);
  });

  // 10. getStats returns correct counts
  it('getStats returns correct counts', () => {
    // 2 open HIGH AMOUNT_DIVERGENCE, 1 confirmed CRITICAL STATUS_INCOMPATIBLE
    db.insertFinding(makeFinding({ severity: 'HIGH', type: 'AMOUNT_DIVERGENCE' }), 50);
    db.insertFinding(makeFinding({ severity: 'HIGH', type: 'AMOUNT_DIVERGENCE' }), 60);

    const critical = makeFinding({ severity: 'CRITICAL', type: 'STATUS_INCOMPATIBLE' });
    db.insertFinding(critical, 90);
    db.resolveFinding(critical.id, 'confirmed', 'auditor', 'Verified');

    const stats = db.getStats();
    expect(stats.total).toBe(3);
    expect(stats.open).toBe(2);
    expect(stats.confirmed).toBe(1);
    expect(stats.explained).toBe(0);
    expect(stats.falsePositive).toBe(0);
    expect(stats.bySeverity).toEqual({ HIGH: 2, CRITICAL: 1 });
    expect(stats.byType).toEqual({ AMOUNT_DIVERGENCE: 2, STATUS_INCOMPATIBLE: 1 });
  });

  // 11. Schema validation insert + query round-trip
  it('schema validation insert + query round-trip', () => {
    db.insertSchemaValidation('client-abc', 'path-o2c', true, [], ['Field BSTNK is optional']);
    db.insertSchemaValidation(
      'client-abc',
      'path-p2p',
      false,
      ['Missing required field EBELN'],
      []
    );

    const validations = db.getSchemaValidations('client-abc');
    expect(validations).toHaveLength(2);

    // Ordered by validated_at DESC — p2p inserted second, so first
    const p2p = validations.find(v => v.pathId === 'path-p2p');
    expect(p2p).toBeDefined();
    expect(p2p!.valid).toBe(false);
    expect(p2p!.errors).toEqual(['Missing required field EBELN']);
    expect(p2p!.warnings).toEqual([]);

    const o2c = validations.find(v => v.pathId === 'path-o2c');
    expect(o2c).toBeDefined();
    expect(o2c!.valid).toBe(true);
    expect(o2c!.errors).toEqual([]);
    expect(o2c!.warnings).toEqual(['Field BSTNK is optional']);
  });

  // 12. DB creation creates both tables
  it('DB creation creates both tables', () => {
    const freshDb = new ContradictionDB(':memory:');

    // Verify both tables are queryable by inserting into each
    freshDb.insertFinding(makeFinding(), 50);
    freshDb.insertSchemaValidation('test', 'path', true, [], []);

    const findings = freshDb.queryFindings();
    expect(findings).toHaveLength(1);

    const validations = freshDb.getSchemaValidations('test');
    expect(validations).toHaveLength(1);

    freshDb.close();
  });

  // Additional: getFinding returns null for missing ID
  it('getFinding returns null for nonexistent ID', () => {
    expect(db.getFinding('nonexistent')).toBeNull();
  });

  // Additional: queryFindings filters by status
  it('queryFindings filters by status', () => {
    const f1 = makeFinding();
    const f2 = makeFinding();
    db.insertFinding(f1, 50);
    db.insertFinding(f2, 60);
    db.resolveFinding(f1.id, 'false_positive', 'admin', 'Test data');

    const openResults = db.queryFindings({ status: 'open' });
    expect(openResults).toHaveLength(1);
    expect(openResults[0]!.id).toBe(f2.id);

    const fpResults = db.queryFindings({ status: 'false_positive' });
    expect(fpResults).toHaveLength(1);
    expect(fpResults[0]!.id).toBe(f1.id);
  });

  // Additional: queryFindings filters by leftSystem / rightSystem
  it('queryFindings filters by leftSystem and rightSystem', () => {
    db.insertFinding(makeFinding({ leftSystem: 'SAP', rightSystem: 'Salesforce' }), 50);
    db.insertFinding(makeFinding({ leftSystem: 'SAP', rightSystem: 'NetSuite' }), 60);
    db.insertFinding(makeFinding({ leftSystem: 'NetSuite', rightSystem: 'Salesforce' }), 70);

    expect(db.queryFindings({ leftSystem: 'SAP' })).toHaveLength(2);
    expect(db.queryFindings({ rightSystem: 'Salesforce' })).toHaveLength(2);
    expect(db.queryFindings({ leftSystem: 'SAP', rightSystem: 'NetSuite' })).toHaveLength(1);
  });

  // Additional: insertBatch persists all on success
  it('insertBatch persists all findings on success', () => {
    const findings = [makeFinding(), makeFinding(), makeFinding()];
    const scores = new Map<string, number>();
    for (const f of findings) {
      scores.set(f.id, 55);
    }

    db.insertBatch(findings, scores);

    const results = db.queryFindings();
    expect(results).toHaveLength(3);
  });
});
