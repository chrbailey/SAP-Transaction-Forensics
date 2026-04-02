/**
 * Tests for Provenance Query API + DAG Export
 *
 * Uses a mock ProvenanceReader with pre-loaded extraction records
 * and finding→evidence links. Tests all 10 scenarios specified in
 * the task brief.
 */

import type { ExtractionRecord, EvidenceRole, SystemType } from '../provenance/types.js';
import type { ProvenanceReader } from '../provenance/query.js';
import { ProvenanceQuery } from '../provenance/query.js';
import { ProvenanceExporter } from '../provenance/export.js';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function makeExtraction(overrides: Partial<ExtractionRecord> & { id: string }): ExtractionRecord {
  return {
    adapterId: 'adapter-1',
    systemType: 'SAP' as SystemType,
    tableName: 'VBAK',
    recordId: 'REC-001',
    fieldName: 'AUART',
    rawValue: 'OR',
    normalizedValue: 'Standard Order',
    extractionTimestamp: '2026-01-15T10:00:00Z',
    queryHash: 'qh-aaa',
    replayHash: 'rh-aaa',
    extractionPathId: 'path-1',
    extractionPathVersion: '1.0',
    ...overrides,
  };
}

const EXT_SAP_1 = makeExtraction({
  id: 'ext-sap-1',
  systemType: 'SAP',
  tableName: 'VBAK',
  recordId: 'DOC-100',
  fieldName: 'AUART',
  rawValue: 'OR',
  extractionTimestamp: '2026-01-10T08:00:00Z',
  queryHash: 'qh-001',
  replayHash: 'rh-001',
});

const EXT_SAP_2 = makeExtraction({
  id: 'ext-sap-2',
  systemType: 'SAP',
  tableName: 'VBAP',
  recordId: 'DOC-100',
  fieldName: 'MATNR',
  rawValue: 'MAT-500',
  extractionTimestamp: '2026-01-12T09:30:00Z',
  queryHash: 'qh-002',
  replayHash: 'rh-002',
});

const EXT_NS_1 = makeExtraction({
  id: 'ext-ns-1',
  adapterId: 'adapter-2',
  systemType: 'NetSuite',
  tableName: 'TransactionLine',
  recordId: 'TL-200',
  fieldName: 'amount',
  rawValue: '5000.00',
  extractionTimestamp: '2026-01-11T14:00:00Z',
  queryHash: 'qh-003',
  replayHash: 'rh-003',
});

const EXT_SF_1 = makeExtraction({
  id: 'ext-sf-1',
  adapterId: 'adapter-3',
  systemType: 'Salesforce',
  tableName: 'Opportunity',
  recordId: 'OPP-300',
  fieldName: 'StageName',
  rawValue: 'Closed Won',
  extractionTimestamp: '2026-01-14T16:00:00Z',
  queryHash: 'qh-004',
  replayHash: 'rh-004',
});

const FINDING_ID = 'FIND-001';
const EMPTY_FINDING_ID = 'FIND-EMPTY';

// ---------------------------------------------------------------------------
// Mock ProvenanceReader
// ---------------------------------------------------------------------------

class MockReader implements ProvenanceReader {
  private evidenceLinks: Array<{
    findingId: string;
    extraction: ExtractionRecord;
    role: EvidenceRole;
  }> = [];

  private extractions = new Map<string, ExtractionRecord>();

  /** Register an extraction in the store */
  addExtraction(record: ExtractionRecord): void {
    this.extractions.set(record.id, record);
  }

  /** Link an extraction to a finding with a role */
  linkEvidence(findingId: string, extractionId: string, role: EvidenceRole): void {
    const ext = this.extractions.get(extractionId);
    if (!ext) throw new Error(`Unknown extraction: ${extractionId}`);
    this.evidenceLinks.push({ findingId, extraction: ext, role });
  }

  getExtractionsByFinding(findingId: string): Array<ExtractionRecord & { role: EvidenceRole }> {
    return this.evidenceLinks
      .filter(link => link.findingId === findingId)
      .map(link => ({ ...link.extraction, role: link.role }));
  }

  getExtraction(id: string): ExtractionRecord | null {
    return this.extractions.get(id) ?? null;
  }

  getExtractionsByQuery(queryHash: string): ExtractionRecord[] {
    return [...this.extractions.values()].filter(ext => ext.queryHash === queryHash);
  }

  verifyReplay(queryHash: string, currentReplayHash: string): boolean {
    const ext = [...this.extractions.values()].find(e => e.queryHash === queryHash);
    if (!ext) return false;
    return ext.replayHash === currentReplayHash;
  }
}

function buildMockReader(): MockReader {
  const reader = new MockReader();
  reader.addExtraction(EXT_SAP_1);
  reader.addExtraction(EXT_SAP_2);
  reader.addExtraction(EXT_NS_1);
  reader.addExtraction(EXT_SF_1);

  // Finding with mixed evidence roles
  reader.linkEvidence(FINDING_ID, 'ext-sap-1', 'primary');
  reader.linkEvidence(FINDING_ID, 'ext-sap-2', 'primary');
  reader.linkEvidence(FINDING_ID, 'ext-ns-1', 'corroborating');
  reader.linkEvidence(FINDING_ID, 'ext-sf-1', 'contradicting');

  // EMPTY_FINDING_ID has no links
  return reader;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ProvenanceQuery', () => {
  let reader: MockReader;
  let query: ProvenanceQuery;

  beforeEach(() => {
    reader = buildMockReader();
    query = new ProvenanceQuery(reader);
  });

  // Test 1
  it('getEvidenceChain groups extractions by role correctly', () => {
    const chain = query.getEvidenceChain(FINDING_ID);

    expect(chain.primary).toHaveLength(2);
    expect(chain.corroborating).toHaveLength(1);
    expect(chain.contradicting).toHaveLength(1);

    expect(chain.primary.map(e => e.id)).toEqual(['ext-sap-1', 'ext-sap-2']);
    expect(chain.corroborating[0]!.id).toBe('ext-ns-1');
    expect(chain.contradicting[0]!.id).toBe('ext-sf-1');
  });

  // Test 2
  it('getEvidenceChain returns empty arrays when no evidence exists', () => {
    const chain = query.getEvidenceChain(EMPTY_FINDING_ID);

    expect(chain.primary).toEqual([]);
    expect(chain.corroborating).toEqual([]);
    expect(chain.contradicting).toEqual([]);
  });

  // Test 3
  it('getSummary computes correct systemsCovered and tablesCovered (unique, sorted)', () => {
    const summary = query.getSummary(FINDING_ID);

    expect(summary.findingId).toBe(FINDING_ID);
    expect(summary.extractionCount).toBe(4);
    expect(summary.systemsCovered).toEqual(['NetSuite', 'SAP', 'Salesforce']);
    expect(summary.tablesCovered).toEqual(['Opportunity', 'TransactionLine', 'VBAK', 'VBAP']);
  });

  // Test 4
  it('getSummary computes correct oldest and newest timestamps', () => {
    const summary = query.getSummary(FINDING_ID);

    expect(summary.oldestExtraction).toBe('2026-01-10T08:00:00Z');
    expect(summary.newestExtraction).toBe('2026-01-14T16:00:00Z');
  });

  // Test 5
  it('getTableCoverage aggregates correctly across extractions', () => {
    const coverage = query.getTableCoverage(FINDING_ID);

    expect(coverage).toEqual([
      { systemType: 'NetSuite', tableName: 'TransactionLine', recordCount: 1 },
      { systemType: 'Salesforce', tableName: 'Opportunity', recordCount: 1 },
      { systemType: 'SAP', tableName: 'VBAK', recordCount: 1 },
      { systemType: 'SAP', tableName: 'VBAP', recordCount: 1 },
    ]);
  });

  // Test 6
  it('verifyFindingReplayability returns allReplayable=true when all hashes match', () => {
    const currentHashes = new Map<string, string>([
      ['qh-001', 'rh-001'],
      ['qh-002', 'rh-002'],
      ['qh-003', 'rh-003'],
      ['qh-004', 'rh-004'],
    ]);

    const result = query.verifyFindingReplayability(FINDING_ID, currentHashes);

    expect(result.allReplayable).toBe(true);
    expect(result.staleExtractions).toEqual([]);
  });

  // Test 7
  it('verifyFindingReplayability returns staleExtractions when hashes differ', () => {
    const currentHashes = new Map<string, string>([
      ['qh-001', 'rh-001'], // matches
      ['qh-002', 'rh-CHANGED'], // differs
      ['qh-003', 'rh-003'], // matches
      ['qh-004', 'rh-DIFFERENT'], // differs
    ]);

    const result = query.verifyFindingReplayability(FINDING_ID, currentHashes);

    expect(result.allReplayable).toBe(false);
    expect(result.staleExtractions).toHaveLength(2);
    expect(result.staleExtractions).toEqual(
      expect.arrayContaining([
        {
          extractionId: 'ext-sap-2',
          queryHash: 'qh-002',
          expected: 'rh-002',
          actual: 'rh-CHANGED',
        },
        {
          extractionId: 'ext-sf-1',
          queryHash: 'qh-004',
          expected: 'rh-004',
          actual: 'rh-DIFFERENT',
        },
      ])
    );
  });
});

describe('ProvenanceExporter', () => {
  let reader: MockReader;
  let query: ProvenanceQuery;
  let exporter: ProvenanceExporter;

  beforeEach(() => {
    reader = buildMockReader();
    query = new ProvenanceQuery(reader);
    exporter = new ProvenanceExporter(query);
  });

  // Test 8
  it('exportDAG produces a tree with finding as root, evidence as children, extractions as leaves', () => {
    const dag = exporter.exportDAG(FINDING_ID);

    expect(dag.rootFindingId).toBe(FINDING_ID);
    expect(dag.generatedAt).toBeTruthy();
    expect(dag.replayable).toBe(true);

    // Single root node (the finding)
    expect(dag.nodes).toHaveLength(1);
    const root = dag.nodes[0]!;
    expect(root.type).toBe('finding');
    expect(root.id).toBe(FINDING_ID);

    // Three evidence children (primary, corroborating, contradicting)
    expect(root.children).toHaveLength(3);
    const [primary, corroborating, contradicting] = root.children;

    expect(primary!.type).toBe('evidence');
    expect(primary!.data['role']).toBe('primary');
    expect(primary!.children).toHaveLength(2);
    expect(primary!.children.every(c => c.type === 'extraction')).toBe(true);

    expect(corroborating!.type).toBe('evidence');
    expect(corroborating!.data['role']).toBe('corroborating');
    expect(corroborating!.children).toHaveLength(1);

    expect(contradicting!.type).toBe('evidence');
    expect(contradicting!.data['role']).toBe('contradicting');
    expect(contradicting!.children).toHaveLength(1);

    // Extraction leaves have no children
    for (const evidence of root.children) {
      for (const extraction of evidence.children) {
        expect(extraction.children).toEqual([]);
      }
    }
  });

  // Test 9
  it('exportFlat produces one row per extraction', () => {
    const rows = exporter.exportFlat(FINDING_ID);

    expect(rows).toHaveLength(4);

    // Rows ordered: primary first, then corroborating, then contradicting
    expect(rows[0]!.role).toBe('primary');
    expect(rows[0]!.extractionId).toBe('ext-sap-1');
    expect(rows[0]!.findingId).toBe(FINDING_ID);
    expect(rows[0]!.systemType).toBe('SAP');
    expect(rows[0]!.tableName).toBe('VBAK');
    expect(rows[0]!.recordId).toBe('DOC-100');
    expect(rows[0]!.fieldName).toBe('AUART');
    expect(rows[0]!.rawValue).toBe('OR');
    expect(rows[0]!.extractedAt).toBe('2026-01-10T08:00:00Z');
    expect(rows[0]!.queryHash).toBe('qh-001');
    expect(rows[0]!.replayHash).toBe('rh-001');

    expect(rows[1]!.role).toBe('primary');
    expect(rows[2]!.role).toBe('corroborating');
    expect(rows[3]!.role).toBe('contradicting');
  });

  // Test 10
  it('exportMarkdown produces valid Markdown table format', () => {
    const md = exporter.exportMarkdown(FINDING_ID);

    // Has a heading
    expect(md).toContain(`# Provenance: ${FINDING_ID}`);

    // Has a table header and separator
    expect(md).toContain(
      '| Role | System | Table | Record | Field | Value | Extracted At | Query Hash |'
    );
    expect(md).toContain(
      '|------|--------|-------|--------|-------|-------|--------------|------------|'
    );

    // Has data rows (4 extractions)
    const dataLines = md
      .split('\n')
      .filter(
        line => line.startsWith('| ') && !line.startsWith('| Role') && !line.startsWith('|--')
      );
    expect(dataLines).toHaveLength(4);

    // Verify content appears in rows
    expect(md).toContain('| primary |');
    expect(md).toContain('| corroborating |');
    expect(md).toContain('| contradicting |');
    expect(md).toContain('| SAP |');
    expect(md).toContain('| NetSuite |');
    expect(md).toContain('| Salesforce |');
  });

  it('exportMarkdown handles empty findings gracefully', () => {
    const md = exporter.exportMarkdown(EMPTY_FINDING_ID);

    expect(md).toContain(`# Provenance: ${EMPTY_FINDING_ID}`);
    expect(md).toContain('No evidence found.');
  });
});
