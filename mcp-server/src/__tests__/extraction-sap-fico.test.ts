/**
 * Tests for SAP FI/CO Extraction Paths
 *
 * Validates the four deterministic extraction path definitions for
 * SAP Financial Accounting and Controlling forensic analysis.
 */

import { SAP_FICO_PATHS } from '../extraction-registry/sap/fi-co.js';
import type { ExtractionPath } from '../extraction-registry/types.js';

// --- Helpers ---

function findPath(id: string): ExtractionPath {
  const path = SAP_FICO_PATHS.find((p) => p.id === id);
  if (!path) {
    throw new Error(`Path not found: ${id}`);
  }
  return path;
}

function hasRequiredParam(path: ExtractionPath, name: string): boolean {
  return path.parameters.some((p) => p.name === name && p.required);
}

function hasOptionalParam(path: ExtractionPath, name: string): boolean {
  return path.parameters.some((p) => p.name === name && !p.required);
}

function getField(path: ExtractionPath, name: string) {
  return path.expectedFields.find((f) => f.name === name);
}

// --- Tests ---

describe('SAP FI/CO Extraction Paths', () => {
  it('should export exactly 4 paths', () => {
    expect(SAP_FICO_PATHS).toHaveLength(4);
  });

  it('all paths have valid IDs starting with sap.fi-co.', () => {
    for (const path of SAP_FICO_PATHS) {
      expect(path.id).toMatch(/^sap\.fi-co\./);
    }
  });

  it('all paths are SAP system type with fi-co domain', () => {
    for (const path of SAP_FICO_PATHS) {
      expect(path.systemType).toBe('SAP');
      expect(path.domain).toBe('fi-co');
      expect(path.queryType).toBe('sql');
    }
  });

  it('all paths reference correct SAP tables (BKPF or BSEG)', () => {
    for (const path of SAP_FICO_PATHS) {
      const referencesTable =
        path.query.includes('BKPF') || path.query.includes('BSEG');
      expect(referencesTable).toBe(true);
    }
  });

  it('all paths have required parameters bukrs and gjahr', () => {
    for (const path of SAP_FICO_PATHS) {
      expect(hasRequiredParam(path, 'bukrs')).toBe(true);
      expect(hasRequiredParam(path, 'gjahr')).toBe(true);
    }
  });

  it('all paths have non-empty name and description', () => {
    for (const path of SAP_FICO_PATHS) {
      expect(path.name.length).toBeGreaterThan(0);
      expect(path.description.length).toBeGreaterThan(0);
    }
  });

  it('all paths have version 1.0', () => {
    for (const path of SAP_FICO_PATHS) {
      expect(path.version).toBe('1.0');
    }
  });

  it('all paths have at least one expected field', () => {
    for (const path of SAP_FICO_PATHS) {
      expect(path.expectedFields.length).toBeGreaterThan(0);
    }
  });

  // --- Path-specific tests ---

  describe('sap.fi-co.journal-entries', () => {
    const path = findPath('sap.fi-co.journal-entries');

    it('has optional period parameters with defaults', () => {
      expect(hasOptionalParam(path, 'period_from')).toBe(true);
      expect(hasOptionalParam(path, 'period_to')).toBe(true);

      const periodFrom = path.parameters.find((p) => p.name === 'period_from');
      const periodTo = path.parameters.find((p) => p.name === 'period_to');
      expect(periodFrom!.defaultValue).toBe('01');
      expect(periodTo!.defaultValue).toBe('12');
    });

    it('queries BKPF table', () => {
      expect(path.query).toContain('FROM BKPF');
    });

    it('date fields typed as date', () => {
      expect(getField(path, 'BLDAT')!.type).toBe('date');
      expect(getField(path, 'BUDAT')!.type).toBe('date');
      expect(getField(path, 'CPUDT')!.type).toBe('date');
    });

    it('BELNR typed as string', () => {
      expect(getField(path, 'BELNR')!.type).toBe('string');
    });

    it('MONAT typed as string', () => {
      expect(getField(path, 'MONAT')!.type).toBe('string');
    });

    it('includes reversal fields (STBLG, STJAH)', () => {
      expect(getField(path, 'STBLG')).toBeDefined();
      expect(getField(path, 'STJAH')).toBeDefined();
    });
  });

  describe('sap.fi-co.line-items', () => {
    const path = findPath('sap.fi-co.line-items');

    it('queries BSEG table', () => {
      expect(path.query).toContain('FROM BSEG');
    });

    it('requires belnr parameter', () => {
      expect(hasRequiredParam(path, 'belnr')).toBe(true);
    });

    it('amount fields DMBTR and WRBTR typed as amount', () => {
      expect(getField(path, 'DMBTR')!.type).toBe('amount');
      expect(getField(path, 'WRBTR')!.type).toBe('amount');
    });

    it('BSCHL (posting key) typed as string', () => {
      expect(getField(path, 'BSCHL')!.type).toBe('string');
    });

    it('SHKZG (debit/credit indicator) typed as string', () => {
      expect(getField(path, 'SHKZG')!.type).toBe('string');
    });

    it('HKONT (GL account) typed as string', () => {
      expect(getField(path, 'HKONT')!.type).toBe('string');
    });
  });

  describe('sap.fi-co.sod-users', () => {
    const path = findPath('sap.fi-co.sod-users');

    it('uses self-join on BKPF', () => {
      expect(path.query).toContain('BKPF A');
      expect(path.query).toContain('INNER JOIN BKPF B');
    });

    it('joins on same user with different tcodes', () => {
      expect(path.query).toContain('A.USNAM = B.USNAM');
      expect(path.query).toContain('A.TCODE <> B.TCODE');
    });

    it('joins on same document key (BUKRS + BELNR + GJAHR)', () => {
      expect(path.query).toContain('A.BUKRS = B.BUKRS');
      expect(path.query).toContain('A.BELNR = B.BELNR');
      expect(path.query).toContain('A.GJAHR = B.GJAHR');
    });

    it('description mentions SoD conflict patterns', () => {
      expect(path.description).toContain('post_and_approve');
      expect(path.description).toContain('create_and_pay');
      expect(path.description).toContain('park_and_post');
    });
  });

  describe('sap.fi-co.gl-balances', () => {
    const path = findPath('sap.fi-co.gl-balances');

    it('queries BSEG with GROUP BY', () => {
      expect(path.query).toContain('FROM BSEG');
      expect(path.query).toContain('GROUP BY HKONT');
    });

    it('uses aggregate functions (SUM, COUNT)', () => {
      expect(path.query).toContain('SUM(');
      expect(path.query).toContain('COUNT(');
    });

    it('DEBIT_TOTAL and CREDIT_TOTAL typed as amount', () => {
      expect(getField(path, 'DEBIT_TOTAL')!.type).toBe('amount');
      expect(getField(path, 'CREDIT_TOTAL')!.type).toBe('amount');
    });

    it('POSTING_COUNT and DOC_COUNT typed as number', () => {
      expect(getField(path, 'POSTING_COUNT')!.type).toBe('number');
      expect(getField(path, 'DOC_COUNT')!.type).toBe('number');
    });

    it('orders by DEBIT_TOTAL DESC', () => {
      expect(path.query).toContain('ORDER BY DEBIT_TOTAL DESC');
    });
  });
});
