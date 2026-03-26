// mcp-server/src/cross-system/__tests__/entity-resolver.test.ts

import { describe, it, expect } from '@jest/globals';
import {
  levenshteinDistance,
  EntityResolver,
} from '../entity-resolver.js';
import type {
  SFDCMatchRecord,
  SAPMatchRecord,
} from '../entity-resolver.js';

// ============================================================================
// Test Data
// ============================================================================

const sfdcRecords: SFDCMatchRecord[] = [
  {
    opportunity_id: 'OPP-001',
    account_name: 'Acme Corporation',
    amount: 50000,
    close_date: '2024-03-15',
    sap_order_number: '0000001234', // explicit SAP link
  },
  {
    opportunity_id: 'OPP-002',
    account_name: 'Globex Inc',
    amount: 75000,
    close_date: '2024-04-01',
    sap_order_number: null, // no explicit link — needs proximity
  },
  {
    opportunity_id: 'OPP-003',
    account_name: 'Initech Solutions',
    amount: 30000,
    close_date: '2024-05-10',
    sap_order_number: null, // no match expected
  },
];

const sapRecords: SAPMatchRecord[] = [
  {
    vbeln: '0000001234',
    customer_name: 'ACME CORPORATION',
    netwr: 50000,
    erdat: '20240315',
  },
  {
    vbeln: '0000005678',
    customer_name: 'GLOBEX CORPORATION',
    netwr: 74500,
    erdat: '20240403',
  },
  {
    vbeln: '0000009999',
    customer_name: 'VANDELAY INDUSTRIES',
    netwr: 12000,
    erdat: '20240601',
  },
];

// ============================================================================
// levenshteinDistance
// ============================================================================

describe('levenshteinDistance', () => {
  it('returns 0 for identical strings', () => {
    expect(levenshteinDistance('hello', 'hello')).toBe(0);
  });

  it('returns 1 for a single character difference', () => {
    expect(levenshteinDistance('hello', 'helo')).toBe(1);
  });

  it('is case-sensitive', () => {
    expect(levenshteinDistance('Hello', 'hello')).toBe(1);
  });

  it('handles empty strings', () => {
    expect(levenshteinDistance('', '')).toBe(0);
    expect(levenshteinDistance('abc', '')).toBe(3);
    expect(levenshteinDistance('', 'abc')).toBe(3);
  });

  it('handles substitution', () => {
    expect(levenshteinDistance('kitten', 'sitting')).toBe(3);
  });

  it('handles transposition as two edits', () => {
    expect(levenshteinDistance('ab', 'ba')).toBe(2);
  });
});

// ============================================================================
// EntityResolver — resolveExplicitId
// ============================================================================

describe('EntityResolver.resolveExplicitId', () => {
  const resolver = new EntityResolver();

  it('matches when sap_order_number equals vbeln', () => {
    const matches = resolver.resolveExplicitId(sfdcRecords, sapRecords);
    expect(matches).toHaveLength(1);
    expect(matches[0]!.sfdc_id).toBe('OPP-001');
    expect(matches[0]!.sap_id).toBe('0000001234');
  });

  it('returns confidence of 0.99 for explicit matches', () => {
    const matches = resolver.resolveExplicitId(sfdcRecords, sapRecords);
    expect(matches[0]!.confidence).toBe(0.99);
  });

  it('returns strategy "explicit_id"', () => {
    const matches = resolver.resolveExplicitId(sfdcRecords, sapRecords);
    expect(matches[0]!.strategy).toBe('explicit_id');
  });

  it('returns empty array when no explicit links exist', () => {
    const noLinkSFDC = sfdcRecords.filter(r => r.sap_order_number === null);
    const matches = resolver.resolveExplicitId(noLinkSFDC, sapRecords);
    expect(matches).toHaveLength(0);
  });

  it('does not match when sap_order_number does not exist in SAP records', () => {
    const orphanSFDC: SFDCMatchRecord[] = [
      {
        opportunity_id: 'OPP-999',
        account_name: 'Ghost Corp',
        amount: 10000,
        close_date: '2024-01-01',
        sap_order_number: '9999999999', // does not exist in SAP
      },
    ];
    const matches = resolver.resolveExplicitId(orphanSFDC, sapRecords);
    expect(matches).toHaveLength(0);
  });
});

// ============================================================================
// EntityResolver — resolveByProximity
// ============================================================================

describe('EntityResolver.resolveByProximity', () => {
  const resolver = new EntityResolver();

  it('fuzzy-matches Globex Inc to GLOBEX CORPORATION', () => {
    const matches = resolver.resolveByProximity(sfdcRecords, sapRecords);
    const globexMatch = matches.find(m => m.sfdc_id === 'OPP-002');
    expect(globexMatch).toBeDefined();
    expect(globexMatch!.sap_id).toBe('0000005678');
    expect(globexMatch!.strategy).toBe('proximity');
    expect(globexMatch!.confidence).toBeGreaterThanOrEqual(0.50);
  });

  it('does not match Initech to unrelated SAP records', () => {
    const matches = resolver.resolveByProximity(sfdcRecords, sapRecords);
    const initechMatch = matches.find(m => m.sfdc_id === 'OPP-003');
    expect(initechMatch).toBeUndefined();
  });

  it('respects tight amount tolerance — rejects when amount diff exceeds tolerance', () => {
    const tightOptions = {
      nameThreshold: 0.5,
      amountTolerance: 0.01, // 1% — SAP 74500 vs SFDC 75000 = 0.67% diff, but name sim may be too low
      maxDateGapDays: 45,
    };
    // With very tight tolerance on amount but loose name threshold, Vandelay should not match Initech
    const sfdc: SFDCMatchRecord[] = [
      {
        opportunity_id: 'OPP-TGT',
        account_name: 'Vandelay Industries',
        amount: 100000, // far from all SAP records
        close_date: '2024-06-01',
        sap_order_number: null,
      },
    ];
    const matches = resolver.resolveByProximity(sfdc, sapRecords, tightOptions);
    expect(matches).toHaveLength(0);
  });

  it('includes confidence details in result', () => {
    const matches = resolver.resolveByProximity(sfdcRecords, sapRecords);
    const globexMatch = matches.find(m => m.sfdc_id === 'OPP-002');
    expect(globexMatch).toBeDefined();
    expect(globexMatch!.details).toHaveProperty('nameSim');
    expect(globexMatch!.details).toHaveProperty('amountSim');
    expect(globexMatch!.details).toHaveProperty('dateSim');
  });
});

// ============================================================================
// EntityResolver — resolveAll
// ============================================================================

describe('EntityResolver.resolveAll', () => {
  const resolver = new EntityResolver();

  it('combines explicit and proximity strategies', () => {
    const matches = resolver.resolveAll(sfdcRecords, sapRecords);
    const sfdc_ids = matches.map(m => m.sfdc_id);
    expect(sfdc_ids).toContain('OPP-001'); // explicit
    expect(sfdc_ids).toContain('OPP-002'); // proximity
  });

  it('produces no duplicate SFDC ids', () => {
    const matches = resolver.resolveAll(sfdcRecords, sapRecords);
    const sfdc_ids = matches.map(m => m.sfdc_id);
    const unique = new Set(sfdc_ids);
    expect(unique.size).toBe(sfdc_ids.length);
  });

  it('produces no duplicate SAP ids', () => {
    const matches = resolver.resolveAll(sfdcRecords, sapRecords);
    const sap_ids = matches.map(m => m.sap_id);
    const unique = new Set(sap_ids);
    expect(unique.size).toBe(sap_ids.length);
  });

  it('prefers explicit match over proximity when both exist for same SFDC id', () => {
    // OPP-001 has explicit match — even if proximity could also find it, explicit wins
    const matches = resolver.resolveAll(sfdcRecords, sapRecords);
    const acmeMatch = matches.find(m => m.sfdc_id === 'OPP-001');
    expect(acmeMatch).toBeDefined();
    expect(acmeMatch!.strategy).toBe('explicit_id');
    expect(acmeMatch!.confidence).toBe(0.99);
  });

  it('higher confidence wins when same SFDC id has multiple candidates', () => {
    // Build a scenario where proximity also finds OPP-001 with lower confidence
    const matches = resolver.resolveAll(sfdcRecords, sapRecords);
    const acmeMatch = matches.find(m => m.sfdc_id === 'OPP-001');
    // Explicit is 0.99, so explicit_id must win
    expect(acmeMatch!.confidence).toBeGreaterThanOrEqual(0.99);
  });
});
