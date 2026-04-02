/**
 * Tests for Amount and Quantity Divergence Comparators
 *
 * Covers: field detection, European number parsing, severity scoring,
 * threshold filtering, scoring details, and structural correctness.
 */

import {
  AmountDivergenceComparator,
  QuantityDivergenceComparator,
  parseNumericValue,
} from '../contradiction/comparators/amount.js';
import type {
  ComparisonPair,
  ContradictionConfig,
  ContradictionFinding,
} from '../contradiction/comparators/amount.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

function defaultConfig(overrides: Partial<ContradictionConfig> = {}): ContradictionConfig {
  return {
    amountDivergencePercent: 0.05,
    amountDivergenceMinAbsolute: 10,
    dateConflictDays: 7,
    dateConflictHighDays: 30,
    approvalThreshold: 0.8,
    stalePeriodDays: 90,
    retroactiveDays: 14,
    ...overrides,
  };
}

function makePair(
  leftFields: Record<string, string>,
  rightFields: Record<string, string>,
  opts: {
    leftSystem?: 'SAP' | 'NetSuite' | 'Salesforce';
    rightSystem?: 'SAP' | 'NetSuite' | 'Salesforce';
    leftTable?: string;
    rightTable?: string;
  } = {}
): ComparisonPair {
  return {
    left: {
      system: opts.leftSystem ?? 'SAP',
      table: opts.leftTable ?? 'VBAK',
      recordId: 'L001',
      fields: leftFields,
      extractionId: 'ext-left-1',
    },
    right: {
      system: opts.rightSystem ?? 'Salesforce',
      table: opts.rightTable ?? 'Opportunity',
      recordId: 'R001',
      fields: rightFields,
      extractionId: 'ext-right-1',
    },
  };
}

// ---------------------------------------------------------------------------
// AmountDivergenceComparator
// ---------------------------------------------------------------------------

describe('AmountDivergenceComparator', () => {
  const comparator = new AmountDivergenceComparator();

  it('detects 15% divergence between SAP NETWR and SFDC Amount', () => {
    const pair = makePair({ NETWR: '1000.00' }, { Amount: '850.00' });
    const finding = comparator.compare(pair, defaultConfig());

    expect(finding).not.toBeNull();
    expect(finding!.type).toBe('AMOUNT_DIVERGENCE');
    expect(finding!.severity).toBe('HIGH');
    expect(finding!.leftField).toBe('NETWR');
    expect(finding!.rightField).toBe('Amount');
  });

  it('returns null when amounts match within threshold', () => {
    // 2% divergence, below 5% threshold
    const pair = makePair({ NETWR: '1000.00' }, { Amount: '980.00' });
    const finding = comparator.compare(pair, defaultConfig());

    expect(finding).toBeNull();
  });

  it('handles European format (1.234,56)', () => {
    // European 1.234,56 = 1234.56 vs standard 1050.00  → ~15% divergence
    const pair = makePair({ NETWR: '1.234,56' }, { Amount: '1050.00' });
    const finding = comparator.compare(pair, defaultConfig());

    expect(finding).not.toBeNull();
    expect(finding!.scoringDetails['leftAmount']).toBeCloseTo(1234.56, 2);
  });

  it('severity is CRITICAL for >20% divergence', () => {
    // 50% divergence
    const pair = makePair({ NETWR: '1000.00' }, { Amount: '500.00' });
    const finding = comparator.compare(pair, defaultConfig());

    expect(finding).not.toBeNull();
    expect(finding!.severity).toBe('CRITICAL');
  });

  it('severity is HIGH for 10-20% divergence', () => {
    // ~15% divergence
    const pair = makePair({ NETWR: '1000.00' }, { Amount: '850.00' });
    const finding = comparator.compare(pair, defaultConfig());

    expect(finding).not.toBeNull();
    expect(finding!.severity).toBe('HIGH');
  });

  it('severity is MEDIUM for 5-10% divergence', () => {
    // ~8% divergence: |1000-920|/1000 = 0.08
    const pair = makePair({ NETWR: '1000.00' }, { Amount: '920.00' });
    const finding = comparator.compare(pair, defaultConfig());

    expect(finding).not.toBeNull();
    expect(finding!.severity).toBe('MEDIUM');
  });

  it('respects minimum absolute threshold (ignores tiny amounts)', () => {
    // 10% divergence but only $0.50 absolute → below $10 min
    const pair = makePair({ NETWR: '5.00' }, { Amount: '4.50' });
    const finding = comparator.compare(pair, defaultConfig());

    expect(finding).toBeNull();
  });

  it('scoringDetails contains all 4 metrics', () => {
    const pair = makePair({ NETWR: '1000.00' }, { Amount: '800.00' });
    const finding = comparator.compare(pair, defaultConfig());

    expect(finding).not.toBeNull();
    const d = finding!.scoringDetails;
    expect(d).toHaveProperty('percentDivergence');
    expect(d).toHaveProperty('absoluteDivergence');
    expect(d).toHaveProperty('leftAmount');
    expect(d).toHaveProperty('rightAmount');
    expect(d['percentDivergence']).toBeCloseTo(0.2, 2);
    expect(d['absoluteDivergence']).toBeCloseTo(200, 2);
    expect(d['leftAmount']).toBe(1000);
    expect(d['rightAmount']).toBe(800);
  });

  it('auto-detects amount fields by name', () => {
    // DMBTR and a custom "unit_price" field
    const pair = makePair({ DMBTR: '500.00' }, { unit_price: '400.00' });
    const finding = comparator.compare(pair, defaultConfig());

    expect(finding).not.toBeNull();
    expect(finding!.leftField).toBe('DMBTR');
    expect(finding!.rightField).toBe('unit_price');
  });
});

// ---------------------------------------------------------------------------
// QuantityDivergenceComparator
// ---------------------------------------------------------------------------

describe('QuantityDivergenceComparator', () => {
  const comparator = new QuantityDivergenceComparator();

  it('detects ordered vs delivered mismatch', () => {
    // KWMENG (ordered) 100, LFIMG (delivered) 70 → 30% divergence
    const pair = makePair(
      { KWMENG: '100' },
      { LFIMG: '70' },
      {
        leftSystem: 'SAP',
        rightSystem: 'SAP',
        leftTable: 'VBAP',
        rightTable: 'LIPS',
      }
    );
    const finding = comparator.compare(pair, defaultConfig());

    expect(finding).not.toBeNull();
    expect(finding!.type).toBe('QUANTITY_DIVERGENCE');
    expect(finding!.severity).toBe('HIGH');
  });

  it('CRITICAL for >50% divergence', () => {
    // 80% divergence
    const pair = makePair(
      { KWMENG: '100' },
      { LFIMG: '20' },
      {
        leftSystem: 'SAP',
        rightSystem: 'SAP',
      }
    );
    const finding = comparator.compare(pair, defaultConfig());

    expect(finding).not.toBeNull();
    expect(finding!.severity).toBe('CRITICAL');
  });

  it('returns null for matching quantities', () => {
    const pair = makePair(
      { KWMENG: '100' },
      { LFIMG: '98' },
      {
        leftSystem: 'SAP',
        rightSystem: 'SAP',
      }
    );
    const finding = comparator.compare(pair, defaultConfig());

    expect(finding).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Structural correctness (both comparators)
// ---------------------------------------------------------------------------

describe('Finding structure', () => {
  const amtCmp = new AmountDivergenceComparator();
  const qtyCmp = new QuantityDivergenceComparator();

  it('finding has valid UUID id and ISO timestamp', () => {
    const pair = makePair({ NETWR: '1000' }, { Amount: '700' });
    const finding = amtCmp.compare(pair, defaultConfig())!;

    expect(finding.id).toMatch(UUID_RE);
    expect(finding.detectedAt).toMatch(ISO_RE);

    const qPair = makePair(
      { KWMENG: '100' },
      { LFIMG: '50' },
      {
        leftSystem: 'SAP',
        rightSystem: 'SAP',
      }
    );
    const qFinding = qtyCmp.compare(qPair, defaultConfig())!;

    expect(qFinding.id).toMatch(UUID_RE);
    expect(qFinding.detectedAt).toMatch(ISO_RE);
  });

  it('finding has correct left/right system and table info', () => {
    const pair = makePair(
      { NETWR: '2000' },
      { Amount: '1500' },
      { leftSystem: 'SAP', rightSystem: 'Salesforce', leftTable: 'VBAK', rightTable: 'Opportunity' }
    );
    const finding = amtCmp.compare(pair, defaultConfig())!;

    expect(finding.leftSystem).toBe('SAP');
    expect(finding.rightSystem).toBe('Salesforce');
    expect(finding.leftTable).toBe('VBAK');
    expect(finding.rightTable).toBe('Opportunity');
    expect(finding.leftRecordId).toBe('L001');
    expect(finding.rightRecordId).toBe('R001');
    expect(finding.leftExtractionId).toBe('ext-left-1');
    expect(finding.rightExtractionId).toBe('ext-right-1');
    expect(finding.resolutionStatus).toBe('open');
    expect(finding.reviewerNotes).toBe('');
  });
});
