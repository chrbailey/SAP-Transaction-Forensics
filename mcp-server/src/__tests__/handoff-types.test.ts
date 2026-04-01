/**
 * Tests for handoff packet type definitions
 *
 * Validates that type structures are importable, usable, and that
 * runtime constraints hold (since TypeScript types are erased at runtime).
 */

import type {
  HandoffConfig,
  RenderedFinding,
  EvidenceFile,
  ManifestEntry,
  ExtractionManifest,
  ChecklistItem,
  ReviewerChecklist,
  HandoffPacket,
} from '../handoff/types.js';

import type { SystemType } from '../provenance/types.js';

// --- Runtime validation helpers ---

const VALID_SYSTEM_TYPES: readonly string[] = ['SAP', 'NetSuite', 'Salesforce'];
const VALID_MIME_TYPES: readonly string[] = ['text/csv', 'application/json', 'text/plain', 'text/markdown'];
const VALID_CHECKLIST_CATEGORIES: readonly string[] = [
  'data_quality', 'completeness', 'methodology', 'findings', 'remediation',
];

function isValidSystemType(value: string): value is SystemType {
  return VALID_SYSTEM_TYPES.includes(value);
}

function isValidMimeType(value: string): boolean {
  return VALID_MIME_TYPES.includes(value);
}

function isValidChecklistCategory(value: string): value is ChecklistItem['category'] {
  return VALID_CHECKLIST_CATEGORIES.includes(value);
}

// --- Handoff types ---

describe('Handoff types', () => {
  describe('HandoffConfig', () => {
    const config: HandoffConfig = {
      engagementId: 'ENG-2026-001',
      clientName: 'Acme Corp',
      preparedBy: 'Christopher Bailey',
      dateRange: { from: '2025-01-01', to: '2025-09-30' },
      systemsAccessed: ['SAP', 'Salesforce'],
      scope: 'FY2025 Q1-Q3 O2C Process Audit',
      includeReproduction: true,
      includeChecklist: true,
      outputDir: '/tmp/handoff-output',
    };

    it('should be constructable with all fields', () => {
      expect(config.engagementId).toBe('ENG-2026-001');
      expect(config.clientName).toBe('Acme Corp');
      expect(config.preparedBy).toBe('Christopher Bailey');
      expect(config.dateRange.from).toBe('2025-01-01');
      expect(config.dateRange.to).toBe('2025-09-30');
      expect(config.scope).toBe('FY2025 Q1-Q3 O2C Process Audit');
      expect(config.includeReproduction).toBe(true);
      expect(config.includeChecklist).toBe(true);
      expect(config.outputDir).toBe('/tmp/handoff-output');
    });

    it('should only contain valid SystemType values in systemsAccessed', () => {
      for (const sys of config.systemsAccessed) {
        expect(isValidSystemType(sys)).toBe(true);
      }
    });
  });

  describe('RenderedFinding', () => {
    const evidenceFile: EvidenceFile = {
      filename: 'invoice-duplicates.csv',
      content: 'doc_number,amount,vendor\n100001,5000.00,V001',
      mimeType: 'text/csv',
      extractionId: 'ext-001',
    };

    const finding: RenderedFinding = {
      id: 'FIND-001',
      title: 'Duplicate Invoice Payments Detected',
      severity: 'high',
      riskScore: 8.5,
      markdown: '## Duplicate Invoice Payments\n\nFound 12 duplicate payments totaling $150,000.',
      evidenceFiles: [evidenceFile],
    };

    it('should have evidenceFiles array', () => {
      expect(Array.isArray(finding.evidenceFiles)).toBe(true);
      expect(finding.evidenceFiles).toHaveLength(1);
      expect(finding.evidenceFiles[0]!.filename).toBe('invoice-duplicates.csv');
    });

    it('should have all required fields', () => {
      expect(finding.id).toBeDefined();
      expect(finding.title).toBeDefined();
      expect(finding.severity).toBeDefined();
      expect(typeof finding.riskScore).toBe('number');
      expect(finding.markdown).toBeDefined();
    });

    it('should support findings with multiple evidence files', () => {
      const multiEvidence: RenderedFinding = {
        ...finding,
        evidenceFiles: [
          evidenceFile,
          { filename: 'timeline.json', content: '[]', mimeType: 'application/json' },
          { filename: 'notes.md', content: '# Notes', mimeType: 'text/markdown' },
        ],
      };
      expect(multiEvidence.evidenceFiles).toHaveLength(3);
    });
  });

  describe('EvidenceFile', () => {
    it('should accept all 4 valid mime types', () => {
      const mimeTypes: EvidenceFile['mimeType'][] = [
        'text/csv', 'application/json', 'text/plain', 'text/markdown',
      ];
      for (const mime of mimeTypes) {
        const file: EvidenceFile = {
          filename: `test.${mime.split('/')[1]}`,
          content: 'test content',
          mimeType: mime,
        };
        expect(isValidMimeType(file.mimeType)).toBe(true);
      }
      expect(VALID_MIME_TYPES).toHaveLength(4);
    });

    it('should support optional extractionId for provenance linkage', () => {
      const withId: EvidenceFile = {
        filename: 'data.csv',
        content: 'col1,col2\na,b',
        mimeType: 'text/csv',
        extractionId: 'ext-042',
      };
      const withoutId: EvidenceFile = {
        filename: 'notes.txt',
        content: 'Manual observation',
        mimeType: 'text/plain',
      };
      expect(withId.extractionId).toBe('ext-042');
      expect(withoutId.extractionId).toBeUndefined();
    });
  });

  describe('ManifestEntry', () => {
    const entry: ManifestEntry = {
      extractionPathId: 'sap.o2c.order-header',
      extractionPathVersion: '1.0.0',
      parameters: { date_from: '2025-01-01', date_to: '2025-09-30' },
      queryHash: 'sha256-abc123def456',
      replayHash: 'sha256-fed654cba321',
      extractedAt: '2026-03-31T10:00:00.000Z',
      rowCount: 1500,
    };

    it('should have all hash fields for reproduction', () => {
      expect(entry.queryHash).toBeDefined();
      expect(entry.replayHash).toBeDefined();
      expect(typeof entry.queryHash).toBe('string');
      expect(typeof entry.replayHash).toBe('string');
      expect(entry.queryHash.length).toBeGreaterThan(0);
      expect(entry.replayHash.length).toBeGreaterThan(0);
    });

    it('should have extraction path identity and version', () => {
      expect(entry.extractionPathId).toBe('sap.o2c.order-header');
      expect(entry.extractionPathVersion).toBe('1.0.0');
    });

    it('should have ISO 8601 extractedAt timestamp', () => {
      expect(new Date(entry.extractedAt).toISOString()).toBe(entry.extractedAt);
    });
  });

  describe('ExtractionManifest', () => {
    const manifest: ExtractionManifest = {
      engagementId: 'ENG-2026-001',
      generatedAt: '2026-03-31T12:00:00.000Z',
      entries: [
        {
          extractionPathId: 'sap.o2c.order-header',
          extractionPathVersion: '1.0.0',
          parameters: { date_from: '2025-01-01', date_to: '2025-09-30' },
          queryHash: 'sha256-aaa',
          replayHash: 'sha256-bbb',
          extractedAt: '2026-03-31T10:00:00.000Z',
          rowCount: 1500,
        },
        {
          extractionPathId: 'sfdc.pipeline.opportunity',
          extractionPathVersion: '1.0.0',
          parameters: { date_from: '2025-01-01' },
          queryHash: 'sha256-ccc',
          replayHash: 'sha256-ddd',
          extractedAt: '2026-03-31T10:05:00.000Z',
          rowCount: 350,
        },
      ],
      totalExtractions: 2,
      totalRows: 1850,
      systems: ['SAP', 'Salesforce'],
    };

    it('should have totalExtractions and totalRows', () => {
      expect(typeof manifest.totalExtractions).toBe('number');
      expect(typeof manifest.totalRows).toBe('number');
      expect(manifest.totalExtractions).toBe(2);
      expect(manifest.totalRows).toBe(1850);
    });

    it('should have entries matching totalExtractions count', () => {
      expect(manifest.entries).toHaveLength(manifest.totalExtractions);
    });

    it('should only contain valid SystemType values', () => {
      for (const sys of manifest.systems) {
        expect(isValidSystemType(sys)).toBe(true);
      }
    });
  });

  describe('ChecklistItem', () => {
    it('should support all 5 categories', () => {
      const categories: ChecklistItem['category'][] = [
        'data_quality', 'completeness', 'methodology', 'findings', 'remediation',
      ];
      for (const cat of categories) {
        expect(isValidChecklistCategory(cat)).toBe(true);
      }
      expect(VALID_CHECKLIST_CATEGORIES).toHaveLength(5);
    });

    it('should have all required fields', () => {
      const item: ChecklistItem = {
        id: 'CHK-001',
        category: 'data_quality',
        text: 'Verify extraction hashes match source system',
        required: true,
        checked: false,
        notes: '',
      };
      expect(item.id).toBeDefined();
      expect(item.category).toBeDefined();
      expect(item.text).toBeDefined();
      expect(typeof item.required).toBe('boolean');
      expect(typeof item.checked).toBe('boolean');
      expect(typeof item.notes).toBe('string');
    });
  });

  describe('ReviewerChecklist', () => {
    const checklist: ReviewerChecklist = {
      engagementId: 'ENG-2026-001',
      reviewerName: '',
      generatedAt: '2026-03-31T12:00:00.000Z',
      items: [
        { id: 'CHK-001', category: 'data_quality', text: 'Verify hashes', required: true, checked: true, notes: 'All passed' },
        { id: 'CHK-002', category: 'completeness', text: 'All systems covered', required: true, checked: false, notes: '' },
        { id: 'CHK-003', category: 'methodology', text: 'Review conformance model', required: false, checked: false, notes: '' },
      ],
      completedCount: 1,
      totalCount: 3,
    };

    it('should track completion counts', () => {
      expect(checklist.completedCount).toBe(1);
      expect(checklist.totalCount).toBe(3);
      expect(checklist.completedCount).toBeLessThanOrEqual(checklist.totalCount);
    });

    it('should have items matching totalCount', () => {
      expect(checklist.items).toHaveLength(checklist.totalCount);
    });

    it('should count checked items matching completedCount', () => {
      const actualChecked = checklist.items.filter(i => i.checked).length;
      expect(actualChecked).toBe(checklist.completedCount);
    });
  });

  describe('HandoffPacket', () => {
    const packet: HandoffPacket = {
      config: {
        engagementId: 'ENG-2026-001',
        clientName: 'Acme Corp',
        preparedBy: 'Christopher Bailey',
        dateRange: { from: '2025-01-01', to: '2025-09-30' },
        systemsAccessed: ['SAP', 'Salesforce'],
        scope: 'FY2025 Q1-Q3 O2C Process Audit',
        includeReproduction: true,
        includeChecklist: true,
        outputDir: '/tmp/handoff-output',
      },
      summary: '## Executive Summary\n\nAudit identified 5 critical findings.',
      findings: [
        {
          id: 'FIND-001',
          title: 'Duplicate Invoice Payments',
          severity: 'high',
          riskScore: 8.5,
          markdown: '## Finding\n\nDuplicate payments detected.',
          evidenceFiles: [{ filename: 'dupes.csv', content: 'a,b\n1,2', mimeType: 'text/csv' }],
        },
      ],
      contradictions: [
        {
          id: 'CONTRA-001',
          title: 'SAP vs Salesforce Amount Mismatch',
          severity: 'medium',
          riskScore: 6.0,
          markdown: '## Contradiction\n\nAmounts differ by 15%.',
          evidenceFiles: [],
        },
      ],
      realityGaps: [
        {
          id: 'GAP-001',
          title: 'Missing Delivery Documentation',
          severity: 'high',
          riskScore: 7.0,
          markdown: '## Reality Gap\n\nNo delivery records for 30 orders.',
          evidenceFiles: [],
        },
      ],
      manifest: {
        engagementId: 'ENG-2026-001',
        generatedAt: '2026-03-31T12:00:00.000Z',
        entries: [],
        totalExtractions: 0,
        totalRows: 0,
        systems: ['SAP', 'Salesforce'],
      },
      checklist: {
        engagementId: 'ENG-2026-001',
        reviewerName: '',
        generatedAt: '2026-03-31T12:00:00.000Z',
        items: [],
        completedCount: 0,
        totalCount: 0,
      },
      provenanceGraph: '{"nodes":[],"edges":[]}',
      generatedAt: '2026-03-31T12:00:00.000Z',
    };

    it('should contain all sections', () => {
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

    it('should have findings, contradictions, and realityGaps as arrays', () => {
      expect(Array.isArray(packet.findings)).toBe(true);
      expect(Array.isArray(packet.contradictions)).toBe(true);
      expect(Array.isArray(packet.realityGaps)).toBe(true);
    });

    it('should have parseable provenanceGraph JSON', () => {
      expect(() => JSON.parse(packet.provenanceGraph)).not.toThrow();
    });

    it('should have ISO 8601 generatedAt timestamp', () => {
      expect(new Date(packet.generatedAt).toISOString()).toBe(packet.generatedAt);
    });
  });
});
