// mcp-server/src/adapters/sfdc/process-models.ts

import type { SFDCProcessModelDef } from './sfdc-types.js';

// ============================================================================
// Pipeline Definitions
// ============================================================================

export const SFDC_PIPELINES: Record<string, SFDCProcessModelDef> = {
  'New Business': {
    record_type: 'New Business',
    stages: [
      'Prospecting',
      'Qualification',
      'Needs Analysis',
      'Value Proposition',
      'Id. Decision Makers',
      'Perception Analysis',
      'Proposal/Price Quote',
      'Negotiation/Review',
    ],
    terminal_stages: ['Closed Won', 'Closed Lost'],
    allowed_regressions: [],
  },
  Renewal: {
    record_type: 'Renewal',
    stages: ['Qualification', 'Proposal'],
    terminal_stages: ['Closed Won', 'Closed Lost'],
    allowed_regressions: [],
  },
  Upsell: {
    record_type: 'Upsell',
    stages: ['Discovery', 'Proposal', 'Negotiation'],
    terminal_stages: ['Closed Won', 'Closed Lost'],
    allowed_regressions: [],
  },
};

// ============================================================================
// getStagesForRecordType
// ============================================================================

/**
 * Returns the ordered stage list for a given record type.
 * Falls back to New Business if the record type is unknown.
 */
export function getStagesForRecordType(recordType: string): string[] {
  const pipeline = SFDC_PIPELINES[recordType];
  if (pipeline) {
    return pipeline.stages;
  }
  return SFDC_PIPELINES['New Business']?.stages ?? [];
}

// ============================================================================
// isTerminalStage
// ============================================================================

/**
 * Returns true if the stage name is a terminal stage (Closed Won / Closed Lost).
 */
export function isTerminalStage(stageName: string): boolean {
  return stageName === 'Closed Won' || stageName === 'Closed Lost';
}

// ============================================================================
// isValidTransition
// ============================================================================

/**
 * Returns true if moving from `fromStage` to `toStage` is allowed.
 * A transition is valid if:
 *   - toStage is a terminal stage, OR
 *   - toStage comes after fromStage in the pipeline (forward movement)
 * Backward movement is not OK.
 */
export function isValidTransition(fromStage: string, toStage: string, recordType: string): boolean {
  // Transition to any terminal stage is always allowed
  if (isTerminalStage(toStage)) {
    return true;
  }

  const stages = getStagesForRecordType(recordType);
  const fromIndex = stages.indexOf(fromStage);
  const toIndex = stages.indexOf(toStage);

  // If either stage is not found in the process stages, allow the transition
  // (could be a custom or legacy stage)
  if (fromIndex === -1 || toIndex === -1) {
    return true;
  }

  return toIndex > fromIndex;
}

// ============================================================================
// detectStageSkip
// ============================================================================

/**
 * Given an ordered stage history, finds process stages that were skipped
 * between the first and last visited stages.
 *
 * A stage is considered skipped if it lies between the earliest and latest
 * visited stage (by pipeline order) and was never visited.
 */
export function detectStageSkip(stageHistory: string[], recordType: string): string[] {
  if (stageHistory.length < 2) {
    return [];
  }

  const stages = getStagesForRecordType(recordType);

  // Map visited stages to their pipeline indices (ignore non-process stages like terminals)
  const visitedIndices = stageHistory.map(s => stages.indexOf(s)).filter(i => i !== -1);

  if (visitedIndices.length < 2) {
    return [];
  }

  const minIndex = Math.min(...visitedIndices);
  const maxIndex = Math.max(...visitedIndices);

  const visitedSet = new Set(stageHistory);
  const skipped: string[] = [];

  for (let i = minIndex + 1; i < maxIndex; i++) {
    const stage = stages[i];
    if (stage !== undefined && !visitedSet.has(stage)) {
      skipped.push(stage);
    }
  }

  return skipped;
}

// ============================================================================
// detectStageRegression
// ============================================================================

/**
 * Finds backward stage moves in the history.
 * Returns an array of { from, to, index } for each regression found,
 * where index is the position in stageHistory of the `to` stage.
 *
 * Terminal stage transitions are never regressions.
 */
export function detectStageRegression(
  stageHistory: string[],
  recordType: string
): Array<{ from: string; to: string; index: number }> {
  if (stageHistory.length < 2) {
    return [];
  }

  const stages = getStagesForRecordType(recordType);
  const regressions: Array<{ from: string; to: string; index: number }> = [];

  for (let i = 1; i < stageHistory.length; i++) {
    const from = stageHistory[i - 1];
    const to = stageHistory[i];

    if (from === undefined || to === undefined) {
      continue;
    }

    // Terminal moves are never regressions
    if (isTerminalStage(to)) {
      continue;
    }

    const fromIndex = stages.indexOf(from);
    const toIndex = stages.indexOf(to);

    // Both stages must be in the process list for a regression to be flagged
    if (fromIndex === -1 || toIndex === -1) {
      continue;
    }

    if (toIndex < fromIndex) {
      regressions.push({ from, to, index: i });
    }
  }

  return regressions;
}
