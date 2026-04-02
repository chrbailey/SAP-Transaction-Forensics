/**
 * Phase 2 Barrel Export Tests
 *
 * Verifies that the contradiction engine and schema-validator barrel
 * exports are correctly wired, factory functions produce working
 * instances, and all 12 contradiction types are represented.
 */

// ---------------------------------------------------------------------------
// Contradiction barrel imports
// ---------------------------------------------------------------------------

import {
  // Engine
  ContradictionEngine,
  createDefaultEngine,
  // Config
  DEFAULT_CONFIG,
  SEVERITY_WEIGHTS,
  // Comparators
  AmountDivergenceComparator,
  QuantityDivergenceComparator,
  DateConflictComparator,
  TemporalImpossibilityComparator,
  StatusIncompatibleComparator,
  ApprovalBypassComparator,
  EntityMismatchComparator,
  DuplicateReferenceComparator,
  OrphanRecordComparator,
  RetroactiveChangeComparator,
  SoDViolationComparator,
  SchemaGhostComparator,
  // Scoring
  computeRiskScore,
  computeAggregateRisk,
  sortByRisk,
  filterByMinRisk,
  generateRiskSummary,
  TYPE_BASE_WEIGHTS,
} from '../contradiction/index.js';

import type {
  ContradictionType,
  Severity,
  ResolutionStatus,
  ContradictionFinding,
  ContradictionConfig,
  ComparisonResult,
  ComparisonPair,
  Comparator,
} from '../contradiction/index.js';

// ---------------------------------------------------------------------------
// Schema-validator barrel imports
// ---------------------------------------------------------------------------

import {
  SchemaValidator,
  buildIDESReferenceSchema,
  getReferenceTableNames,
  getReferenceFields,
  getReferenceStats,
  createDefaultValidator,
} from '../schema-validator/index.js';

import type {
  ValidationLevel,
  FieldValidation,
  TableValidation,
  PathValidation,
  ClientSchema,
  ClientTable,
  ClientField,
  ReferenceTable,
  ReferenceField,
} from '../schema-validator/index.js';

// ============================================================================
// Contradiction barrel tests
// ============================================================================

describe('Contradiction barrel — createDefaultEngine', () => {
  test('returns engine with 12 registered types', () => {
    const engine = createDefaultEngine();
    const types = engine.getRegisteredTypes();
    expect(types).toHaveLength(12);
  });

  test('all 12 ContradictionType values are represented', () => {
    const engine = createDefaultEngine();
    const types = new Set(engine.getRegisteredTypes());

    const ALL_TYPES: ContradictionType[] = [
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

    for (const t of ALL_TYPES) {
      expect(types.has(t)).toBe(true);
    }
  });

  test('accepts partial config override', () => {
    const engine = createDefaultEngine({ amountDivergencePercent: 0.1 });
    const types = engine.getRegisteredTypes();
    expect(types).toHaveLength(12);
  });

  test('running engine with no pairs returns empty contradictions', () => {
    const engine = createDefaultEngine();
    const result = engine.analyzeAll([]);
    expect(result.contradictions).toHaveLength(0);
    expect(result.recordsCompared).toBe(0);
    expect(result.comparisonsRun).toBe(0);
    expect(result.duration).toBeGreaterThanOrEqual(0);
  });
});

describe('Contradiction barrel — DEFAULT_CONFIG', () => {
  test('all config values are positive numbers', () => {
    expect(DEFAULT_CONFIG.amountDivergencePercent).toBeGreaterThan(0);
    expect(DEFAULT_CONFIG.amountDivergenceMinAbsolute).toBeGreaterThan(0);
    expect(DEFAULT_CONFIG.dateConflictDays).toBeGreaterThan(0);
    expect(DEFAULT_CONFIG.dateConflictHighDays).toBeGreaterThan(0);
    expect(DEFAULT_CONFIG.approvalThreshold).toBeGreaterThan(0);
    expect(DEFAULT_CONFIG.stalePeriodDays).toBeGreaterThan(0);
    // retroactiveDays can be 0 (any change in closed period)
    expect(DEFAULT_CONFIG.retroactiveDays).toBeGreaterThanOrEqual(0);
  });
});

describe('Contradiction barrel — exports are all importable', () => {
  test('engine class is a constructor', () => {
    expect(typeof ContradictionEngine).toBe('function');
    const engine = new ContradictionEngine();
    expect(engine).toBeInstanceOf(ContradictionEngine);
  });

  test('all 12 comparator classes are constructors', () => {
    const comparators = [
      AmountDivergenceComparator,
      QuantityDivergenceComparator,
      DateConflictComparator,
      TemporalImpossibilityComparator,
      StatusIncompatibleComparator,
      ApprovalBypassComparator,
      EntityMismatchComparator,
      DuplicateReferenceComparator,
      OrphanRecordComparator,
      RetroactiveChangeComparator,
      SoDViolationComparator,
      SchemaGhostComparator,
    ];

    for (const Cls of comparators) {
      expect(typeof Cls).toBe('function');
      const instance = new Cls();
      expect(instance.type).toBeDefined();
    }
  });

  test('scoring functions are callable', () => {
    expect(typeof computeRiskScore).toBe('function');
    expect(typeof computeAggregateRisk).toBe('function');
    expect(typeof sortByRisk).toBe('function');
    expect(typeof filterByMinRisk).toBe('function');
    expect(typeof generateRiskSummary).toBe('function');
  });

  test('SEVERITY_WEIGHTS has all 5 levels', () => {
    const levels: Severity[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'];
    for (const level of levels) {
      expect(typeof SEVERITY_WEIGHTS[level]).toBe('number');
      expect(SEVERITY_WEIGHTS[level]).toBeGreaterThan(0);
    }
  });

  test('TYPE_BASE_WEIGHTS has all 12 types', () => {
    const types: ContradictionType[] = [
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
    for (const t of types) {
      expect(typeof TYPE_BASE_WEIGHTS[t]).toBe('number');
      expect(TYPE_BASE_WEIGHTS[t]).toBeGreaterThan(0);
    }
  });

  test('type imports compile correctly (compile-time check)', () => {
    const ct: ContradictionType = 'AMOUNT_DIVERGENCE';
    const sev: Severity = 'HIGH';
    const rs: ResolutionStatus = 'open';
    expect(ct).toBe('AMOUNT_DIVERGENCE');
    expect(sev).toBe('HIGH');
    expect(rs).toBe('open');
  });
});

// ============================================================================
// Schema-validator barrel tests
// ============================================================================

describe('Schema-validator barrel — createDefaultValidator', () => {
  test('returns a working validator', () => {
    const validator = createDefaultValidator();
    expect(validator).toBeInstanceOf(SchemaValidator);
  });

  test('IDES reference has 18+ tables', () => {
    const schema = buildIDESReferenceSchema();
    expect(schema.size).toBeGreaterThanOrEqual(18);
  });

  test('getReferenceTableNames returns correct count', () => {
    const names = getReferenceTableNames();
    expect(names.length).toBeGreaterThanOrEqual(18);
    expect(names).toContain('VBAK');
    expect(names).toContain('BKPF');
    expect(names).toContain('EKKO');
    expect(names).toContain('EBAN');
  });

  test('getReferenceFields returns fields for known tables', () => {
    const vbakFields = getReferenceFields('VBAK');
    expect(vbakFields).toBeDefined();
    expect(vbakFields!.length).toBeGreaterThan(5);
    expect(vbakFields).toContain('VBELN');
    expect(vbakFields).toContain('NETWR');
    expect(vbakFields).toContain('ERDAT');
  });

  test('getReferenceFields returns undefined for unknown table', () => {
    expect(getReferenceFields('ZTABLE_NONEXISTENT')).toBeUndefined();
  });

  test('getReferenceStats returns valid statistics', () => {
    const stats = getReferenceStats();
    expect(stats.tableCount).toBeGreaterThanOrEqual(18);
    expect(stats.totalFields).toBeGreaterThan(100);
  });
});

describe('Schema-validator barrel — exports are all importable', () => {
  test('SchemaValidator is a constructor', () => {
    expect(typeof SchemaValidator).toBe('function');
    const validator = new SchemaValidator(new Map());
    expect(validator).toBeInstanceOf(SchemaValidator);
  });

  test('builder functions are callable', () => {
    expect(typeof buildIDESReferenceSchema).toBe('function');
    expect(typeof getReferenceTableNames).toBe('function');
    expect(typeof getReferenceFields).toBe('function');
    expect(typeof getReferenceStats).toBe('function');
    expect(typeof createDefaultValidator).toBe('function');
  });

  test('type imports compile correctly (compile-time check)', () => {
    const vl: ValidationLevel = 'structure';
    expect(vl).toBe('structure');
  });
});
