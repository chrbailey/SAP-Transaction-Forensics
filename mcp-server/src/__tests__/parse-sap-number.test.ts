/**
 * Tests for the shared SAP numeric parser.
 *
 * Locks in the fix for the 1000x currency-parsing bug: US and European
 * thousands/decimal conventions must both parse correctly.
 */

import { describe, it, expect } from '@jest/globals';

import { parseSAPNumber } from '../adapters/shared/parse-sap-number.js';

describe('parseSAPNumber', () => {
  it('parses European format (1.234,56 -> 1234.56)', () => {
    expect(parseSAPNumber('1.234,56')).toBeCloseTo(1234.56, 2);
  });

  it('parses US/standard format (1,234.56 -> 1234.56)', () => {
    expect(parseSAPNumber('1,234.56')).toBeCloseTo(1234.56, 2);
  });

  it('parses a plain decimal (1234.56 -> 1234.56)', () => {
    expect(parseSAPNumber('1234.56')).toBeCloseTo(1234.56, 2);
  });

  it('parses multi-group European (1.234.567,89 -> 1234567.89)', () => {
    expect(parseSAPNumber('1.234.567,89')).toBeCloseTo(1234567.89, 2);
  });

  it('parses multi-group US (1,234,567.89 -> 1234567.89)', () => {
    expect(parseSAPNumber('1,234,567.89')).toBeCloseTo(1234567.89, 2);
  });

  it('handles trailing-minus negatives (1234.56- -> -1234.56)', () => {
    expect(parseSAPNumber('1234.56-')).toBeCloseTo(-1234.56, 2);
  });

  it('handles parenthesized negatives ((1234.56) -> -1234.56)', () => {
    expect(parseSAPNumber('(1234.56)')).toBeCloseTo(-1234.56, 2);
  });

  it('strips a leading ISO currency code (EUR 1.234,56 -> 1234.56)', () => {
    expect(parseSAPNumber('EUR 1.234,56')).toBeCloseTo(1234.56, 2);
  });

  it('passes numeric input through unchanged', () => {
    expect(parseSAPNumber(4200.5)).toBe(4200.5);
  });

  it('treats empty/blank as 0', () => {
    expect(parseSAPNumber('')).toBe(0);
    expect(parseSAPNumber('   ')).toBe(0);
  });

  it('does NOT collapse a both-separator amount to ~1.2 (the old bug)', () => {
    // The regression this test guards: 1.234,56 and 1,234.56 must not become 1.234.
    expect(parseSAPNumber('1.234,56')).toBeGreaterThan(1000);
    expect(parseSAPNumber('1,234.56')).toBeGreaterThan(1000);
  });
});
