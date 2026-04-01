/**
 * Tests for Replay Hash Module
 *
 * Validates deterministic hash computation for extraction queries,
 * result sets, and individual fields.
 */

import { describe, it, expect } from '@jest/globals';

import {
  computeQueryHash,
  computeReplayHash,
  computeFieldHash,
  verifyReplayHash,
} from '../provenance/replay.js';

describe('Replay Hash Module', () => {
  // -----------------------------------------------------------------------
  // computeQueryHash
  // -----------------------------------------------------------------------
  describe('computeQueryHash', () => {
    it('should produce the same hash for the same inputs', () => {
      const params = { company: '1000', year: '2025' };
      const h1 = computeQueryHash('BKPF_EXTRACT', 'v1', params);
      const h2 = computeQueryHash('BKPF_EXTRACT', 'v1', params);
      expect(h1).toBe(h2);
    });

    it('should produce the same hash regardless of parameter order', () => {
      const params1 = { company: '1000', year: '2025', docType: 'RE' };
      const params2 = { docType: 'RE', company: '1000', year: '2025' };
      const params3 = { year: '2025', docType: 'RE', company: '1000' };
      const h1 = computeQueryHash('BKPF_EXTRACT', 'v1', params1);
      const h2 = computeQueryHash('BKPF_EXTRACT', 'v1', params2);
      const h3 = computeQueryHash('BKPF_EXTRACT', 'v1', params3);
      expect(h1).toBe(h2);
      expect(h2).toBe(h3);
    });

    it('should produce different hashes for different parameters', () => {
      const h1 = computeQueryHash('BKPF_EXTRACT', 'v1', { company: '1000' });
      const h2 = computeQueryHash('BKPF_EXTRACT', 'v1', { company: '2000' });
      expect(h1).not.toBe(h2);
    });

    it('should produce different hashes for different path IDs', () => {
      const params = { company: '1000' };
      const h1 = computeQueryHash('BKPF_EXTRACT', 'v1', params);
      const h2 = computeQueryHash('BSEG_EXTRACT', 'v1', params);
      expect(h1).not.toBe(h2);
    });

    it('should produce different hashes for different versions', () => {
      const params = { company: '1000' };
      const h1 = computeQueryHash('BKPF_EXTRACT', 'v1', params);
      const h2 = computeQueryHash('BKPF_EXTRACT', 'v2', params);
      expect(h1).not.toBe(h2);
    });

    it('should trim whitespace in parameter values', () => {
      const h1 = computeQueryHash('BKPF_EXTRACT', 'v1', { company: '1000' });
      const h2 = computeQueryHash('BKPF_EXTRACT', 'v1', { company: '  1000  ' });
      expect(h1).toBe(h2);
    });
  });

  // -----------------------------------------------------------------------
  // computeReplayHash
  // -----------------------------------------------------------------------
  describe('computeReplayHash', () => {
    it('should produce the same hash for the same rows', () => {
      const rows = [
        { BUKRS: '1000', BELNR: '0100000001', GJAHR: '2025' },
        { BUKRS: '1000', BELNR: '0100000002', GJAHR: '2025' },
      ];
      const h1 = computeReplayHash(rows);
      const h2 = computeReplayHash(rows);
      expect(h1).toBe(h2);
    });

    it('should produce different hashes for different row order', () => {
      const row1 = { BUKRS: '1000', BELNR: '0100000001' };
      const row2 = { BUKRS: '1000', BELNR: '0100000002' };
      const h1 = computeReplayHash([row1, row2]);
      const h2 = computeReplayHash([row2, row1]);
      expect(h1).not.toBe(h2);
    });

    it('should produce the same hash regardless of key order within a row', () => {
      const rows1 = [{ BUKRS: '1000', BELNR: '001', GJAHR: '2025' }];
      const rows2 = [{ GJAHR: '2025', BUKRS: '1000', BELNR: '001' }];
      const h1 = computeReplayHash(rows1);
      const h2 = computeReplayHash(rows2);
      expect(h1).toBe(h2);
    });

    it('should produce a consistent hash for an empty result set', () => {
      const h1 = computeReplayHash([]);
      const h2 = computeReplayHash([]);
      expect(h1).toBe(h2);
    });

    it('should normalize null/undefined values to empty strings', () => {
      // TypeScript types say Record<string, string>, but at runtime
      // data from adapters may contain nullish values
      const rowWithNull = { BUKRS: '1000', BELNR: null as unknown as string };
      const rowWithUndef = { BUKRS: '1000', BELNR: undefined as unknown as string };
      const rowWithEmpty = { BUKRS: '1000', BELNR: '' };
      const h1 = computeReplayHash([rowWithNull]);
      const h2 = computeReplayHash([rowWithUndef]);
      const h3 = computeReplayHash([rowWithEmpty]);
      expect(h1).toBe(h3);
      expect(h2).toBe(h3);
    });
  });

  // -----------------------------------------------------------------------
  // computeFieldHash
  // -----------------------------------------------------------------------
  describe('computeFieldHash', () => {
    it('should be deterministic for the same inputs', () => {
      const h1 = computeFieldHash('SAP', 'BKPF', 'DOC001', 'BUKRS', '1000');
      const h2 = computeFieldHash('SAP', 'BKPF', 'DOC001', 'BUKRS', '1000');
      expect(h1).toBe(h2);
    });

    it('should produce different hashes for different fields', () => {
      const h1 = computeFieldHash('SAP', 'BKPF', 'DOC001', 'BUKRS', '1000');
      const h2 = computeFieldHash('SAP', 'BKPF', 'DOC001', 'GJAHR', '2025');
      expect(h1).not.toBe(h2);
    });

    it('should produce different hashes for different systems', () => {
      const h1 = computeFieldHash('SAP', 'BKPF', 'DOC001', 'BUKRS', '1000');
      const h2 = computeFieldHash('Salesforce', 'BKPF', 'DOC001', 'BUKRS', '1000');
      expect(h1).not.toBe(h2);
    });

    it('should produce different hashes for different records', () => {
      const h1 = computeFieldHash('SAP', 'BKPF', 'DOC001', 'BUKRS', '1000');
      const h2 = computeFieldHash('SAP', 'BKPF', 'DOC002', 'BUKRS', '1000');
      expect(h1).not.toBe(h2);
    });

    it('should trim whitespace in the value', () => {
      const h1 = computeFieldHash('SAP', 'BKPF', 'DOC001', 'BUKRS', '1000');
      const h2 = computeFieldHash('SAP', 'BKPF', 'DOC001', 'BUKRS', '  1000  ');
      expect(h1).toBe(h2);
    });

    it('should normalize null value to empty string', () => {
      const h1 = computeFieldHash('SAP', 'BKPF', 'DOC001', 'BUKRS', null as unknown as string);
      const h2 = computeFieldHash('SAP', 'BKPF', 'DOC001', 'BUKRS', '');
      expect(h1).toBe(h2);
    });
  });

  // -----------------------------------------------------------------------
  // verifyReplayHash
  // -----------------------------------------------------------------------
  describe('verifyReplayHash', () => {
    it('should return match=true when data is unchanged', () => {
      const rows = [
        { BUKRS: '1000', BELNR: '0100000001' },
        { BUKRS: '1000', BELNR: '0100000002' },
      ];
      const originalHash = computeReplayHash(rows);
      const result = verifyReplayHash(originalHash, rows);
      expect(result.match).toBe(true);
      expect(result.currentHash).toBe(originalHash);
    });

    it('should return match=false when data has changed, and include the current hash', () => {
      const originalRows = [
        { BUKRS: '1000', BELNR: '0100000001' },
        { BUKRS: '1000', BELNR: '0100000002' },
      ];
      const originalHash = computeReplayHash(originalRows);

      const modifiedRows = [
        { BUKRS: '1000', BELNR: '0100000001' },
        { BUKRS: '1000', BELNR: '0100000099' },  // changed
      ];
      const result = verifyReplayHash(originalHash, modifiedRows);
      expect(result.match).toBe(false);
      expect(result.currentHash).not.toBe(originalHash);
      // The currentHash should be a valid SHA-256 hex string
      expect(result.currentHash).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  // -----------------------------------------------------------------------
  // Hash format
  // -----------------------------------------------------------------------
  describe('Hash format', () => {
    it('all hashes should be 64-character hex strings (SHA-256)', () => {
      const sha256Hex = /^[0-9a-f]{64}$/;

      const queryHash = computeQueryHash('PATH', 'v1', { key: 'val' });
      expect(queryHash).toMatch(sha256Hex);

      const replayHash = computeReplayHash([{ col: 'data' }]);
      expect(replayHash).toMatch(sha256Hex);

      const fieldHash = computeFieldHash('SAP', 'T', 'R', 'F', 'V');
      expect(fieldHash).toMatch(sha256Hex);

      const emptyReplayHash = computeReplayHash([]);
      expect(emptyReplayHash).toMatch(sha256Hex);
    });
  });
});
