/**
 * Rule Parser — Parses structured rule definitions into WorkflowRule objects
 *
 * Converts JSON rule definitions into validated WorkflowRule instances for
 * the reality-gap engine. Includes NLP-lite helpers to extract parameters
 * from human-readable rule text (approval thresholds, timing SLAs) and a
 * factory for generating standard ERP rulesets.
 */

import { createHash } from 'node:crypto';
import type { SystemType } from '../provenance/types.js';
import type { WorkflowRule } from './types.js';

// ---------------------------------------------------------------------------
// Local types
// ---------------------------------------------------------------------------

type RuleType = WorkflowRule['ruleType'];

const VALID_SYSTEMS: ReadonlySet<string> = new Set<string>([
  'SAP',
  'NetSuite',
  'Salesforce',
  'cross-system',
]);

const VALID_RULE_TYPES: ReadonlySet<string> = new Set<string>([
  'approval_threshold',
  'sod_constraint',
  'sequence_requirement',
  'timing_sla',
  'field_validation',
  'routing_rule',
]);

/** Input format for rule definitions (JSON) */
export interface RuleDefinition {
  id?: string;
  document: string;
  section: string;
  text: string;
  system: string;
  type: string;
  params: Record<string, string | number>;
  extractionPath?: string;
}

// ---------------------------------------------------------------------------
// RuleParser
// ---------------------------------------------------------------------------

export class RuleParser {
  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /** Parse an array of rule definitions into WorkflowRules */
  parseRules(definitions: RuleDefinition[]): { rules: WorkflowRule[]; errors: string[] } {
    const rules: WorkflowRule[] = [];
    const errors: string[] = [];

    for (const def of definitions) {
      const validation = this.validateDefinition(def);
      if (!validation.valid) {
        for (const e of validation.errors) {
          errors.push(`[${def.id ?? 'unknown'}] ${e}`);
        }
        continue;
      }
      rules.push(this.parseRule(def));
    }

    return { rules, errors };
  }

  /** Parse a single rule definition into a WorkflowRule */
  parseRule(definition: RuleDefinition): WorkflowRule {
    const id = definition.id ?? this.generateId(definition);
    return {
      id,
      sourceDocument: definition.document,
      section: definition.section,
      ruleText: definition.text,
      systemScope: definition.system as SystemType | 'cross-system',
      ruleType: definition.type as RuleType,
      parameters: { ...definition.params },
      extractionPathId: definition.extractionPath,
      active: true,
    };
  }

  /** Validate a rule definition, returning structured errors */
  validateDefinition(definition: RuleDefinition): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!definition.document || definition.document.trim() === '') {
      errors.push('missing required field: document');
    }
    if (!definition.section || definition.section.trim() === '') {
      errors.push('missing required field: section');
    }
    if (!definition.text || definition.text.trim() === '') {
      errors.push('missing required field: text');
    }
    if (!definition.system || !VALID_SYSTEMS.has(definition.system)) {
      errors.push(
        `invalid system: "${String(definition.system ?? '')}" — must be one of: ${[...VALID_SYSTEMS].join(', ')}`
      );
    }
    if (!definition.type || !VALID_RULE_TYPES.has(definition.type)) {
      errors.push(
        `invalid rule type: "${String(definition.type ?? '')}" — must be one of: ${[...VALID_RULE_TYPES].join(', ')}`
      );
    }

    return { valid: errors.length === 0, errors };
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  /** Generate a deterministic rule ID from the definition */
  private generateId(definition: RuleDefinition): string {
    const sys = (definition.system ?? 'UNK').toUpperCase().replace(/[^A-Z]/g, '');
    const tp = (definition.type ?? 'UNK').toLowerCase().replace(/_/g, '-');
    const hash = createHash('sha256')
      .update(`${definition.document}|${definition.section}`)
      .digest('hex')
      .slice(0, 8);
    return `RULE-${sys}-${tp}-${hash}`;
  }

  // -----------------------------------------------------------------------
  // Static text-parsing helpers
  // -----------------------------------------------------------------------

  /**
   * Parse common approval-threshold rules from human-readable text.
   *
   * Recognises patterns such as:
   *   "Purchases over $50,000 require CFO approval"
   *   "Invoices exceeding EUR 10,000 must be reviewed by Finance Manager"
   */
  static parseApprovalText(text: string): {
    threshold?: number;
    currency?: string;
    approverRole?: string;
  } {
    const result: { threshold?: number; currency?: string; approverRole?: string } = {};

    // --- Threshold + currency ---
    // Match currency symbol then amount, e.g. "$50,000" or "EUR10,000"
    const symbolAmountRe = /([£€$¥])\s*([\d,]+(?:\.\d+)?)/;
    const symbolMatch = symbolAmountRe.exec(text);
    if (symbolMatch) {
      const symbolMap: Record<string, string> = { $: 'USD', '€': 'EUR', '£': 'GBP', '¥': 'JPY' };
      result.currency = symbolMap[symbolMatch[1]!] ?? 'USD';
      result.threshold = Number(symbolMatch[2]!.replace(/,/g, ''));
    }

    // Match ISO code then amount, e.g. "EUR 10,000"
    if (result.threshold === undefined) {
      const codeAmountRe = /\b(USD|EUR|GBP|JPY|CHF|AUD|CAD)\s+([\d,]+(?:\.\d+)?)/i;
      const codeMatch = codeAmountRe.exec(text);
      if (codeMatch) {
        result.currency = codeMatch[1]!.toUpperCase();
        result.threshold = Number(codeMatch[2]!.replace(/,/g, ''));
      }
    }

    // --- Approver role ---
    // "require(s) <ROLE> approval" or "approved by <ROLE>"
    const rolePatterns = [
      /require[sd]?\s+(.+?)\s+approval/i,
      /approved?\s+by\s+(.+?)(?:\.|$)/i,
      /reviewed?\s+by\s+(.+?)(?:\.|$)/i,
    ];
    for (const re of rolePatterns) {
      const m = re.exec(text);
      if (m) {
        result.approverRole = m[1]!.trim();
        break;
      }
    }

    return result;
  }

  /**
   * Parse timing-SLA rules from human-readable text.
   *
   * Recognises patterns such as:
   *   "Delivery must occur within 5 business days of order confirmation"
   *   "Invoice processing SLA: 3 days from goods receipt"
   */
  static parseTimingSLA(text: string): { maxDays?: number; activity?: string } {
    const result: { maxDays?: number; activity?: string } = {};

    // Match "N (business)? days"
    const daysRe = /(\d+)\s+(?:business\s+)?days/i;
    const daysMatch = daysRe.exec(text);
    if (daysMatch) {
      result.maxDays = Number(daysMatch[1]);
    }

    // Activity: "within N days of <activity>" or "from <activity>"
    const activityPatterns = [
      /days?\s+(?:of|from|after)\s+(.+?)(?:\.|$)/i,
      /SLA[:\s]+\d+\s+days?\s+from\s+(.+?)(?:\.|$)/i,
    ];
    for (const re of activityPatterns) {
      const m = re.exec(text);
      if (m) {
        result.activity = m[1]!.trim();
        break;
      }
    }

    return result;
  }

  // -----------------------------------------------------------------------
  // Standard ruleset factory
  // -----------------------------------------------------------------------

  /** Create a standard set of common ERP rules for the given system type */
  static createStandardRuleset(systemType: SystemType): WorkflowRule[] {
    const parser = new RuleParser();

    const defs: RuleDefinition[] =
      systemType === 'SAP'
        ? sapStandardRules()
        : systemType === 'NetSuite'
          ? netsuiteStandardRules()
          : salesforceStandardRules();

    return defs.map(d => parser.parseRule(d));
  }
}

// ---------------------------------------------------------------------------
// Standard rule templates (private to module)
// ---------------------------------------------------------------------------

function sapStandardRules(): RuleDefinition[] {
  return [
    {
      document: 'SOP-AP-001',
      section: '4.1 - Purchase Approval',
      text: 'Purchases over $50,000 require VP approval',
      system: 'SAP',
      type: 'approval_threshold',
      params: { threshold: 50000, currency: 'USD', approverRole: 'VP' },
    },
    {
      document: 'SOP-AP-001',
      section: '4.2 - Invoice Approval',
      text: 'Invoices over $10,000 require Manager approval',
      system: 'SAP',
      type: 'approval_threshold',
      params: { threshold: 10000, currency: 'USD', approverRole: 'Manager' },
    },
    {
      document: 'SOP-SEC-001',
      section: '3.1 - Segregation of Duties',
      text: 'PO creator must not be the same as PO approver',
      system: 'SAP',
      type: 'sod_constraint',
      params: { role1: 'PO Creator', role2: 'PO Approver' },
    },
    {
      document: 'SOP-SEC-001',
      section: '3.2 - Payment SoD',
      text: 'Invoice creator must not be the same as payment releaser',
      system: 'SAP',
      type: 'sod_constraint',
      params: { role1: 'Invoice Creator', role2: 'Payment Releaser' },
    },
    {
      document: 'SOP-O2C-001',
      section: '2.1 - Order Sequence',
      text: 'Sales order must precede delivery before billing',
      system: 'SAP',
      type: 'sequence_requirement',
      params: { step1: 'Sales Order', step2: 'Delivery', step3: 'Billing' },
    },
    {
      document: 'SOP-O2C-001',
      section: '2.3 - Delivery SLA',
      text: 'Delivery must occur within 5 business days of order confirmation',
      system: 'SAP',
      type: 'timing_sla',
      params: { maxDays: 5, from: 'Order Confirmation', to: 'Delivery' },
    },
    {
      document: 'SOP-AP-001',
      section: '5.1 - Three-Way Match',
      text: 'Invoice must match PO and goods receipt before payment',
      system: 'SAP',
      type: 'sequence_requirement',
      params: { step1: 'PO', step2: 'Goods Receipt', step3: 'Invoice Verification' },
    },
    {
      document: 'SOP-GL-001',
      section: '1.1 - Period Close',
      text: 'No postings allowed to closed fiscal periods',
      system: 'SAP',
      type: 'field_validation',
      params: { field: 'posting_period', constraint: 'must_be_open' },
    },
    {
      document: 'SOP-GL-001',
      section: '2.1 - Posting Authorization',
      text: 'Journal entries over $100,000 require Controller sign-off',
      system: 'SAP',
      type: 'approval_threshold',
      params: { threshold: 100000, currency: 'USD', approverRole: 'Controller' },
    },
    {
      document: 'SOP-AP-001',
      section: '6.1 - Payment Routing',
      text: 'Payments above $25,000 must use wire transfer, not check',
      system: 'SAP',
      type: 'routing_rule',
      params: { threshold: 25000, requiredMethod: 'wire_transfer' },
    },
    {
      document: 'SOP-MM-001',
      section: '1.2 - GR Processing SLA',
      text: 'Goods receipt must be posted within 2 days of physical receipt',
      system: 'SAP',
      type: 'timing_sla',
      params: { maxDays: 2, from: 'Physical Receipt', to: 'GR Posting' },
    },
    {
      document: 'SOP-SEC-001',
      section: '3.3 - Vendor Master SoD',
      text: 'Vendor master data maintainer must not create purchase orders',
      system: 'SAP',
      type: 'sod_constraint',
      params: { role1: 'Vendor Master Maintainer', role2: 'PO Creator' },
    },
  ];
}

function netsuiteStandardRules(): RuleDefinition[] {
  return [
    {
      document: 'NS-POL-001',
      section: '2.1 - Expense Approval',
      text: 'Expense reports over $5,000 require Director approval',
      system: 'NetSuite',
      type: 'approval_threshold',
      params: { threshold: 5000, currency: 'USD', approverRole: 'Director' },
    },
    {
      document: 'NS-POL-001',
      section: '2.2 - PO Approval',
      text: 'Purchase orders over $25,000 require VP approval',
      system: 'NetSuite',
      type: 'approval_threshold',
      params: { threshold: 25000, currency: 'USD', approverRole: 'VP' },
    },
    {
      document: 'NS-SEC-001',
      section: '1.1 - User Access Review',
      text: 'All user roles must be reviewed quarterly',
      system: 'NetSuite',
      type: 'timing_sla',
      params: { maxDays: 90, activity: 'User Access Review' },
    },
    {
      document: 'NS-SEC-001',
      section: '1.2 - Role Separation',
      text: 'Administrator role must not have transaction entry permissions',
      system: 'NetSuite',
      type: 'sod_constraint',
      params: { role1: 'Administrator', role2: 'Transaction Entry' },
    },
    {
      document: 'NS-POL-002',
      section: '3.1 - Approval Routing',
      text: 'Multi-subsidiary transactions require subsidiary controller approval',
      system: 'NetSuite',
      type: 'routing_rule',
      params: { condition: 'multi_subsidiary', approverRole: 'Subsidiary Controller' },
    },
    {
      document: 'NS-POL-001',
      section: '4.1 - Transaction Limits',
      text: 'Single transactions exceeding $100,000 require CFO approval',
      system: 'NetSuite',
      type: 'approval_threshold',
      params: { threshold: 100000, currency: 'USD', approverRole: 'CFO' },
    },
    {
      document: 'NS-POL-002',
      section: '3.2 - Revenue Recognition',
      text: 'Revenue must follow the documented recognition sequence',
      system: 'NetSuite',
      type: 'sequence_requirement',
      params: { step1: 'Sales Order', step2: 'Fulfillment', step3: 'Revenue Recognition' },
    },
    {
      document: 'NS-GL-001',
      section: '1.1 - Period Close',
      text: 'Period close must be completed within 5 business days of month end',
      system: 'NetSuite',
      type: 'timing_sla',
      params: { maxDays: 5, activity: 'Period Close' },
    },
    {
      document: 'NS-GL-001',
      section: '2.1 - Journal Entry Approval',
      text: 'Manual journal entries require Manager approval',
      system: 'NetSuite',
      type: 'approval_threshold',
      params: { threshold: 0, currency: 'USD', approverRole: 'Manager' },
    },
    {
      document: 'NS-SEC-001',
      section: '2.1 - Vendor SoD',
      text: 'Vendor record editor must not approve vendor payments',
      system: 'NetSuite',
      type: 'sod_constraint',
      params: { role1: 'Vendor Editor', role2: 'Payment Approver' },
    },
    {
      document: 'NS-POL-002',
      section: '1.1 - Currency Validation',
      text: 'Transaction currency must match subsidiary base currency or be explicitly converted',
      system: 'NetSuite',
      type: 'field_validation',
      params: { field: 'currency', constraint: 'match_subsidiary_or_converted' },
    },
  ];
}

function salesforceStandardRules(): RuleDefinition[] {
  return [
    {
      document: 'SF-SALES-001',
      section: '1.1 - Stage Progression',
      text: 'Opportunities must progress sequentially through stages',
      system: 'Salesforce',
      type: 'sequence_requirement',
      params: { step1: 'Prospecting', step2: 'Qualification', step3: 'Proposal' },
    },
    {
      document: 'SF-SALES-001',
      section: '1.2 - Close Date Policy',
      text: 'Close date must not be backdated more than 7 days',
      system: 'Salesforce',
      type: 'field_validation',
      params: { field: 'close_date', maxBackdateDays: 7 },
    },
    {
      document: 'SF-SALES-001',
      section: '2.1 - Forecast Category',
      text: 'Opportunities in Commit must have close date within current quarter',
      system: 'Salesforce',
      type: 'field_validation',
      params: { field: 'forecast_category', constraint: 'commit_within_quarter' },
    },
    {
      document: 'SF-SALES-001',
      section: '3.1 - Discount Approval',
      text: 'Discounts over 20% require Sales VP approval',
      system: 'Salesforce',
      type: 'approval_threshold',
      params: { threshold: 20, unit: 'percent', approverRole: 'Sales VP' },
    },
    {
      document: 'SF-SALES-001',
      section: '3.2 - Large Deal Approval',
      text: 'Deals over $500,000 require CRO approval',
      system: 'Salesforce',
      type: 'approval_threshold',
      params: { threshold: 500000, currency: 'USD', approverRole: 'CRO' },
    },
    {
      document: 'SF-ADMIN-001',
      section: '1.1 - Profile SoD',
      text: 'System Administrator must not own customer-facing opportunities',
      system: 'Salesforce',
      type: 'sod_constraint',
      params: { role1: 'System Administrator', role2: 'Opportunity Owner' },
    },
    {
      document: 'SF-SALES-001',
      section: '4.1 - Lead Response SLA',
      text: 'New leads must be contacted within 1 business day of assignment',
      system: 'Salesforce',
      type: 'timing_sla',
      params: { maxDays: 1, from: 'Lead Assignment', to: 'First Contact' },
    },
    {
      document: 'SF-SALES-001',
      section: '4.2 - Opportunity Aging',
      text: 'Opportunities must not remain in same stage for more than 30 days',
      system: 'Salesforce',
      type: 'timing_sla',
      params: { maxDays: 30, activity: 'Stage Progression' },
    },
    {
      document: 'SF-SALES-001',
      section: '5.1 - Quote Routing',
      text: 'Quotes with non-standard terms must route to Legal review',
      system: 'Salesforce',
      type: 'routing_rule',
      params: { condition: 'non_standard_terms', approverRole: 'Legal' },
    },
    {
      document: 'SF-ADMIN-001',
      section: '2.1 - Data Quality',
      text: 'Account records must have industry and annual revenue populated',
      system: 'Salesforce',
      type: 'field_validation',
      params: { fields: 'industry,annual_revenue', constraint: 'required' },
    },
    {
      document: 'SF-SALES-001',
      section: '2.2 - Pipeline Hygiene',
      text: 'Opportunities past close date must be updated or closed within 3 days',
      system: 'Salesforce',
      type: 'timing_sla',
      params: { maxDays: 3, activity: 'Pipeline Cleanup' },
    },
  ];
}
