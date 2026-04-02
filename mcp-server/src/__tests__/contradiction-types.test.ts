/**
 * Tests for contradiction engine type definitions
 *
 * Validates that type structures are importable, usable, and that
 * runtime constraints hold (since TypeScript types are erased at runtime).
 */

import type { SystemType } from '../provenance/types.js';

import type {
  ContradictionType,
  Severity,
  ResolutionStatus,
  ContradictionFinding,
  ContradictionConfig,
  ComparisonResult,
  ComparisonPair,
  Comparator,
} from '../contradiction/types.js';

import { SEVERITY_WEIGHTS, DEFAULT_CONFIG } from '../contradiction/types.js';

// --- Runtime validation helpers ---

const VALID_CONTRADICTION_TYPES: readonly string[] = [
  'AMOUNT_DIVERGENCE',
  'DATE_CONFLICT',
  'STATUS_INCOMPATIBLE',
  'ENTITY_MISMATCH',
  'QUANTITY_DIVERGENCE',
  'APPROVAL_BYPASS',
  'TEMPORAL_IMPOSSIBILITY',
  'DUPLICATE_REFERENCE',
  'ORPHAN_RECORD',
  'RETROACTIVE_CHANGE',
  'SOD_VIOLATION',
  'SCHEMA_GHOST',
];

const VALID_SEVERITIES: readonly string[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'];

const VALID_RESOLUTION_STATUSES: readonly string[] = [
  'open',
  'confirmed',
  'explained',
  'false_positive',
];

function isValidContradictionType(value: string): value is ContradictionType {
  return VALID_CONTRADICTION_TYPES.includes(value);
}

function isValidSeverity(value: string): value is Severity {
  return VALID_SEVERITIES.includes(value);
}

function isValidResolutionStatus(value: string): value is ResolutionStatus {
  return VALID_RESOLUTION_STATUSES.includes(value);
}

// --- Tests ---

describe('Contradiction types', () => {
  describe('ContradictionType constraints', () => {
    it('should have exactly 12 distinct values', () => {
      expect(VALID_CONTRADICTION_TYPES).toHaveLength(12);
      const unique = new Set(VALID_CONTRADICTION_TYPES);
      expect(unique.size).toBe(12);
    });

    it('should accept all valid contradiction types', () => {
      for (const ct of VALID_CONTRADICTION_TYPES) {
        expect(isValidContradictionType(ct)).toBe(true);
      }
    });

    it('should reject invalid contradiction types', () => {
      expect(isValidContradictionType('MISSING_FIELD')).toBe(false);
      expect(isValidContradictionType('amount_divergence')).toBe(false);
      expect(isValidContradictionType('')).toBe(false);
    });
  });

  describe('Severity constraints', () => {
    it('should have exactly 5 severity levels', () => {
      expect(VALID_SEVERITIES).toHaveLength(5);
    });

    it('should accept all valid severities', () => {
      for (const s of VALID_SEVERITIES) {
        expect(isValidSeverity(s)).toBe(true);
      }
    });

    it('should reject invalid severities', () => {
      expect(isValidSeverity('WARNING')).toBe(false);
      expect(isValidSeverity('critical')).toBe(false);
    });
  });

  describe('SEVERITY_WEIGHTS', () => {
    it('should have entries for all 5 severity levels', () => {
      const keys = Object.keys(SEVERITY_WEIGHTS);
      expect(keys).toHaveLength(5);
      for (const s of VALID_SEVERITIES) {
        expect(SEVERITY_WEIGHTS[s as Severity]).toBeDefined();
      }
    });

    it('should have values in descending order (CRITICAL > HIGH > MEDIUM > LOW > INFO)', () => {
      expect(SEVERITY_WEIGHTS.CRITICAL).toBeGreaterThan(SEVERITY_WEIGHTS.HIGH);
      expect(SEVERITY_WEIGHTS.HIGH).toBeGreaterThan(SEVERITY_WEIGHTS.MEDIUM);
      expect(SEVERITY_WEIGHTS.MEDIUM).toBeGreaterThan(SEVERITY_WEIGHTS.LOW);
      expect(SEVERITY_WEIGHTS.LOW).toBeGreaterThan(SEVERITY_WEIGHTS.INFO);
    });

    it('should have all weights between 0 and 1 inclusive', () => {
      for (const s of VALID_SEVERITIES) {
        const w = SEVERITY_WEIGHTS[s as Severity];
        expect(w).toBeGreaterThanOrEqual(0);
        expect(w).toBeLessThanOrEqual(1);
      }
    });

    it('should have CRITICAL = 1.0 and INFO = 0.1', () => {
      expect(SEVERITY_WEIGHTS.CRITICAL).toBe(1.0);
      expect(SEVERITY_WEIGHTS.INFO).toBe(0.1);
    });
  });

  describe('ResolutionStatus constraints', () => {
    it('should have exactly 4 values', () => {
      expect(VALID_RESOLUTION_STATUSES).toHaveLength(4);
    });

    it('should accept all valid resolution statuses', () => {
      for (const rs of VALID_RESOLUTION_STATUSES) {
        expect(isValidResolutionStatus(rs)).toBe(true);
      }
    });

    it('should reject invalid resolution statuses', () => {
      expect(isValidResolutionStatus('resolved')).toBe(false);
      expect(isValidResolutionStatus('OPEN')).toBe(false);
    });
  });

  describe('DEFAULT_CONFIG', () => {
    it('should have all positive values', () => {
      expect(DEFAULT_CONFIG.amountDivergencePercent).toBeGreaterThan(0);
      expect(DEFAULT_CONFIG.amountDivergenceMinAbsolute).toBeGreaterThan(0);
      expect(DEFAULT_CONFIG.dateConflictDays).toBeGreaterThan(0);
      expect(DEFAULT_CONFIG.dateConflictHighDays).toBeGreaterThan(0);
      expect(DEFAULT_CONFIG.approvalThreshold).toBeGreaterThan(0);
      expect(DEFAULT_CONFIG.stalePeriodDays).toBeGreaterThan(0);
      // retroactiveDays = 0 is intentional (any change in closed period)
      expect(DEFAULT_CONFIG.retroactiveDays).toBeGreaterThanOrEqual(0);
    });

    it('should have divergence percent less than 1.0 (100%)', () => {
      expect(DEFAULT_CONFIG.amountDivergencePercent).toBeLessThan(1.0);
    });

    it('should have dateConflictHighDays >= dateConflictDays', () => {
      expect(DEFAULT_CONFIG.dateConflictHighDays).toBeGreaterThanOrEqual(
        DEFAULT_CONFIG.dateConflictDays
      );
    });

    it('should have sensible default values', () => {
      expect(DEFAULT_CONFIG.amountDivergencePercent).toBe(0.05);
      expect(DEFAULT_CONFIG.amountDivergenceMinAbsolute).toBe(100);
      expect(DEFAULT_CONFIG.dateConflictDays).toBe(30);
      expect(DEFAULT_CONFIG.dateConflictHighDays).toBe(60);
      expect(DEFAULT_CONFIG.approvalThreshold).toBe(50000);
      expect(DEFAULT_CONFIG.stalePeriodDays).toBe(90);
      expect(DEFAULT_CONFIG.retroactiveDays).toBe(0);
    });
  });

  describe('ContradictionFinding', () => {
    const finding: ContradictionFinding = {
      id: 'cf-001-uuid',
      type: 'AMOUNT_DIVERGENCE',
      severity: 'HIGH',
      confidence: 0.92,
      description: 'Invoice amount in SAP differs from Salesforce opportunity by 15%',

      leftSystem: 'SAP',
      leftTable: 'VBRK',
      leftRecordId: '0090012345',
      leftField: 'NETWR',
      leftValue: '50000.00',
      leftExtractionId: 'ext-sap-001',

      rightSystem: 'Salesforce',
      rightTable: 'Opportunity',
      rightRecordId: '006xx000001abc',
      rightField: 'Amount',
      rightValue: '57500.00',
      rightExtractionId: 'ext-sfdc-001',

      scoringDetails: { percentDivergence: 0.15, absoluteAmount: 7500 },

      detectedAt: '2026-03-31T14:30:00.000Z',
      resolutionStatus: 'open',
      reviewerNotes: '',
    };

    it('should have all required fields', () => {
      expect(finding.id).toBeDefined();
      expect(finding.type).toBeDefined();
      expect(finding.severity).toBeDefined();
      expect(finding.confidence).toBeDefined();
      expect(finding.description).toBeDefined();

      expect(finding.leftSystem).toBeDefined();
      expect(finding.leftTable).toBeDefined();
      expect(finding.leftRecordId).toBeDefined();
      expect(finding.leftField).toBeDefined();
      expect(finding.leftValue).toBeDefined();
      expect(finding.leftExtractionId).toBeDefined();

      expect(finding.rightSystem).toBeDefined();
      expect(finding.rightTable).toBeDefined();
      expect(finding.rightRecordId).toBeDefined();
      expect(finding.rightField).toBeDefined();
      expect(finding.rightValue).toBeDefined();
      expect(finding.rightExtractionId).toBeDefined();

      expect(finding.scoringDetails).toBeDefined();
      expect(finding.detectedAt).toBeDefined();
      expect(finding.resolutionStatus).toBeDefined();
      expect(finding.reviewerNotes).toBeDefined();
    });

    it('should use valid ContradictionType', () => {
      expect(isValidContradictionType(finding.type)).toBe(true);
    });

    it('should use valid Severity', () => {
      expect(isValidSeverity(finding.severity)).toBe(true);
    });

    it('should use valid ResolutionStatus', () => {
      expect(isValidResolutionStatus(finding.resolutionStatus)).toBe(true);
    });

    it('should have confidence between 0 and 1', () => {
      expect(finding.confidence).toBeGreaterThanOrEqual(0);
      expect(finding.confidence).toBeLessThanOrEqual(1);
    });

    it('should have ISO 8601 detectedAt timestamp', () => {
      expect(new Date(finding.detectedAt).toISOString()).toBe(finding.detectedAt);
    });

    it('should have numeric scoring details', () => {
      for (const value of Object.values(finding.scoringDetails)) {
        expect(typeof value).toBe('number');
      }
    });
  });

  describe('ComparisonPair', () => {
    const pair: ComparisonPair = {
      left: {
        system: 'SAP',
        table: 'VBRK',
        recordId: '0090012345',
        fields: { NETWR: '50000.00', WAERK: 'USD', FKDAT: '2026-03-15' },
        extractionId: 'ext-sap-001',
      },
      right: {
        system: 'Salesforce',
        table: 'Opportunity',
        recordId: '006xx000001abc',
        fields: { Amount: '57500.00', CurrencyIsoCode: 'USD', CloseDate: '2026-03-15' },
        extractionId: 'ext-sfdc-001',
      },
    };

    it('should have both left and right sides', () => {
      expect(pair.left).toBeDefined();
      expect(pair.right).toBeDefined();
    });

    it('should have all required fields on each side', () => {
      for (const side of [pair.left, pair.right]) {
        expect(side.system).toBeDefined();
        expect(side.table).toBeDefined();
        expect(side.recordId).toBeDefined();
        expect(side.fields).toBeDefined();
        expect(side.extractionId).toBeDefined();
      }
    });

    it('should support cross-system pairs (different systems)', () => {
      expect(pair.left.system).not.toBe(pair.right.system);
    });

    it('should support arbitrary field maps', () => {
      expect(Object.keys(pair.left.fields).length).toBeGreaterThan(0);
      expect(Object.keys(pair.right.fields).length).toBeGreaterThan(0);
    });
  });

  describe('ComparisonResult', () => {
    const result: ComparisonResult = {
      contradictions: [],
      recordsCompared: 150,
      comparisonsRun: 450,
      duration: 1234,
    };

    it('should have all required fields', () => {
      expect(result.contradictions).toBeDefined();
      expect(typeof result.recordsCompared).toBe('number');
      expect(typeof result.comparisonsRun).toBe('number');
      expect(typeof result.duration).toBe('number');
    });

    it('should have non-negative numeric fields', () => {
      expect(result.recordsCompared).toBeGreaterThanOrEqual(0);
      expect(result.comparisonsRun).toBeGreaterThanOrEqual(0);
      expect(result.duration).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Comparator interface', () => {
    it('should be implementable with a concrete comparator', () => {
      const mockComparator: Comparator = {
        type: 'AMOUNT_DIVERGENCE',
        compare: (_pair: ComparisonPair, _config: ContradictionConfig) => null,
      };

      expect(mockComparator.type).toBe('AMOUNT_DIVERGENCE');
      expect(isValidContradictionType(mockComparator.type)).toBe(true);
      expect(typeof mockComparator.compare).toBe('function');
    });

    it('should return null when no contradiction is found', () => {
      const mockComparator: Comparator = {
        type: 'DATE_CONFLICT',
        compare: () => null,
      };

      const pair: ComparisonPair = {
        left: {
          system: 'SAP',
          table: 'VBAK',
          recordId: '001',
          fields: { ERDAT: '2026-03-15' },
          extractionId: 'ext-1',
        },
        right: {
          system: 'Salesforce',
          table: 'Opportunity',
          recordId: '002',
          fields: { CreatedDate: '2026-03-15' },
          extractionId: 'ext-2',
        },
      };

      expect(mockComparator.compare(pair, DEFAULT_CONFIG)).toBeNull();
    });

    it('should return a ContradictionFinding when a contradiction is found', () => {
      const mockFinding: ContradictionFinding = {
        id: 'cf-mock-001',
        type: 'TEMPORAL_IMPOSSIBILITY',
        severity: 'CRITICAL',
        confidence: 0.99,
        description: 'Invoice created before purchase order',
        leftSystem: 'SAP',
        leftTable: 'EKKO',
        leftRecordId: '4500000001',
        leftField: 'AEDAT',
        leftValue: '2026-03-20',
        leftExtractionId: 'ext-po-001',
        rightSystem: 'SAP',
        rightTable: 'RBKP',
        rightRecordId: '5100000001',
        rightField: 'BLDAT',
        rightValue: '2026-03-10',
        rightExtractionId: 'ext-inv-001',
        scoringDetails: { daysBefore: 10 },
        detectedAt: '2026-03-31T15:00:00.000Z',
        resolutionStatus: 'open',
        reviewerNotes: '',
      };

      const mockComparator: Comparator = {
        type: 'TEMPORAL_IMPOSSIBILITY',
        compare: () => mockFinding,
      };

      const pair: ComparisonPair = {
        left: {
          system: 'SAP',
          table: 'EKKO',
          recordId: '4500000001',
          fields: { AEDAT: '2026-03-20' },
          extractionId: 'ext-po-001',
        },
        right: {
          system: 'SAP',
          table: 'RBKP',
          recordId: '5100000001',
          fields: { BLDAT: '2026-03-10' },
          extractionId: 'ext-inv-001',
        },
      };

      const result = mockComparator.compare(pair, DEFAULT_CONFIG);
      expect(result).not.toBeNull();
      expect(result!.type).toBe('TEMPORAL_IMPOSSIBILITY');
      expect(result!.severity).toBe('CRITICAL');
    });
  });
});
