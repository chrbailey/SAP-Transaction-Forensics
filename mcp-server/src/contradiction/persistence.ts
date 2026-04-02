/**
 * ContradictionDB — SQLite persistence for contradiction findings.
 *
 * Stores contradiction findings with full evidence linking, supports
 * cross-session tracking, finding lifecycle management (open -> resolved),
 * deduplication, and schema validation persistence.
 */

import Database from 'better-sqlite3';
import type {
  ContradictionFinding,
  ContradictionType,
  ResolutionStatus,
  Severity,
} from './types.js';
import type { SystemType } from '../provenance/types.js';

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS contradiction_findings (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    severity TEXT NOT NULL CHECK (severity IN ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO')),
    confidence REAL NOT NULL,
    description TEXT NOT NULL,

    left_system TEXT NOT NULL,
    left_table TEXT NOT NULL,
    left_record_id TEXT NOT NULL,
    left_field TEXT NOT NULL,
    left_value TEXT NOT NULL,
    left_extraction_id TEXT NOT NULL,

    right_system TEXT NOT NULL,
    right_table TEXT NOT NULL,
    right_record_id TEXT NOT NULL,
    right_field TEXT NOT NULL,
    right_value TEXT NOT NULL,
    right_extraction_id TEXT NOT NULL,

    scoring_details TEXT NOT NULL DEFAULT '{}',
    risk_score REAL NOT NULL DEFAULT 0,

    detected_at TEXT NOT NULL,
    resolution_status TEXT NOT NULL DEFAULT 'open' CHECK (resolution_status IN ('open', 'confirmed', 'explained', 'false_positive')),
    resolved_at TEXT,
    resolved_by TEXT,
    reviewer_notes TEXT NOT NULL DEFAULT ''
  );

  CREATE INDEX IF NOT EXISTS idx_contradiction_type ON contradiction_findings(type);
  CREATE INDEX IF NOT EXISTS idx_contradiction_severity ON contradiction_findings(severity);
  CREATE INDEX IF NOT EXISTS idx_contradiction_status ON contradiction_findings(resolution_status);
  CREATE INDEX IF NOT EXISTS idx_contradiction_left ON contradiction_findings(left_system, left_table);
  CREATE INDEX IF NOT EXISTS idx_contradiction_right ON contradiction_findings(right_system, right_table);
  CREATE INDEX IF NOT EXISTS idx_contradiction_risk ON contradiction_findings(risk_score DESC);

  CREATE TABLE IF NOT EXISTS schema_validations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id TEXT NOT NULL,
    path_id TEXT NOT NULL,
    valid INTEGER NOT NULL,
    errors TEXT NOT NULL DEFAULT '[]',
    warnings TEXT NOT NULL DEFAULT '[]',
    validated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_schema_client ON schema_validations(client_id);
`;

// ---------------------------------------------------------------------------
// ContradictionDB
// ---------------------------------------------------------------------------

export class ContradictionDB {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.exec(SCHEMA_SQL);
  }

  // -------------------------------------------------------------------------
  // Insert / query findings
  // -------------------------------------------------------------------------

  insertFinding(finding: ContradictionFinding, riskScore: number): void {
    const stmt = this.db.prepare(`
      INSERT INTO contradiction_findings
        (id, type, severity, confidence, description,
         left_system, left_table, left_record_id, left_field, left_value, left_extraction_id,
         right_system, right_table, right_record_id, right_field, right_value, right_extraction_id,
         scoring_details, risk_score,
         detected_at, resolution_status, reviewer_notes)
      VALUES
        (?, ?, ?, ?, ?,
         ?, ?, ?, ?, ?, ?,
         ?, ?, ?, ?, ?, ?,
         ?, ?,
         ?, ?, ?)
    `);
    stmt.run(
      finding.id,
      finding.type,
      finding.severity,
      finding.confidence,
      finding.description,
      finding.leftSystem,
      finding.leftTable,
      finding.leftRecordId,
      finding.leftField,
      finding.leftValue,
      finding.leftExtractionId,
      finding.rightSystem,
      finding.rightTable,
      finding.rightRecordId,
      finding.rightField,
      finding.rightValue,
      finding.rightExtractionId,
      JSON.stringify(finding.scoringDetails),
      riskScore,
      finding.detectedAt,
      finding.resolutionStatus,
      finding.reviewerNotes
    );
  }

  insertBatch(findings: ContradictionFinding[], riskScores: Map<string, number>): void {
    const stmt = this.db.prepare(`
      INSERT INTO contradiction_findings
        (id, type, severity, confidence, description,
         left_system, left_table, left_record_id, left_field, left_value, left_extraction_id,
         right_system, right_table, right_record_id, right_field, right_value, right_extraction_id,
         scoring_details, risk_score,
         detected_at, resolution_status, reviewer_notes)
      VALUES
        (?, ?, ?, ?, ?,
         ?, ?, ?, ?, ?, ?,
         ?, ?, ?, ?, ?, ?,
         ?, ?,
         ?, ?, ?)
    `);

    const insertAll = this.db.transaction((rows: ContradictionFinding[]) => {
      for (const f of rows) {
        stmt.run(
          f.id,
          f.type,
          f.severity,
          f.confidence,
          f.description,
          f.leftSystem,
          f.leftTable,
          f.leftRecordId,
          f.leftField,
          f.leftValue,
          f.leftExtractionId,
          f.rightSystem,
          f.rightTable,
          f.rightRecordId,
          f.rightField,
          f.rightValue,
          f.rightExtractionId,
          JSON.stringify(f.scoringDetails),
          riskScores.get(f.id) ?? 0,
          f.detectedAt,
          f.resolutionStatus,
          f.reviewerNotes
        );
      }
    });

    insertAll(findings);
  }

  getFinding(id: string): ContradictionFinding | null {
    const row = this.db.prepare('SELECT * FROM contradiction_findings WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;

    if (!row) return null;
    return this.rowToFinding(row);
  }

  // -------------------------------------------------------------------------
  // Query with filters
  // -------------------------------------------------------------------------

  queryFindings(filter?: {
    type?: string;
    severity?: string;
    status?: string;
    leftSystem?: string;
    rightSystem?: string;
    minRiskScore?: number;
  }): ContradictionFinding[] {
    const clauses: string[] = [];
    const params: unknown[] = [];

    if (filter?.type !== undefined) {
      clauses.push('type = ?');
      params.push(filter.type);
    }
    if (filter?.severity !== undefined) {
      clauses.push('severity = ?');
      params.push(filter.severity);
    }
    if (filter?.status !== undefined) {
      clauses.push('resolution_status = ?');
      params.push(filter.status);
    }
    if (filter?.leftSystem !== undefined) {
      clauses.push('left_system = ?');
      params.push(filter.leftSystem);
    }
    if (filter?.rightSystem !== undefined) {
      clauses.push('right_system = ?');
      params.push(filter.rightSystem);
    }
    if (filter?.minRiskScore !== undefined) {
      clauses.push('risk_score >= ?');
      params.push(filter.minRiskScore);
    }

    const where = clauses.length > 0 ? ' WHERE ' + clauses.join(' AND ') : '';

    const rows = this.db
      .prepare(`SELECT * FROM contradiction_findings${where} ORDER BY risk_score DESC`)
      .all(...params) as Array<Record<string, unknown>>;

    return rows.map(row => this.rowToFinding(row));
  }

  // -------------------------------------------------------------------------
  // Lifecycle management
  // -------------------------------------------------------------------------

  resolveFinding(
    id: string,
    status: 'confirmed' | 'explained' | 'false_positive',
    resolvedBy: string,
    notes: string
  ): void {
    this.db
      .prepare(
        `
      UPDATE contradiction_findings
      SET resolution_status = ?,
          resolved_at = ?,
          resolved_by = ?,
          reviewer_notes = ?
      WHERE id = ?
    `
      )
      .run(status, new Date().toISOString(), resolvedBy, notes, id);
  }

  // -------------------------------------------------------------------------
  // Deduplication
  // -------------------------------------------------------------------------

  isDuplicate(finding: ContradictionFinding): boolean {
    const row = this.db
      .prepare(
        `
      SELECT 1 FROM contradiction_findings
      WHERE type = ?
        AND left_system = ?
        AND left_table = ?
        AND left_record_id = ?
        AND right_system = ?
        AND right_table = ?
        AND right_record_id = ?
      LIMIT 1
    `
      )
      .get(
        finding.type,
        finding.leftSystem,
        finding.leftTable,
        finding.leftRecordId,
        finding.rightSystem,
        finding.rightTable,
        finding.rightRecordId
      );

    return row !== undefined;
  }

  // -------------------------------------------------------------------------
  // Stats
  // -------------------------------------------------------------------------

  getStats(): {
    total: number;
    open: number;
    confirmed: number;
    explained: number;
    falsePositive: number;
    bySeverity: Record<string, number>;
    byType: Record<string, number>;
  } {
    const total = (
      this.db.prepare('SELECT COUNT(*) AS cnt FROM contradiction_findings').get() as {
        cnt: number;
      }
    ).cnt;

    const statusRows = this.db
      .prepare(
        'SELECT resolution_status, COUNT(*) AS cnt FROM contradiction_findings GROUP BY resolution_status'
      )
      .all() as Array<{ resolution_status: string; cnt: number }>;

    const statusMap: Record<string, number> = {};
    for (const row of statusRows) {
      statusMap[row.resolution_status] = row.cnt;
    }

    const severityRows = this.db
      .prepare('SELECT severity, COUNT(*) AS cnt FROM contradiction_findings GROUP BY severity')
      .all() as Array<{ severity: string; cnt: number }>;

    const bySeverity: Record<string, number> = {};
    for (const row of severityRows) {
      bySeverity[row.severity] = row.cnt;
    }

    const typeRows = this.db
      .prepare('SELECT type, COUNT(*) AS cnt FROM contradiction_findings GROUP BY type')
      .all() as Array<{ type: string; cnt: number }>;

    const byType: Record<string, number> = {};
    for (const row of typeRows) {
      byType[row.type] = row.cnt;
    }

    return {
      total,
      open: statusMap['open'] ?? 0,
      confirmed: statusMap['confirmed'] ?? 0,
      explained: statusMap['explained'] ?? 0,
      falsePositive: statusMap['false_positive'] ?? 0,
      bySeverity,
      byType,
    };
  }

  // -------------------------------------------------------------------------
  // Schema validation persistence
  // -------------------------------------------------------------------------

  insertSchemaValidation(
    clientId: string,
    pathId: string,
    valid: boolean,
    errors: string[],
    warnings: string[]
  ): void {
    this.db
      .prepare(
        `
      INSERT INTO schema_validations (client_id, path_id, valid, errors, warnings, validated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `
      )
      .run(
        clientId,
        pathId,
        valid ? 1 : 0,
        JSON.stringify(errors),
        JSON.stringify(warnings),
        new Date().toISOString()
      );
  }

  getSchemaValidations(clientId: string): Array<{
    pathId: string;
    valid: boolean;
    errors: string[];
    warnings: string[];
    validatedAt: string;
  }> {
    const rows = this.db
      .prepare(
        'SELECT path_id, valid, errors, warnings, validated_at FROM schema_validations WHERE client_id = ? ORDER BY validated_at DESC'
      )
      .all(clientId) as Array<Record<string, unknown>>;

    return rows.map(row => ({
      pathId: row['path_id'] as string,
      valid: (row['valid'] as number) === 1,
      errors: JSON.parse(row['errors'] as string) as string[],
      warnings: JSON.parse(row['warnings'] as string) as string[],
      validatedAt: row['validated_at'] as string,
    }));
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

  private rowToFinding(row: Record<string, unknown>): ContradictionFinding {
    return {
      id: row['id'] as string,
      type: row['type'] as ContradictionType,
      severity: row['severity'] as Severity,
      confidence: row['confidence'] as number,
      description: row['description'] as string,
      leftSystem: row['left_system'] as SystemType,
      leftTable: row['left_table'] as string,
      leftRecordId: row['left_record_id'] as string,
      leftField: row['left_field'] as string,
      leftValue: row['left_value'] as string,
      leftExtractionId: row['left_extraction_id'] as string,
      rightSystem: row['right_system'] as SystemType,
      rightTable: row['right_table'] as string,
      rightRecordId: row['right_record_id'] as string,
      rightField: row['right_field'] as string,
      rightValue: row['right_value'] as string,
      rightExtractionId: row['right_extraction_id'] as string,
      scoringDetails: JSON.parse(row['scoring_details'] as string) as Record<string, number>,
      detectedAt: row['detected_at'] as string,
      resolutionStatus: row['resolution_status'] as ResolutionStatus,
      reviewerNotes: row['reviewer_notes'] as string,
    };
  }
}
