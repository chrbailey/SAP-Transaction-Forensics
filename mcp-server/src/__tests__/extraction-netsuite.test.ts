/**
 * Tests for NetSuite User Audit Extraction Paths
 *
 * Validates the three deterministic extraction path definitions for
 * NetSuite user optimization audits: user activity, transaction summary,
 * and login history.
 */

import { NETSUITE_USER_AUDIT_PATHS } from '../extraction-registry/netsuite/user-audit.js';
import type { ExtractionPath } from '../extraction-registry/types.js';

// Helper: find a path by ID suffix
function findPath(suffix: string): ExtractionPath {
  const path = NETSUITE_USER_AUDIT_PATHS.find(p => p.id === `netsuite.user-audit.${suffix}`);
  if (!path) throw new Error(`Path netsuite.user-audit.${suffix} not found`);
  return path;
}

// ============================================================================
// Structural tests — apply to all 3 paths
// ============================================================================

describe('NetSuite User Audit Extraction Paths — structural', () => {
  test('exports exactly 3 paths', () => {
    expect(NETSUITE_USER_AUDIT_PATHS).toHaveLength(3);
  });

  test('all paths have IDs starting with netsuite.user-audit.', () => {
    for (const path of NETSUITE_USER_AUDIT_PATHS) {
      expect(path.id).toMatch(/^netsuite\.user-audit\./);
    }
  });

  test('all paths have systemType NetSuite', () => {
    for (const path of NETSUITE_USER_AUDIT_PATHS) {
      expect(path.systemType).toBe('NetSuite');
    }
  });

  test('all paths have domain user-audit', () => {
    for (const path of NETSUITE_USER_AUDIT_PATHS) {
      expect(path.domain).toBe('user-audit');
    }
  });

  test('all paths have queryType sql (SuiteQL is SQL-based)', () => {
    for (const path of NETSUITE_USER_AUDIT_PATHS) {
      expect(path.queryType).toBe('sql');
    }
  });

  test('all paths have version 1.0', () => {
    for (const path of NETSUITE_USER_AUDIT_PATHS) {
      expect(path.version).toBe('1.0');
    }
  });

  test('all paths have non-empty query strings starting with SELECT', () => {
    for (const path of NETSUITE_USER_AUDIT_PATHS) {
      expect(path.query.length).toBeGreaterThan(0);
      expect(path.query).toMatch(/^SELECT/i);
    }
  });

  test('all paths have non-empty expectedFields', () => {
    for (const path of NETSUITE_USER_AUDIT_PATHS) {
      expect(path.expectedFields.length).toBeGreaterThan(0);
    }
  });

  test('all paths have a name and description', () => {
    for (const path of NETSUITE_USER_AUDIT_PATHS) {
      expect(path.name.length).toBeGreaterThan(0);
      expect(path.description.length).toBeGreaterThan(0);
    }
  });

  test('all field types are valid', () => {
    const validTypes = ['string', 'number', 'date', 'amount', 'boolean'];
    for (const path of NETSUITE_USER_AUDIT_PATHS) {
      for (const field of path.expectedFields) {
        expect(validTypes).toContain(field.type);
      }
    }
  });
});

// ============================================================================
// Query content — each path references the correct NetSuite tables
// ============================================================================

describe('NetSuite User Audit Extraction Paths — query content', () => {
  test('user-activity references employee and loginaudit tables', () => {
    const path = findPath('user-activity');
    expect(path.query).toContain('employee');
    expect(path.query).toContain('loginaudit');
  });

  test('transaction-summary references transaction table with GROUP BY', () => {
    const path = findPath('transaction-summary');
    expect(path.query).toContain('transaction');
    expect(path.query).toMatch(/GROUP BY/i);
  });

  test('login-history uses window functions (OVER PARTITION BY)', () => {
    const path = findPath('login-history');
    expect(path.query).toMatch(/OVER\s*\(\s*PARTITION\s+BY/i);
  });
});

// ============================================================================
// Parameters — defaults and types
// ============================================================================

describe('NetSuite User Audit Extraction Paths — parameters', () => {
  test('all paths have reasonable default parameters', () => {
    for (const path of NETSUITE_USER_AUDIT_PATHS) {
      for (const param of path.parameters) {
        if (!param.required) {
          expect(param.defaultValue).toBeDefined();
          expect(param.defaultValue!.length).toBeGreaterThan(0);
        }
      }
    }
  });

  test('user-activity dormant_days default is 90', () => {
    const path = findPath('user-activity');
    const dormantParam = path.parameters.find(p => p.name === 'dormant_days');
    expect(dormantParam).toBeDefined();
    expect(dormantParam!.defaultValue).toBe('90');
  });

  test('transaction-summary lookback_days default is 365', () => {
    const path = findPath('transaction-summary');
    const lookbackParam = path.parameters.find(p => p.name === 'lookback_days');
    expect(lookbackParam).toBeDefined();
    expect(lookbackParam!.defaultValue).toBe('365');
  });

  test('login-history lookback_days default is 90', () => {
    const path = findPath('login-history');
    const lookbackParam = path.parameters.find(p => p.name === 'lookback_days');
    expect(lookbackParam).toBeDefined();
    expect(lookbackParam!.defaultValue).toBe('90');
  });
});

// ============================================================================
// Field-level checks
// ============================================================================

describe('NetSuite User Audit Extraction Paths — field details', () => {
  test('user-activity has employee_id, full_name, email, login_status fields', () => {
    const path = findPath('user-activity');
    const fieldNames = path.expectedFields.map(f => f.name);
    expect(fieldNames).toContain('employee_id');
    expect(fieldNames).toContain('full_name');
    expect(fieldNames).toContain('email');
    expect(fieldNames).toContain('login_status');
  });

  test('user-activity has boolean fields for is_inactive and has_access', () => {
    const path = findPath('user-activity');
    const isInactive = path.expectedFields.find(f => f.name === 'is_inactive');
    const hasAccess = path.expectedFields.find(f => f.name === 'has_access');
    expect(isInactive).toBeDefined();
    expect(isInactive!.type).toBe('boolean');
    expect(hasAccess).toBeDefined();
    expect(hasAccess!.type).toBe('boolean');
  });

  test('user-activity last_login_date has type date', () => {
    const path = findPath('user-activity');
    const lastLogin = path.expectedFields.find(f => f.name === 'last_login_date');
    expect(lastLogin).toBeDefined();
    expect(lastLogin!.type).toBe('date');
  });

  test('transaction-summary has count and date aggregate fields', () => {
    const path = findPath('transaction-summary');
    const txCount = path.expectedFields.find(f => f.name === 'transaction_count');
    const distinctTypes = path.expectedFields.find(f => f.name === 'distinct_types');
    const firstTx = path.expectedFields.find(f => f.name === 'first_transaction');
    const lastTx = path.expectedFields.find(f => f.name === 'last_transaction');
    expect(txCount).toBeDefined();
    expect(txCount!.type).toBe('number');
    expect(distinctTypes).toBeDefined();
    expect(distinctTypes!.type).toBe('number');
    expect(firstTx).toBeDefined();
    expect(firstTx!.type).toBe('date');
    expect(lastTx).toBeDefined();
    expect(lastTx!.type).toBe('date');
  });

  test('login-history has window function fields with correct types', () => {
    const path = findPath('login-history');
    const totalLogins = path.expectedFields.find(f => f.name === 'total_logins');
    const firstLogin = path.expectedFields.find(f => f.name === 'first_login');
    const lastLogin = path.expectedFields.find(f => f.name === 'last_login');
    expect(totalLogins).toBeDefined();
    expect(totalLogins!.type).toBe('number');
    expect(firstLogin).toBeDefined();
    expect(firstLogin!.type).toBe('date');
    expect(lastLogin).toBeDefined();
    expect(lastLogin!.type).toBe('date');
  });

  test('all expectedFields have netsuiteName set', () => {
    for (const path of NETSUITE_USER_AUDIT_PATHS) {
      for (const field of path.expectedFields) {
        expect(field.netsuiteName).toBeDefined();
        expect(field.netsuiteName!.length).toBeGreaterThan(0);
      }
    }
  });
});
