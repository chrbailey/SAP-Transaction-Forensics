/**
 * Extraction Manifest Generator Tests
 *
 * Covers: manifest generation, reproduction README, JSON output,
 * verification script, validation, and edge cases.
 */

import { ManifestGenerator } from '../handoff/manifest.js';

// --- Fixture helpers ---

function makeExtraction(
  overrides: Partial<Parameters<ManifestGenerator['generateManifest']>[1][0]> = {}
) {
  return {
    extractionPathId: 'sap.o2c.order-header',
    extractionPathVersion: '1.0',
    parameters: { date_from: '2025-01-01', date_to: '2025-03-31' },
    queryHash: 'a'.repeat(64),
    replayHash: 'b'.repeat(64),
    extractedAt: '2025-04-01T10:00:00.000Z',
    rowCount: 1500,
    systemType: 'SAP',
    ...overrides,
  };
}

function makeSfdcExtraction(
  overrides: Partial<Parameters<ManifestGenerator['generateManifest']>[1][0]> = {}
) {
  return {
    extractionPathId: 'sfdc.pipeline.opportunity',
    extractionPathVersion: '2.1',
    parameters: { stage: 'Closed Won' },
    queryHash: 'c'.repeat(64),
    replayHash: 'd'.repeat(64),
    extractedAt: '2025-04-01T11:00:00.000Z',
    rowCount: 320,
    systemType: 'Salesforce',
    ...overrides,
  };
}

// --- Tests ---

describe('ManifestGenerator', () => {
  let gen: ManifestGenerator;

  beforeEach(() => {
    gen = new ManifestGenerator();
  });

  // 1. generateManifest creates manifest with correct entry count
  test('generateManifest creates manifest with correct entry count', () => {
    const extractions = [makeExtraction(), makeSfdcExtraction()];
    const manifest = gen.generateManifest('ENG-001', extractions);

    expect(manifest.entries).toHaveLength(2);
    expect(manifest.engagementId).toBe('ENG-001');
  });

  // 2. totalExtractions equals entries.length
  test('totalExtractions equals entries.length', () => {
    const extractions = [
      makeExtraction(),
      makeSfdcExtraction(),
      makeExtraction({ extractionPathId: 'sap.fi.gl-postings' }),
    ];
    const manifest = gen.generateManifest('ENG-002', extractions);

    expect(manifest.totalExtractions).toBe(manifest.entries.length);
    expect(manifest.totalExtractions).toBe(3);
  });

  // 3. totalRows sums all entry rowCounts
  test('totalRows sums all entry rowCounts', () => {
    const extractions = [makeExtraction({ rowCount: 1000 }), makeSfdcExtraction({ rowCount: 500 })];
    const manifest = gen.generateManifest('ENG-003', extractions);

    expect(manifest.totalRows).toBe(1500);
  });

  // 4. systems deduped from entries
  test('systems deduped from entries', () => {
    const extractions = [
      makeExtraction({ systemType: 'SAP' }),
      makeExtraction({ systemType: 'SAP', extractionPathId: 'sap.fi.gl-postings' }),
      makeSfdcExtraction({ systemType: 'Salesforce' }),
    ];
    const manifest = gen.generateManifest('ENG-004', extractions);

    expect(manifest.systems).toHaveLength(2);
    expect(manifest.systems).toContain('SAP');
    expect(manifest.systems).toContain('Salesforce');
  });

  // 5. generateReproductionReadme contains step-by-step instructions
  test('generateReproductionReadme contains step-by-step instructions', () => {
    const manifest = gen.generateManifest('ENG-005', [makeExtraction()]);
    const readme = gen.generateReproductionReadme(manifest);

    expect(readme).toContain('# Extraction Reproduction Guide');
    expect(readme).toContain('Independent Verification Steps');
    expect(readme).toContain('Run the query with the given parameters');
    expect(readme).toContain('Compute the SHA-256 hash');
    expect(readme).toContain('Compare the computed hash against the **replayHash**');
    expect(readme).toContain('independently verified');
  });

  // 6. README references extraction path IDs
  test('README references extraction path IDs', () => {
    const extractions = [makeExtraction(), makeSfdcExtraction()];
    const manifest = gen.generateManifest('ENG-006', extractions);
    const readme = gen.generateReproductionReadme(manifest);

    expect(readme).toContain('sap.o2c.order-header');
    expect(readme).toContain('sfdc.pipeline.opportunity');
  });

  // 7. README includes expected replay hashes
  test('README includes expected replay hashes', () => {
    const manifest = gen.generateManifest('ENG-007', [makeExtraction()]);
    const readme = gen.generateReproductionReadme(manifest);

    expect(readme).toContain('b'.repeat(64));
  });

  // 8. generateManifestJSON is valid JSON
  test('generateManifestJSON is valid JSON', () => {
    const manifest = gen.generateManifest('ENG-008', [makeExtraction()]);
    const json = gen.generateManifestJSON(manifest);

    const parsed = JSON.parse(json);
    expect(parsed.engagementId).toBe('ENG-008');
    expect(parsed.entries).toHaveLength(1);
    expect(parsed.totalExtractions).toBe(1);
  });

  // 9. generateVerificationScript is bash-formatted
  test('generateVerificationScript is bash-formatted', () => {
    const extractions = [makeExtraction(), makeSfdcExtraction()];
    const manifest = gen.generateManifest('ENG-009', extractions);
    const script = gen.generateVerificationScript(manifest);

    expect(script).toMatch(/^#!\/usr\/bin\/env bash/);
    expect(script).toContain('set -euo pipefail');
    expect(script).toContain('run_extraction');
    expect(script).toContain('sha256sum');
    expect(script).toContain('PASS');
    expect(script).toContain('FAIL');
    expect(script).toContain('sap.o2c.order-header');
    expect(script).toContain('sfdc.pipeline.opportunity');
    expect(script).toContain('exit 0');
    expect(script).toContain('exit 1');
  });

  // 10. validateManifest passes for valid manifest
  test('validateManifest passes for valid manifest', () => {
    const manifest = gen.generateManifest('ENG-010', [makeExtraction(), makeSfdcExtraction()]);
    const result = gen.validateManifest(manifest);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  // 11. validateManifest catches missing hashes
  test('validateManifest catches missing hashes', () => {
    const manifest = gen.generateManifest('ENG-011', [
      makeExtraction({ queryHash: '', replayHash: '' }),
    ]);
    const result = gen.validateManifest(manifest);

    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(2);
    expect(result.errors.some(e => e.includes('queryHash'))).toBe(true);
    expect(result.errors.some(e => e.includes('replayHash'))).toBe(true);
  });

  // 12. generatedAt is ISO 8601 timestamp
  test('generatedAt is ISO 8601 timestamp', () => {
    const before = new Date().toISOString();
    const manifest = gen.generateManifest('ENG-012', [makeExtraction()]);
    const after = new Date().toISOString();

    // ISO 8601 pattern: YYYY-MM-DDTHH:mm:ss.sssZ
    expect(manifest.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/);
    expect(manifest.generatedAt >= before).toBe(true);
    expect(manifest.generatedAt <= after).toBe(true);
  });
});
