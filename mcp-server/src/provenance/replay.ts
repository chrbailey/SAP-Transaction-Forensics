/**
 * Replay Hash Module — Deterministic Hash Computation
 *
 * Core of replay verification: if you re-run the same extraction and get
 * the same hash, the data hasn't changed. All hashes are SHA-256 hex strings.
 *
 * Canonicalization rules:
 * - JSON keys sorted alphabetically
 * - No whitespace in serialized output
 * - Values trimmed of leading/trailing whitespace
 * - Nulls/undefined normalized to empty strings
 */

import { createHash } from 'node:crypto';

/**
 * Compute a deterministic hash for an extraction query.
 * Same query + same parameters always produces the same hash,
 * regardless of parameter order in the input object.
 */
export function computeQueryHash(
  extractionPathId: string,
  extractionPathVersion: string,
  parameters: Record<string, string>
): string {
  const canonical = JSON.stringify({
    pathId: extractionPathId,
    pathVersion: extractionPathVersion,
    params: sortedParams(parameters),
  });
  return createHash('sha256').update(canonical).digest('hex');
}

/**
 * Compute a deterministic hash for an extraction result set.
 * Same rows in same order always produces the same hash.
 */
export function computeReplayHash(
  rows: Record<string, string>[]
): string {
  const canonical = rows.map(row => canonicalizeRow(row));
  const serialized = JSON.stringify(canonical);
  return createHash('sha256').update(serialized).digest('hex');
}

/**
 * Compute a deterministic hash for a single field extraction.
 * Used for field-level provenance tracking.
 */
export function computeFieldHash(
  systemType: string,
  tableName: string,
  recordId: string,
  fieldName: string,
  value: string
): string {
  const canonical = JSON.stringify({
    system: systemType,
    table: tableName,
    record: recordId,
    field: fieldName,
    value: (value ?? '').trim(),
  });
  return createHash('sha256').update(canonical).digest('hex');
}

/**
 * Verify that a replay hash matches the current data.
 */
export function verifyReplayHash(
  expectedHash: string,
  currentRows: Record<string, string>[]
): { match: boolean; currentHash: string } {
  const currentHash = computeReplayHash(currentRows);
  return { match: expectedHash === currentHash, currentHash };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function sortedParams(params: Record<string, string>): Array<[string, string]> {
  return Object.entries(params)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => [k, (v ?? '').trim()]);
}

function canonicalizeRow(row: Record<string, string>): Array<[string, string]> {
  return Object.entries(row)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => [k, (v ?? '').trim()]);
}
