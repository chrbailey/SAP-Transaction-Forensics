/**
 * Tests for ContradictionEngine
 *
 * Covers: registration, analysis, filtering, error resilience,
 * configuration updates, and edge cases (empty inputs).
 */

import { jest } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { ContradictionEngine } from '../contradiction/engine.js';
import type {
  Comparator,
  ComparisonPair,
  ContradictionConfig,
  ContradictionFinding,
  ContradictionType,
} from '../contradiction/engine.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makePair(
  leftFields: Record<string, string> = {},
  rightFields: Record<string, string> = {},
): ComparisonPair {
  return {
    left: {
      system: 'SAP',
      table: 'VBAK',
      recordId: 'L001',
      fields: leftFields,
      extractionId: 'ext-left-1',
    },
    right: {
      system: 'Salesforce',
      table: 'Opportunity',
      recordId: 'R001',
      fields: rightFields,
      extractionId: 'ext-right-1',
    },
  };
}

/** A comparator that always returns a finding. */
class AlwaysFindsComparator implements Comparator {
  readonly type: ContradictionType = 'AMOUNT_DIVERGENCE';

  compare(pair: ComparisonPair, _config: ContradictionConfig): ContradictionFinding {
    return {
      id: randomUUID(),
      type: this.type,
      severity: 'HIGH',
      confidence: 0.9,
      description: 'Always-finds mock finding',
      leftSystem: pair.left.system,
      leftTable: pair.left.table,
      leftRecordId: pair.left.recordId,
      leftField: 'NETWR',
      leftValue: '1000',
      leftExtractionId: pair.left.extractionId,
      rightSystem: pair.right.system,
      rightTable: pair.right.table,
      rightRecordId: pair.right.recordId,
      rightField: 'Amount',
      rightValue: '500',
      rightExtractionId: pair.right.extractionId,
      scoringDetails: { divergence: 0.5 },
      detectedAt: new Date().toISOString(),
      resolutionStatus: 'open',
      reviewerNotes: '',
    };
  }
}

/** A comparator that never returns a finding. */
class NeverFindsComparator implements Comparator {
  readonly type: ContradictionType = 'STATUS_INCOMPATIBLE';

  compare(_pair: ComparisonPair, _config: ContradictionConfig): null {
    return null;
  }
}

/** A comparator that always throws. */
class ThrowingComparator implements Comparator {
  readonly type: ContradictionType = 'DATE_CONFLICT';

  compare(_pair: ComparisonPair, _config: ContradictionConfig): ContradictionFinding | null {
    throw new Error('Simulated comparator failure');
  }
}

/** A second always-finds comparator with a different type and lower severity. */
class SecondFindsComparator implements Comparator {
  readonly type: ContradictionType = 'ENTITY_MISMATCH';

  compare(pair: ComparisonPair, _config: ContradictionConfig): ContradictionFinding {
    return {
      id: randomUUID(),
      type: this.type,
      severity: 'LOW',
      confidence: 0.6,
      description: 'Second mock finding',
      leftSystem: pair.left.system,
      leftTable: pair.left.table,
      leftRecordId: pair.left.recordId,
      leftField: 'CustomerName',
      leftValue: 'Acme Corp',
      leftExtractionId: pair.left.extractionId,
      rightSystem: pair.right.system,
      rightTable: pair.right.table,
      rightRecordId: pair.right.recordId,
      rightField: 'AccountName',
      rightValue: 'ACME Corporation',
      rightExtractionId: pair.right.extractionId,
      scoringDetails: { similarity: 0.85 },
      detectedAt: new Date().toISOString(),
      resolutionStatus: 'open',
      reviewerNotes: '',
    };
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ContradictionEngine', () => {
  // -----------------------------------------------------------------------
  // Registration
  // -----------------------------------------------------------------------

  it('registerComparator adds a comparator', () => {
    const engine = new ContradictionEngine();
    engine.registerComparator(new AlwaysFindsComparator());

    expect(engine.getRegisteredTypes()).toEqual(['AMOUNT_DIVERGENCE']);
  });

  it('registerAll adds multiple comparators', () => {
    const engine = new ContradictionEngine();
    engine.registerAll([
      new AlwaysFindsComparator(),
      new NeverFindsComparator(),
      new ThrowingComparator(),
    ]);

    expect(engine.getRegisteredTypes()).toEqual([
      'AMOUNT_DIVERGENCE',
      'STATUS_INCOMPATIBLE',
      'DATE_CONFLICT',
    ]);
  });

  it('getRegisteredTypes returns correct list', () => {
    const engine = new ContradictionEngine();
    engine.registerComparator(new NeverFindsComparator());
    engine.registerComparator(new SecondFindsComparator());

    expect(engine.getRegisteredTypes()).toEqual([
      'STATUS_INCOMPATIBLE',
      'ENTITY_MISMATCH',
    ]);
  });

  // -----------------------------------------------------------------------
  // analyzePair
  // -----------------------------------------------------------------------

  it('analyzePair runs all comparators on one pair', () => {
    const engine = new ContradictionEngine();
    engine.registerAll([
      new AlwaysFindsComparator(),
      new NeverFindsComparator(),
    ]);

    const findings = engine.analyzePair(makePair());

    // AlwaysFinds produces 1 finding, NeverFinds produces 0
    expect(findings).toHaveLength(1);
    expect(findings[0]!.type).toBe('AMOUNT_DIVERGENCE');
  });

  it('analyzePair collects findings from multiple comparators', () => {
    const engine = new ContradictionEngine();
    engine.registerAll([
      new AlwaysFindsComparator(),
      new SecondFindsComparator(),
    ]);

    const findings = engine.analyzePair(makePair());

    expect(findings).toHaveLength(2);
    const types = findings.map((f) => f.type);
    expect(types).toContain('AMOUNT_DIVERGENCE');
    expect(types).toContain('ENTITY_MISMATCH');
  });

  // -----------------------------------------------------------------------
  // analyzeAll
  // -----------------------------------------------------------------------

  it('analyzeAll runs on multiple pairs', () => {
    const engine = new ContradictionEngine();
    engine.registerComparator(new AlwaysFindsComparator());

    const pairs = [makePair(), makePair(), makePair()];
    const result = engine.analyzeAll(pairs);

    // 1 comparator × 3 pairs = 3 findings
    expect(result.contradictions).toHaveLength(3);
  });

  it('analyzeAll returns correct recordsCompared count', () => {
    const engine = new ContradictionEngine();
    engine.registerComparator(new NeverFindsComparator());

    const pairs = [makePair(), makePair()];
    const result = engine.analyzeAll(pairs);

    expect(result.recordsCompared).toBe(2);
  });

  it('analyzeAll returns correct comparisonsRun count (pairs x comparators)', () => {
    const engine = new ContradictionEngine();
    engine.registerAll([
      new AlwaysFindsComparator(),
      new NeverFindsComparator(),
      new SecondFindsComparator(),
    ]);

    const pairs = [makePair(), makePair(), makePair(), makePair()];
    const result = engine.analyzeAll(pairs);

    // 3 comparators × 4 pairs = 12
    expect(result.comparisonsRun).toBe(12);
  });

  it('analyzeAll includes duration', () => {
    const engine = new ContradictionEngine();
    engine.registerComparator(new AlwaysFindsComparator());

    const result = engine.analyzeAll([makePair()]);

    expect(typeof result.duration).toBe('number');
    expect(result.duration).toBeGreaterThanOrEqual(0);
  });

  // -----------------------------------------------------------------------
  // analyzeWithTypes
  // -----------------------------------------------------------------------

  it('analyzeWithTypes filters by type', () => {
    const engine = new ContradictionEngine();
    engine.registerAll([
      new AlwaysFindsComparator(),   // AMOUNT_DIVERGENCE
      new NeverFindsComparator(),    // STATUS_INCOMPATIBLE
      new SecondFindsComparator(),   // ENTITY_MISMATCH
    ]);

    const pairs = [makePair()];
    const result = engine.analyzeWithTypes(pairs, ['ENTITY_MISMATCH']);

    // Only SecondFindsComparator should run
    expect(result.contradictions).toHaveLength(1);
    expect(result.contradictions[0]!.type).toBe('ENTITY_MISMATCH');
    // Only 1 comparator × 1 pair = 1
    expect(result.comparisonsRun).toBe(1);
  });

  // -----------------------------------------------------------------------
  // Error resilience
  // -----------------------------------------------------------------------

  it('a throwing comparator does not crash the engine', () => {
    const engine = new ContradictionEngine();
    engine.registerAll([
      new ThrowingComparator(),
      new AlwaysFindsComparator(),
    ]);

    // Suppress console.error for this test
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const result = engine.analyzeAll([makePair()]);

    // ThrowingComparator fails, AlwaysFindsComparator succeeds
    expect(result.contradictions).toHaveLength(1);
    expect(result.contradictions[0]!.type).toBe('AMOUNT_DIVERGENCE');
    expect(result.comparisonsRun).toBe(2);

    // The error should be captured in the result
    expect(result.errors).toBeDefined();
    expect(result.errors).toHaveLength(1);
    expect(result.errors![0]!.comparatorType).toBe('DATE_CONFLICT');
    expect(result.errors![0]!.error).toBe('Simulated comparator failure');

    spy.mockRestore();
  });

  // -----------------------------------------------------------------------
  // Configuration
  // -----------------------------------------------------------------------

  it('updateConfig changes thresholds', () => {
    const engine = new ContradictionEngine();

    // Default approvalThreshold is 10_000
    engine.updateConfig({ approvalThreshold: 50_000 });

    // Verify via a comparator that reads the config
    let receivedConfig: ContradictionConfig | undefined;
    const spy: Comparator = {
      type: 'APPROVAL_BYPASS',
      compare(_pair: ComparisonPair, config: ContradictionConfig) {
        receivedConfig = config;
        return null;
      },
    };
    engine.registerComparator(spy);
    engine.analyzePair(makePair());

    expect(receivedConfig).toBeDefined();
    expect(receivedConfig!.approvalThreshold).toBe(50_000);
    // Other defaults should still be in place
    expect(receivedConfig!.amountDivergencePercent).toBe(0.05);
  });

  // -----------------------------------------------------------------------
  // Edge cases
  // -----------------------------------------------------------------------

  it('empty pairs returns zero contradictions', () => {
    const engine = new ContradictionEngine();
    engine.registerComparator(new AlwaysFindsComparator());

    const result = engine.analyzeAll([]);

    expect(result.contradictions).toHaveLength(0);
    expect(result.recordsCompared).toBe(0);
    expect(result.comparisonsRun).toBe(0);
  });

  it('empty comparators returns zero contradictions', () => {
    const engine = new ContradictionEngine();

    const result = engine.analyzeAll([makePair(), makePair()]);

    expect(result.contradictions).toHaveLength(0);
    expect(result.recordsCompared).toBe(2);
    expect(result.comparisonsRun).toBe(0);
  });
});
