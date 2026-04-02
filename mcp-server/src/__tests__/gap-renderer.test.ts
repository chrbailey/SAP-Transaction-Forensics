/**
 * Gap Renderer Tests
 *
 * Covers: single-gap rendering, grouped rendering by type,
 * section headers, severity sorting, impact metrics, and edge cases.
 */

import { GapRenderer } from '../handoff/renderers/gap.js';
import type { GapFinding, GapSeverity, GapType } from '../handoff/renderers/gap.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeGap(overrides: Partial<GapFinding> = {}): GapFinding {
  return {
    id: 'GAP-001',
    gapType: 'design',
    severity: 'HIGH',
    confidence: 0.85,
    title: 'Missing Credit Check',
    description: 'Credit check step is absent from documented process',
    expectedSource: 'reference',
    expectedRule: 'REF-O2C-003',
    expectedBehavior: 'Credit check before order release',
    actualBehavior: 'Order released without credit check',
    actualEvents: ['CASE-001', 'CASE-002', 'CASE-003'],
    frequency: 47,
    materiality: 0.72,
    recency: 0.9,
    detectedAt: '2025-07-01T12:00:00Z',
    systemScope: 'SAP',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GapRenderer', () => {
  let renderer: GapRenderer;

  beforeEach(() => {
    renderer = new GapRenderer();
  });

  // 1. renderGap produces Markdown with gap type
  test('renderGap produces Markdown containing gap type', () => {
    const result = renderer.renderGap(makeGap());
    expect(result.markdown).toContain('**Gap Type:** design');
    expect(result.markdown).toContain('G-GAP-001');
  });

  // 2. Expected vs Actual section present
  test('renderGap includes Expected vs Actual section', () => {
    const result = renderer.renderGap(makeGap());
    expect(result.markdown).toContain('### Expected vs Actual');
    expect(result.markdown).toContain('**Expected (reference):**');
    expect(result.markdown).toContain('**Actual:**');
    expect(result.markdown).toContain('**Rule/Model:** REF-O2C-003');
  });

  // 3. Impact metrics rendered
  test('renderGap includes impact metrics', () => {
    const gap = makeGap({ frequency: 47, materiality: 0.72, recency: 0.9 });
    const result = renderer.renderGap(gap);
    expect(result.markdown).toContain('**Frequency:** 47 occurrences');
    expect(result.markdown).toContain('**Materiality:** 0.72/1.0');
    expect(result.markdown).toContain('**Recency:** 0.9/1.0');
    expect(result.markdown).toContain('**Affected Cases:** 3');
  });

  // 4. renderAllGrouped separates by type
  test('renderAllGrouped separates gaps by type', () => {
    const gaps: GapFinding[] = [
      makeGap({ id: 'D1', gapType: 'design' }),
      makeGap({ id: 'C1', gapType: 'compliance' }),
      makeGap({ id: 'S1', gapType: 'shadow' }),
    ];

    const result = renderer.renderAllGrouped(gaps);
    expect(result.designSection).toContain('G-D1');
    expect(result.complianceSection).toContain('G-C1');
    expect(result.shadowSection).toContain('G-S1');

    expect(result.designSection).not.toContain('G-C1');
    expect(result.complianceSection).not.toContain('G-D1');
    expect(result.shadowSection).not.toContain('G-D1');
  });

  // 5. Design section header present
  test('design section has correct header', () => {
    const gaps = [makeGap({ gapType: 'design' })];
    const result = renderer.renderAllGrouped(gaps);
    expect(result.designSection).toContain('# Design Gaps (Reference vs Documented)');
    expect(result.designSection).toContain('1 gaps detected.');
    expect(result.designSection).toContain('deviations from best practice');
  });

  // 6. Compliance section header present
  test('compliance section has correct header', () => {
    const gaps = [makeGap({ gapType: 'compliance' })];
    const result = renderer.renderAllGrouped(gaps);
    expect(result.complianceSection).toContain('# Compliance Gaps (Documented vs Actual)');
    expect(result.complianceSection).toContain('1 gaps detected.');
    expect(result.complianceSection).toContain('documented processes and actual execution');
  });

  // 7. Shadow section header present
  test('shadow section has correct header', () => {
    const gaps = [makeGap({ gapType: 'shadow' })];
    const result = renderer.renderAllGrouped(gaps);
    expect(result.shadowSection).toContain('# Shadow Gaps (Undocumented Activity)');
    expect(result.shadowSection).toContain('1 gaps detected.');
    expect(result.shadowSection).toContain('no corresponding documentation');
  });

  // 8. Empty gap type produces empty section
  test('empty gap type produces empty section string', () => {
    const gaps = [makeGap({ gapType: 'design' })];
    const result = renderer.renderAllGrouped(gaps);
    expect(result.complianceSection).toBe('');
    expect(result.shadowSection).toBe('');
  });

  // 9. renderedFindings sorted by severity
  test('renderedFindings are sorted by severity (CRITICAL first)', () => {
    const gaps: GapFinding[] = [
      makeGap({ id: 'LOW-1', gapType: 'design', severity: 'LOW' }),
      makeGap({ id: 'CRIT-1', gapType: 'compliance', severity: 'CRITICAL' }),
      makeGap({ id: 'MED-1', gapType: 'shadow', severity: 'MEDIUM' }),
      makeGap({ id: 'HIGH-1', gapType: 'design', severity: 'HIGH' }),
      makeGap({ id: 'INFO-1', gapType: 'compliance', severity: 'INFO' }),
    ];

    const result = renderer.renderAllGrouped(gaps);
    const severities = result.renderedFindings.map(f => f.severity);
    expect(severities).toEqual(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO']);
  });

  // 10. System scope rendered
  test('system scope is rendered in its own section', () => {
    const gap = makeGap({ systemScope: 'cross-system' });
    const result = renderer.renderGap(gap);
    expect(result.markdown).toContain('### System Scope');
    expect(result.markdown).toContain('cross-system');
  });
});
