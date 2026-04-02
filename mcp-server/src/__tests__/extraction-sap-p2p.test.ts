/**
 * Tests for SAP Procure-to-Pay (P2P) Extraction Paths
 *
 * Validates the four P2P extraction paths cover the correct SAP tables,
 * field definitions, parameter requirements, and query structure.
 */

import { SAP_P2P_PATHS } from '../extraction-registry/sap/p2p.js';
import type { ExtractionPath } from '../extraction-registry/types.js';

// ─── Helpers ─────────────────────────────────────────────────────────────

function getPath(suffix: string): ExtractionPath {
  const path = SAP_P2P_PATHS.find(p => p.id === `sap.p2p.${suffix}`);
  if (!path) throw new Error(`Path sap.p2p.${suffix} not found`);
  return path;
}

function fieldByName(path: ExtractionPath, name: string) {
  return path.expectedFields.find(f => f.name === name);
}

function paramByName(path: ExtractionPath, name: string) {
  return path.parameters.find(p => p.name === name);
}

// ─── Test 1: All paths have IDs starting with 'sap.p2p.' ────────────────

describe('SAP P2P extraction paths — ID format', () => {
  it('exports exactly 4 paths', () => {
    expect(SAP_P2P_PATHS).toHaveLength(4);
  });

  it.each(SAP_P2P_PATHS.map(p => [p.id]))('path %s starts with sap.p2p.', id => {
    expect(id).toMatch(/^sap\.p2p\./);
  });

  it('all paths have systemType SAP and domain p2p', () => {
    for (const path of SAP_P2P_PATHS) {
      expect(path.systemType).toBe('SAP');
      expect(path.domain).toBe('p2p');
    }
  });

  it('all paths have version 1.0', () => {
    for (const path of SAP_P2P_PATHS) {
      expect(path.version).toBe('1.0');
    }
  });
});

// ─── Test 2: Correct SAP tables referenced ───────────────────────────────

describe('SAP P2P extraction paths — correct SAP tables', () => {
  it('purchase-orders references EKKO and EKPO', () => {
    const path = getPath('purchase-orders');
    expect(path.query).toContain('EKKO');
    expect(path.query).toContain('EKPO');
  });

  it('purchase-requisitions references EBAN', () => {
    const path = getPath('purchase-requisitions');
    expect(path.query).toContain('EBAN');
  });

  it('goods-receipts references EKBE', () => {
    const path = getPath('goods-receipts');
    expect(path.query).toContain('EKBE');
  });

  it('invoice-verification references RBKP and RSEG', () => {
    const path = getPath('invoice-verification');
    expect(path.query).toContain('RBKP');
    expect(path.query).toContain('RSEG');
  });
});

// ─── Test 3: All have required date range parameters ─────────────────────

describe('SAP P2P extraction paths — required date parameters', () => {
  it('purchase-orders has required date_from and date_to', () => {
    const path = getPath('purchase-orders');
    const dateFrom = paramByName(path, 'date_from');
    const dateTo = paramByName(path, 'date_to');
    expect(dateFrom).toBeDefined();
    expect(dateFrom!.required).toBe(true);
    expect(dateFrom!.type).toBe('date');
    expect(dateTo).toBeDefined();
    expect(dateTo!.required).toBe(true);
    expect(dateTo!.type).toBe('date');
  });

  it('purchase-requisitions has required date_from and date_to', () => {
    const path = getPath('purchase-requisitions');
    const dateFrom = paramByName(path, 'date_from');
    const dateTo = paramByName(path, 'date_to');
    expect(dateFrom).toBeDefined();
    expect(dateFrom!.required).toBe(true);
    expect(dateTo).toBeDefined();
    expect(dateTo!.required).toBe(true);
  });

  it('goods-receipts has required ebeln parameter (PO-scoped, no date range)', () => {
    const path = getPath('goods-receipts');
    const ebeln = paramByName(path, 'ebeln');
    expect(ebeln).toBeDefined();
    expect(ebeln!.required).toBe(true);
    // goods-receipts is scoped to a single PO, not a date range
    expect(path.parameters.every(p => p.required)).toBe(true);
  });

  it('invoice-verification has required date_from and date_to', () => {
    const path = getPath('invoice-verification');
    const dateFrom = paramByName(path, 'date_from');
    const dateTo = paramByName(path, 'date_to');
    expect(dateFrom).toBeDefined();
    expect(dateFrom!.required).toBe(true);
    expect(dateTo).toBeDefined();
    expect(dateTo!.required).toBe(true);
  });
});

// ─── Test 4: Amount fields correctly typed ───────────────────────────────

describe('SAP P2P extraction paths — amount fields', () => {
  it('purchase-orders: NETPR and NETWR are amount type', () => {
    const path = getPath('purchase-orders');
    expect(fieldByName(path, 'NETPR')?.type).toBe('amount');
    expect(fieldByName(path, 'NETWR')?.type).toBe('amount');
  });

  it('purchase-requisitions: PREIS is amount type', () => {
    const path = getPath('purchase-requisitions');
    expect(fieldByName(path, 'PREIS')?.type).toBe('amount');
  });

  it('goods-receipts: DMBTR is amount type', () => {
    const path = getPath('goods-receipts');
    expect(fieldByName(path, 'DMBTR')?.type).toBe('amount');
  });

  it('invoice-verification: RMWWR and WRBTR are amount type', () => {
    const path = getPath('invoice-verification');
    expect(fieldByName(path, 'RMWWR')?.type).toBe('amount');
    expect(fieldByName(path, 'WRBTR')?.type).toBe('amount');
  });

  it('quantity fields (MENGE) are number type, not amount', () => {
    for (const path of SAP_P2P_PATHS) {
      const menge = fieldByName(path, 'MENGE');
      if (menge) {
        expect(menge.type).toBe('number');
      }
    }
  });
});

// ─── Test 5: purchase-orders uses JOIN between EKKO and EKPO ─────────────

describe('SAP P2P extraction paths — purchase-orders JOIN', () => {
  it('uses INNER JOIN between EKKO and EKPO on EBELN', () => {
    const path = getPath('purchase-orders');
    expect(path.query).toMatch(/INNER\s+JOIN\s+EKPO/i);
    expect(path.query).toMatch(/ON\s+H\.EBELN\s*=\s*I\.EBELN/i);
  });

  it('selects from both header (H) and item (I) aliases', () => {
    const path = getPath('purchase-orders');
    expect(path.query).toMatch(/H\.\w+/);
    expect(path.query).toMatch(/I\.\w+/);
  });
});

// ─── Test 6: goods-receipts filters by VGABE='1' ─────────────────────────

describe('SAP P2P extraction paths — goods-receipts VGABE filter', () => {
  it('filters EKBE by VGABE = 1 for goods receipt transactions', () => {
    const path = getPath('goods-receipts');
    expect(path.query).toMatch(/VGABE\s*=\s*'1'/);
  });

  it('VGABE field description indicates goods receipt', () => {
    const path = getPath('goods-receipts');
    const vgabe = fieldByName(path, 'VGABE');
    expect(vgabe).toBeDefined();
    expect(vgabe!.description.toLowerCase()).toContain('goods receipt');
  });
});

// ─── Test 7: invoice-verification uses JOIN between RBKP and RSEG ────────

describe('SAP P2P extraction paths — invoice-verification JOIN', () => {
  it('uses INNER JOIN between RBKP and RSEG on BELNR and GJAHR', () => {
    const path = getPath('invoice-verification');
    expect(path.query).toMatch(/INNER\s+JOIN\s+RSEG/i);
    expect(path.query).toMatch(/H\.BELNR\s*=\s*I\.BELNR/i);
    expect(path.query).toMatch(/H\.GJAHR\s*=\s*I\.GJAHR/i);
  });

  it('includes PO reference fields EBELN and EBELP from RSEG', () => {
    const path = getPath('invoice-verification');
    expect(fieldByName(path, 'EBELN')).toBeDefined();
    expect(fieldByName(path, 'EBELP')).toBeDefined();
  });
});

// ─── Structural integrity ────────────────────────────────────────────────

describe('SAP P2P extraction paths — structural integrity', () => {
  it('all paths have queryType sql', () => {
    for (const path of SAP_P2P_PATHS) {
      expect(path.queryType).toBe('sql');
    }
  });

  it('all paths have non-empty descriptions', () => {
    for (const path of SAP_P2P_PATHS) {
      expect(path.description.length).toBeGreaterThan(20);
    }
  });

  it('all paths have at least one expected field', () => {
    for (const path of SAP_P2P_PATHS) {
      expect(path.expectedFields.length).toBeGreaterThan(0);
    }
  });

  it('all expected fields have sapFieldName set', () => {
    for (const path of SAP_P2P_PATHS) {
      for (const field of path.expectedFields) {
        expect(field.sapFieldName).toBeDefined();
        expect(field.sapFieldName!.length).toBeGreaterThan(0);
      }
    }
  });

  it('all paths have test data', () => {
    for (const path of SAP_P2P_PATHS) {
      expect(path.testData).toBeDefined();
      expect(path.testData!.inputParams).toBeDefined();
    }
  });

  it('no duplicate path IDs', () => {
    const ids = SAP_P2P_PATHS.map(p => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('no duplicate field names within any path', () => {
    for (const path of SAP_P2P_PATHS) {
      const names = path.expectedFields.map(f => f.name);
      expect(new Set(names).size).toBe(names.length);
    }
  });
});
