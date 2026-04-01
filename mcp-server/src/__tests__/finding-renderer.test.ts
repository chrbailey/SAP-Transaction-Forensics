/**
 * Tests for FindingRenderer
 *
 * Covers: Markdown rendering for contradictions and FI/CO anomalies,
 * evidence file generation, risk-score sorting, empty fields, and
 * special character escaping.
 */

import {
  FindingRenderer,
} from '../handoff/renderers/finding.js';
import type {
  ContradictionFinding,
} from '../handoff/renderers/finding.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeFinding(overrides: Partial<ContradictionFinding> = {}): ContradictionFinding {
  return {
    id: 'f001',
    type: 'AMOUNT_DIVERGENCE',
    severity: 'HIGH',
    confidence: 0.9,
    description: 'Net value mismatch between SAP and Salesforce',
    title: 'Net Value Mismatch',
    riskScore: 78,
    leftSystem: 'SAP',
    leftTable: 'VBAK',
    leftRecordId: 'SO-100200',
    leftField: 'NETWR',
    leftValue: '50000',
    leftExtractionId: 'ext-left-001',
    rightSystem: 'Salesforce',
    rightTable: 'Opportunity',
    rightRecordId: 'OPP-300',
    rightField: 'Amount',
    rightValue: '48000',
    rightExtractionId: 'ext-right-001',
    scoringDetails: { percentDivergence: 0.04, absoluteAmount: 2000 },
    detectedAt: '2025-11-15T10:30:00Z',
    resolutionStatus: 'open',
    reviewerNotes: '',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('FindingRenderer', () => {
  let renderer: FindingRenderer;

  beforeEach(() => {
    renderer = new FindingRenderer();
  });

  // 1
  it('renderContradiction produces valid Markdown with headers', () => {
    const finding = makeFinding();
    const result = renderer.renderContradiction(finding);

    expect(result.markdown).toContain('## F-f001: Net Value Mismatch');
    expect(result.markdown).toContain('### Evidence');
    expect(result.markdown).toContain('### Scoring Details');
    expect(result.markdown).toContain('### Status');
  });

  // 2
  it('Markdown contains severity and risk score', () => {
    const finding = makeFinding({ severity: 'CRITICAL', riskScore: 95 });
    const result = renderer.renderContradiction(finding);

    expect(result.markdown).toContain('**Severity:** CRITICAL');
    expect(result.markdown).toContain('**Risk Score:** 95/100');
  });

  // 3
  it('Evidence table has both left and right sides', () => {
    const finding = makeFinding();
    const result = renderer.renderContradiction(finding);

    expect(result.markdown).toContain('| Left | SAP | VBAK | SO-100200 | NETWR | 50000 |');
    expect(result.markdown).toContain('| Right | Salesforce | Opportunity | OPP-300 | Amount | 48000 |');
  });

  // 4
  it('Scoring details table rendered', () => {
    const finding = makeFinding({
      scoringDetails: { percentDivergence: 0.04, absoluteAmount: 2000 },
    });
    const result = renderer.renderContradiction(finding);

    expect(result.markdown).toContain('| Metric | Value |');
    expect(result.markdown).toContain('| percentDivergence | 0.04 |');
    expect(result.markdown).toContain('| absoluteAmount | 2000 |');
  });

  // 5
  it('EvidenceFiles array has 3 files (left CSV, right CSV, meta JSON)', () => {
    const finding = makeFinding();
    const result = renderer.renderContradiction(finding);

    expect(result.evidenceFiles).toHaveLength(3);

    const filenames = result.evidenceFiles.map((f) => f.filename);
    expect(filenames).toContain('F-f001-left.csv');
    expect(filenames).toContain('F-f001-right.csv');
    expect(filenames).toContain('F-f001-meta.json');

    const leftCsv = result.evidenceFiles.find((f) => f.filename.endsWith('-left.csv'));
    expect(leftCsv?.mimeType).toBe('text/csv');

    const rightCsv = result.evidenceFiles.find((f) => f.filename.endsWith('-right.csv'));
    expect(rightCsv?.mimeType).toBe('text/csv');

    const metaJson = result.evidenceFiles.find((f) => f.filename.endsWith('-meta.json'));
    expect(metaJson?.mimeType).toBe('application/json');
  });

  // 6
  it('Meta JSON contains extraction IDs', () => {
    const finding = makeFinding();
    const result = renderer.renderContradiction(finding);

    const metaFile = result.evidenceFiles.find((f) => f.filename.endsWith('-meta.json'));
    expect(metaFile).toBeDefined();

    const meta = JSON.parse(metaFile!.content);
    expect(meta.findingId).toBe('f001');
    expect(meta.leftExtractionId).toBe('ext-left-001');
    expect(meta.rightExtractionId).toBe('ext-right-001');
    expect(meta.queryHashes).toBeDefined();
    expect(meta.queryHashes.left).toBeDefined();
    expect(meta.queryHashes.right).toBeDefined();
    expect(meta.timestamps.detectedAt).toBe('2025-11-15T10:30:00Z');
  });

  // 7
  it('renderAll sorts by risk score descending', () => {
    const low = makeFinding({ id: 'low', riskScore: 20, title: 'Low Risk' });
    const high = makeFinding({ id: 'high', riskScore: 90, title: 'High Risk' });
    const mid = makeFinding({ id: 'mid', riskScore: 55, title: 'Mid Risk' });

    const results = renderer.renderAll([low, high, mid]);

    expect(results).toHaveLength(3);
    expect(results[0]!.id).toBe('high');
    expect(results[1]!.id).toBe('mid');
    expect(results[2]!.id).toBe('low');
    expect(results[0]!.riskScore).toBeGreaterThanOrEqual(results[1]!.riskScore);
    expect(results[1]!.riskScore).toBeGreaterThanOrEqual(results[2]!.riskScore);
  });

  // 8
  it('renderAnomaly produces Markdown for FI/CO anomaly', () => {
    const result = renderer.renderAnomaly({
      type: 'POSTING_REVERSAL',
      severity: 'MEDIUM',
      details: { documentNumber: '5000001234', companyCode: '1000', amount: 75000 },
      riskScore: 60,
    });

    expect(result.markdown).toContain('FI/CO Anomaly');
    expect(result.markdown).toContain('POSTING_REVERSAL');
    expect(result.markdown).toContain('**Severity:** MEDIUM');
    expect(result.markdown).toContain('**Risk Score:** 60/100');
    expect(result.markdown).toContain('| documentNumber | 5000001234 |');
    expect(result.severity).toBe('MEDIUM');
    expect(result.riskScore).toBe(60);
    expect(result.evidenceFiles).toHaveLength(0);
  });

  // 9
  it('Empty reviewer notes shows None', () => {
    const finding = makeFinding({ reviewerNotes: '' });
    const result = renderer.renderContradiction(finding);

    expect(result.markdown).toContain('**Reviewer Notes:** None');
  });

  // 10
  it('Special characters in values are escaped', () => {
    const finding = makeFinding({
      title: 'Value with | pipe & <angle> and `backtick`',
      leftValue: '100|200',
      rightValue: '<script>alert("xss")</script>',
      reviewerNotes: 'Check `this` value | important',
    });
    const result = renderer.renderContradiction(finding);

    // Pipes must be escaped to not break tables
    expect(result.markdown).not.toContain('| 100|200 |');
    expect(result.markdown).toContain('100\\|200');

    // Angle brackets must be HTML-escaped
    expect(result.markdown).toContain('&lt;script&gt;');
    expect(result.markdown).not.toContain('<script>');

    // Backticks escaped
    expect(result.markdown).toContain('\\`backtick\\`');

    // Pipe in reviewer notes escaped
    expect(result.markdown).toContain('Check \\`this\\` value \\| important');
  });
});
