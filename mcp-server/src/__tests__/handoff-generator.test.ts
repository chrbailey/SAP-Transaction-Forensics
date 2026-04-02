/**
 * Tests for HandoffPacketGenerator
 *
 * Validates the main orchestrator that assembles all handoff packet
 * components — summary, findings, gaps, manifest, checklist, provenance —
 * and produces a complete file structure for auditor delivery.
 */

import { HandoffPacketGenerator } from '../handoff/generator.js';

import type { ContradictionFinding, GapFinding, ExtractionInfo } from '../handoff/generator.js';

import type { HandoffConfig, HandoffPacket } from '../handoff/types.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeConfig(overrides: Partial<HandoffConfig> = {}): HandoffConfig {
  return {
    engagementId: 'ENG-2026-001',
    clientName: 'Acme Corp',
    preparedBy: 'Christopher Bailey',
    dateRange: { from: '2025-01-01', to: '2025-09-30' },
    systemsAccessed: ['SAP', 'Salesforce'],
    scope: 'FY2025 Q1-Q3 O2C Process Audit',
    includeReproduction: true,
    includeChecklist: true,
    outputDir: '/tmp/handoff-output',
    ...overrides,
  };
}

function makeContradiction(overrides: Partial<ContradictionFinding> = {}): ContradictionFinding {
  return {
    id: 'CTR-001',
    type: 'AMOUNT_DIVERGENCE',
    severity: 'HIGH',
    confidence: 0.92,
    description: 'Invoice amount in SAP differs from Salesforce opportunity by 15%',
    title: 'SAP vs Salesforce Amount Mismatch',
    riskScore: 78,

    leftSystem: 'SAP',
    leftTable: 'BKPF',
    leftRecordId: 'DOC-100001',
    leftField: 'DMBTR',
    leftValue: '50000.00',
    leftExtractionId: 'ext-001',

    rightSystem: 'Salesforce',
    rightTable: 'Opportunity',
    rightRecordId: 'OPP-200001',
    rightField: 'Amount',
    rightValue: '43500.00',
    rightExtractionId: 'ext-002',

    scoringDetails: { amountDelta: 0.15, confidence: 0.92 },
    detectedAt: '2026-03-31T10:00:00.000Z',
    resolutionStatus: 'open',
    reviewerNotes: '',
    ...overrides,
  };
}

function makeGap(overrides: Partial<GapFinding> = {}): GapFinding {
  return {
    id: 'GAP-001',
    gapType: 'compliance',
    severity: 'MEDIUM',
    confidence: 0.85,
    title: 'Three-Way Match Bypass',
    description: 'Invoices paid without goods receipt confirmation',
    expectedSource: 'documented',
    expectedRule: 'SOP-AP-001 Section 4.2',
    expectedBehavior: 'Invoice payment requires matched GR, PO, and IR',
    actualBehavior: 'Invoice paid with PO match only, no GR',
    actualEvents: ['CASE-001', 'CASE-002', 'CASE-003'],
    frequency: 42,
    materiality: 0.7,
    recency: 0.6,
    detectedAt: '2026-03-31T11:00:00.000Z',
    systemScope: 'SAP',
    ...overrides,
  };
}

function makeExtraction(overrides: Partial<ExtractionInfo> = {}): ExtractionInfo {
  return {
    extractionPathId: 'sap.o2c.order-header',
    extractionPathVersion: '1.0.0',
    parameters: { date_from: '2025-01-01', date_to: '2025-09-30' },
    queryHash: 'sha256-abc123',
    replayHash: 'sha256-def456',
    extractedAt: '2026-03-31T10:00:00.000Z',
    rowCount: 1500,
    systemType: 'SAP',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('HandoffPacketGenerator', () => {
  let gen: HandoffPacketGenerator;

  beforeEach(() => {
    gen = new HandoffPacketGenerator();
  });

  // 1. generate returns HandoffPacket with all sections
  test('generate returns HandoffPacket with all sections', () => {
    const packet = gen.generate({
      config: makeConfig(),
      contradictions: [makeContradiction()],
      gaps: [makeGap()],
      extractions: [makeExtraction()],
    });

    expect(packet.config).toBeDefined();
    expect(packet.summary).toBeDefined();
    expect(packet.findings).toBeDefined();
    expect(packet.contradictions).toBeDefined();
    expect(packet.realityGaps).toBeDefined();
    expect(packet.manifest).toBeDefined();
    expect(packet.checklist).toBeDefined();
    expect(packet.provenanceGraph).toBeDefined();
    expect(packet.generatedAt).toBeDefined();
  });

  // 2. summary is non-empty Markdown
  test('summary is non-empty Markdown', () => {
    const packet = gen.generate({
      config: makeConfig(),
      contradictions: [makeContradiction()],
      gaps: [makeGap()],
      extractions: [makeExtraction()],
    });

    expect(packet.summary.length).toBeGreaterThan(0);
    expect(packet.summary).toContain('# Forensic Assessment');
    expect(packet.summary).toContain('## Executive Summary');
    expect(packet.summary).toContain('Acme Corp');
  });

  // 3. findings rendered for each contradiction
  test('findings rendered for each contradiction', () => {
    const c1 = makeContradiction({ id: 'CTR-001' });
    const c2 = makeContradiction({ id: 'CTR-002', type: 'STATUS_INCOMPATIBLE', riskScore: 60 });

    const packet = gen.generate({
      config: makeConfig(),
      contradictions: [c1, c2],
      gaps: [],
      extractions: [],
    });

    expect(packet.contradictions).toHaveLength(2);
    expect(packet.contradictions.map(f => f.id)).toContain('CTR-001');
    expect(packet.contradictions.map(f => f.id)).toContain('CTR-002');
    for (const f of packet.contradictions) {
      expect(f.markdown.length).toBeGreaterThan(0);
      expect(f.markdown).toContain(f.id);
    }
  });

  // 4. realityGaps rendered for each gap
  test('realityGaps rendered for each gap', () => {
    const g1 = makeGap({ id: 'GAP-001' });
    const g2 = makeGap({ id: 'GAP-002', gapType: 'design', severity: 'HIGH' });

    const packet = gen.generate({
      config: makeConfig(),
      contradictions: [],
      gaps: [g1, g2],
      extractions: [],
    });

    expect(packet.realityGaps).toHaveLength(2);
    expect(packet.realityGaps.map(g => g.id)).toContain('GAP-001');
    expect(packet.realityGaps.map(g => g.id)).toContain('GAP-002');
    for (const g of packet.realityGaps) {
      expect(g.markdown.length).toBeGreaterThan(0);
      expect(g.markdown).toContain(g.id);
    }
  });

  // 5. manifest has entries for each extraction
  test('manifest has entries for each extraction', () => {
    const e1 = makeExtraction({ extractionPathId: 'sap.o2c.order-header', rowCount: 1500 });
    const e2 = makeExtraction({
      extractionPathId: 'sfdc.pipeline.opp',
      rowCount: 350,
      systemType: 'Salesforce',
    });

    const packet = gen.generate({
      config: makeConfig(),
      contradictions: [],
      gaps: [],
      extractions: [e1, e2],
    });

    expect(packet.manifest.entries).toHaveLength(2);
    expect(packet.manifest.totalExtractions).toBe(2);
    expect(packet.manifest.totalRows).toBe(1850);
    expect(packet.manifest.entries.map(e => e.extractionPathId)).toContain('sap.o2c.order-header');
    expect(packet.manifest.entries.map(e => e.extractionPathId)).toContain('sfdc.pipeline.opp');
  });

  // 6. checklist has 25 items
  test('checklist has 25 items', () => {
    const packet = gen.generate({
      config: makeConfig(),
      contradictions: [makeContradiction()],
      gaps: [makeGap()],
      extractions: [makeExtraction()],
    });

    expect(packet.checklist.items).toHaveLength(25);
    expect(packet.checklist.totalCount).toBe(25);
    expect(packet.checklist.completedCount).toBe(0);

    // Verify 5 categories, 5 items each
    const byCat = new Map<string, number>();
    for (const item of packet.checklist.items) {
      byCat.set(item.category, (byCat.get(item.category) ?? 0) + 1);
    }
    expect(byCat.size).toBe(5);
    for (const count of byCat.values()) {
      expect(count).toBe(5);
    }
  });

  // 7. generateFileStructure returns correct file paths
  test('generateFileStructure returns correct file paths', () => {
    const packet = gen.generate({
      config: makeConfig(),
      contradictions: [makeContradiction()],
      gaps: [makeGap()],
      extractions: [makeExtraction()],
    });

    const files = gen.generateFileStructure(packet);

    expect(files.has('SUMMARY.md')).toBe(true);
    expect(files.has('metadata/engagement.json')).toBe(true);
    expect(files.has('metadata/provenance-graph.json')).toBe(true);
    expect(files.has('metadata/reviewer-checklist.md')).toBe(true);
    expect(files.has('reproduction/README.md')).toBe(true);
    expect(files.has('reproduction/extraction-manifest.json')).toBe(true);
    expect(files.has('reproduction/verify-extractions.sh')).toBe(true);
  });

  // 8. SUMMARY.md is in the file map
  test('SUMMARY.md is in the file map with Markdown content', () => {
    const packet = gen.generate({
      config: makeConfig(),
      contradictions: [makeContradiction()],
      gaps: [makeGap()],
      extractions: [makeExtraction()],
    });

    const files = gen.generateFileStructure(packet);
    const summary = files.get('SUMMARY.md');

    expect(summary).toBeDefined();
    expect(summary!.length).toBeGreaterThan(0);
    expect(summary).toContain('# Forensic Assessment');
  });

  // 9. reproduction/README.md is in the file map
  test('reproduction/README.md is in the file map', () => {
    const packet = gen.generate({
      config: makeConfig(),
      contradictions: [],
      gaps: [],
      extractions: [makeExtraction()],
    });

    const files = gen.generateFileStructure(packet);
    const readme = files.get('reproduction/README.md');

    expect(readme).toBeDefined();
    expect(readme).toContain('# Reproduction Instructions');
    expect(readme).toContain('extraction-manifest.json');
    expect(readme).toContain('verify-extractions.sh');
  });

  // 10. reproduction/extraction-manifest.json is valid JSON
  test('reproduction/extraction-manifest.json is valid JSON', () => {
    const packet = gen.generate({
      config: makeConfig(),
      contradictions: [],
      gaps: [],
      extractions: [
        makeExtraction(),
        makeExtraction({ extractionPathId: 'sfdc.pipeline.opp', systemType: 'Salesforce' }),
      ],
    });

    const files = gen.generateFileStructure(packet);
    const manifestJson = files.get('reproduction/extraction-manifest.json');

    expect(manifestJson).toBeDefined();
    const parsed = JSON.parse(manifestJson!);
    expect(parsed.engagementId).toBe('ENG-2026-001');
    expect(parsed.entries).toHaveLength(2);
    expect(typeof parsed.totalExtractions).toBe('number');
    expect(typeof parsed.totalRows).toBe('number');
  });

  // 11. metadata/engagement.json contains config
  test('metadata/engagement.json contains config', () => {
    const packet = gen.generate({
      config: makeConfig(),
      contradictions: [makeContradiction()],
      gaps: [makeGap()],
      extractions: [makeExtraction()],
    });

    const files = gen.generateFileStructure(packet);
    const engJson = files.get('metadata/engagement.json');

    expect(engJson).toBeDefined();
    const parsed = JSON.parse(engJson!);
    expect(parsed.engagementId).toBe('ENG-2026-001');
    expect(parsed.clientName).toBe('Acme Corp');
    expect(parsed.preparedBy).toBe('Christopher Bailey');
    expect(parsed.scope).toBe('FY2025 Q1-Q3 O2C Process Audit');
    expect(parsed.dateRange.from).toBe('2025-01-01');
    expect(parsed.systemsAccessed).toContain('SAP');
    expect(parsed.systemsAccessed).toContain('Salesforce');
  });

  // 12. metadata/reviewer-checklist.md has checkboxes
  test('metadata/reviewer-checklist.md has checkboxes', () => {
    const packet = gen.generate({
      config: makeConfig(),
      contradictions: [makeContradiction()],
      gaps: [makeGap()],
      extractions: [makeExtraction()],
    });

    const files = gen.generateFileStructure(packet);
    const checklist = files.get('metadata/reviewer-checklist.md');

    expect(checklist).toBeDefined();
    expect(checklist).toContain('- [ ]');
    expect(checklist).toContain('# Reviewer Checklist');

    // Count checkboxes — should be 25
    const checkboxCount = (checklist!.match(/- \[ \]/g) ?? []).length;
    expect(checkboxCount).toBe(25);
  });

  // 13. Finding files are named by type and ID
  test('finding files are named by type and ID', () => {
    const c1 = makeContradiction({ id: 'CTR-001', severity: 'HIGH' });
    const c2 = makeContradiction({ id: 'CTR-002', severity: 'CRITICAL' });

    const packet = gen.generate({
      config: makeConfig(),
      contradictions: [c1, c2],
      gaps: [],
      extractions: [],
    });

    const files = gen.generateFileStructure(packet);
    const keys = [...files.keys()];

    // findings/ directory should have files named by ID and severity
    const findingFiles = keys.filter(k => k.startsWith('findings/') && k.endsWith('.md'));
    expect(findingFiles.length).toBeGreaterThanOrEqual(2);

    // Check that IDs appear in filenames
    const hasC1 = findingFiles.some(f => f.includes('CTR-001'));
    const hasC2 = findingFiles.some(f => f.includes('CTR-002'));
    expect(hasC1).toBe(true);
    expect(hasC2).toBe(true);

    // Check that severity slugs appear
    const hasHigh = findingFiles.some(f => f.includes('high'));
    const hasCritical = findingFiles.some(f => f.includes('critical'));
    expect(hasHigh).toBe(true);
    expect(hasCritical).toBe(true);
  });

  // 14. Config with includeReproduction=false omits reproduction dir
  test('config with includeReproduction=false omits reproduction dir', () => {
    const packet = gen.generate({
      config: makeConfig({ includeReproduction: false }),
      contradictions: [makeContradiction()],
      gaps: [makeGap()],
      extractions: [makeExtraction()],
    });

    const files = gen.generateFileStructure(packet);
    const keys = [...files.keys()];

    const reproductionFiles = keys.filter(k => k.startsWith('reproduction/'));
    expect(reproductionFiles).toHaveLength(0);

    // Other files should still exist
    expect(files.has('SUMMARY.md')).toBe(true);
    expect(files.has('metadata/engagement.json')).toBe(true);
  });

  // 15. Config with includeChecklist=false omits checklist
  test('config with includeChecklist=false omits checklist', () => {
    const packet = gen.generate({
      config: makeConfig({ includeChecklist: false }),
      contradictions: [makeContradiction()],
      gaps: [makeGap()],
      extractions: [makeExtraction()],
    });

    const files = gen.generateFileStructure(packet);

    expect(files.has('metadata/reviewer-checklist.md')).toBe(false);

    // Other metadata files should still exist
    expect(files.has('metadata/engagement.json')).toBe(true);
    expect(files.has('metadata/provenance-graph.json')).toBe(true);
  });
});
