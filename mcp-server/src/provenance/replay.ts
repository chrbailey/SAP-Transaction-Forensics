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
export function computeReplayHash(rows: Record<string, string>[]): string {
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

/**
 * Deterministic canonical serialization of an arbitrary JSON-like value.
 *
 * Unlike `JSON.stringify`, this recursively sorts object keys at every depth,
 * so two logically-equal values serialize identically regardless of key order,
 * and — critically — the serialization actually covers every leaf value. (The
 * previous per-record hasher passed `Object.keys(result)` as JSON.stringify's
 * replacer array, which for an array-of-rows collapsed every row to `{}`, so
 * the hash was a function of row count only and did not detect tampering.)
 *
 * Canonicalization rules (matching this module's header contract):
 * - object keys sorted alphabetically at all depths
 * - null / undefined normalized to ""
 * - string leaves trimmed of leading/trailing whitespace
 * - arrays preserve order (order is evidentiary)
 */
export function canonicalStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'string') {
    return value.trim();
  }
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = canonicalize((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  // numbers, booleans — leave as-is (stable under JSON.stringify)
  return value;
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
