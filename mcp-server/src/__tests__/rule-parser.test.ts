/**
 * Tests for RuleParser
 *
 * Covers: batch parsing, single-rule conversion, validation errors,
 * deterministic ID generation, approval-text extraction, timing-SLA
 * extraction, standard rulesets per system, error aggregation, and
 * ID uniqueness.
 */

import { RuleParser } from '../reality-gap/rule-parser.js';
import type { RuleDefinition } from '../reality-gap/rule-parser.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function validDef(overrides: Partial<RuleDefinition> = {}): RuleDefinition {
  return {
    document: 'SOP-AP-001',
    section: '4.1 - Purchase Approval',
    text: 'Purchases over $50,000 require VP approval',
    system: 'SAP',
    type: 'approval_threshold',
    params: { threshold: 50000, currency: 'USD' },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RuleParser', () => {
  let parser: RuleParser;

  beforeEach(() => {
    parser = new RuleParser();
  });

  // 1. parseRules converts array of definitions
  it('parseRules converts an array of definitions into WorkflowRules', () => {
    const defs: RuleDefinition[] = [
      validDef(),
      validDef({ section: '4.2 - Invoice Approval', text: 'Invoices need review' }),
    ];
    const { rules, errors } = parser.parseRules(defs);
    expect(errors).toHaveLength(0);
    expect(rules).toHaveLength(2);
    expect(rules[0]!.sourceDocument).toBe('SOP-AP-001');
    expect(rules[1]!.section).toBe('4.2 - Invoice Approval');
  });

  // 2. parseRule creates a valid WorkflowRule
  it('parseRule creates a valid WorkflowRule with all fields', () => {
    const def = validDef({ id: 'CUSTOM-001', extractionPath: 'ext-path-1' });
    const rule = parser.parseRule(def);
    expect(rule.id).toBe('CUSTOM-001');
    expect(rule.sourceDocument).toBe('SOP-AP-001');
    expect(rule.section).toBe('4.1 - Purchase Approval');
    expect(rule.ruleText).toBe('Purchases over $50,000 require VP approval');
    expect(rule.systemScope).toBe('SAP');
    expect(rule.ruleType).toBe('approval_threshold');
    expect(rule.parameters).toEqual({ threshold: 50000, currency: 'USD' });
    expect(rule.extractionPathId).toBe('ext-path-1');
    expect(rule.active).toBe(true);
  });

  // 3. validateDefinition catches missing document
  it('validateDefinition catches missing document', () => {
    const def = validDef({ document: '' });
    const { valid, errors } = parser.validateDefinition(def);
    expect(valid).toBe(false);
    expect(errors).toContain('missing required field: document');
  });

  // 4. validateDefinition catches invalid rule type
  it('validateDefinition catches invalid rule type', () => {
    const def = validDef({ type: 'bogus_type' });
    const { valid, errors } = parser.validateDefinition(def);
    expect(valid).toBe(false);
    expect(errors.some((e) => e.includes('invalid rule type'))).toBe(true);
  });

  // 5. generateId produces a deterministic ID
  it('generates deterministic IDs for the same definition', () => {
    const def = validDef();
    const rule1 = parser.parseRule(def);
    const rule2 = parser.parseRule(def);
    expect(rule1.id).toBe(rule2.id);
    expect(rule1.id).toMatch(/^RULE-SAP-approval-threshold-[0-9a-f]{8}$/);
  });

  // 6. parseApprovalText extracts threshold from "$50,000"
  it('parseApprovalText extracts threshold from dollar amount', () => {
    const result = RuleParser.parseApprovalText('Purchases over $50,000 require CFO approval');
    expect(result.threshold).toBe(50000);
  });

  // 7. parseApprovalText extracts currency from "EUR 10,000"
  it('parseApprovalText extracts currency from ISO code amount', () => {
    const result = RuleParser.parseApprovalText(
      'Invoices exceeding EUR 10,000 must be reviewed by Finance Manager',
    );
    expect(result.currency).toBe('EUR');
    expect(result.threshold).toBe(10000);
  });

  // 8. parseApprovalText extracts role from "CFO approval"
  it('parseApprovalText extracts approver role', () => {
    const result = RuleParser.parseApprovalText('Purchases over $50,000 require CFO approval');
    expect(result.approverRole).toBe('CFO');
  });

  // 9. parseTimingSLA extracts days from "5 business days"
  it('parseTimingSLA extracts day count from business days', () => {
    const result = RuleParser.parseTimingSLA(
      'Delivery must occur within 5 business days of order confirmation',
    );
    expect(result.maxDays).toBe(5);
  });

  // 10. parseTimingSLA extracts activity
  it('parseTimingSLA extracts the reference activity', () => {
    const result = RuleParser.parseTimingSLA(
      'Delivery must occur within 5 business days of order confirmation',
    );
    expect(result.activity).toBe('order confirmation');
  });

  // 11. createStandardRuleset('SAP') returns 10+ rules
  it('createStandardRuleset returns 10+ SAP rules', () => {
    const rules = RuleParser.createStandardRuleset('SAP');
    expect(rules.length).toBeGreaterThanOrEqual(10);
    for (const r of rules) {
      expect(r.systemScope).toBe('SAP');
      expect(r.active).toBe(true);
    }
  });

  // 12. createStandardRuleset('NetSuite') returns 10+ rules
  it('createStandardRuleset returns 10+ NetSuite rules', () => {
    const rules = RuleParser.createStandardRuleset('NetSuite');
    expect(rules.length).toBeGreaterThanOrEqual(10);
    for (const r of rules) {
      expect(r.systemScope).toBe('NetSuite');
    }
  });

  // 13. Standard ruleset rules have valid IDs and types
  it('standard ruleset rules have valid IDs and rule types', () => {
    const validTypes = new Set([
      'approval_threshold', 'sod_constraint', 'sequence_requirement',
      'timing_sla', 'field_validation', 'routing_rule',
    ]);
    for (const sys of ['SAP', 'NetSuite', 'Salesforce'] as const) {
      const rules = RuleParser.createStandardRuleset(sys);
      for (const r of rules) {
        expect(r.id).toMatch(/^RULE-/);
        expect(validTypes.has(r.ruleType)).toBe(true);
        expect(r.sourceDocument).toBeTruthy();
      }
    }
  });

  // 14. parseRules returns errors for invalid definitions
  it('parseRules collects errors for invalid definitions and skips them', () => {
    const defs: RuleDefinition[] = [
      validDef(),
      validDef({ document: '', type: 'invalid_type' }), // two errors
      validDef({ section: '5.1' }),
    ];
    const { rules, errors } = parser.parseRules(defs);
    expect(rules).toHaveLength(2);   // first and third are valid
    expect(errors.length).toBeGreaterThanOrEqual(2); // at least 2 errors from the bad one
  });

  // 15. Auto-generated IDs are unique across different definitions
  it('auto-generated IDs are unique for different definitions', () => {
    const defs: RuleDefinition[] = [
      validDef({ section: 'Section A' }),
      validDef({ section: 'Section B' }),
      validDef({ document: 'OTHER-DOC', section: 'Section A' }),
    ];
    const ids = defs.map((d) => parser.parseRule(d).id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });
});
