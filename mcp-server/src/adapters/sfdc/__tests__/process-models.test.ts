// mcp-server/src/adapters/sfdc/__tests__/process-models.test.ts

import { describe, it, expect } from '@jest/globals';
import {
  SFDC_PIPELINES,
  getStagesForRecordType,
  isValidTransition,
  isTerminalStage,
  detectStageSkip,
  detectStageRegression,
} from '../process-models.js';

// ============================================================================
// SFDC_PIPELINES
// ============================================================================

describe('SFDC_PIPELINES', () => {
  it('defines New Business pipeline', () => {
    expect(SFDC_PIPELINES['New Business']).toBeDefined();
  });

  it('defines Renewal pipeline', () => {
    expect(SFDC_PIPELINES['Renewal']).toBeDefined();
  });

  it('defines Upsell pipeline', () => {
    expect(SFDC_PIPELINES['Upsell']).toBeDefined();
  });

  it('New Business has correct stages in order', () => {
    expect(SFDC_PIPELINES['New Business'].stages).toEqual([
      'Prospecting',
      'Qualification',
      'Needs Analysis',
      'Value Proposition',
      'Id. Decision Makers',
      'Perception Analysis',
      'Proposal/Price Quote',
      'Negotiation/Review',
    ]);
  });

  it('Renewal has correct stages', () => {
    expect(SFDC_PIPELINES['Renewal'].stages).toEqual(['Qualification', 'Proposal']);
  });

  it('Upsell has correct stages', () => {
    expect(SFDC_PIPELINES['Upsell'].stages).toEqual(['Discovery', 'Proposal', 'Negotiation']);
  });

  it('all pipelines have Closed Won and Closed Lost as terminal stages', () => {
    for (const pipeline of Object.values(SFDC_PIPELINES)) {
      expect(pipeline.terminal_stages).toContain('Closed Won');
      expect(pipeline.terminal_stages).toContain('Closed Lost');
    }
  });

  it('all pipelines have empty allowed_regressions', () => {
    for (const pipeline of Object.values(SFDC_PIPELINES)) {
      expect(pipeline.allowed_regressions).toEqual([]);
    }
  });

  it('record_type field matches the pipeline key', () => {
    expect(SFDC_PIPELINES['New Business'].record_type).toBe('New Business');
    expect(SFDC_PIPELINES['Renewal'].record_type).toBe('Renewal');
    expect(SFDC_PIPELINES['Upsell'].record_type).toBe('Upsell');
  });
});

// ============================================================================
// getStagesForRecordType
// ============================================================================

describe('getStagesForRecordType', () => {
  it('returns New Business stages for "New Business"', () => {
    const stages = getStagesForRecordType('New Business');
    expect(stages).toEqual(SFDC_PIPELINES['New Business'].stages);
  });

  it('returns Renewal stages for "Renewal"', () => {
    const stages = getStagesForRecordType('Renewal');
    expect(stages).toEqual(['Qualification', 'Proposal']);
  });

  it('returns Upsell stages for "Upsell"', () => {
    const stages = getStagesForRecordType('Upsell');
    expect(stages).toEqual(['Discovery', 'Proposal', 'Negotiation']);
  });

  it('falls back to New Business stages for unknown record type', () => {
    const stages = getStagesForRecordType('Cross-Sell');
    expect(stages).toEqual(SFDC_PIPELINES['New Business'].stages);
  });

  it('falls back to New Business stages for empty string', () => {
    const stages = getStagesForRecordType('');
    expect(stages).toEqual(SFDC_PIPELINES['New Business'].stages);
  });
});

// ============================================================================
// isTerminalStage
// ============================================================================

describe('isTerminalStage', () => {
  it('returns true for "Closed Won"', () => {
    expect(isTerminalStage('Closed Won')).toBe(true);
  });

  it('returns true for "Closed Lost"', () => {
    expect(isTerminalStage('Closed Lost')).toBe(true);
  });

  it('returns false for "Prospecting"', () => {
    expect(isTerminalStage('Prospecting')).toBe(false);
  });

  it('returns false for "Negotiation/Review"', () => {
    expect(isTerminalStage('Negotiation/Review')).toBe(false);
  });

  it('returns false for an unknown stage', () => {
    expect(isTerminalStage('Unknown Stage')).toBe(false);
  });
});

// ============================================================================
// isValidTransition
// ============================================================================

describe('isValidTransition', () => {
  it('allows forward movement in New Business', () => {
    expect(isValidTransition('Prospecting', 'Qualification', 'New Business')).toBe(true);
  });

  it('allows skipping forward stages in New Business', () => {
    expect(isValidTransition('Prospecting', 'Needs Analysis', 'New Business')).toBe(true);
  });

  it('rejects backward movement in New Business', () => {
    expect(isValidTransition('Qualification', 'Prospecting', 'New Business')).toBe(false);
  });

  it('allows transition to Closed Won from any stage', () => {
    expect(isValidTransition('Prospecting', 'Closed Won', 'New Business')).toBe(true);
  });

  it('allows transition to Closed Lost from any stage', () => {
    expect(isValidTransition('Negotiation/Review', 'Closed Lost', 'New Business')).toBe(true);
  });

  it('allows forward movement in Renewal', () => {
    expect(isValidTransition('Qualification', 'Proposal', 'Renewal')).toBe(true);
  });

  it('rejects backward movement in Renewal', () => {
    expect(isValidTransition('Proposal', 'Qualification', 'Renewal')).toBe(false);
  });

  it('allows forward movement in Upsell', () => {
    expect(isValidTransition('Discovery', 'Proposal', 'Upsell')).toBe(true);
  });

  it('rejects backward movement in Upsell', () => {
    expect(isValidTransition('Negotiation', 'Discovery', 'Upsell')).toBe(false);
  });

  it('allows transition to terminal from terminal (e.g. stage re-open edge case treated as terminal)', () => {
    // Both Closed Won and Closed Lost are terminal — transition between them
    // should be allowed since toStage is terminal
    expect(isValidTransition('Closed Won', 'Closed Lost', 'New Business')).toBe(true);
  });

  it('falls back to New Business for unknown record type', () => {
    // 'Prospecting' is in New Business; forward move should be valid
    expect(isValidTransition('Prospecting', 'Qualification', 'Unknown')).toBe(true);
  });
});

// ============================================================================
// detectStageSkip
// ============================================================================

describe('detectStageSkip', () => {
  it('returns empty array when no stages are skipped', () => {
    const history = ['Prospecting', 'Qualification', 'Needs Analysis'];
    expect(detectStageSkip(history, 'New Business')).toEqual([]);
  });

  it('detects a single skipped stage', () => {
    // Jumps from Prospecting to Needs Analysis — skips Qualification
    const history = ['Prospecting', 'Needs Analysis'];
    const skipped = detectStageSkip(history, 'New Business');
    expect(skipped).toContain('Qualification');
  });

  it('detects multiple skipped stages', () => {
    // Jumps from Prospecting to Value Proposition — skips Qualification, Needs Analysis
    const history = ['Prospecting', 'Value Proposition'];
    const skipped = detectStageSkip(history, 'New Business');
    expect(skipped).toContain('Qualification');
    expect(skipped).toContain('Needs Analysis');
    expect(skipped).not.toContain('Prospecting');
    expect(skipped).not.toContain('Value Proposition');
  });

  it('returns empty array for a single-stage history', () => {
    expect(detectStageSkip(['Prospecting'], 'New Business')).toEqual([]);
  });

  it('returns empty array for empty history', () => {
    expect(detectStageSkip([], 'New Business')).toEqual([]);
  });

  it('handles terminal stages in history without false positives', () => {
    // Prospecting -> Closed Won is valid skip detection based on process stages only
    const history = ['Prospecting', 'Closed Won'];
    // Terminal stages are not in the main stages list — no process stages skipped
    // between Prospecting (index 0) and Closed Won (not in stages list)
    // Implementation should not crash and return skipped stages between first and last
    // that ARE in the stages list
    const skipped = detectStageSkip(history, 'New Business');
    expect(Array.isArray(skipped)).toBe(true);
  });

  it('works correctly for Renewal pipeline', () => {
    // Renewal only has Qualification and Proposal — no stages between them
    const history = ['Qualification', 'Proposal'];
    expect(detectStageSkip(history, 'Renewal')).toEqual([]);
  });

  it('detects skip in Upsell pipeline', () => {
    // Jumps Discovery -> Negotiation, skips Proposal
    const history = ['Discovery', 'Negotiation'];
    const skipped = detectStageSkip(history, 'Upsell');
    expect(skipped).toContain('Proposal');
  });
});

// ============================================================================
// detectStageRegression
// ============================================================================

describe('detectStageRegression', () => {
  it('returns empty array when no regressions exist', () => {
    const history = ['Prospecting', 'Qualification', 'Needs Analysis'];
    expect(detectStageRegression(history, 'New Business')).toEqual([]);
  });

  it('detects a single regression', () => {
    const history = ['Qualification', 'Needs Analysis', 'Prospecting'];
    const regressions = detectStageRegression(history, 'New Business');
    expect(regressions).toHaveLength(1);
    expect(regressions[0]).toMatchObject({ from: 'Needs Analysis', to: 'Prospecting' });
  });

  it('includes the index of the regression transition', () => {
    const history = ['Qualification', 'Needs Analysis', 'Prospecting'];
    const regressions = detectStageRegression(history, 'New Business');
    // index 2 is the position in history of the backward stage
    expect(regressions[0].index).toBe(2);
  });

  it('detects multiple regressions', () => {
    const history = [
      'Needs Analysis',
      'Value Proposition',
      'Qualification',  // regression
      'Proposal/Price Quote',
      'Prospecting',    // regression
    ];
    const regressions = detectStageRegression(history, 'New Business');
    expect(regressions).toHaveLength(2);
  });

  it('returns empty array for single-stage history', () => {
    expect(detectStageRegression(['Prospecting'], 'New Business')).toEqual([]);
  });

  it('returns empty array for empty history', () => {
    expect(detectStageRegression([], 'New Business')).toEqual([]);
  });

  it('does not flag terminal stage transitions as regressions', () => {
    // Moving to Closed Won or Closed Lost is always valid
    const history = ['Negotiation/Review', 'Closed Won'];
    expect(detectStageRegression(history, 'New Business')).toEqual([]);
  });

  it('detects regression in Renewal pipeline', () => {
    const history = ['Proposal', 'Qualification'];
    const regressions = detectStageRegression(history, 'Renewal');
    expect(regressions).toHaveLength(1);
    expect(regressions[0]).toMatchObject({ from: 'Proposal', to: 'Qualification' });
  });

  it('falls back to New Business for unknown record type', () => {
    const history = ['Qualification', 'Prospecting'];
    const regressions = detectStageRegression(history, 'Unknown');
    expect(regressions).toHaveLength(1);
  });
});
