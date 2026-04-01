/**
 * Contradiction Engine — Public API
 *
 * Barrel exports for the contradiction detection subsystem. Provides the
 * engine, all 12 comparators, scoring utilities, and a factory function
 * that returns a fully-loaded engine instance.
 */

// ---------------------------------------------------------------------------
// Types (canonical definitions from types.ts)
// ---------------------------------------------------------------------------

export type {
  ContradictionType,
  Severity,
  ResolutionStatus,
  ContradictionFinding,
  ContradictionConfig,
  ComparisonResult,
  ComparisonPair,
  Comparator,
} from './types.js';

export { DEFAULT_CONFIG, SEVERITY_WEIGHTS } from './types.js';

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

export { ContradictionEngine } from './engine.js';

// ---------------------------------------------------------------------------
// Comparators
// ---------------------------------------------------------------------------

export {
  AmountDivergenceComparator,
  QuantityDivergenceComparator,
} from './comparators/amount.js';

export {
  DateConflictComparator,
  TemporalImpossibilityComparator,
} from './comparators/temporal.js';

export {
  StatusIncompatibleComparator,
  ApprovalBypassComparator,
} from './comparators/status.js';

export {
  EntityMismatchComparator,
  DuplicateReferenceComparator,
  OrphanRecordComparator,
} from './comparators/entity.js';

export {
  RetroactiveChangeComparator,
  SoDViolationComparator,
  SchemaGhostComparator,
} from './comparators/change.js';

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

export {
  computeRiskScore,
  computeAggregateRisk,
  sortByRisk,
  filterByMinRisk,
  generateRiskSummary,
  TYPE_BASE_WEIGHTS,
} from './scoring.js';

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

import type { ContradictionConfig } from './types.js';
import { ContradictionEngine } from './engine.js';

import { AmountDivergenceComparator, QuantityDivergenceComparator } from './comparators/amount.js';
import { DateConflictComparator, TemporalImpossibilityComparator } from './comparators/temporal.js';
import { StatusIncompatibleComparator, ApprovalBypassComparator } from './comparators/status.js';
import { EntityMismatchComparator, DuplicateReferenceComparator, OrphanRecordComparator } from './comparators/entity.js';
import { RetroactiveChangeComparator, SoDViolationComparator, SchemaGhostComparator } from './comparators/change.js';

/**
 * Create a fully-loaded contradiction engine with all 12 comparators registered.
 *
 * Note: The comparators in status.ts and change.ts have specialised `compare()`
 * signatures (they accept different inputs than the standard ComparisonPair
 * interface). They are registered here for type-enumeration purposes — the
 * engine's `getRegisteredTypes()` will list all 12 contradiction categories.
 * For actual detection, call the specialised comparators directly or use
 * `analyzeAll()` only with the pair-based comparators (amount, temporal, entity).
 */
export function createDefaultEngine(config?: Partial<ContradictionConfig>): ContradictionEngine {
  const engine = new ContradictionEngine(config);

  // Pair-based comparators (amount.ts, temporal.ts)
  engine.registerComparator(new AmountDivergenceComparator());
  engine.registerComparator(new QuantityDivergenceComparator());
  engine.registerComparator(new DateConflictComparator());
  engine.registerComparator(new TemporalImpossibilityComparator());

  // Status comparators — specialised signatures, registered for type coverage
  engine.registerComparator(new StatusIncompatibleComparator() as unknown as import('./types.js').Comparator);
  engine.registerComparator(new ApprovalBypassComparator() as unknown as import('./types.js').Comparator);

  // Entity comparators — specialised signatures
  engine.registerComparator(new EntityMismatchComparator() as unknown as import('./types.js').Comparator);
  engine.registerComparator(new DuplicateReferenceComparator() as unknown as import('./types.js').Comparator);
  engine.registerComparator(new OrphanRecordComparator() as unknown as import('./types.js').Comparator);

  // Change/compliance comparators — specialised signatures
  engine.registerComparator(new RetroactiveChangeComparator() as unknown as import('./types.js').Comparator);
  engine.registerComparator(new SoDViolationComparator() as unknown as import('./types.js').Comparator);
  engine.registerComparator(new SchemaGhostComparator() as unknown as import('./types.js').Comparator);

  return engine;
}
