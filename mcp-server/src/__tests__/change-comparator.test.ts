/**
 * Tests for Change & Compliance Comparators
 *
 * Covers: RetroactiveChangeComparator, SoDViolationComparator,
 * SchemaGhostComparator — period detection, SoD conflict pairs,
 * schema validation, severity, confidence, and scoring details.
 */

import {
  RetroactiveChangeComparator,
  SoDViolationComparator,
  SchemaGhostComparator,
  parsePeriod,
} from '../contradiction/comparators/change.js';
import type {
  ChangeRecord,
  SchemaInput,
  ContradictionConfig,
} from '../contradiction/comparators/change.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

function defaultConfig(overrides: Partial<ContradictionConfig> = {}): ContradictionConfig {
  return {
    amountDivergencePercent: 0.05,
    amountDivergenceMinAbsolute: 10,
    dateConflictDays: 7,
    dateConflictHighDays: 30,
    approvalThreshold: 0.8,
    stalePeriodDays: 90,
    retroactiveDays: 14,
    ...overrides,
  };
}

function makeRecord(
  fields: Record<string, string>,
  opts: {
    system?: 'SAP' | 'NetSuite' | 'Salesforce';
    table?: string;
    recordId?: string;
  } = {},
): ChangeRecord {
  return {
    system: opts.system ?? 'SAP',
    table: opts.table ?? 'BKPF',
    recordId: opts.recordId ?? 'DOC001',
    fields,
  };
}

function makeSchemaInput(
  record: Record<string, string>,
  validFields: string[],
  opts: {
    system?: 'SAP' | 'NetSuite' | 'Salesforce';
    table?: string;
    recordId?: string;
  } = {},
): SchemaInput {
  return {
    system: opts.system ?? 'SAP',
    table: opts.table ?? 'BKPF',
    recordId: opts.recordId ?? 'DOC001',
    record,
    validFields: new Set(validFields),
  };
}

// ---------------------------------------------------------------------------
// RetroactiveChangeComparator
// ---------------------------------------------------------------------------

describe('RetroactiveChangeComparator', () => {
  const comparator = new RetroactiveChangeComparator();

  it('detects change in period 04 for doc posted in period 02', () => {
    const record = makeRecord({
      MONAT: '02',
      GJAHR: '2025',
      CPUDT: '20250415',  // April = period 04
    });
    const finding = comparator.compare(record, defaultConfig());

    expect(finding).not.toBeNull();
    expect(finding!.type).toBe('RETROACTIVE_CHANGE');
    expect(finding!.scoringDetails['postingPeriod']).toBe(202502);
    expect(finding!.scoringDetails['changePeriod']).toBe(202504);
    expect(finding!.scoringDetails['periodGap']).toBe(2);
  });

  it('returns null when change is in same period as posting', () => {
    const record = makeRecord({
      MONAT: '03',
      GJAHR: '2025',
      CPUDT: '20250318',  // March = period 03, same as posting
    });
    const finding = comparator.compare(record, defaultConfig());

    expect(finding).toBeNull();
  });

  it('CRITICAL when period gap > 1', () => {
    const record = makeRecord({
      MONAT: '01',
      GJAHR: '2025',
      AEDAT: '20250520',  // May = period 05, gap of 4
    });
    const finding = comparator.compare(record, defaultConfig());

    expect(finding).not.toBeNull();
    expect(finding!.severity).toBe('CRITICAL');
    expect(finding!.scoringDetails['periodGap']).toBe(4);
  });

  it('handles SAP YYYYMMDD date format', () => {
    const record = makeRecord({
      BUDAT: '20250210',  // Feb posting date
      CPUDT: '20250415',  // April change date
    });
    const finding = comparator.compare(record, defaultConfig());

    expect(finding).not.toBeNull();
    expect(finding!.type).toBe('RETROACTIVE_CHANGE');
    expect(finding!.confidence).toBe(0.90);
    // Verify the dates were parsed correctly
    expect(finding!.scoringDetails['postingDate']).toBe('20250210');
    expect(finding!.scoringDetails['changeDate']).toBe('20250415');
  });

  it('HIGH severity when gap is exactly 1', () => {
    const record = makeRecord({
      MONAT: '06',
      GJAHR: '2025',
      CPUDT: '20250715',  // July = period 07, gap of 1
    });
    const finding = comparator.compare(record, defaultConfig());

    expect(finding).not.toBeNull();
    expect(finding!.severity).toBe('HIGH');
    expect(finding!.scoringDetails['periodGap']).toBe(1);
  });

  it('finding has valid UUID and ISO timestamp', () => {
    const record = makeRecord({
      MONAT: '02',
      GJAHR: '2025',
      CPUDT: '20250415',
    });
    const finding = comparator.compare(record, defaultConfig())!;

    expect(finding.id).toMatch(UUID_RE);
    expect(finding.detectedAt).toMatch(ISO_RE);
  });
});

// ---------------------------------------------------------------------------
// SoDViolationComparator
// ---------------------------------------------------------------------------

describe('SoDViolationComparator', () => {
  const comparator = new SoDViolationComparator();

  it('detects same user as poster and approver', () => {
    const record = makeRecord({
      USNAM: 'JSMITH',
      APPROVER: 'JSMITH',
    });
    const finding = comparator.compare(record, defaultConfig());

    expect(finding).not.toBeNull();
    expect(finding!.type).toBe('SOD_VIOLATION');
    expect(finding!.scoringDetails['conflictType']).toBe('post_and_approve');
    expect(finding!.scoringDetails['userId']).toBe('JSMITH');
  });

  it('returns null for different users', () => {
    const record = makeRecord({
      USNAM: 'JSMITH',
      APPROVER: 'MJONES',
    });
    const finding = comparator.compare(record, defaultConfig());

    expect(finding).toBeNull();
  });

  it('detects create_and_pay conflict', () => {
    const record = makeRecord({
      ERNAM: 'BWILSON',
      PaymentProcessedBy: 'BWILSON',
    });
    const finding = comparator.compare(record, defaultConfig());

    expect(finding).not.toBeNull();
    expect(finding!.scoringDetails['conflictType']).toBe('create_and_pay');
    expect(finding!.scoringDetails['userId']).toBe('BWILSON');
  });

  it('always HIGH severity', () => {
    const record = makeRecord({
      USNAM: 'ADMIN01',
      APPROVER: 'ADMIN01',
    });
    const finding = comparator.compare(record, defaultConfig());

    expect(finding).not.toBeNull();
    expect(finding!.severity).toBe('HIGH');
    expect(finding!.confidence).toBe(0.95);
  });

  it('identifies the specific conflict type in scoringDetails', () => {
    const record = makeRecord({
      ERNAM: 'TUSER',
      AENAM: 'TUSER',
    });
    const finding = comparator.compare(record, defaultConfig());

    expect(finding).not.toBeNull();
    expect(finding!.scoringDetails).toHaveProperty('conflictType');
    expect(finding!.scoringDetails).toHaveProperty('userId');
    expect(finding!.scoringDetails).toHaveProperty('leftAction');
    expect(finding!.scoringDetails).toHaveProperty('rightAction');
    expect(finding!.scoringDetails['conflictType']).toBe('create_and_modify');
    expect(finding!.scoringDetails['leftAction']).toBe('creator');
    expect(finding!.scoringDetails['rightAction']).toBe('modifier');
  });

  it('case-insensitive user matching', () => {
    const record = makeRecord({
      USNAM: 'jsmith',
      APPROVER: 'JSMITH',
    });
    const finding = comparator.compare(record, defaultConfig());

    expect(finding).not.toBeNull();
    expect(finding!.type).toBe('SOD_VIOLATION');
  });
});

// ---------------------------------------------------------------------------
// SchemaGhostComparator
// ---------------------------------------------------------------------------

describe('SchemaGhostComparator', () => {
  const comparator = new SchemaGhostComparator();

  it('detects field not in valid schema', () => {
    const input = makeSchemaInput(
      { BUKRS: '1000', BELNR: '100001', ZZTAXCODE: 'X1' },
      ['BUKRS', 'BELNR', 'GJAHR', 'MONAT', 'BUDAT'],
    );
    const finding = comparator.compare(input, defaultConfig());

    expect(finding).not.toBeNull();
    expect(finding!.type).toBe('SCHEMA_GHOST');
    expect(finding!.scoringDetails['ghostField']).toBe('ZZTAXCODE');
    expect(finding!.scoringDetails['table']).toBe('BKPF');
    expect(finding!.scoringDetails['validFieldCount']).toBe(5);
  });

  it('returns null when all fields are valid', () => {
    const input = makeSchemaInput(
      { BUKRS: '1000', BELNR: '100001' },
      ['BUKRS', 'BELNR', 'GJAHR', 'MONAT', 'BUDAT'],
    );
    const finding = comparator.compare(input, defaultConfig());

    expect(finding).toBeNull();
  });

  it('CRITICAL severity, confidence 1.0', () => {
    const input = makeSchemaInput(
      { BUKRS: '1000', PHANTOM_FIELD: 'data' },
      ['BUKRS', 'BELNR'],
    );
    const finding = comparator.compare(input, defaultConfig());

    expect(finding).not.toBeNull();
    expect(finding!.severity).toBe('CRITICAL');
    expect(finding!.confidence).toBe(1.0);
  });

  it('finding has valid UUID and ISO timestamp', () => {
    const input = makeSchemaInput(
      { GHOST: 'value' },
      ['BUKRS'],
    );
    const finding = comparator.compare(input, defaultConfig())!;

    expect(finding.id).toMatch(UUID_RE);
    expect(finding.detectedAt).toMatch(ISO_RE);
  });
});
