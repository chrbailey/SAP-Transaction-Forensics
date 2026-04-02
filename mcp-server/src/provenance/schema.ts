/**
 * ProvenanceDB — SQLite persistence for field-level provenance tracking.
 *
 * Stores extraction records (system/table/record/field/value/timestamp tuples)
 * and links them to findings as evidence. Supports replay verification by
 * comparing stored replay hashes against current extraction results.
 */

import Database from 'better-sqlite3';
import type { ExtractionRecord, EvidenceRole, SystemType } from './types.js';

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS extraction_records (
    id TEXT PRIMARY KEY,
    adapter_id TEXT NOT NULL,
    system_type TEXT NOT NULL CHECK (system_type IN ('SAP', 'NetSuite', 'Salesforce')),
    table_name TEXT NOT NULL,
    record_id TEXT NOT NULL DEFAULT '',
    field_name TEXT NOT NULL DEFAULT '',
    raw_value TEXT NOT NULL DEFAULT '',
    normalized_value TEXT NOT NULL DEFAULT '',
    extraction_timestamp TEXT NOT NULL,
    query_hash TEXT NOT NULL,
    replay_hash TEXT NOT NULL,
    extraction_path_id TEXT NOT NULL DEFAULT '',
    extraction_path_version TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS finding_evidence (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    finding_id TEXT NOT NULL,
    extraction_id TEXT NOT NULL REFERENCES extraction_records(id),
    role TEXT NOT NULL CHECK (role IN ('primary', 'corroborating', 'contradicting')),
    added_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_extraction_system ON extraction_records(system_type);
  CREATE INDEX IF NOT EXISTS idx_extraction_table ON extraction_records(table_name);
  CREATE INDEX IF NOT EXISTS idx_extraction_path ON extraction_records(extraction_path_id);
  CREATE INDEX IF NOT EXISTS idx_extraction_query_hash ON extraction_records(query_hash);
  CREATE INDEX IF NOT EXISTS idx_extraction_timestamp ON extraction_records(extraction_timestamp);
  CREATE INDEX IF NOT EXISTS idx_evidence_finding ON finding_evidence(finding_id);
  CREATE INDEX IF NOT EXISTS idx_evidence_extraction ON finding_evidence(extraction_id);
`;

export class ProvenanceDB {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.exec(SCHEMA_SQL);
  }

  // ---------------------------------------------------------------------------
  // Core operations
  // ---------------------------------------------------------------------------

  insertExtraction(record: ExtractionRecord): void {
    const stmt = this.db.prepare(`
      INSERT INTO extraction_records
        (id, adapter_id, system_type, table_name, record_id, field_name,
         raw_value, normalized_value, extraction_timestamp, query_hash,
         replay_hash, extraction_path_id, extraction_path_version)
      VALUES
        (@id, @adapterId, @systemType, @tableName, @recordId, @fieldName,
         @rawValue, @normalizedValue, @extractionTimestamp, @queryHash,
         @replayHash, @extractionPathId, @extractionPathVersion)
    `);
    stmt.run(record);
  }

  insertBatchExtractions(records: ExtractionRecord[]): void {
    const stmt = this.db.prepare(`
      INSERT INTO extraction_records
        (id, adapter_id, system_type, table_name, record_id, field_name,
         raw_value, normalized_value, extraction_timestamp, query_hash,
         replay_hash, extraction_path_id, extraction_path_version)
      VALUES
        (@id, @adapterId, @systemType, @tableName, @recordId, @fieldName,
         @rawValue, @normalizedValue, @extractionTimestamp, @queryHash,
         @replayHash, @extractionPathId, @extractionPathVersion)
    `);

    const insertAll = this.db.transaction((rows: ExtractionRecord[]) => {
      for (const row of rows) {
        stmt.run(row);
      }
    });

    insertAll(records);
  }

  linkEvidence(findingId: string, extractionId: string, role: EvidenceRole): void {
    const stmt = this.db.prepare(`
      INSERT INTO finding_evidence (finding_id, extraction_id, role, added_at)
      VALUES (?, ?, ?, ?)
    `);
    stmt.run(findingId, extractionId, role, new Date().toISOString());
  }

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  getExtraction(id: string): ExtractionRecord | null {
    const row = this.db.prepare('SELECT * FROM extraction_records WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;

    if (!row) return null;
    return this.rowToExtractionRecord(row);
  }

  getExtractionsByFinding(findingId: string): Array<ExtractionRecord & { role: EvidenceRole }> {
    const rows = this.db
      .prepare(
        `
      SELECT er.*, fe.role
      FROM finding_evidence fe
      JOIN extraction_records er ON er.id = fe.extraction_id
      WHERE fe.finding_id = ?
    `
      )
      .all(findingId) as Array<Record<string, unknown>>;

    return rows.map(row => ({
      ...this.rowToExtractionRecord(row),
      role: row['role'] as EvidenceRole,
    }));
  }

  getExtractionsByQuery(queryHash: string): ExtractionRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM extraction_records WHERE query_hash = ?')
      .all(queryHash) as Array<Record<string, unknown>>;

    return rows.map(row => this.rowToExtractionRecord(row));
  }

  getExtractionsByTable(systemType: SystemType, tableName: string): ExtractionRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM extraction_records WHERE system_type = ? AND table_name = ?')
      .all(systemType, tableName) as Array<Record<string, unknown>>;

    return rows.map(row => this.rowToExtractionRecord(row));
  }

  getExtractionsByPath(pathId: string, pathVersion?: string): ExtractionRecord[] {
    if (pathVersion !== undefined) {
      const rows = this.db
        .prepare(
          'SELECT * FROM extraction_records WHERE extraction_path_id = ? AND extraction_path_version = ?'
        )
        .all(pathId, pathVersion) as Array<Record<string, unknown>>;

      return rows.map(row => this.rowToExtractionRecord(row));
    }

    const rows = this.db
      .prepare('SELECT * FROM extraction_records WHERE extraction_path_id = ?')
      .all(pathId) as Array<Record<string, unknown>>;

    return rows.map(row => this.rowToExtractionRecord(row));
  }

  // ---------------------------------------------------------------------------
  // Replay verification
  // ---------------------------------------------------------------------------

  getReplayHash(queryHash: string): string | null {
    const row = this.db
      .prepare('SELECT replay_hash FROM extraction_records WHERE query_hash = ? LIMIT 1')
      .get(queryHash) as { replay_hash: string } | undefined;

    return row?.replay_hash ?? null;
  }

  verifyReplay(queryHash: string, currentReplayHash: string): boolean {
    const stored = this.getReplayHash(queryHash);
    if (stored === null) return false;
    return stored === currentReplayHash;
  }

  // ---------------------------------------------------------------------------
  // Stats
  // ---------------------------------------------------------------------------

  getStats(): {
    totalExtractions: number;
    totalFindings: number;
    systemCounts: Record<string, number>;
  } {
    const totalExtractions = (
      this.db.prepare('SELECT COUNT(*) AS cnt FROM extraction_records').get() as {
        cnt: number;
      }
    ).cnt;

    const totalFindings = (
      this.db.prepare('SELECT COUNT(DISTINCT finding_id) AS cnt FROM finding_evidence').get() as {
        cnt: number;
      }
    ).cnt;

    const systemRows = this.db
      .prepare('SELECT system_type, COUNT(*) AS cnt FROM extraction_records GROUP BY system_type')
      .all() as Array<{ system_type: string; cnt: number }>;

    const systemCounts: Record<string, number> = {};
    for (const row of systemRows) {
      systemCounts[row.system_type] = row.cnt;
    }

    return { totalExtractions, totalFindings, systemCounts };
  }

  // ---------------------------------------------------------------------------
  // Cleanup
  // ---------------------------------------------------------------------------

  close(): void {
    this.db.close();
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private rowToExtractionRecord(row: Record<string, unknown>): ExtractionRecord {
    return {
      id: row['id'] as string,
      adapterId: row['adapter_id'] as string,
      systemType: row['system_type'] as SystemType,
      tableName: row['table_name'] as string,
      recordId: row['record_id'] as string,
      fieldName: row['field_name'] as string,
      rawValue: row['raw_value'] as string,
      normalizedValue: row['normalized_value'] as string,
      extractionTimestamp: row['extraction_timestamp'] as string,
      queryHash: row['query_hash'] as string,
      replayHash: row['replay_hash'] as string,
      extractionPathId: row['extraction_path_id'] as string,
      extractionPathVersion: row['extraction_path_version'] as string,
    };
  }
}
