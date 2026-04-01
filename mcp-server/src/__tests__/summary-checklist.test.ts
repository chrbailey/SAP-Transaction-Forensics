/**
 * Summary & Checklist Generator Tests
 *
 * Covers: executive summary rendering, risk narratives,
 * checklist generation, item counts, and edge cases.
 */

import { SummaryGenerator } from '../handoff/renderers/summary.js';
import type { SummaryParams } from '../handoff/renderers/summary.js';
import { ChecklistGenerator, CHECKLIST_DEFINITIONS } from '../handoff/renderers/checklist.js';
import type { HandoffConfig } from '../handoff/types.js';

// --- Fixture helpers ---

function makeConfig(overrides: Partial<HandoffConfig> = {}): HandoffConfig {
  return {
    engagementId: 'ENG-2025-042',
    clientName: 'Acme Corp',
    preparedBy: 'Forensic Analytics Team',
    dateRange: { from: '2025-01-01', to: '2025-09-30' },
    systemsAccessed: ['SAP', 'Salesforce'],
    scope: 'FY2025 Q1-Q3 O2C Process Audit',
    includeReproduction: true,
    includeChecklist: true,
    outputDir: '/tmp/handoff',
    ...overrides,
  };
}

function makeSummaryParams(overrides: Partial<SummaryParams> = {}): SummaryParams {
  return {
    config: makeConfig(),
    contradictionCount: 5,
    gapCount: 3,
    criticalCount: 2,
    highCount: 4,
    mediumCount: 7,
    systemsCovered: ['SAP', 'Salesforce'],
    tablesCovered: ['EKKO', 'EKPO', 'Opportunity', 'Account'],
    totalExtractions: 1250,
    overallRiskScore: 68,
    ...overrides,
  };
}

// --- Tests ---

describe('SummaryGenerator', () => {
  let gen: SummaryGenerator;

  beforeEach(() => {
    gen = new SummaryGenerator();
  });

  // 1. Summary contains client name and engagement ID
  test('summary contains client name and engagement ID', () => {
    const md = gen.generateSummary(makeSummaryParams());
    expect(md).toContain('Acme Corp');
    expect(md).toContain('ENG-2025-042');
  });

  // 2. Summary has risk score table
  test('summary has risk score table', () => {
    const md = gen.generateSummary(makeSummaryParams());
    expect(md).toContain('| Overall Risk Score | 68/100 |');
    expect(md).toContain('| Critical Findings | 2 |');
    expect(md).toContain('| High Findings | 4 |');
    expect(md).toContain('| Medium Findings | 7 |');
    expect(md).toContain('| Contradictions Detected | 5 |');
    expect(md).toContain('| Process Gaps Detected | 3 |');
  });

  // 3. Summary narrative varies by risk level — high risk (>75)
  test('risk narrative for score > 75 mentions significant concerns', () => {
    const md = gen.generateSummary(makeSummaryParams({ overallRiskScore: 82 }));
    expect(md).toContain('significant concerns requiring immediate attention');
  });

  // 3b. Summary narrative varies by risk level — moderate (50-75)
  test('risk narrative for score 50-75 mentions moderate risk', () => {
    const md = gen.generateSummary(makeSummaryParams({ overallRiskScore: 60 }));
    expect(md).toContain('moderate risk requiring review');
  });

  // 3c. Summary narrative varies by risk level — manageable (25-49)
  test('risk narrative for score 25-49 mentions manageable risk', () => {
    const md = gen.generateSummary(makeSummaryParams({ overallRiskScore: 35 }));
    expect(md).toContain('manageable risk with recommendations');
  });

  // 3d. Summary narrative varies by risk level — low (<25)
  test('risk narrative for score < 25 mentions low risk', () => {
    const md = gen.generateSummary(makeSummaryParams({ overallRiskScore: 15 }));
    expect(md).toContain('low risk, routine findings');
  });

  // 4. Summary lists systems covered
  test('summary lists systems covered in table', () => {
    const md = gen.generateSummary(makeSummaryParams());
    expect(md).toContain('### Systems Analyzed');
    expect(md).toContain('| SAP |');
    expect(md).toContain('| Salesforce |');
  });

  // 9. High finding count triggers different narrative
  test('high critical/high counts appear in significant-risk narrative', () => {
    const md = gen.generateSummary(makeSummaryParams({
      overallRiskScore: 88,
      criticalCount: 10,
      highCount: 15,
    }));
    expect(md).toContain('10 critical');
    expect(md).toContain('15 high-severity');
    expect(md).toContain('significant concerns');
  });

  // 10. Zero findings produces clean report narrative
  test('zero findings with low risk produces clean report', () => {
    const md = gen.generateSummary(makeSummaryParams({
      overallRiskScore: 5,
      criticalCount: 0,
      highCount: 0,
      mediumCount: 0,
      contradictionCount: 0,
      gapCount: 0,
    }));
    expect(md).toContain('| Critical Findings | 0 |');
    expect(md).toContain('| High Findings | 0 |');
    expect(md).toContain('no significant issues requiring urgent attention');
  });
});

describe('ChecklistGenerator', () => {
  let gen: ChecklistGenerator;

  beforeEach(() => {
    gen = new ChecklistGenerator();
  });

  // 5. Checklist has 25 items
  test('checklist has 25 items', () => {
    const cl = gen.generateChecklist('ENG-2025-042', 10, 2);
    expect(cl.items).toHaveLength(25);
    expect(cl.totalCount).toBe(25);
  });

  // 6. Checklist has 5 items per category
  test('checklist has 5 items per category', () => {
    const cl = gen.generateChecklist('ENG-2025-042', 10, 2);
    const categories = ['data_quality', 'completeness', 'methodology', 'findings', 'remediation'] as const;

    for (const cat of categories) {
      const count = cl.items.filter(i => i.category === cat).length;
      expect(count).toBe(5);
    }
  });

  // 7. All items start unchecked
  test('all items start unchecked with empty notes', () => {
    const cl = gen.generateChecklist('ENG-2025-042', 10, 2);
    for (const item of cl.items) {
      expect(item.checked).toBe(false);
      expect(item.notes).toBe('');
    }
  });

  // 8. Checklist tracks completedCount = 0
  test('checklist starts with completedCount = 0', () => {
    const cl = gen.generateChecklist('ENG-2025-042', 10, 2);
    expect(cl.completedCount).toBe(0);
  });
});
