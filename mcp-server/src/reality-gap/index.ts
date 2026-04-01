/**
 * Reality-Gap Engine — Public API
 *
 * Barrel exports for the three-way gap analysis subsystem:
 *   Design gaps   (reference vs documented)
 *   Compliance gaps (documented vs actual)
 *   Shadow gaps    (actual vs reference+documented)
 *
 * Plus the orchestrating RealityGapEngine and a factory function.
 */

// ---------------------------------------------------------------------------
// Types (canonical definitions from types.ts)
// ---------------------------------------------------------------------------

export type {
  GapType,
  GapSeverity,
  WorkflowRule,
  ReferenceStep,
  ActualEvent,
  GapFinding,
  GapDetectionConfig,
  GapDetectionResult,
} from './types.js';

export { DEFAULT_GAP_CONFIG } from './types.js';

// ---------------------------------------------------------------------------
// Detectors
// ---------------------------------------------------------------------------

export { DesignGapDetector } from './design-gap.js';
export { ComplianceGapDetector } from './compliance-gap.js';
export { ShadowGapDetector } from './shadow-gap.js';

// ---------------------------------------------------------------------------
// Engine (orchestrator)
// ---------------------------------------------------------------------------

export { RealityGapEngine } from './engine.js';

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

import type { GapDetectionConfig } from './types.js';
import { RealityGapEngine } from './engine.js';

/**
 * Create a RealityGapEngine with sensible defaults.
 * Pass partial config to override any default values.
 */
export function createDefaultEngine(config?: Partial<GapDetectionConfig>): RealityGapEngine {
  return new RealityGapEngine(config);
}
