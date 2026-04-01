/**
 * FindingLifecycleDB — SQLite persistence for unified finding lifecycle tracking.
 *
 * Aggregates findings from all detection sources (contradiction, reality_gap,
 * conformance, fi_co_anomaly) into a single lifecycle table with state
 * transitions, deduplication keys, and filter/stats queries.
 */

import Database from 'better-sqlite3';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FindingSource =
  | 'contradiction'
  | 'reality_gap'
  | 'conformance'
  | 'fi_co_anomaly';

export type FindingSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';

export interface UnifiedFinding {
  id: string;
  source: FindingSource;
  sourceId: string;
  state: string;
  title: string;
  description: string;
  severity: FindingSeverity;
  riskScore: number;
  assignedTo?: string | undefined;
  systemsCovered: string[];
  tablesCovered: string[];
  extractionIds: string[];
  detectedAt: string;
  lastTransitionAt: string;
  resolvedAt?: string | undefined;
  transitions?: StateTransition[] | undefined;
}

export interface StateTransition {
  fromState: string;
  toState: string;
  transitionedAt: string;
  transitionedBy: string;
  evidence?: string | undefined;
  notes: string;
}

export interface FindingKey {
  source: string;
  systemLeft?: string | undefined;
  tableLeft?: string | undefined;
  recordLeft?: string | undefined;
  systemRight?: string | undefined;
  tableRight?: string | undefined;
  recordRight?: string | undefined;
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS unified_findings (
    id TEXT PRIMARY KEY,
    source TEXT NOT NULL CHECK (source IN ('contradiction', 'reality_gap', 'conformance', 'fi_co_anomaly')),
    source_id TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'DETECTED',
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    severity TEXT NOT NULL CHECK (severity IN ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO')),
    risk_score REAL NOT NULL DEFAULT 0,
    assigned_to TEXT,
    systems_covered TEXT NOT NULL DEFAULT '[]',
    tables_covered TEXT NOT NULL DEFAULT '[]',
    extraction_ids TEXT NOT NULL DEFAULT '[]',
    detected_at TEXT NOT NULL,
    last_transition_at TEXT NOT NULL,
    resolved_at TEXT
  );

  CREATE TABLE IF NOT EXISTS finding_transitions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    finding_id TEXT NOT NULL REFERENCES unified_findings(id),
    from_state TEXT NOT NULL,
    to_state TEXT NOT NULL,
    transitioned_at TEXT NOT NULL,
    transitioned_by TEXT NOT NULL,
    evidence TEXT,
    notes TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS finding_dedup_keys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    finding_id TEXT NOT NULL REFERENCES unified_findings(id),
    source TEXT NOT NULL,
    system_left TEXT,
    table_left TEXT,
    record_left TEXT,
    system_right TEXT,
    table_right TEXT,
    record_right TEXT,
    UNIQUE(source, system_left, table_left, record_left, system_right, table_right, record_right)
  );

  CREATE INDEX IF NOT EXISTS idx_findings_state ON unified_findings(state);
  CREATE INDEX IF NOT EXISTS idx_findings_source ON unified_findings(source);
  CREATE INDEX IF NOT EXISTS idx_findings_severity ON unified_findings(severity);
  CREATE INDEX IF NOT EXISTS idx_findings_risk ON unified_findings(risk_score DESC);
  CREATE INDEX IF NOT EXISTS idx_transitions_finding ON finding_transitions(finding_id);
`;

// ---------------------------------------------------------------------------
// FindingLifecycleDB
// ---------------------------------------------------------------------------

export class FindingLifecycleDB {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.exec(SCHEMA_SQL);
  }

  // -------------------------------------------------------------------------
  // Insert / get findings
  // -------------------------------------------------------------------------

  insertFinding(finding: UnifiedFinding): void {
    const stmt = this.db.prepare(`
      INSERT INTO unified_findings
        (id, source, source_id, state, title, description, severity, risk_score,
         assigned_to, systems_covered, tables_covered, extraction_ids,
         detected_at, last_transition_at, resolved_at)
      VALUES
        (?, ?, ?, ?, ?, ?, ?, ?,
         ?, ?, ?, ?,
         ?, ?, ?)
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
      finding.assignedTo ?? null,
      JSON.stringify(finding.systemsCovered),
      JSON.stringify(finding.tablesCovered),
      JSON.stringify(finding.extractionIds),
      finding.detectedAt,
      finding.lastTransitionAt,
      finding.resolvedAt ?? null,
    );
  }

  getFinding(id: string): UnifiedFinding | null {
    const row = this.db.prepare(
      'SELECT * FROM unified_findings WHERE id = ?',
    ).get(id) as Record<string, unknown> | undefined;

    if (!row) return null;

    const finding = this.rowToFinding(row);
    finding.transitions = this.getTransitions(id);
    return finding;
  }

  // -------------------------------------------------------------------------
  // State management
  // -------------------------------------------------------------------------

  updateState(
    id: string,
    newState: string,
    transitionedAt: string,
    resolvedAt?: string,
  ): void {
    if (resolvedAt !== undefined) {
      this.db.prepare(`
        UPDATE unified_findings
        SET state = ?, last_transition_at = ?, resolved_at = ?
        WHERE id = ?
      `).run(newState, transitionedAt, resolvedAt, id);
    } else {
      this.db.prepare(`
        UPDATE unified_findings
        SET state = ?, last_transition_at = ?
        WHERE id = ?
      `).run(newState, transitionedAt, id);
    }
  }

  insertTransition(
    transition: StateTransition & { findingId: string },
  ): void {
    this.db.prepare(`
      INSERT INTO finding_transitions
        (finding_id, from_state, to_state, transitioned_at, transitioned_by, evidence, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      transition.findingId,
      transition.fromState,
      transition.toState,
      transition.transitionedAt,
      transition.transitionedBy,
      transition.evidence ?? null,
      transition.notes,
    );
  }

  getTransitions(findingId: string): StateTransition[] {
    const rows = this.db.prepare(
      'SELECT * FROM finding_transitions WHERE finding_id = ? ORDER BY id ASC',
    ).all(findingId) as Array<Record<string, unknown>>;

    return rows.map((row) => this.rowToTransition(row));
  }

  // -------------------------------------------------------------------------
  // Query with filters
  // -------------------------------------------------------------------------

  queryFindings(filter?: {
    state?: string;
    source?: string;
    severity?: string;
    minRiskScore?: number;
    assignedTo?: string;
  }): UnifiedFinding[] {
    const clauses: string[] = [];
    const params: unknown[] = [];

    if (filter?.state !== undefined) {
      clauses.push('state = ?');
      params.push(filter.state);
    }
    if (filter?.source !== undefined) {
      clauses.push('source = ?');
      params.push(filter.source);
    }
    if (filter?.severity !== undefined) {
      clauses.push('severity = ?');
      params.push(filter.severity);
    }
    if (filter?.minRiskScore !== undefined) {
      clauses.push('risk_score >= ?');
      params.push(filter.minRiskScore);
    }
    if (filter?.assignedTo !== undefined) {
      clauses.push('assigned_to = ?');
      params.push(filter.assignedTo);
    }

    const where = clauses.length > 0
      ? ' WHERE ' + clauses.join(' AND ')
      : '';

    const rows = this.db.prepare(
      `SELECT * FROM unified_findings${where} ORDER BY risk_score DESC`,
    ).all(...params) as Array<Record<string, unknown>>;

    return rows.map((row) => this.rowToFinding(row));
  }

  // -------------------------------------------------------------------------
  // Deduplication
  // -------------------------------------------------------------------------

  registerDedupKey(findingId: string, key: FindingKey): void {
    this.db.prepare(`
      INSERT INTO finding_dedup_keys
        (finding_id, source, system_left, table_left, record_left,
         system_right, table_right, record_right)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      findingId,
      key.source,
      key.systemLeft ?? null,
      key.tableLeft ?? null,
      key.recordLeft ?? null,
      key.systemRight ?? null,
      key.tableRight ?? null,
      key.recordRight ?? null,
    );
  }

  isDuplicate(key: FindingKey): boolean {
    const row = this.db.prepare(`
      SELECT 1 FROM finding_dedup_keys
      WHERE source = ?
        AND system_left IS ?
        AND table_left IS ?
        AND record_left IS ?
        AND system_right IS ?
        AND table_right IS ?
        AND record_right IS ?
      LIMIT 1
    `).get(
      key.source,
      key.systemLeft ?? null,
      key.tableLeft ?? null,
      key.recordLeft ?? null,
      key.systemRight ?? null,
      key.tableRight ?? null,
      key.recordRight ?? null,
    );

    return row !== undefined;
  }

  // -------------------------------------------------------------------------
  // Stats
  // -------------------------------------------------------------------------

  getStats(): {
    total: number;
    byState: Record<string, number>;
    bySource: Record<string, number>;
    bySeverity: Record<string, number>;
  } {
    const total = (
      this.db.prepare('SELECT COUNT(*) AS cnt FROM unified_findings').get() as {
        cnt: number;
      }
    ).cnt;

    const stateRows = this.db.prepare(
      'SELECT state, COUNT(*) AS cnt FROM unified_findings GROUP BY state',
    ).all() as Array<{ state: string; cnt: number }>;

    const byState: Record<string, number> = {};
    for (const row of stateRows) {
      byState[row.state] = row.cnt;
    }

    const sourceRows = this.db.prepare(
      'SELECT source, COUNT(*) AS cnt FROM unified_findings GROUP BY source',
    ).all() as Array<{ source: string; cnt: number }>;

    const bySource: Record<string, number> = {};
    for (const row of sourceRows) {
      bySource[row.source] = row.cnt;
    }

    const severityRows = this.db.prepare(
      'SELECT severity, COUNT(*) AS cnt FROM unified_findings GROUP BY severity',
    ).all() as Array<{ severity: string; cnt: number }>;

    const bySeverity: Record<string, number> = {};
    for (const row of severityRows) {
      bySeverity[row.severity] = row.cnt;
    }

    return { total, byState, bySource, bySeverity };
  }

  // -------------------------------------------------------------------------
  // Cleanup
  // -------------------------------------------------------------------------

  close(): void {
    this.db.close();
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  private rowToFinding(row: Record<string, unknown>): UnifiedFinding {
    return {
      id: row['id'] as string,
      source: row['source'] as FindingSource,
      sourceId: row['source_id'] as string,
      state: row['state'] as string,
      title: row['title'] as string,
      description: row['description'] as string,
      severity: row['severity'] as FindingSeverity,
      riskScore: row['risk_score'] as number,
      assignedTo: (row['assigned_to'] as string | null) ?? undefined,
      systemsCovered: JSON.parse(row['systems_covered'] as string) as string[],
      tablesCovered: JSON.parse(row['tables_covered'] as string) as string[],
      extractionIds: JSON.parse(row['extraction_ids'] as string) as string[],
      detectedAt: row['detected_at'] as string,
      lastTransitionAt: row['last_transition_at'] as string,
      resolvedAt: (row['resolved_at'] as string | null) ?? undefined,
    };
  }

  private rowToTransition(row: Record<string, unknown>): StateTransition {
    return {
      fromState: row['from_state'] as string,
      toState: row['to_state'] as string,
      transitionedAt: row['transitioned_at'] as string,
      transitionedBy: row['transitioned_by'] as string,
      evidence: (row['evidence'] as string | null) ?? undefined,
      notes: row['notes'] as string,
    };
  }
}
