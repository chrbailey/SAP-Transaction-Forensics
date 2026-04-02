/**
 * Tests for Temporal Comparators
 *
 * Covers DateConflictComparator, TemporalImpossibilityComparator, and
 * the parseFlexibleDate helper across SAP, ISO, and European date formats.
 */

import { describe, it, expect } from '@jest/globals';

import {
  DateConflictComparator,
  TemporalImpossibilityComparator,
  parseFlexibleDate,
} from '../contradiction/comparators/temporal.js';

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

type SystemType = 'SAP' | 'NetSuite' | 'Salesforce';

interface PairSide {
  system: SystemType;
  table: string;
  recordId: string;
  fields: Record<string, string>;
  extractionId: string;
}

function makePair(left: Partial<PairSide>, right: Partial<PairSide>) {
  return {
    left: {
      system: 'SAP' as SystemType,
      table: 'VBAK',
      recordId: 'SAP-001',
      fields: {},
      extractionId: 'ext-left',
      ...left,
    },
    right: {
      system: 'Salesforce' as SystemType,
      table: 'Opportunity',
      recordId: 'SFDC-001',
      fields: {},
      extractionId: 'ext-right',
      ...right,
    },
  };
}

const DEFAULT_CONFIG = {
  amountDivergencePercent: 5,
  amountDivergenceMinAbsolute: 100,
  dateConflictDays: 7,
  dateConflictHighDays: 60,
  approvalThreshold: 0.8,
  stalePeriodDays: 90,
  retroactiveDays: 30,
};

// ---------------------------------------------------------------------------
// DateConflictComparator
// ---------------------------------------------------------------------------

describe('DateConflictComparator', () => {
  const comparator = new DateConflictComparator();

  it('has type DATE_CONFLICT', () => {
    expect(comparator.type).toBe('DATE_CONFLICT');
  });

  // 1. detects 45-day gap between SAP ERDAT and SFDC CloseDate
  it('detects 45-day gap between SAP ERDAT and SFDC CloseDate', () => {
    const pair = makePair(
      { fields: { ERDAT: '2025-01-15' } },
      { fields: { CloseDate: '2025-03-01' } }
    );
    const finding = comparator.compare(pair, DEFAULT_CONFIG);

    expect(finding).not.toBeNull();
    expect(finding!.type).toBe('DATE_CONFLICT');
    expect(finding!.scoringDetails['gapDays']).toBeGreaterThanOrEqual(44);
    expect(finding!.scoringDetails['gapDays']).toBeLessThanOrEqual(46);
  });

  // 2. returns null for dates within threshold
  it('returns null for dates within threshold', () => {
    const pair = makePair(
      { fields: { ERDAT: '2025-01-15' } },
      { fields: { CloseDate: '2025-01-18' } }
    );
    const finding = comparator.compare(pair, DEFAULT_CONFIG);
    expect(finding).toBeNull();
  });

  // 3. HIGH severity for >60-day gap
  it('assigns HIGH severity for >60-day gap', () => {
    const pair = makePair(
      { fields: { ERDAT: '2025-01-01' } },
      { fields: { CloseDate: '2025-04-01' } }
    );
    const finding = comparator.compare(pair, DEFAULT_CONFIG);

    expect(finding).not.toBeNull();
    expect(finding!.severity).toBe('HIGH');
  });

  // 4. MEDIUM for 30-60 day gap
  it('assigns MEDIUM severity for 30-60 day gap', () => {
    const pair = makePair(
      { fields: { ERDAT: '2025-01-01' } },
      { fields: { CloseDate: '2025-02-15' } }
    );
    const finding = comparator.compare(pair, DEFAULT_CONFIG);

    expect(finding).not.toBeNull();
    expect(finding!.severity).toBe('MEDIUM');
  });

  // 5. handles SAP YYYYMMDD format
  it('handles SAP YYYYMMDD format', () => {
    const pair = makePair(
      { fields: { ERDAT: '20250115' } },
      { fields: { CloseDate: '2025-03-01' } }
    );
    const finding = comparator.compare(pair, DEFAULT_CONFIG);

    expect(finding).not.toBeNull();
    expect(finding!.scoringDetails['gapDays']).toBeGreaterThanOrEqual(44);
  });

  // 6. handles DD.MM.YYYY format
  it('handles DD.MM.YYYY format', () => {
    const pair = makePair(
      { fields: { ERDAT: '15.01.2025' } },
      { fields: { CloseDate: '2025-03-01' } }
    );
    const finding = comparator.compare(pair, DEFAULT_CONFIG);

    expect(finding).not.toBeNull();
    expect(finding!.scoringDetails['gapDays']).toBeGreaterThanOrEqual(44);
  });

  // 7. handles ISO format
  it('handles ISO format with time component', () => {
    const pair = makePair(
      { fields: { ERDAT: '2025-01-15T10:30:00Z' } },
      { fields: { CloseDate: '2025-03-01' } }
    );
    const finding = comparator.compare(pair, DEFAULT_CONFIG);

    expect(finding).not.toBeNull();
    expect(finding!.type).toBe('DATE_CONFLICT');
  });

  // 8. direction weight increases severity when SAP date is after SFDC
  it('direction weight bumps severity when SAP date is after SFDC date', () => {
    // 50-day gap, normally MEDIUM. But SAP is later, so direction weight = 1.5
    // effective gap = 50 * 1.5 = 75 > 60 → HIGH
    const pair = makePair(
      {
        system: 'SAP',
        fields: { ERDAT: '2025-03-01' },
      },
      {
        system: 'Salesforce',
        fields: { CloseDate: '2025-01-10' },
      }
    );
    const finding = comparator.compare(pair, DEFAULT_CONFIG);

    expect(finding).not.toBeNull();
    expect(finding!.scoringDetails['directionWeight']).toBe(1.5);
    expect(finding!.severity).toBe('HIGH');
  });
});

// ---------------------------------------------------------------------------
// TemporalImpossibilityComparator
// ---------------------------------------------------------------------------

describe('TemporalImpossibilityComparator', () => {
  const comparator = new TemporalImpossibilityComparator();

  it('has type TEMPORAL_IMPOSSIBILITY', () => {
    expect(comparator.type).toBe('TEMPORAL_IMPOSSIBILITY');
  });

  // 9. detects invoice before delivery
  it('detects invoice before delivery (FKDAT before LFDAT)', () => {
    const pair = makePair({ fields: { LFDAT: '2025-03-15', FKDAT: '2025-03-01' } }, { fields: {} });
    const finding = comparator.compare(pair, DEFAULT_CONFIG);

    expect(finding).not.toBeNull();
    expect(finding!.type).toBe('TEMPORAL_IMPOSSIBILITY');
    expect(finding!.description).toContain('delivery before invoice');
  });

  // 10. detects delivery before order
  it('detects delivery before order (LFDAT before ERDAT)', () => {
    const pair = makePair({ fields: { ERDAT: '2025-04-01', LFDAT: '2025-03-15' } }, { fields: {} });
    const finding = comparator.compare(pair, DEFAULT_CONFIG);

    expect(finding).not.toBeNull();
    expect(finding!.type).toBe('TEMPORAL_IMPOSSIBILITY');
    expect(finding!.description).toContain('order before delivery');
  });

  // 11. returns null for correct sequence
  it('returns null for correct temporal sequence', () => {
    const pair = makePair(
      { fields: { ERDAT: '2025-01-01', LFDAT: '2025-02-01', FKDAT: '2025-03-01' } },
      { fields: {} }
    );
    const finding = comparator.compare(pair, DEFAULT_CONFIG);
    expect(finding).toBeNull();
  });

  // 12. always CRITICAL severity
  it('always assigns CRITICAL severity', () => {
    const pair = makePair({ fields: { ERDAT: '2025-03-02', LFDAT: '2025-03-01' } }, { fields: {} });
    const finding = comparator.compare(pair, DEFAULT_CONFIG);

    expect(finding).not.toBeNull();
    expect(finding!.severity).toBe('CRITICAL');
  });

  // 13. high confidence (0.95)
  it('reports confidence 0.95', () => {
    const pair = makePair({ fields: { ERDAT: '2025-03-02', LFDAT: '2025-03-01' } }, { fields: {} });
    const finding = comparator.compare(pair, DEFAULT_CONFIG);

    expect(finding).not.toBeNull();
    expect(finding!.confidence).toBe(0.95);
  });

  // Cross-system: SFDC CreatedDate after CloseDate
  it('detects SFDC CloseDate before CreatedDate across systems', () => {
    const pair = makePair(
      { fields: {} },
      { fields: { CreatedDate: '2025-06-01', CloseDate: '2025-05-01' } }
    );
    const finding = comparator.compare(pair, DEFAULT_CONFIG);

    expect(finding).not.toBeNull();
    expect(finding!.description).toContain('create before close');
  });
});

// ---------------------------------------------------------------------------
// parseFlexibleDate
// ---------------------------------------------------------------------------

describe('parseFlexibleDate', () => {
  // 14. parses all 4 formats correctly
  it('parses YYYYMMDD (SAP internal)', () => {
    const d = parseFlexibleDate('20250315');
    expect(d).not.toBeNull();
    expect(d!.getUTCFullYear()).toBe(2025);
    expect(d!.getUTCMonth()).toBe(2); // March = 2
    expect(d!.getUTCDate()).toBe(15);
  });

  it('parses YYYY-MM-DD (ISO date)', () => {
    const d = parseFlexibleDate('2025-03-15');
    expect(d).not.toBeNull();
    expect(d!.getUTCFullYear()).toBe(2025);
    expect(d!.getUTCMonth()).toBe(2);
    expect(d!.getUTCDate()).toBe(15);
  });

  it('parses DD.MM.YYYY (SAP European display)', () => {
    const d = parseFlexibleDate('15.03.2025');
    expect(d).not.toBeNull();
    expect(d!.getUTCFullYear()).toBe(2025);
    expect(d!.getUTCMonth()).toBe(2);
    expect(d!.getUTCDate()).toBe(15);
  });

  it('parses full ISO 8601 with time', () => {
    const d = parseFlexibleDate('2025-03-15T14:30:00Z');
    expect(d).not.toBeNull();
    expect(d!.getUTCFullYear()).toBe(2025);
    expect(d!.getUTCMonth()).toBe(2);
    expect(d!.getUTCDate()).toBe(15);
    expect(d!.getUTCHours()).toBe(14);
    expect(d!.getUTCMinutes()).toBe(30);
  });

  // 15. returns null for invalid input
  it('returns null for empty string', () => {
    expect(parseFlexibleDate('')).toBeNull();
  });

  it('returns null for garbage text', () => {
    expect(parseFlexibleDate('not-a-date')).toBeNull();
  });

  it('returns null for partial date', () => {
    expect(parseFlexibleDate('2025-13-40')).toBeNull();
  });

  it('returns null for invalid YYYYMMDD', () => {
    expect(parseFlexibleDate('20251340')).toBeNull();
  });

  it('returns null for invalid DD.MM.YYYY', () => {
    expect(parseFlexibleDate('40.13.2025')).toBeNull();
  });
});
