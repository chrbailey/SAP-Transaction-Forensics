/**
 * Extraction Manifest Generator
 *
 * Generates the extraction manifest and reproduction script that allows
 * independent verification of forensic findings. The manifest records
 * every extraction performed, its parameters, and cryptographic hashes
 * so a reviewer can re-run queries and confirm hash matches.
 */

// --- Local types (self-contained module) ---

interface ManifestEntry {
  extractionPathId: string;
  extractionPathVersion: string;
  parameters: Record<string, string>;
  queryHash: string;
  replayHash: string;
  extractedAt: string;
  rowCount: number;
}

interface ExtractionManifest {
  engagementId: string;
  generatedAt: string;
  entries: ManifestEntry[];
  totalExtractions: number;
  totalRows: number;
  systems: string[];
}

interface ExtractionInput {
  extractionPathId: string;
  extractionPathVersion: string;
  parameters: Record<string, string>;
  queryHash: string;
  replayHash: string;
  extractedAt: string;
  rowCount: number;
  systemType: string;
}

interface ValidationResult {
  valid: boolean;
  errors: string[];
}

// SHA-256 hash pattern: 64 hex characters
const SHA256_PATTERN = /^[0-9a-f]{64}$/i;

export class ManifestGenerator {
  /**
   * Generate extraction manifest from provenance records.
   *
   * Aggregates extraction inputs into a manifest with deduped system list,
   * total row count, and ISO 8601 timestamp.
   */
  generateManifest(engagementId: string, extractions: ExtractionInput[]): ExtractionManifest {
    const entries: ManifestEntry[] = extractions.map(ext => ({
      extractionPathId: ext.extractionPathId,
      extractionPathVersion: ext.extractionPathVersion,
      parameters: ext.parameters,
      queryHash: ext.queryHash,
      replayHash: ext.replayHash,
      extractedAt: ext.extractedAt,
      rowCount: ext.rowCount,
    }));

    const systems = [...new Set(extractions.map(ext => ext.systemType))];
    const totalRows = entries.reduce((sum, e) => sum + e.rowCount, 0);

    return {
      engagementId,
      generatedAt: new Date().toISOString(),
      entries,
      totalExtractions: entries.length,
      totalRows,
      systems,
    };
  }

  /**
   * Generate a reproduction README in Markdown.
   *
   * Explains how to independently verify each extraction:
   * 1. Run the query with the given parameters
   * 2. Compute SHA-256 of the result set
   * 3. Compare against the replayHash in the manifest
   * 4. If hashes match, the finding's evidence is independently verified
   */
  generateReproductionReadme(manifest: ExtractionManifest): string {
    const lines: string[] = [];

    lines.push(`# Extraction Reproduction Guide`);
    lines.push(``);
    lines.push(`**Engagement:** ${manifest.engagementId}`);
    lines.push(`**Generated:** ${manifest.generatedAt}`);
    lines.push(`**Total Extractions:** ${manifest.totalExtractions}`);
    lines.push(`**Total Rows:** ${manifest.totalRows}`);
    lines.push(`**Systems:** ${manifest.systems.join(', ')}`);
    lines.push(``);
    lines.push(`## Independent Verification Steps`);
    lines.push(``);
    lines.push(`For each extraction listed below:`);
    lines.push(``);
    lines.push(`1. Connect to the source system using the specified extraction path`);
    lines.push(`2. Run the query with the given parameters`);
    lines.push(`3. Compute the SHA-256 hash of the result set`);
    lines.push(`4. Compare the computed hash against the **replayHash** in the manifest`);
    lines.push(`5. If hashes match, the extraction data is independently verified`);
    lines.push(``);
    lines.push(`> A matching replayHash confirms that the data used in findings`);
    lines.push(`> is identical to what the source system returns for the same query.`);
    lines.push(``);
    lines.push(`## Extractions`);
    lines.push(``);

    for (const entry of manifest.entries) {
      lines.push(`### ${entry.extractionPathId} (v${entry.extractionPathVersion})`);
      lines.push(``);
      lines.push(`- **Extracted At:** ${entry.extractedAt}`);
      lines.push(`- **Row Count:** ${entry.rowCount}`);
      lines.push(`- **Query Hash:** \`${entry.queryHash}\``);
      lines.push(`- **Expected Replay Hash:** \`${entry.replayHash}\``);
      lines.push(``);

      const paramKeys = Object.keys(entry.parameters);
      if (paramKeys.length > 0) {
        lines.push(`**Parameters:**`);
        lines.push(``);
        lines.push(`| Parameter | Value |`);
        lines.push(`|-----------|-------|`);
        for (const key of paramKeys) {
          lines.push(`| ${key} | ${entry.parameters[key]} |`);
        }
        lines.push(``);
      }

      lines.push(`**Verification:**`);
      lines.push(``);
      lines.push('```bash');
      lines.push(`# Re-run extraction and verify hash`);
      lines.push(
        `RESULT_HASH=$(run_extraction --path "${entry.extractionPathId}" --version "${entry.extractionPathVersion}" | sha256sum | awk '{print $1}')`
      );
      lines.push(`echo "Expected: ${entry.replayHash}"`);
      lines.push(`echo "Actual:   $RESULT_HASH"`);
      lines.push(
        `[ "$RESULT_HASH" = "${entry.replayHash}" ] && echo "VERIFIED" || echo "MISMATCH"`
      );
      lines.push('```');
      lines.push(``);
    }

    return lines.join('\n');
  }

  /**
   * Generate extraction-manifest.json content.
   *
   * Returns pretty-printed JSON of the manifest for inclusion in
   * the handoff packet.
   */
  generateManifestJSON(manifest: ExtractionManifest): string {
    return JSON.stringify(manifest, null, 2);
  }

  /**
   * Generate a shell script that re-runs all extractions.
   *
   * Outputs a bash script with comments showing each extraction path,
   * parameters, and expected hash. Uses the `run_extraction` MCP tool
   * or direct SQL commands.
   */
  generateVerificationScript(manifest: ExtractionManifest): string {
    const lines: string[] = [];

    lines.push(`#!/usr/bin/env bash`);
    lines.push(`#`);
    lines.push(`# Extraction Verification Script`);
    lines.push(`# Engagement: ${manifest.engagementId}`);
    lines.push(`# Generated: ${manifest.generatedAt}`);
    lines.push(`# Total Extractions: ${manifest.totalExtractions}`);
    lines.push(`#`);
    lines.push(`# This script re-runs each extraction and compares the result hash`);
    lines.push(`# against the expected replayHash recorded in the manifest.`);
    lines.push(`#`);
    lines.push(`set -euo pipefail`);
    lines.push(``);
    lines.push(`PASS=0`);
    lines.push(`FAIL=0`);
    lines.push(`TOTAL=${manifest.totalExtractions}`);
    lines.push(``);
    lines.push(`echo "=== Extraction Verification ==="`);
    lines.push(`echo "Engagement: ${manifest.engagementId}"`);
    lines.push(`echo "Verifying $TOTAL extractions..."`);
    lines.push(`echo ""`);

    for (let i = 0; i < manifest.entries.length; i++) {
      const entry = manifest.entries[i]!;
      const idx = i + 1;

      lines.push(``);
      lines.push(`# --- Extraction ${idx}/${manifest.totalExtractions} ---`);
      lines.push(`# Path: ${entry.extractionPathId} v${entry.extractionPathVersion}`);
      lines.push(`# Extracted At: ${entry.extractedAt}`);
      lines.push(`# Expected Rows: ${entry.rowCount}`);
      lines.push(`# Expected Hash: ${entry.replayHash}`);

      // Build parameter string
      const paramArgs = Object.entries(entry.parameters)
        .map(([k, v]) => `--param "${k}=${v}"`)
        .join(' ');

      lines.push(
        `echo "[${idx}/$TOTAL] Verifying ${entry.extractionPathId} v${entry.extractionPathVersion}..."`
      );
      lines.push(
        `RESULT_HASH=$(run_extraction --path "${entry.extractionPathId}" --version "${entry.extractionPathVersion}" ${paramArgs} | sha256sum | awk '{print $1}')`
      );
      lines.push(`EXPECTED="${entry.replayHash}"`);
      lines.push(`if [ "$RESULT_HASH" = "$EXPECTED" ]; then`);
      lines.push(`  echo "  PASS - Hash matches"`);
      lines.push(`  PASS=$((PASS + 1))`);
      lines.push(`else`);
      lines.push(`  echo "  FAIL - Expected: $EXPECTED"`);
      lines.push(`  echo "         Actual:   $RESULT_HASH"`);
      lines.push(`  FAIL=$((FAIL + 1))`);
      lines.push(`fi`);
      lines.push(`echo ""`);
    }

    lines.push(``);
    lines.push(`echo "=== Results ==="`);
    lines.push(`echo "Passed: $PASS / $TOTAL"`);
    lines.push(`echo "Failed: $FAIL / $TOTAL"`);
    lines.push(``);
    lines.push(`if [ "$FAIL" -gt 0 ]; then`);
    lines.push(`  echo "WARNING: Some extractions did not match expected hashes."`);
    lines.push(`  exit 1`);
    lines.push(`fi`);
    lines.push(``);
    lines.push(`echo "All extractions verified successfully."`);
    lines.push(`exit 0`);

    return lines.join('\n');
  }

  /**
   * Validate manifest: check all entries have valid hashes and required fields.
   */
  validateManifest(manifest: ExtractionManifest): ValidationResult {
    const errors: string[] = [];

    if (!manifest.engagementId) {
      errors.push('Missing engagementId');
    }

    if (!manifest.generatedAt) {
      errors.push('Missing generatedAt');
    }

    for (let i = 0; i < manifest.entries.length; i++) {
      const entry = manifest.entries[i]!;
      const prefix = `Entry ${i} (${entry.extractionPathId || 'unknown'})`;

      if (!entry.extractionPathId) {
        errors.push(`${prefix}: missing extractionPathId`);
      }

      if (!entry.extractionPathVersion) {
        errors.push(`${prefix}: missing extractionPathVersion`);
      }

      if (!entry.queryHash) {
        errors.push(`${prefix}: missing queryHash`);
      } else if (!SHA256_PATTERN.test(entry.queryHash)) {
        errors.push(`${prefix}: invalid queryHash format (expected SHA-256 hex)`);
      }

      if (!entry.replayHash) {
        errors.push(`${prefix}: missing replayHash`);
      } else if (!SHA256_PATTERN.test(entry.replayHash)) {
        errors.push(`${prefix}: invalid replayHash format (expected SHA-256 hex)`);
      }

      if (!entry.extractedAt) {
        errors.push(`${prefix}: missing extractedAt`);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }
}
