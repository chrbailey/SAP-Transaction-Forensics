/**
 * Tests for Entity, Reference, and Orphan Comparators
 *
 * Covers: entity mismatch detection (name similarity, currency),
 * duplicate cross-references, and orphan record detection with
 * severity scaling.
 */

import {
  EntityMismatchComparator,
  DuplicateReferenceComparator,
  OrphanRecordComparator,
  levenshteinSimilarity,
} from '../contradiction/comparators/entity.js';
import type {
  ContradictionConfig,
  MatchedEntityPair,
  MatchedEntityPairSet,
  OrphanCheckInput,
} from '../contradiction/comparators/entity.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

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

function makeMatchedPair(overrides: Partial<MatchedEntityPair> = {}): MatchedEntityPair {
  return {
    left: {
      system: 'SAP',
      table: 'VBAK',
      recordId: 'SAP-001',
      fields: {
        NAME1: 'Acme Corporation',
        WAERK: 'USD',
        NETWR: '50000',
      },
      extractionId: 'ext-sap-1',
    },
    right: {
      system: 'Salesforce',
      table: 'Opportunity',
      recordId: 'OPP-001',
      fields: {
        AccountName: 'Acme Corp',
        CurrencyIsoCode: 'USD',
        Amount: '50000',
      },
      extractionId: 'ext-sfdc-1',
    },
    matchConfidence: 0.72,
    matchStrategy: 'proximity',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// levenshteinSimilarity
// ---------------------------------------------------------------------------

describe('levenshteinSimilarity', () => {
  it('"kitten" vs "sitting" ≈ 0.57', () => {
    const sim = levenshteinSimilarity('kitten', 'sitting');
    expect(sim).toBeCloseTo(0.571, 2);
  });

  it('both empty strings = 1.0', () => {
    expect(levenshteinSimilarity('', '')).toBe(1.0);
  });

  it('identical strings = 1.0', () => {
    expect(levenshteinSimilarity('hello', 'hello')).toBe(1.0);
  });

  it('is case-insensitive', () => {
    expect(levenshteinSimilarity('HELLO', 'hello')).toBe(1.0);
  });

  it('completely different strings → low similarity', () => {
    const sim = levenshteinSimilarity('abc', 'xyz');
    expect(sim).toBeLessThan(0.1);
  });
});

// ---------------------------------------------------------------------------
// EntityMismatchComparator
// ---------------------------------------------------------------------------

describe('EntityMismatchComparator', () => {
  const comparator = new EntityMismatchComparator();

  it('detects low name similarity (0.3) between matched records', () => {
    const pair = makeMatchedPair({
      left: {
        system: 'SAP',
        table: 'VBAK',
        recordId: 'SAP-001',
        fields: { NAME1: 'Globex Industries', WAERK: 'USD' },
        extractionId: 'ext-sap-1',
      },
      right: {
        system: 'Salesforce',
        table: 'Opportunity',
        recordId: 'OPP-001',
        fields: { AccountName: 'Acme Corp', CurrencyIsoCode: 'USD' },
        extractionId: 'ext-sfdc-1',
      },
      matchConfidence: 0.55,
      matchStrategy: 'proximity',
    });

    const finding = comparator.compare(pair, defaultConfig());

    expect(finding).not.toBeNull();
    expect(finding!.type).toBe('ENTITY_MISMATCH');
    expect(finding!.scoringDetails['nameSimilarity']).toBeLessThan(0.5);
  });

  it('returns null for high similarity names', () => {
    const pair = makeMatchedPair({
      left: {
        system: 'SAP',
        table: 'VBAK',
        recordId: 'SAP-001',
        fields: { NAME1: 'Acme Corporation', WAERK: 'USD' },
        extractionId: 'ext-sap-1',
      },
      right: {
        system: 'Salesforce',
        table: 'Opportunity',
        recordId: 'OPP-001',
        fields: { AccountName: 'Acme Corporation', CurrencyIsoCode: 'USD' },
        extractionId: 'ext-sfdc-1',
      },
      matchConfidence: 0.85,
      matchStrategy: 'proximity',
    });

    const finding = comparator.compare(pair, defaultConfig());
    expect(finding).toBeNull();
  });

  it('severity inversely proportional to match confidence', () => {
    // Low confidence (0.52) → HIGH severity
    const lowConfPair = makeMatchedPair({
      left: {
        system: 'SAP',
        table: 'VBAK',
        recordId: 'SAP-LOW',
        fields: { NAME1: 'XYZ Holdings', WAERK: 'USD' },
        extractionId: 'ext-sap-1',
      },
      right: {
        system: 'Salesforce',
        table: 'Opportunity',
        recordId: 'OPP-LOW',
        fields: { AccountName: 'ABC Partners', CurrencyIsoCode: 'USD' },
        extractionId: 'ext-sfdc-1',
      },
      matchConfidence: 0.52,
      matchStrategy: 'proximity',
    });

    // Higher confidence (0.62) → lower severity
    const highConfPair = makeMatchedPair({
      left: {
        system: 'SAP',
        table: 'VBAK',
        recordId: 'SAP-HIGH',
        fields: { NAME1: 'Zenith Corp', WAERK: 'USD' },
        extractionId: 'ext-sap-1',
      },
      right: {
        system: 'Salesforce',
        table: 'Opportunity',
        recordId: 'OPP-HIGH',
        fields: { AccountName: 'Apex Global', CurrencyIsoCode: 'USD' },
        extractionId: 'ext-sfdc-1',
      },
      matchConfidence: 0.62,
      matchStrategy: 'proximity',
    });

    const lowFinding = comparator.compare(lowConfPair, defaultConfig());
    const highFinding = comparator.compare(highConfPair, defaultConfig());

    expect(lowFinding).not.toBeNull();
    expect(highFinding).not.toBeNull();
    // Lower confidence → higher or equal severity
    const severityOrder: Record<string, number> = {
      CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1, INFO: 0,
    };
    expect(severityOrder[lowFinding!.severity]).toBeGreaterThanOrEqual(
      severityOrder[highFinding!.severity]!,
    );
  });

  it('detects currency mismatch', () => {
    const pair = makeMatchedPair({
      left: {
        system: 'SAP',
        table: 'VBAK',
        recordId: 'SAP-CUR',
        fields: { NAME1: 'Acme Corporation', WAERK: 'EUR' },
        extractionId: 'ext-sap-1',
      },
      right: {
        system: 'Salesforce',
        table: 'Opportunity',
        recordId: 'OPP-CUR',
        fields: { AccountName: 'Acme Corporation', CurrencyIsoCode: 'USD' },
        extractionId: 'ext-sfdc-1',
      },
      matchConfidence: 0.80,
      matchStrategy: 'proximity',
    });

    const finding = comparator.compare(pair, defaultConfig());

    expect(finding).not.toBeNull();
    expect(finding!.type).toBe('ENTITY_MISMATCH');
    expect(finding!.scoringDetails['currencyMatch']).toBe(0);
  });

  it('skips explicit_id matches (trusted)', () => {
    const pair = makeMatchedPair({
      matchStrategy: 'explicit_id',
      matchConfidence: 0.99,
    });

    const finding = comparator.compare(pair, defaultConfig());
    expect(finding).toBeNull();
  });

  it('has valid UUID and timestamp', () => {
    const pair = makeMatchedPair({
      left: {
        system: 'SAP',
        table: 'VBAK',
        recordId: 'SAP-UUID',
        fields: { NAME1: 'ZZZ Corp', WAERK: 'USD' },
        extractionId: 'ext-sap-1',
      },
      right: {
        system: 'Salesforce',
        table: 'Opportunity',
        recordId: 'OPP-UUID',
        fields: { AccountName: 'AAA Inc', CurrencyIsoCode: 'USD' },
        extractionId: 'ext-sfdc-1',
      },
      matchConfidence: 0.52,
      matchStrategy: 'proximity',
    });

    const finding = comparator.compare(pair, defaultConfig());
    expect(finding).not.toBeNull();
    expect(finding!.id).toMatch(UUID_RE);
    expect(finding!.detectedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

// ---------------------------------------------------------------------------
// DuplicateReferenceComparator
// ---------------------------------------------------------------------------

describe('DuplicateReferenceComparator', () => {
  const comparator = new DuplicateReferenceComparator();

  it('detects two SFDC opps referencing same SAP order', () => {
    const pairs: MatchedEntityPairSet = [
      makeMatchedPair({
        left: {
          system: 'Salesforce',
          table: 'Opportunity',
          recordId: 'OPP-A',
          fields: { sap_order_number: '0000001234', AccountName: 'Acme Corp' },
          extractionId: 'ext-sfdc-a',
        },
        right: {
          system: 'SAP',
          table: 'VBAK',
          recordId: 'SAP-001',
          fields: { NAME1: 'Acme Corp' },
          extractionId: 'ext-sap-1',
        },
      }),
      makeMatchedPair({
        left: {
          system: 'Salesforce',
          table: 'Opportunity',
          recordId: 'OPP-B',
          fields: { sap_order_number: '0000001234', AccountName: 'Acme Corporation' },
          extractionId: 'ext-sfdc-b',
        },
        right: {
          system: 'SAP',
          table: 'VBAK',
          recordId: 'SAP-001',
          fields: { NAME1: 'Acme Corp' },
          extractionId: 'ext-sap-1',
        },
      }),
    ];

    const findings = comparator.compare(pairs, defaultConfig());

    expect(findings.length).toBeGreaterThanOrEqual(1);
    expect(findings[0]!.type).toBe('DUPLICATE_REFERENCE');
    expect(findings[0]!.description).toContain('sap_order_number');
    expect(findings[0]!.description).toContain('0000001234');
  });

  it('returns empty for unique references', () => {
    const pairs: MatchedEntityPairSet = [
      makeMatchedPair({
        left: {
          system: 'Salesforce',
          table: 'Opportunity',
          recordId: 'OPP-X',
          fields: { sap_order_number: '0000001111' },
          extractionId: 'ext-sfdc-x',
        },
      }),
      makeMatchedPair({
        left: {
          system: 'Salesforce',
          table: 'Opportunity',
          recordId: 'OPP-Y',
          fields: { sap_order_number: '0000002222' },
          extractionId: 'ext-sfdc-y',
        },
      }),
    ];

    const findings = comparator.compare(pairs, defaultConfig());
    expect(findings).toHaveLength(0);
  });

  it('severity is HIGH', () => {
    const pairs: MatchedEntityPairSet = [
      makeMatchedPair({
        left: {
          system: 'Salesforce',
          table: 'Opportunity',
          recordId: 'OPP-D1',
          fields: { BSTNK: 'PO-9999' },
          extractionId: 'ext-1',
        },
      }),
      makeMatchedPair({
        left: {
          system: 'Salesforce',
          table: 'Opportunity',
          recordId: 'OPP-D2',
          fields: { BSTNK: 'PO-9999' },
          extractionId: 'ext-2',
        },
      }),
    ];

    const findings = comparator.compare(pairs, defaultConfig());
    expect(findings.length).toBeGreaterThanOrEqual(1);
    expect(findings[0]!.severity).toBe('HIGH');
  });

  it('confidence is 0.80', () => {
    const pairs: MatchedEntityPairSet = [
      makeMatchedPair({
        left: {
          system: 'Salesforce',
          table: 'Opportunity',
          recordId: 'OPP-C1',
          fields: { EBELN: 'EB-100' },
          extractionId: 'ext-c1',
        },
      }),
      makeMatchedPair({
        left: {
          system: 'Salesforce',
          table: 'Opportunity',
          recordId: 'OPP-C2',
          fields: { EBELN: 'EB-100' },
          extractionId: 'ext-c2',
        },
      }),
    ];

    const findings = comparator.compare(pairs, defaultConfig());
    expect(findings[0]!.confidence).toBe(0.80);
  });
});

// ---------------------------------------------------------------------------
// OrphanRecordComparator
// ---------------------------------------------------------------------------

describe('OrphanRecordComparator', () => {
  const comparator = new OrphanRecordComparator();

  it('detects Closed Won opp with no SAP match', () => {
    const input: OrphanCheckInput = {
      record: {
        system: 'Salesforce',
        table: 'Opportunity',
        recordId: 'OPP-ORPHAN',
        fields: {
          StageName: 'Closed Won',
          Amount: '75000',
          CloseDate: new Date().toISOString().split('T')[0]!, // today
        },
        extractionId: 'ext-orphan-1',
      },
      potentialMatches: [], // no matches
    };

    const finding = comparator.compare(input, defaultConfig());

    expect(finding).not.toBeNull();
    expect(finding!.type).toBe('ORPHAN_RECORD');
    expect(finding!.leftSystem).toBe('Salesforce');
    expect(finding!.rightSystem).toBe('SAP');
    expect(finding!.description).toContain('Closed Won');
    expect(finding!.confidence).toBe(0.70);
  });

  it('returns null when match exists', () => {
    const input: OrphanCheckInput = {
      record: {
        system: 'Salesforce',
        table: 'Opportunity',
        recordId: 'OPP-MATCHED',
        fields: {
          StageName: 'Closed Won',
          Amount: '50000',
          CloseDate: '2024-03-15',
        },
        extractionId: 'ext-matched-1',
      },
      potentialMatches: [
        {
          system: 'SAP',
          table: 'VBAK',
          recordId: 'SAP-MATCH',
          fields: { NETWR: '50000' },
          extractionId: 'ext-sap-match-1',
        },
      ],
    };

    const finding = comparator.compare(input, defaultConfig());
    expect(finding).toBeNull();
  });

  it('severity scales with amount', () => {
    // Large amount + recent → HIGH
    const highInput: OrphanCheckInput = {
      record: {
        system: 'Salesforce',
        table: 'Opportunity',
        recordId: 'OPP-BIG',
        fields: {
          StageName: 'Closed Won',
          Amount: '500000',
          CloseDate: new Date().toISOString().split('T')[0]!, // today = recent
        },
        extractionId: 'ext-big',
      },
      potentialMatches: [],
    };

    // Small amount + old → LOW
    const lowInput: OrphanCheckInput = {
      record: {
        system: 'Salesforce',
        table: 'Opportunity',
        recordId: 'OPP-SMALL',
        fields: {
          StageName: 'Closed Won',
          Amount: '500',
          CloseDate: '2020-01-01', // old
        },
        extractionId: 'ext-small',
      },
      potentialMatches: [],
    };

    const highFinding = comparator.compare(highInput, defaultConfig());
    const lowFinding = comparator.compare(lowInput, defaultConfig());

    expect(highFinding).not.toBeNull();
    expect(lowFinding).not.toBeNull();
    expect(highFinding!.severity).toBe('HIGH');
    expect(lowFinding!.severity).toBe('LOW');
  });

  it('detects SAP orphan with BSTNK reference', () => {
    const input: OrphanCheckInput = {
      record: {
        system: 'SAP',
        table: 'VBAK',
        recordId: 'SAP-ORPHAN',
        fields: {
          BSTNK: 'PO-EXT-12345',
          NETWR: '30000',
          ERDAT: '20240601',
        },
        extractionId: 'ext-sap-orphan',
      },
      potentialMatches: [],
    };

    const finding = comparator.compare(input, defaultConfig());

    expect(finding).not.toBeNull();
    expect(finding!.type).toBe('ORPHAN_RECORD');
    expect(finding!.leftSystem).toBe('SAP');
    expect(finding!.rightSystem).toBe('Salesforce');
    expect(finding!.scoringDetails['hasExternalRef']).toBe(1);
  });

  it('scoringDetails contains ageDays, amount, and hasExternalRef', () => {
    const input: OrphanCheckInput = {
      record: {
        system: 'Salesforce',
        table: 'Opportunity',
        recordId: 'OPP-DETAILS',
        fields: {
          StageName: 'Closed Won',
          Amount: '25000',
          CloseDate: '2024-06-15',
        },
        extractionId: 'ext-details',
      },
      potentialMatches: [],
    };

    const finding = comparator.compare(input, defaultConfig());

    expect(finding).not.toBeNull();
    const d = finding!.scoringDetails;
    expect(d).toHaveProperty('ageDays');
    expect(d).toHaveProperty('amount');
    expect(d).toHaveProperty('hasExternalRef');
    expect(d['amount']).toBe(25000);
    expect(d['hasExternalRef']).toBe(0);
    expect(d['ageDays']).toBeGreaterThan(0);
  });
});
