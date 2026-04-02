/**
 * Finding Lifecycle — SQLite Persistence Layer
 *
 * Persists unified findings to a SQLite database so that lifecycle state
 * survives across sessions. Works with the in-memory FindingLifecycleManager
 * as the write-through store.
 */

import type {
  FindingState,
  FindingSource,
  FindingSeverity,
  UnifiedFinding,
  StateTransition,
} from './types.js';

// ---------------------------------------------------------------------------
// Minimal SQLite interface (same pattern as provenance/schema.ts)
// We accept any object with run / all / prepare — works with better-sqlite3
// or any compatible driver.
// ---------------------------------------------------------------------------

interface Statement {
  run(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
  get(...params: unknown[]): unknown;
}

export interface Database {
  exec(sql: string): void;
  prepare(sql: string): Statement;
  close(): void;
}

// ---------------------------------------------------------------------------
// Row shape stored in SQLite
// ---------------------------------------------------------------------------

interface FindingRow {
  id: string;
  source: string;
  source_id: string;
  state: string;
  title: string;
  description: string;
  severity: string;
  risk_score: number;
  systems_covered: string; // JSON array
  tables_covered: string; // JSON array
  extraction_ids: string; // JSON array
  assigned_to: string | null;
  detected_at: string;
  last_transition_at: string;
  resolved_at: string | null;
  transitions: string; // JSON array of StateTransition
}

// ---------------------------------------------------------------------------
// FindingLifecycleDB
// ---------------------------------------------------------------------------

export class FindingLifecycleDB {
  private db: Database;

  constructor(db: Database) {
    this.db = db;
    this.initialize();
  }

  // ------------------------------------------------------------------
  // Schema
  // ------------------------------------------------------------------

  private initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS findings (
        id                  TEXT PRIMARY KEY,
        source              TEXT NOT NULL,
        source_id           TEXT NOT NULL,
        state               TEXT NOT NULL DEFAULT 'DETECTED',
        title               TEXT NOT NULL,
        description         TEXT NOT NULL,
        severity            TEXT NOT NULL,
        risk_score          REAL NOT NULL DEFAULT 0,
        systems_covered     TEXT NOT NULL DEFAULT '[]',
        tables_covered      TEXT NOT NULL DEFAULT '[]',
        extraction_ids      TEXT NOT NULL DEFAULT '[]',
        assigned_to         TEXT,
        detected_at         TEXT NOT NULL,
        last_transition_at  TEXT NOT NULL,
        resolved_at         TEXT,
        transitions         TEXT NOT NULL DEFAULT '[]'
      );

      CREATE INDEX IF NOT EXISTS idx_findings_state ON findings(state);
      CREATE INDEX IF NOT EXISTS idx_findings_source ON findings(source);
      CREATE INDEX IF NOT EXISTS idx_findings_severity ON findings(severity);
    `);
  }

  // ------------------------------------------------------------------
  // Write
  // ------------------------------------------------------------------

  /** Persist a finding (insert or replace) */
  save(finding: UnifiedFinding): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO findings (
        id, source, source_id, state, title, description, severity,
        risk_score, systems_covered, tables_covered, extraction_ids,
        assigned_to, detected_at, last_transition_at, resolved_at, transitions
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      finding.id,
      finding.source,
      finding.sourceId,
      finding.state,
      finding.title,
      finding.description,
      finding.severity,
      finding.riskScore,
      JSON.stringify(finding.systemsCovered),
      JSON.stringify(finding.tablesCovered),
      JSON.stringify(finding.extractionIds),
      finding.assignedTo ?? null,
      finding.detectedAt,
      finding.lastTransitionAt,
      finding.resolvedAt ?? null,
      JSON.stringify(finding.transitions)
    );
  }

  // ------------------------------------------------------------------
  // Read
  // ------------------------------------------------------------------

  /** Load a finding by ID */
  load(id: string): UnifiedFinding | undefined {
    const stmt = this.db.prepare('SELECT * FROM findings WHERE id = ?');
    const row = stmt.get(id) as FindingRow | undefined;
    if (!row) return undefined;
    return this.rowToFinding(row);
  }

  /** Load all findings */
  loadAll(): UnifiedFinding[] {
    const stmt = this.db.prepare('SELECT * FROM findings ORDER BY detected_at DESC');
    const rows = stmt.all() as FindingRow[];
    return rows.map(r => this.rowToFinding(r));
  }

  /** Load findings by state */
  loadByState(state: FindingState): UnifiedFinding[] {
    const stmt = this.db.prepare(
      'SELECT * FROM findings WHERE state = ? ORDER BY detected_at DESC'
    );
    const rows = stmt.all(state) as FindingRow[];
    return rows.map(r => this.rowToFinding(r));
  }

  /** Load findings by source */
  loadBySource(source: FindingSource): UnifiedFinding[] {
    const stmt = this.db.prepare(
      'SELECT * FROM findings WHERE source = ? ORDER BY detected_at DESC'
    );
    const rows = stmt.all(source) as FindingRow[];
    return rows.map(r => this.rowToFinding(r));
  }

  /** Count findings by state */
  countByState(): Record<string, number> {
    const stmt = this.db.prepare('SELECT state, COUNT(*) as cnt FROM findings GROUP BY state');
    const rows = stmt.all() as Array<{ state: string; cnt: number }>;
    const result: Record<string, number> = {};
    for (const row of rows) {
      result[row.state] = row.cnt;
    }
    return result;
  }

  // ------------------------------------------------------------------
  // Close
  // ------------------------------------------------------------------

  close(): void {
    this.db.close();
  }

  // ------------------------------------------------------------------
  // Private helpers
  // ------------------------------------------------------------------

  private rowToFinding(row: FindingRow): UnifiedFinding {
    return {
      id: row.id,
      source: row.source as FindingSource,
      sourceId: row.source_id,
      state: row.state as FindingState,
      title: row.title,
      description: row.description,
      severity: row.severity as FindingSeverity,
      riskScore: row.risk_score,
      systemsCovered: JSON.parse(row.systems_covered) as string[],
      tablesCovered: JSON.parse(row.tables_covered) as string[],
      extractionIds: JSON.parse(row.extraction_ids) as string[],
      assignedTo: row.assigned_to ?? undefined,
      detectedAt: row.detected_at,
      lastTransitionAt: row.last_transition_at,
      resolvedAt: row.resolved_at ?? undefined,
      transitions: JSON.parse(row.transitions) as StateTransition[],
    };
  }
}
