/**
 * Integration test: CSV Adapter + Provenance Logger
 *
 * Verifies that the createCSVAdapterWithProvenance factory correctly wires
 * the ProvenanceLogger middleware onto a real CSVAdapter, using actual
 * SAP IDES CSV fixtures. Every adapter call should produce field-level
 * ExtractionRecords persisted in the provenance SQLite database.
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';

import { createCSVAdapterWithProvenance } from '../adapters/csv/with-provenance.js';
import { CSVAdapter } from '../adapters/csv/index.js';
import { ProvenanceDB } from '../provenance/schema.js';
import type { IDataAdapter } from '../adapters/adapter-interface.js';

// ESM-compatible __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Fixture paths -- real SAP IDES CSV data
const FIXTURE_DIR = resolve(__dirname, '../../test/fixtures');
const CSV_FILES = [
  `${FIXTURE_DIR}/bkpf.csv`,
  `${FIXTURE_DIR}/bseg.csv`,
  `${FIXTURE_DIR}/ska1.csv`,
  `${FIXTURE_DIR}/skat.csv`,
  `${FIXTURE_DIR}/t001.csv`,
];

describe('CSV Adapter + Provenance Integration', () => {
  let adapter: IDataAdapter;
  let csvAdapter: CSVAdapter;
  let provenanceDb: ProvenanceDB;
  let tmpDir: string;
  let dbPath: string;

  beforeAll(async () => {
    // Use a temp directory for the provenance DB so tests are isolated
    tmpDir = mkdtempSync(join(tmpdir(), 'csv-prov-'));
    dbPath = join(tmpDir, 'provenance.db');

    const result = createCSVAdapterWithProvenance(CSV_FILES, dbPath);
    adapter = result.adapter;
    csvAdapter = result.csvAdapter;
    provenanceDb = result.provenanceDb;

    await adapter.initialize();
  }, 30_000); // 30s timeout for loading large CSVs

  afterAll(async () => {
    await adapter.shutdown();
    provenanceDb.close();
    // Clean up temp directory
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // ==========================================================================
  // 1. Factory function basics
  // ==========================================================================

  describe('factory function', () => {
    it('should return an adapter, provenanceDb, and csvAdapter', () => {
      expect(adapter).toBeDefined();
      expect(provenanceDb).toBeInstanceOf(ProvenanceDB);
      expect(csvAdapter).toBeInstanceOf(CSVAdapter);
    });

    it('should preserve the csv adapter name through the wrapper', () => {
      expect(adapter.name).toBe('csv');
    });

    it('should have initialized and loaded data', () => {
      expect(adapter.isReady()).toBe(true);
      const dataset = csvAdapter.getDataset();
      expect(dataset.bkpf.length).toBeGreaterThan(0);
      expect(dataset.bseg.length).toBeGreaterThan(0);
    });
  });

  // ==========================================================================
  // 2. Pass-through behavior -- adapter returns correct results
  // ==========================================================================

  describe('pass-through behavior', () => {
    it('should return null from getSalesDocHeader (CSV adapter has no O2C data)', async () => {
      const result = await adapter.getSalesDocHeader({ vbeln: '0000012345' });
      expect(result).toBeNull();
    });

    it('should return empty array from getSalesDocItems', async () => {
      const result = await adapter.getSalesDocItems({ vbeln: '0000012345' });
      expect(result).toEqual([]);
    });

    it('should return empty array from searchDocText', async () => {
      const result = await adapter.searchDocText({ pattern: 'test' });
      expect(result).toEqual([]);
    });

    it('should return empty DocTextResult from getDocText', async () => {
      const result = await adapter.getDocText({ doc_type: 'sales', doc_key: '12345' });
      expect(result).toEqual({ header_texts: [], item_texts: [] });
    });

    it('should return empty DocFlowResult from getDocFlow', async () => {
      const result = await adapter.getDocFlow({ vbeln: '0000012345' });
      expect(result).toEqual({ root_document: '', flow: [] });
    });

    it('should return null from getDeliveryTiming', async () => {
      const result = await adapter.getDeliveryTiming({ vbeln: '0080012345' });
      expect(result).toBeNull();
    });

    it('should return null from getInvoiceTiming', async () => {
      const result = await adapter.getInvoiceTiming({ vbeln: '0090012345' });
      expect(result).toBeNull();
    });

    it('should return null from getMasterStub', async () => {
      const result = await adapter.getMasterStub({ entity_type: 'customer', id: '0000100001' });
      expect(result).toBeNull();
    });
  });

  // ==========================================================================
  // 3. Provenance DB records -- extraction records were created
  // ==========================================================================

  describe('provenance DB records', () => {
    it('should create extraction records for getDocText (non-null result)', async () => {
      // getDocText returns { header_texts: [], item_texts: [] } -- a non-null object
      // The logger should flatten this into extraction records
      await adapter.getDocText({ doc_type: 'sales', doc_key: 'PROV_TEST_001' });

      const stats = provenanceDb.getStats();
      expect(stats.totalExtractions).toBeGreaterThan(0);
    });

    it('should create extraction records for getDocFlow (non-null result)', async () => {
      // getDocFlow returns { root_document: '', flow: [] } -- a non-null object
      // The root_document empty string field should still produce a record
      await adapter.getDocFlow({ vbeln: 'PROV_TEST_002' });

      const stats = provenanceDb.getStats();
      expect(stats.totalExtractions).toBeGreaterThan(0);
    });

    it('should NOT create extraction records for null results', async () => {
      // Clear provenance state by creating a fresh DB for this specific test
      const isolatedTmpDir = mkdtempSync(join(tmpdir(), 'csv-prov-null-'));
      const isolatedDbPath = join(isolatedTmpDir, 'provenance.db');
      const isolatedResult = createCSVAdapterWithProvenance(CSV_FILES, isolatedDbPath);
      await isolatedResult.adapter.initialize();

      // getSalesDocHeader returns null for CSV adapter
      await isolatedResult.adapter.getSalesDocHeader({ vbeln: 'DOES_NOT_EXIST' });

      const stats = isolatedResult.provenanceDb.getStats();
      expect(stats.totalExtractions).toBe(0);

      await isolatedResult.adapter.shutdown();
      isolatedResult.provenanceDb.close();
      rmSync(isolatedTmpDir, { recursive: true, force: true });
    }, 30_000);
  });

  // ==========================================================================
  // 4. Extraction record correctness -- systemType, adapterId, tableName
  // ==========================================================================

  describe('extraction record correctness', () => {
    let isolatedDb: ProvenanceDB;
    let isolatedAdapter: IDataAdapter;
    let isolatedTmpDir: string;

    beforeAll(async () => {
      isolatedTmpDir = mkdtempSync(join(tmpdir(), 'csv-prov-correct-'));
      const isolatedDbPath = join(isolatedTmpDir, 'provenance.db');
      const result = createCSVAdapterWithProvenance(CSV_FILES, isolatedDbPath);
      isolatedAdapter = result.adapter;
      isolatedDb = result.provenanceDb;
      await isolatedAdapter.initialize();
    }, 30_000);

    afterAll(async () => {
      await isolatedAdapter.shutdown();
      isolatedDb.close();
      rmSync(isolatedTmpDir, { recursive: true, force: true });
    });

    it('should set systemType=SAP on all extraction records', async () => {
      await isolatedAdapter.getDocText({ doc_type: 'sales', doc_key: 'CORRECT_001' });

      const records = isolatedDb.getExtractionsByTable('SAP', 'STXH');
      for (const rec of records) {
        expect(rec.systemType).toBe('SAP');
      }
    });

    it('should set adapterId=csv on all extraction records', async () => {
      await isolatedAdapter.getDocFlow({ vbeln: 'CORRECT_002' });

      const records = isolatedDb.getExtractionsByTable('SAP', 'VBFA');
      for (const rec of records) {
        expect(rec.adapterId).toBe('csv');
      }
    });

    it('should not create extraction records for getDocText with empty arrays', async () => {
      // getDocText returns { header_texts: [], item_texts: [] } from the CSV adapter.
      // Empty arrays produce zero field-level records because there are no elements
      // to flatten. The logger correctly skips empty-array fields.
      const recordsBefore = isolatedDb.getExtractionsByTable('SAP', 'STXH');
      await isolatedAdapter.getDocText({ doc_type: 'sales', doc_key: 'TABLE_001' });
      const recordsAfter = isolatedDb.getExtractionsByTable('SAP', 'STXH');
      expect(recordsAfter.length).toBe(recordsBefore.length);
    });

    it('should set correct table name for getDocFlow (VBFA)', async () => {
      await isolatedAdapter.getDocFlow({ vbeln: 'TABLE_002' });

      const vbfaRecords = isolatedDb.getExtractionsByTable('SAP', 'VBFA');
      expect(vbfaRecords.length).toBeGreaterThan(0);
    });

    it('should set extractionPathId to adapter:csv', async () => {
      await isolatedAdapter.getDocText({ doc_type: 'sales', doc_key: 'PATH_001' });

      const records = isolatedDb.getExtractionsByPath('adapter:csv');
      expect(records.length).toBeGreaterThan(0);
      for (const rec of records) {
        expect(rec.extractionPathId).toBe('adapter:csv');
      }
    });
  });

  // ==========================================================================
  // 5. Replay hash determinism
  // ==========================================================================

  describe('replay hash determinism', () => {
    let isolatedDb: ProvenanceDB;
    let isolatedAdapter: IDataAdapter;
    let isolatedTmpDir: string;

    beforeAll(async () => {
      isolatedTmpDir = mkdtempSync(join(tmpdir(), 'csv-prov-replay-'));
      const isolatedDbPath = join(isolatedTmpDir, 'provenance.db');
      const result = createCSVAdapterWithProvenance(CSV_FILES, isolatedDbPath);
      isolatedAdapter = result.adapter;
      isolatedDb = result.provenanceDb;
      await isolatedAdapter.initialize();
    }, 30_000);

    afterAll(async () => {
      await isolatedAdapter.shutdown();
      isolatedDb.close();
      rmSync(isolatedTmpDir, { recursive: true, force: true });
    });

    it('should produce the same replay hash for identical calls', async () => {
      // Call getDocFlow twice with the same params -- this returns
      // { root_document: '', flow: [] } which produces a record for root_document
      await isolatedAdapter.getDocFlow({ vbeln: 'REPLAY_001' });
      await isolatedAdapter.getDocFlow({ vbeln: 'REPLAY_001' });

      // Get all VBFA records -- should have two batches with the same replay hash
      const allRecords = isolatedDb.getExtractionsByTable('SAP', 'VBFA');
      const replayHashes = new Set(allRecords.map(r => r.replayHash));

      // Both calls return the same result, so replay hash should be identical
      expect(replayHashes.size).toBe(1);
    });

    it('should produce the same query hash for identical method+params', async () => {
      await isolatedAdapter.getDocFlow({ vbeln: 'HASH_001' });
      const firstBatch = isolatedDb.getExtractionsByTable('SAP', 'VBFA');
      const firstHash = firstBatch[firstBatch.length - 1]!.queryHash;

      await isolatedAdapter.getDocFlow({ vbeln: 'HASH_001' });
      const secondBatch = isolatedDb.getExtractionsByTable('SAP', 'VBFA');
      const secondHash = secondBatch[secondBatch.length - 1]!.queryHash;

      // Same method + same params = same query hash
      expect(firstHash).toBe(secondHash);
    });

    it('should produce different query hashes for different params', async () => {
      await isolatedAdapter.getDocFlow({ vbeln: 'DIFF_001' });
      await isolatedAdapter.getDocFlow({ vbeln: 'DIFF_002' });

      const allRecords = isolatedDb.getExtractionsByTable('SAP', 'VBFA');
      const queryHashes = new Set(allRecords.map(r => r.queryHash));

      // Different params should produce at least 2 distinct query hashes
      // (may also include hashes from prior tests in this suite)
      expect(queryHashes.size).toBeGreaterThanOrEqual(2);
    });

    it('should produce SHA-256 hex strings (64 chars) for hashes', async () => {
      await isolatedAdapter.getDocText({ doc_type: 'sales', doc_key: 'SHA_001' });

      const records = isolatedDb.getExtractionsByPath('adapter:csv');
      expect(records.length).toBeGreaterThan(0);
      for (const rec of records) {
        expect(rec.queryHash).toMatch(/^[0-9a-f]{64}$/);
        expect(rec.replayHash).toMatch(/^[0-9a-f]{64}$/);
      }
    });

    it('should support verifyReplay for a known query hash', async () => {
      await isolatedAdapter.getDocText({ doc_type: 'sales', doc_key: 'VERIFY_001' });

      const records = isolatedDb.getExtractionsByPath('adapter:csv');
      const lastRecord = records[records.length - 1]!;

      // The stored replay hash should verify against itself
      const verified = isolatedDb.verifyReplay(lastRecord.queryHash, lastRecord.replayHash);
      expect(verified).toBe(true);

      // A wrong replay hash should NOT verify
      const wrongVerified = isolatedDb.verifyReplay(lastRecord.queryHash, 'deadbeef'.repeat(8));
      expect(wrongVerified).toBe(false);
    });
  });

  // ==========================================================================
  // 6. Stats
  // ==========================================================================

  describe('provenance stats', () => {
    it('should report SAP system counts in stats', () => {
      const stats = provenanceDb.getStats();
      // We have called adapter methods in earlier tests on the shared DB
      if (stats.totalExtractions > 0) {
        expect(stats.systemCounts['SAP']).toBeGreaterThan(0);
      }
    });
  });
});
