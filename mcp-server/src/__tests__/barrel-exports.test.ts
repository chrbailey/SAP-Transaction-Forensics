/**
 * Barrel Export Tests
 *
 * Verifies that all public API exports from the provenance and
 * extraction-registry barrels are importable and correctly wired.
 */

// --- Provenance barrel imports ---
import {
  ProvenanceDB,
  computeQueryHash,
  computeReplayHash,
  computeFieldHash,
  verifyReplayHash,
  ProvenanceLogger,
  ProvenanceQuery,
  ProvenanceExporter,
} from '../provenance/index.js';

import type {
  SystemType,
  EvidenceRole,
  ExtractionRecord,
  FindingEvidence,
  ProvenanceNode,
  ProvenanceDAG,
  ProvenanceSummary,
  ProvenanceReader,
} from '../provenance/index.js';

// --- Extraction-registry barrel imports ---
import {
  ExtractionRegistry,
  validatePathId,
  validateVersion,
  compareVersions,
  validatePath,
  generateRegistrySummary,
  SAP_O2C_PATHS,
  SAP_FICO_PATHS,
  SAP_P2P_PATHS,
  SFDC_PIPELINE_PATHS,
  NETSUITE_USER_AUDIT_PATHS,
  ALL_EXTRACTION_PATHS,
  createDefaultRegistry,
} from '../extraction-registry/registry.js';

import type {
  QueryType,
  FieldType,
  ExtractionDomain,
  ParameterDefinition,
  FieldDefinition,
  TestExpectation,
  ExtractionPath,
  ExtractionResult,
  RegistryMetadata,
} from '../extraction-registry/registry.js';

// ============================================================================
// Provenance barrel
// ============================================================================

describe('Provenance barrel exports', () => {
  test('all classes are importable and are constructors', () => {
    expect(typeof ProvenanceDB).toBe('function');
    expect(typeof ProvenanceLogger).toBe('function');
    expect(typeof ProvenanceQuery).toBe('function');
    expect(typeof ProvenanceExporter).toBe('function');
  });

  test('all hash functions are importable and callable', () => {
    expect(typeof computeQueryHash).toBe('function');
    expect(typeof computeReplayHash).toBe('function');
    expect(typeof computeFieldHash).toBe('function');
    expect(typeof verifyReplayHash).toBe('function');
  });

  test('hash functions produce deterministic output', () => {
    const qh = computeQueryHash('sap.o2c.order-header', '1.0', { vbeln: '0000000001' });
    expect(typeof qh).toBe('string');
    expect(qh.length).toBe(64); // SHA-256 hex

    // Same input → same output
    const qh2 = computeQueryHash('sap.o2c.order-header', '1.0', { vbeln: '0000000001' });
    expect(qh2).toBe(qh);

    const rh = computeReplayHash([{ VBELN: '0000000001', ERDAT: '2024-01-15' }]);
    expect(typeof rh).toBe('string');
    expect(rh.length).toBe(64);

    const fh = computeFieldHash('SAP', 'VBAK', '0000000001', 'NETWR', '50000.00');
    expect(typeof fh).toBe('string');
    expect(fh.length).toBe(64);
  });

  test('verifyReplayHash detects match and mismatch', () => {
    const rows = [{ VBELN: '0000000001', ERDAT: '2024-01-15' }];
    const hash = computeReplayHash(rows);

    const match = verifyReplayHash(hash, rows);
    expect(match.match).toBe(true);
    expect(match.currentHash).toBe(hash);

    const mismatch = verifyReplayHash(hash, [{ VBELN: '0000000002', ERDAT: '2024-01-16' }]);
    expect(mismatch.match).toBe(false);
  });

  test('type imports compile correctly (compile-time check)', () => {
    // These assignments verify the type imports resolve at compile time.
    // If they didn't, TypeScript would fail before the test runs.
    const systemType: SystemType = 'SAP';
    const role: EvidenceRole = 'primary';
    expect(systemType).toBe('SAP');
    expect(role).toBe('primary');
  });
});

// ============================================================================
// Extraction-registry barrel
// ============================================================================

describe('Extraction-registry barrel exports', () => {
  test('ExtractionRegistry class is importable and constructable', () => {
    expect(typeof ExtractionRegistry).toBe('function');
    const registry = new ExtractionRegistry();
    expect(registry.size).toBe(0);
  });

  test('metadata utilities are importable and callable', () => {
    expect(typeof validatePathId).toBe('function');
    expect(typeof validateVersion).toBe('function');
    expect(typeof compareVersions).toBe('function');
    expect(typeof validatePath).toBe('function');
    expect(typeof generateRegistrySummary).toBe('function');

    expect(validatePathId('sap.o2c.order-header').valid).toBe(true);
    expect(validateVersion('1.0').valid).toBe(true);
    expect(compareVersions('1.0', '2.0')).toBe(-1);
  });

  test('all path arrays are importable with correct lengths', () => {
    expect(SAP_O2C_PATHS).toHaveLength(5);
    expect(SAP_FICO_PATHS).toHaveLength(4);
    expect(SAP_P2P_PATHS).toHaveLength(4);
    expect(SFDC_PIPELINE_PATHS).toHaveLength(3);
    expect(NETSUITE_USER_AUDIT_PATHS).toHaveLength(3);
  });

  test('ALL_EXTRACTION_PATHS has correct total count (19)', () => {
    expect(ALL_EXTRACTION_PATHS).toHaveLength(19);
  });

  test('ALL_EXTRACTION_PATHS contains all individual path arrays', () => {
    for (const path of SAP_O2C_PATHS) {
      expect(ALL_EXTRACTION_PATHS).toContain(path);
    }
    for (const path of SAP_FICO_PATHS) {
      expect(ALL_EXTRACTION_PATHS).toContain(path);
    }
    for (const path of SAP_P2P_PATHS) {
      expect(ALL_EXTRACTION_PATHS).toContain(path);
    }
    for (const path of SFDC_PIPELINE_PATHS) {
      expect(ALL_EXTRACTION_PATHS).toContain(path);
    }
    for (const path of NETSUITE_USER_AUDIT_PATHS) {
      expect(ALL_EXTRACTION_PATHS).toContain(path);
    }
  });

  test('createDefaultRegistry returns a registry with 19 paths', () => {
    const registry = createDefaultRegistry();
    expect(registry.size).toBe(19);
  });

  test('registry can be filtered by system (SAP=13, Salesforce=3, NetSuite=3)', () => {
    const registry = createDefaultRegistry();

    const sapPaths = registry.list({ systemType: 'SAP' });
    expect(sapPaths).toHaveLength(13);

    const sfdcPaths = registry.list({ systemType: 'Salesforce' });
    expect(sfdcPaths).toHaveLength(3);

    const nsPaths = registry.list({ systemType: 'NetSuite' });
    expect(nsPaths).toHaveLength(3);
  });

  test('registry can be filtered by domain', () => {
    const registry = createDefaultRegistry();

    const o2cPaths = registry.list({ domain: 'o2c' });
    expect(o2cPaths).toHaveLength(5);

    const ficoPaths = registry.list({ domain: 'fi-co' });
    expect(ficoPaths).toHaveLength(4);

    const p2pPaths = registry.list({ domain: 'p2p' });
    expect(p2pPaths).toHaveLength(4);

    const pipelinePaths = registry.list({ domain: 'pipeline' });
    expect(pipelinePaths).toHaveLength(3);

    const userAuditPaths = registry.list({ domain: 'user-audit' });
    expect(userAuditPaths).toHaveLength(3);
  });

  test('all paths in default registry have valid IDs and versions', () => {
    for (const path of ALL_EXTRACTION_PATHS) {
      const idResult = validatePathId(path.id);
      expect(idResult.valid).toBe(true);

      const versionResult = validateVersion(path.version);
      expect(versionResult.valid).toBe(true);
    }
  });

  test('generateRegistrySummary reflects all paths', () => {
    const summary = generateRegistrySummary(ALL_EXTRACTION_PATHS);
    expect(summary.totalPaths).toBe(19);
    expect(summary.bySystem['SAP']).toBe(13);
    expect(summary.bySystem['Salesforce']).toBe(3);
    expect(summary.bySystem['NetSuite']).toBe(3);
  });

  test('type imports compile correctly (compile-time check)', () => {
    const qt: QueryType = 'sql';
    const ft: FieldType = 'string';
    const ed: ExtractionDomain = 'o2c';
    expect(qt).toBe('sql');
    expect(ft).toBe('string');
    expect(ed).toBe('o2c');
  });
});
