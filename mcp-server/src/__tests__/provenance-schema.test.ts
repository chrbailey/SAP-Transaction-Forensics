/**
 * Tests for ProvenanceDB schema and operations.
 *
 * All tests use :memory: SQLite databases — no file I/O required.
 */

import { ProvenanceDB } from '../provenance/schema.js';
import type { ExtractionRecord } from '../provenance/types.js';

function makeRecord(overrides: Partial<ExtractionRecord> = {}): ExtractionRecord {
  return {
    id: 'ext-001',
    adapterId: 'adapter-synth',
    systemType: 'SAP',
    tableName: 'BKPF',
    recordId: 'DOC-100',
    fieldName: 'BUKRS',
    rawValue: '1000',
    normalizedValue: '1000',
    extractionTimestamp: '2026-03-31T12:00:00.000Z',
    queryHash: 'qh-abc123',
    replayHash: 'rh-def456',
    extractionPathId: 'path-01',
    extractionPathVersion: '1.0.0',
    ...overrides,
  };
}

describe('ProvenanceDB', () => {
  let db: ProvenanceDB;

  beforeEach(() => {
    db = new ProvenanceDB(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  // -------------------------------------------------------------------------
  // 1. DB creation
  // -------------------------------------------------------------------------

  describe('creation', () => {
    it('should create tables on initialization', () => {
      // If we get here without throwing, the schema was applied.
      // Verify by inserting and reading back.
      const record = makeRecord();
      db.insertExtraction(record);
      const result = db.getExtraction('ext-001');
      expect(result).not.toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // 2. insertExtraction + getExtraction round-trip
  // -------------------------------------------------------------------------

  describe('insertExtraction + getExtraction', () => {
    it('should round-trip an extraction record', () => {
      const record = makeRecord();
      db.insertExtraction(record);

      const result = db.getExtraction('ext-001');
      expect(result).toEqual(record);
    });

    it('should return null for non-existent id', () => {
      expect(db.getExtraction('nope')).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // 3. insertBatchExtractions (transaction — all or nothing)
  // -------------------------------------------------------------------------

  describe('insertBatchExtractions', () => {
    it('should insert multiple records in a single transaction', () => {
      const records = [
        makeRecord({ id: 'ext-batch-1' }),
        makeRecord({ id: 'ext-batch-2' }),
        makeRecord({ id: 'ext-batch-3' }),
      ];
      db.insertBatchExtractions(records);

      expect(db.getExtraction('ext-batch-1')).not.toBeNull();
      expect(db.getExtraction('ext-batch-2')).not.toBeNull();
      expect(db.getExtraction('ext-batch-3')).not.toBeNull();
    });

    it('should roll back all records if any insert fails', () => {
      const records = [
        makeRecord({ id: 'ext-ok' }),
        makeRecord({ id: 'ext-ok' }), // duplicate PK — will fail
      ];

      expect(() => db.insertBatchExtractions(records)).toThrow();
      // Transaction rolled back: none should exist
      expect(db.getExtraction('ext-ok')).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // 4. linkEvidence + getExtractionsByFinding
  // -------------------------------------------------------------------------

  describe('linkEvidence + getExtractionsByFinding', () => {
    it('should link evidence and retrieve extractions by finding', () => {
      const r1 = makeRecord({ id: 'ext-e1' });
      const r2 = makeRecord({ id: 'ext-e2', systemType: 'Salesforce' });
      db.insertExtraction(r1);
      db.insertExtraction(r2);

      db.linkEvidence('finding-A', 'ext-e1', 'primary');
      db.linkEvidence('finding-A', 'ext-e2', 'corroborating');

      const results = db.getExtractionsByFinding('finding-A');
      expect(results).toHaveLength(2);

      const primary = results.find(r => r.role === 'primary');
      expect(primary).toBeDefined();
      expect(primary!.id).toBe('ext-e1');

      const corroborating = results.find(r => r.role === 'corroborating');
      expect(corroborating).toBeDefined();
      expect(corroborating!.id).toBe('ext-e2');
    });

    it('should return empty array for finding with no evidence', () => {
      expect(db.getExtractionsByFinding('orphan')).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // 5. getExtractionsByQuery
  // -------------------------------------------------------------------------

  describe('getExtractionsByQuery', () => {
    it('should return all records with same query hash', () => {
      db.insertExtraction(makeRecord({ id: 'ext-q1', queryHash: 'shared-hash' }));
      db.insertExtraction(makeRecord({ id: 'ext-q2', queryHash: 'shared-hash' }));
      db.insertExtraction(makeRecord({ id: 'ext-q3', queryHash: 'other-hash' }));

      const results = db.getExtractionsByQuery('shared-hash');
      expect(results).toHaveLength(2);
      expect(results.map(r => r.id).sort()).toEqual(['ext-q1', 'ext-q2']);
    });

    it('should return empty array for unknown query hash', () => {
      expect(db.getExtractionsByQuery('no-such-hash')).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // 6. getExtractionsByTable
  // -------------------------------------------------------------------------

  describe('getExtractionsByTable', () => {
    it('should filter by system type and table name', () => {
      db.insertExtraction(makeRecord({ id: 'ext-t1', systemType: 'SAP', tableName: 'BKPF' }));
      db.insertExtraction(makeRecord({ id: 'ext-t2', systemType: 'SAP', tableName: 'BSEG' }));
      db.insertExtraction(
        makeRecord({ id: 'ext-t3', systemType: 'Salesforce', tableName: 'BKPF' })
      );

      const sapBkpf = db.getExtractionsByTable('SAP', 'BKPF');
      expect(sapBkpf).toHaveLength(1);
      expect(sapBkpf[0]!.id).toBe('ext-t1');

      const sapBseg = db.getExtractionsByTable('SAP', 'BSEG');
      expect(sapBseg).toHaveLength(1);
      expect(sapBseg[0]!.id).toBe('ext-t2');

      const sfBkpf = db.getExtractionsByTable('Salesforce', 'BKPF');
      expect(sfBkpf).toHaveLength(1);
      expect(sfBkpf[0]!.id).toBe('ext-t3');
    });

    it('should return empty array when no matches', () => {
      expect(db.getExtractionsByTable('NetSuite', 'NONE')).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // 7. getExtractionsByPath with and without version
  // -------------------------------------------------------------------------

  describe('getExtractionsByPath', () => {
    beforeEach(() => {
      db.insertExtraction(
        makeRecord({ id: 'ext-p1', extractionPathId: 'path-A', extractionPathVersion: '1.0' })
      );
      db.insertExtraction(
        makeRecord({ id: 'ext-p2', extractionPathId: 'path-A', extractionPathVersion: '2.0' })
      );
      db.insertExtraction(
        makeRecord({ id: 'ext-p3', extractionPathId: 'path-B', extractionPathVersion: '1.0' })
      );
    });

    it('should return all versions when no version specified', () => {
      const results = db.getExtractionsByPath('path-A');
      expect(results).toHaveLength(2);
      expect(results.map(r => r.id).sort()).toEqual(['ext-p1', 'ext-p2']);
    });

    it('should filter by version when specified', () => {
      const results = db.getExtractionsByPath('path-A', '1.0');
      expect(results).toHaveLength(1);
      expect(results[0]!.id).toBe('ext-p1');
    });

    it('should return empty for non-existent path', () => {
      expect(db.getExtractionsByPath('path-Z')).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // 8. verifyReplay
  // -------------------------------------------------------------------------

  describe('verifyReplay', () => {
    beforeEach(() => {
      db.insertExtraction(makeRecord({ queryHash: 'qh-replay', replayHash: 'rh-correct' }));
    });

    it('should return true when replay hash matches', () => {
      expect(db.verifyReplay('qh-replay', 'rh-correct')).toBe(true);
    });

    it('should return false when replay hash does not match', () => {
      expect(db.verifyReplay('qh-replay', 'rh-wrong')).toBe(false);
    });

    it('should return false for unknown query hash', () => {
      expect(db.verifyReplay('unknown', 'rh-correct')).toBe(false);
    });

    it('getReplayHash should return the stored hash', () => {
      expect(db.getReplayHash('qh-replay')).toBe('rh-correct');
    });

    it('getReplayHash should return null for unknown query hash', () => {
      expect(db.getReplayHash('nope')).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // 9. getStats
  // -------------------------------------------------------------------------

  describe('getStats', () => {
    it('should return correct counts', () => {
      db.insertExtraction(makeRecord({ id: 'ext-s1', systemType: 'SAP' }));
      db.insertExtraction(makeRecord({ id: 'ext-s2', systemType: 'SAP' }));
      db.insertExtraction(makeRecord({ id: 'ext-s3', systemType: 'Salesforce' }));

      db.linkEvidence('finding-X', 'ext-s1', 'primary');
      db.linkEvidence('finding-Y', 'ext-s3', 'contradicting');

      const stats = db.getStats();
      expect(stats.totalExtractions).toBe(3);
      expect(stats.totalFindings).toBe(2);
      expect(stats.systemCounts).toEqual({ SAP: 2, Salesforce: 1 });
    });

    it('should return zeros when empty', () => {
      const stats = db.getStats();
      expect(stats.totalExtractions).toBe(0);
      expect(stats.totalFindings).toBe(0);
      expect(stats.systemCounts).toEqual({});
    });
  });
});
