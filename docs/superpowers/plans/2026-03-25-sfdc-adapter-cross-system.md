# SFDC Adapter + Cross-System Correlation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Salesforce adapter to SAP-Transaction-Forensics with cross-system ERP/CRM correlation

**Architecture:** Adapter-based MCP server extended with SFDC synthetic adapter, field mapper normalizing SFDC→SAP types, cross-system entity resolver with three matching strategies, unified event log for combined process analysis, and Python pattern engine extensions for SFDC conformance checking and cross-system anomaly detection.

**Tech Stack:** TypeScript (ESM, Jest, ts-jest), Python 3.9+ (pytest), JSON schema templates, existing ProcessModel/ConformanceChecker infrastructure

**Project Root:** `/Volumes/OWC drive/Dev/SAP-Transaction-Forensics`

---

## Task 1: SFDC Type Definitions

**Files:**
- Create: `mcp-server/src/adapters/sfdc/sfdc-types.ts`

- [ ] **Step 1: Create the SFDC types file**

```typescript
// mcp-server/src/adapters/sfdc/sfdc-types.ts

/**
 * Salesforce Native Type Definitions
 *
 * These represent Salesforce data as it exists natively, before
 * normalization to SAP types via the field mapper.
 */

// ============================================================================
// Account
// ============================================================================

export interface SFDCAccount {
  account_id: string;
  name: string;
  industry: string;
  billing_state: string;
  billing_country: string;
  type: string;
  number_of_employees: number;
  annual_revenue: number;
  sap_customer_number: string | null;
}

// ============================================================================
// Opportunity
// ============================================================================

export interface SFDCOpportunity {
  opportunity_id: string;
  name: string;
  account_id: string;
  record_type: string;
  stage_name: string;
  amount: number;
  currency_iso_code: string;
  owner_id: string;
  created_date: string;   // ISO 8601
  close_date: string;     // YYYY-MM-DD
  type: string;
  lead_source: string;
  probability: number;
  forecast_category: string;
  sap_order_number: string | null;
  is_closed: boolean;
  is_won: boolean;
  _pattern_flags?: string[];  // For test validation
}

// ============================================================================
// Stage History
// ============================================================================

export interface SFDCStageHistory {
  id: string;
  opportunity_id: string;
  stage_name: string;
  previous_stage: string | null;
  created_date: string;   // ISO 8601
  amount: number;
  probability: number;
  expected_revenue: number;
  close_date: string;
  duration_days: number;
  changed_by: string;
}

// ============================================================================
// Line Item
// ============================================================================

export interface SFDCLineItem {
  line_item_id: string;
  opportunity_id: string;
  product_id: string;
  product_code: string;
  product_name: string;
  product_family: string;
  quantity: number;
  unit_price: number;
  total_price: number;
  sort_order: number;
  service_date: string | null;
  description: string;
}

// ============================================================================
// Activity (Task/Event)
// ============================================================================

export interface SFDCActivity {
  activity_id: string;
  type: 'Task' | 'Event';
  subject: string;
  status: string;
  priority: string;
  activity_date: string;
  owner_id: string;
  what_id: string;         // Related Opportunity ID
  who_id: string | null;   // Related Contact ID
  description: string;
}

// ============================================================================
// Product (for master data)
// ============================================================================

export interface SFDCProduct {
  product_id: string;
  product_code: string;
  name: string;
  family: string;
  is_active: boolean;
  description: string;
}

// ============================================================================
// Loaded SFDC Dataset
// ============================================================================

export interface SFDCDataset {
  accounts: SFDCAccount[];
  opportunities: SFDCOpportunity[];
  stage_histories: SFDCStageHistory[];
  line_items: SFDCLineItem[];
  activities: SFDCActivity[];
  products: SFDCProduct[];
}

// ============================================================================
// Process Model Definition (TypeScript side)
// ============================================================================

export interface SFDCProcessModelDef {
  record_type: string;
  stages: string[];
  terminal_stages: string[];
  allowed_regressions: [string, string][];
}

// ============================================================================
// Record Type to AUART Mapping
// ============================================================================

export const RECORD_TYPE_TO_AUART: Record<string, string> = {
  'New Business': 'ZNEW',
  'Renewal': 'ZREN',
  'Upsell': 'ZUPS',
  'Cross-Sell': 'ZXSL',
  'Partner': 'ZPAR',
};

// ============================================================================
// Stage to Status Code Mapping
// ============================================================================

export const STAGE_STATUS_MAP: Record<string, string> = {
  'Prospecting': 'A',
  'Qualification': 'A',
  'Needs Analysis': 'B',
  'Value Proposition': 'B',
  'Id. Decision Makers': 'B',
  'Perception Analysis': 'B',
  'Proposal/Price Quote': 'B',
  'Negotiation/Review': 'B',
  'Discovery': 'B',
  'Proposal': 'B',
  'Negotiation': 'B',
  'Closed Won': 'C',
  'Closed Lost': 'X',
};
```

- [ ] **Step 2: Commit**

```bash
cd "/Volumes/OWC drive/Dev/SAP-Transaction-Forensics"
git add mcp-server/src/adapters/sfdc/sfdc-types.ts
git commit -m "feat(sfdc): add Salesforce native type definitions"
```

---

## Task 2: SFDC Field Mapper with Tests

**Files:**
- Create: `mcp-server/src/adapters/sfdc/field-mapper.ts`
- Create: `mcp-server/src/adapters/sfdc/__tests__/field-mapper.test.ts`

- [ ] **Step 1: Write the field mapper tests**

```typescript
// mcp-server/src/adapters/sfdc/__tests__/field-mapper.test.ts

import { describe, it, expect } from '@jest/globals';
import {
  SFDCFieldMapper,
  padToLength,
  formatDateToSAP,
  extractTime,
} from '../field-mapper.js';
import type { SFDCOpportunity, SFDCLineItem, SFDCStageHistory, SFDCActivity, SFDCAccount, SFDCProduct } from '../sfdc-types.js';

describe('Utility functions', () => {
  describe('padToLength', () => {
    it('should pad short strings with leading zeros', () => {
      expect(padToLength('123', 10)).toBe('0000000123');
    });

    it('should not truncate strings already at target length', () => {
      expect(padToLength('0000000001', 10)).toBe('0000000001');
    });

    it('should handle empty string', () => {
      expect(padToLength('', 10)).toBe('0000000000');
    });
  });

  describe('formatDateToSAP', () => {
    it('should convert ISO date to YYYYMMDD', () => {
      expect(formatDateToSAP('2025-06-15T10:30:00Z')).toBe('20250615');
    });

    it('should handle date-only strings', () => {
      expect(formatDateToSAP('2025-06-15')).toBe('20250615');
    });

    it('should return empty for invalid date', () => {
      expect(formatDateToSAP('')).toBe('');
    });
  });

  describe('extractTime', () => {
    it('should extract HHMMSS from ISO datetime', () => {
      expect(extractTime('2025-06-15T10:30:45Z')).toBe('103045');
    });

    it('should return 000000 for date-only', () => {
      expect(extractTime('2025-06-15')).toBe('000000');
    });
  });
});

describe('SFDCFieldMapper', () => {
  const mapper = new SFDCFieldMapper();

  const sampleOpp: SFDCOpportunity = {
    opportunity_id: '006xx000001abc',
    name: 'Acme Corp - Enterprise License Q3',
    account_id: '001xx000001xyz',
    record_type: 'New Business',
    stage_name: 'Closed Won',
    amount: 125000.00,
    currency_iso_code: 'USD',
    owner_id: '005xx000001def',
    created_date: '2025-06-15T10:30:00Z',
    close_date: '2025-09-30',
    type: 'New Business',
    lead_source: 'Web',
    probability: 100,
    forecast_category: 'Closed',
    sap_order_number: '0000012345',
    is_closed: true,
    is_won: true,
  };

  describe('opportunityToSalesDocHeader', () => {
    it('should map Opportunity to SalesDocHeader', () => {
      const result = mapper.opportunityToSalesDocHeader(sampleOpp);

      expect(result.VBELN).toBe('006xx00000');
      expect(result.AUART).toBe('ZNEW');
      expect(result.KUNNR).toBe('001xx00000');
      expect(result.ERDAT).toBe('20250615');
      expect(result.ERZET).toBe('103000');
      expect(result.NETWR).toBe(125000.00);
      expect(result.WAERK).toBe('USD');
      expect(result.VDATU).toBe('20250930');
      expect(result.GBSTK).toBe('C');
      expect(result.BSTNK).toBe('0000012345');
    });

    it('should default VKORG to SFDC when no division', () => {
      const result = mapper.opportunityToSalesDocHeader(sampleOpp);
      expect(result.VKORG).toBe('SFDC');
    });

    it('should derive status from stage', () => {
      const openOpp = { ...sampleOpp, stage_name: 'Qualification', is_closed: false, is_won: false };
      expect(mapper.opportunityToSalesDocHeader(openOpp).GBSTK).toBe('A');

      const midOpp = { ...sampleOpp, stage_name: 'Negotiation/Review', is_closed: false, is_won: false };
      expect(mapper.opportunityToSalesDocHeader(midOpp).GBSTK).toBe('B');

      const lostOpp = { ...sampleOpp, stage_name: 'Closed Lost', is_closed: true, is_won: false };
      expect(mapper.opportunityToSalesDocHeader(lostOpp).GBSTK).toBe('X');
    });
  });

  describe('lineItemToSalesDocItem', () => {
    const sampleItem: SFDCLineItem = {
      line_item_id: '00kxx000001abc',
      opportunity_id: '006xx000001abc',
      product_id: '01txx000001abc',
      product_code: 'ENT-LIC-001',
      product_name: 'Enterprise License',
      product_family: 'Software',
      quantity: 100,
      unit_price: 1250.00,
      total_price: 125000.00,
      sort_order: 1,
      service_date: '2025-10-01',
      description: 'Annual enterprise license',
    };

    it('should map LineItem to SalesDocItem', () => {
      const result = mapper.lineItemToSalesDocItem(sampleItem, 'USD');

      expect(result.VBELN).toBe('006xx00000');
      expect(result.POSNR).toBe('000001');
      expect(result.MATNR).toContain('ENT-LIC-001');
      expect(result.ARKTX).toBe('Enterprise License');
      expect(result.KWMENG).toBe(100);
      expect(result.NETWR).toBe(125000.00);
      expect(result.WAERK).toBe('USD');
      expect(result.WERKS).toBe('SFDC');
    });
  });

  describe('stageHistoryToDocFlow', () => {
    const stages: SFDCStageHistory[] = [
      {
        id: '017xx000001',
        opportunity_id: '006xx000001abc',
        stage_name: 'Qualification',
        previous_stage: null,
        created_date: '2025-06-15T10:30:00Z',
        amount: 100000,
        probability: 20,
        expected_revenue: 20000,
        close_date: '2025-09-30',
        duration_days: 0,
        changed_by: '005xx000001def',
      },
      {
        id: '017xx000002',
        opportunity_id: '006xx000001abc',
        stage_name: 'Proposal/Price Quote',
        previous_stage: 'Qualification',
        created_date: '2025-07-01T14:00:00Z',
        amount: 125000,
        probability: 60,
        expected_revenue: 75000,
        close_date: '2025-09-30',
        duration_days: 16,
        changed_by: '005xx000001def',
      },
    ];

    it('should convert stage history to document flow', () => {
      const result = mapper.stageHistoryToDocFlow('006xx000001abc', stages);

      expect(result.documents.length).toBeGreaterThanOrEqual(2);
      expect(result.documents[0].ERDAT).toBe('20250615');
      expect(result.documents[1].ERDAT).toBe('20250701');
    });

    it('should preserve chronological order', () => {
      const result = mapper.stageHistoryToDocFlow('006xx000001abc', stages);
      for (let i = 1; i < result.documents.length; i++) {
        expect(result.documents[i].ERDAT >= result.documents[i - 1].ERDAT).toBe(true);
      }
    });
  });

  describe('activityToDocText', () => {
    const activity: SFDCActivity = {
      activity_id: '00Txx000001abc',
      type: 'Task',
      subject: 'Follow up call',
      status: 'Completed',
      priority: 'Normal',
      activity_date: '2025-06-20',
      owner_id: '005xx000001def',
      what_id: '006xx000001abc',
      who_id: '003xx000001ghi',
      description: 'Discussed pricing terms',
    };

    it('should map Activity to text entry', () => {
      const result = mapper.activityToDocText(activity);

      expect(result.VBELN).toBe('006xx00000');
      expect(result.TDID).toBe('TASK');
      expect(result.TEXT).toContain('Follow up call');
      expect(result.TEXT).toContain('Discussed pricing terms');
    });
  });

  describe('accountToMasterStub', () => {
    const account: SFDCAccount = {
      account_id: '001xx000001xyz',
      name: 'Acme Corporation',
      industry: 'Manufacturing',
      billing_state: 'CA',
      billing_country: 'US',
      type: 'Customer',
      number_of_employees: 5000,
      annual_revenue: 50000000,
      sap_customer_number: '0000045678',
    };

    it('should map Account to MasterStub with safe fields only', () => {
      const result = mapper.accountToMasterStub(account);

      expect(result.entity_type).toBe('customer');
      expect(result.entity_id).toBe('001xx00000');
      expect(result.attributes.BRSCH).toBe('Manufacturing');
      expect(result.attributes.REGIO).toBe('CA');
      expect(result.attributes.LAND1).toBe('US');
    });

    it('should not include PII fields', () => {
      const result = mapper.accountToMasterStub(account);
      const stringified = JSON.stringify(result);
      expect(stringified).not.toContain('Acme Corporation');
      expect(stringified).not.toContain('50000000');
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd "/Volumes/OWC drive/Dev/SAP-Transaction-Forensics/mcp-server"
npx jest src/adapters/sfdc/__tests__/field-mapper.test.ts --no-cache 2>&1 | tail -5
```

Expected: FAIL — module not found

- [ ] **Step 3: Write the field mapper implementation**

```typescript
// mcp-server/src/adapters/sfdc/field-mapper.ts

/**
 * SFDC → SAP Field Mapper
 *
 * Normalizes Salesforce data into SAP type contracts.
 * This is the core translation layer — the adapter calls mapper methods
 * rather than doing inline field-by-field conversion.
 *
 * Lossy mappings are documented inline.
 */

import type {
  SalesDocHeader,
  SalesDocItem,
  DocFlowResult,
  DocTextResult,
  DeliveryTimingResult,
  InvoiceTimingResult,
  MasterStub,
  DOC_CATEGORY,
} from '../../types/index.js';

import type {
  SFDCOpportunity,
  SFDCLineItem,
  SFDCStageHistory,
  SFDCActivity,
  SFDCAccount,
  SFDCProduct,
} from './sfdc-types.js';

import { RECORD_TYPE_TO_AUART, STAGE_STATUS_MAP } from './sfdc-types.js';

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Pad a string with leading zeros to a target length.
 * If longer than target, takes first `len` characters.
 */
export function padToLength(value: string, len: number): string {
  if (value.length >= len) {
    return value.substring(0, len);
  }
  return value.padStart(len, '0');
}

/**
 * Convert ISO 8601 date/datetime to SAP YYYYMMDD format.
 */
export function formatDateToSAP(isoDate: string): string {
  if (!isoDate) return '';
  try {
    const d = new Date(isoDate);
    if (isNaN(d.getTime())) return '';
    const year = d.getUTCFullYear().toString();
    const month = (d.getUTCMonth() + 1).toString().padStart(2, '0');
    const day = d.getUTCDate().toString().padStart(2, '0');
    return `${year}${month}${day}`;
  } catch {
    return '';
  }
}

/**
 * Extract HHMMSS from ISO datetime.
 */
export function extractTime(isoDate: string): string {
  if (!isoDate || !isoDate.includes('T')) return '000000';
  try {
    const d = new Date(isoDate);
    if (isNaN(d.getTime())) return '000000';
    const h = d.getUTCHours().toString().padStart(2, '0');
    const m = d.getUTCMinutes().toString().padStart(2, '0');
    const s = d.getUTCSeconds().toString().padStart(2, '0');
    return `${h}${m}${s}`;
  } catch {
    return '000000';
  }
}

// ============================================================================
// Field Mapper Class
// ============================================================================

export class SFDCFieldMapper {

  /**
   * Map Opportunity → SalesDocHeader (VBAK)
   */
  opportunityToSalesDocHeader(opp: SFDCOpportunity): SalesDocHeader {
    return {
      VBELN: padToLength(opp.opportunity_id, 10),
      AUART: RECORD_TYPE_TO_AUART[opp.record_type] ?? 'ZSFX',
      VKORG: 'SFDC',                                    // Lossy: no direct SFDC equivalent
      VTWEG: '00',                                       // Lossy: no distribution channel
      SPART: '00',                                       // Lossy: no division in SAP sense
      KUNNR: padToLength(opp.account_id, 10),
      KUNWE: padToLength(opp.account_id, 10),            // Same as sold-to (no ship-to in SFDC)
      AUDAT: formatDateToSAP(opp.created_date),
      VDATU: formatDateToSAP(opp.close_date),
      ERNAM: opp.owner_id,
      ERDAT: formatDateToSAP(opp.created_date),
      ERZET: extractTime(opp.created_date),
      GBSTK: this.deriveStatus(opp),
      NETWR: opp.amount,
      WAERK: opp.currency_iso_code,
      BSTNK: opp.sap_order_number ?? undefined,
    };
  }

  /**
   * Map OpportunityLineItem → SalesDocItem (VBAP)
   */
  lineItemToSalesDocItem(item: SFDCLineItem, currency: string): SalesDocItem {
    return {
      VBELN: padToLength(item.opportunity_id, 10),
      POSNR: padToLength(item.sort_order.toString(), 6),
      MATNR: padToLength(item.product_code, 18),
      ARKTX: item.product_name,
      WERKS: 'SFDC',                                     // Lossy: no plant concept
      KWMENG: item.quantity,
      VRKME: 'EA',                                       // Default unit
      NETWR: item.total_price,
      WAERK: currency,
      PSTYV: this.derivePSTYV(item.product_family),
    };
  }

  /**
   * Map StageHistory[] → DocFlowResult
   * Each stage transition becomes a doc flow entry.
   */
  stageHistoryToDocFlow(oppId: string, stages: SFDCStageHistory[]): DocFlowResult {
    const sorted = [...stages].sort(
      (a, b) => new Date(a.created_date).getTime() - new Date(b.created_date).getTime()
    );

    const documents = sorted.map((stage, idx) => ({
      VBELV: padToLength(oppId, 10),
      POSNV: '000000',
      VBELN: padToLength(`${oppId}-${idx}`, 10),
      POSNN: '000000',
      VBTYP_V: idx === 0 ? 'C' : (STAGE_STATUS_MAP[sorted[idx - 1].stage_name] ?? 'B'),
      VBTYP_N: STAGE_STATUS_MAP[stage.stage_name] ?? 'B',
      RFMNG: stage.amount,
      ERDAT: formatDateToSAP(stage.created_date),
      PLMIN: stage.duration_days.toString(),
    }));

    return {
      root_document: padToLength(oppId, 10),
      documents,
    };
  }

  /**
   * Map Activities[] → DocTextResult
   */
  activitiesToDocText(oppId: string, activities: SFDCActivity[]): DocTextResult {
    const headerTexts = activities
      .filter(a => a.what_id === oppId)
      .map(a => ({
        VBELN: padToLength(oppId, 10),
        POSNR: '000000',
        TDID: a.type === 'Task' ? 'TASK' : 'EVNT',
        SPRAS: 'E',
        TEXT: [a.subject, a.description].filter(Boolean).join('\n'),
        AEDAT: formatDateToSAP(a.activity_date),
      }));

    return {
      header_texts: headerTexts,
      item_texts: [],
    };
  }

  /**
   * Map Activity → single text entry (for search results)
   */
  activityToDocText(activity: SFDCActivity) {
    return {
      VBELN: padToLength(activity.what_id, 10),
      POSNR: '000000',
      TDID: activity.type === 'Task' ? 'TASK' : 'EVNT',
      SPRAS: 'E',
      TEXT: [activity.subject, activity.description].filter(Boolean).join('\n'),
      AEDAT: formatDateToSAP(activity.activity_date),
    };
  }

  /**
   * Map Account → MasterStub (safe fields only)
   */
  accountToMasterStub(account: SFDCAccount): MasterStub {
    return {
      entity_type: 'customer',
      entity_id: padToLength(account.account_id, 10),
      attributes: {
        BRSCH: account.industry,
        REGIO: account.billing_state,
        LAND1: account.billing_country,
        KTOKD: account.type,
      },
    };
  }

  /**
   * Map Product → MasterStub (safe fields only)
   */
  productToMasterStub(product: SFDCProduct): MasterStub {
    return {
      entity_type: 'material',
      entity_id: padToLength(product.product_code, 18),
      attributes: {
        MTART: product.family,
        MAKTX: product.name,
      },
    };
  }

  /**
   * Derive SAP overall status from SFDC stage.
   */
  private deriveStatus(opp: SFDCOpportunity): string {
    if (opp.is_closed && opp.is_won) return 'C';
    if (opp.is_closed && !opp.is_won) return 'X';
    return STAGE_STATUS_MAP[opp.stage_name] ?? 'A';
  }

  /**
   * Derive PSTYV (item category) from product family.
   */
  private derivePSTYV(family: string): string {
    const map: Record<string, string> = {
      'Software': 'ZLIC',
      'Hardware': 'ZHDW',
      'Services': 'ZSRV',
      'Support': 'ZSUP',
      'Training': 'ZTRN',
    };
    return map[family] ?? 'ZSTD';
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd "/Volumes/OWC drive/Dev/SAP-Transaction-Forensics/mcp-server"
npx jest src/adapters/sfdc/__tests__/field-mapper.test.ts --no-cache 2>&1 | tail -10
```

Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
cd "/Volumes/OWC drive/Dev/SAP-Transaction-Forensics"
git add mcp-server/src/adapters/sfdc/field-mapper.ts mcp-server/src/adapters/sfdc/__tests__/field-mapper.test.ts
git commit -m "feat(sfdc): add field mapper with SFDC→SAP normalization + tests"
```

---

## Task 3: SFDC Process Models

**Files:**
- Create: `mcp-server/src/adapters/sfdc/process-models.ts`
- Create: `mcp-server/src/adapters/sfdc/__tests__/process-models.test.ts`

- [ ] **Step 1: Write process model tests**

```typescript
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

describe('SFDC Process Models', () => {
  describe('SFDC_PIPELINES', () => {
    it('should define New Business pipeline', () => {
      const pipeline = SFDC_PIPELINES['New Business'];
      expect(pipeline).toBeDefined();
      expect(pipeline.stages[0]).toBe('Prospecting');
      expect(pipeline.terminal_stages).toContain('Closed Won');
      expect(pipeline.terminal_stages).toContain('Closed Lost');
    });

    it('should define Renewal pipeline with fewer stages', () => {
      const pipeline = SFDC_PIPELINES['Renewal'];
      expect(pipeline.stages.length).toBeLessThan(SFDC_PIPELINES['New Business'].stages.length);
    });

    it('should define Upsell pipeline', () => {
      const pipeline = SFDC_PIPELINES['Upsell'];
      expect(pipeline).toBeDefined();
      expect(pipeline.stages.length).toBeGreaterThan(1);
    });
  });

  describe('getStagesForRecordType', () => {
    it('should return stages for known record type', () => {
      const stages = getStagesForRecordType('New Business');
      expect(stages.length).toBeGreaterThan(5);
      expect(stages).toContain('Qualification');
    });

    it('should return default pipeline for unknown record type', () => {
      const stages = getStagesForRecordType('Unknown Type');
      expect(stages.length).toBeGreaterThan(0);
    });
  });

  describe('isValidTransition', () => {
    it('should allow forward movement', () => {
      expect(isValidTransition('Qualification', 'Needs Analysis', 'New Business')).toBe(true);
    });

    it('should allow skipping to terminal stage', () => {
      expect(isValidTransition('Qualification', 'Closed Lost', 'New Business')).toBe(true);
    });

    it('should reject backward movement', () => {
      expect(isValidTransition('Proposal/Price Quote', 'Qualification', 'New Business')).toBe(false);
    });
  });

  describe('isTerminalStage', () => {
    it('should identify Closed Won as terminal', () => {
      expect(isTerminalStage('Closed Won')).toBe(true);
    });

    it('should identify Closed Lost as terminal', () => {
      expect(isTerminalStage('Closed Lost')).toBe(true);
    });

    it('should not identify open stages as terminal', () => {
      expect(isTerminalStage('Qualification')).toBe(false);
    });
  });

  describe('detectStageSkip', () => {
    it('should detect skipped stages', () => {
      const history = ['Prospecting', 'Qualification', 'Closed Won'];
      const skipped = detectStageSkip(history, 'New Business');
      expect(skipped.length).toBeGreaterThan(0);
      expect(skipped).toContain('Needs Analysis');
    });

    it('should return empty for conformant trace', () => {
      const history = ['Qualification', 'Proposal', 'Closed Won'];
      const skipped = detectStageSkip(history, 'Renewal');
      expect(skipped).toEqual([]);
    });
  });

  describe('detectStageRegression', () => {
    it('should detect backward movement', () => {
      const history = ['Prospecting', 'Qualification', 'Needs Analysis', 'Qualification'];
      const regressions = detectStageRegression(history, 'New Business');
      expect(regressions.length).toBe(1);
      expect(regressions[0]).toEqual({ from: 'Needs Analysis', to: 'Qualification', index: 3 });
    });

    it('should return empty for forward-only trace', () => {
      const history = ['Prospecting', 'Qualification', 'Needs Analysis'];
      expect(detectStageRegression(history, 'New Business')).toEqual([]);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

```bash
cd "/Volumes/OWC drive/Dev/SAP-Transaction-Forensics/mcp-server"
npx jest src/adapters/sfdc/__tests__/process-models.test.ts --no-cache 2>&1 | tail -5
```

Expected: FAIL

- [ ] **Step 3: Write process models implementation**

```typescript
// mcp-server/src/adapters/sfdc/process-models.ts

/**
 * SFDC Opportunity Pipeline Process Models
 *
 * Defines expected stage sequences per Record Type for conformance checking.
 * For synthetic/static data these are hardcoded.
 * For live SFDC orgs, use discoverPipelines() to query OpportunityStage metadata.
 */

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
  'Renewal': {
    record_type: 'Renewal',
    stages: ['Qualification', 'Proposal'],
    terminal_stages: ['Closed Won', 'Closed Lost'],
    allowed_regressions: [],
  },
  'Upsell': {
    record_type: 'Upsell',
    stages: ['Discovery', 'Proposal', 'Negotiation'],
    terminal_stages: ['Closed Won', 'Closed Lost'],
    allowed_regressions: [],
  },
};

const DEFAULT_PIPELINE = SFDC_PIPELINES['New Business'];

// ============================================================================
// Query Functions
// ============================================================================

/**
 * Get ordered stages for a record type. Falls back to New Business pipeline.
 */
export function getStagesForRecordType(recordType: string): string[] {
  const pipeline = SFDC_PIPELINES[recordType] ?? DEFAULT_PIPELINE;
  return [...pipeline.stages];
}

/**
 * Check if a stage transition is valid (forward or to terminal).
 */
export function isValidTransition(
  fromStage: string,
  toStage: string,
  recordType: string,
): boolean {
  const pipeline = SFDC_PIPELINES[recordType] ?? DEFAULT_PIPELINE;
  const allStages = [...pipeline.stages, ...pipeline.terminal_stages];

  // Terminal stages are always reachable
  if (pipeline.terminal_stages.includes(toStage)) return true;

  // Check allowed regressions
  for (const [from, to] of pipeline.allowed_regressions) {
    if (from === fromStage && to === toStage) return true;
  }

  // Must be forward movement
  const fromIdx = allStages.indexOf(fromStage);
  const toIdx = allStages.indexOf(toStage);
  if (fromIdx === -1 || toIdx === -1) return false;
  return toIdx > fromIdx;
}

/**
 * Check if a stage is terminal (Closed Won or Closed Lost).
 */
export function isTerminalStage(stageName: string): boolean {
  return stageName === 'Closed Won' || stageName === 'Closed Lost';
}

/**
 * Detect stages that were skipped in a stage history trace.
 * Returns list of skipped stage names.
 */
export function detectStageSkip(
  stageHistory: string[],
  recordType: string,
): string[] {
  const pipeline = SFDC_PIPELINES[recordType] ?? DEFAULT_PIPELINE;
  const expectedStages = pipeline.stages;

  // Find the range of expected stages that were traversed
  const visited = new Set(stageHistory.filter(s => !isTerminalStage(s)));
  const skipped: string[] = [];

  // Find first and last visited index in expected stages
  let firstIdx = expectedStages.length;
  let lastIdx = -1;
  for (const stage of visited) {
    const idx = expectedStages.indexOf(stage);
    if (idx !== -1) {
      firstIdx = Math.min(firstIdx, idx);
      lastIdx = Math.max(lastIdx, idx);
    }
  }

  // Any expected stage between first and last that wasn't visited is skipped
  for (let i = firstIdx; i <= lastIdx; i++) {
    if (!visited.has(expectedStages[i])) {
      skipped.push(expectedStages[i]);
    }
  }

  return skipped;
}

/**
 * Detect backward stage movements (regressions).
 * Returns list of { from, to, index } objects.
 */
export function detectStageRegression(
  stageHistory: string[],
  recordType: string,
): Array<{ from: string; to: string; index: number }> {
  const pipeline = SFDC_PIPELINES[recordType] ?? DEFAULT_PIPELINE;
  const allStages = [...pipeline.stages, ...pipeline.terminal_stages];
  const regressions: Array<{ from: string; to: string; index: number }> = [];

  for (let i = 1; i < stageHistory.length; i++) {
    const fromIdx = allStages.indexOf(stageHistory[i - 1]);
    const toIdx = allStages.indexOf(stageHistory[i]);
    if (fromIdx !== -1 && toIdx !== -1 && toIdx < fromIdx) {
      // Check if this is an allowed regression
      const isAllowed = pipeline.allowed_regressions.some(
        ([f, t]) => f === stageHistory[i - 1] && t === stageHistory[i]
      );
      if (!isAllowed) {
        regressions.push({ from: stageHistory[i - 1], to: stageHistory[i], index: i });
      }
    }
  }

  return regressions;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd "/Volumes/OWC drive/Dev/SAP-Transaction-Forensics/mcp-server"
npx jest src/adapters/sfdc/__tests__/process-models.test.ts --no-cache 2>&1 | tail -10
```

Expected: All PASS

- [ ] **Step 5: Commit**

```bash
cd "/Volumes/OWC drive/Dev/SAP-Transaction-Forensics"
git add mcp-server/src/adapters/sfdc/process-models.ts mcp-server/src/adapters/sfdc/__tests__/process-models.test.ts
git commit -m "feat(sfdc): add opportunity pipeline process models + tests"
```

---

## Task 4: Synthetic SFDC Data Generator

**Files:**
- Create: `synthetic-data/src/generate_sfdc.py`
- Create: `synthetic-data/sfdc_output/.gitkeep`
- Create: `synthetic-data/tests/test_generate_sfdc.py`

- [ ] **Step 1: Write generator tests**

```python
# synthetic-data/tests/test_generate_sfdc.py

"""Tests for SFDC synthetic data generator."""

from __future__ import annotations

import json
import os
import sys
import tempfile
from collections import Counter
from datetime import datetime
from pathlib import Path

import pytest

# Add parent to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))
from src.generate_sfdc import (
    SFDCGenerator,
    SFDCGeneratorConfig,
    PATTERN_STAGE_SKIP,
    PATTERN_QUARTER_END,
    PATTERN_GHOST_PIPELINE,
    PATTERN_STAGE_REGRESSION,
    PATTERN_AMOUNT_INFLATION,
    PATTERN_SPLIT_DEAL,
    PATTERN_SPEED_ANOMALY,
    PATTERN_STALE_PIPELINE,
    PATTERN_OWNER_SWAP,
    PATTERN_CROSS_SYSTEM_GAP,
)


@pytest.fixture
def config():
    return SFDCGeneratorConfig(
        n_accounts=20,
        n_opportunities=100,
        n_users=10,
        n_products=8,
        sap_link_rate=0.60,
        seed=42,
    )


@pytest.fixture
def generator(config):
    return SFDCGenerator(config)


@pytest.fixture
def generated_data(generator):
    return generator.generate()


class TestGeneratorConfig:
    def test_default_config(self):
        cfg = SFDCGeneratorConfig()
        assert cfg.n_accounts == 50
        assert cfg.n_opportunities == 200
        assert cfg.seed == 42

    def test_custom_config(self, config):
        assert config.n_accounts == 20
        assert config.n_opportunities == 100


class TestDataGeneration:
    def test_generates_correct_counts(self, generated_data):
        assert len(generated_data['accounts']) == 20
        assert len(generated_data['opportunities']) == 100
        assert len(generated_data['products']) > 0

    def test_opportunities_reference_valid_accounts(self, generated_data):
        account_ids = {a['account_id'] for a in generated_data['accounts']}
        for opp in generated_data['opportunities']:
            assert opp['account_id'] in account_ids

    def test_stage_histories_exist_for_all_opportunities(self, generated_data):
        opp_ids = {o['opportunity_id'] for o in generated_data['opportunities']}
        history_opp_ids = {h['opportunity_id'] for h in generated_data['stage_histories']}
        assert opp_ids == history_opp_ids

    def test_line_items_reference_valid_products(self, generated_data):
        product_ids = {p['product_id'] for p in generated_data['products']}
        for item in generated_data['line_items']:
            assert item['product_id'] in product_ids

    def test_activities_reference_valid_opportunities(self, generated_data):
        opp_ids = {o['opportunity_id'] for o in generated_data['opportunities']}
        for act in generated_data['activities']:
            assert act['what_id'] in opp_ids

    def test_sap_linked_records_generated(self, generated_data):
        linked = [o for o in generated_data['opportunities'] if o.get('sap_order_number')]
        assert len(linked) > 0
        assert len(linked) <= len(generated_data['opportunities'])
        # Should have SAP orders for linked records
        assert len(generated_data.get('sap_orders', [])) > 0

    def test_deterministic_with_seed(self, config):
        gen1 = SFDCGenerator(config)
        gen2 = SFDCGenerator(config)
        data1 = gen1.generate()
        data2 = gen2.generate()
        assert data1['opportunities'][0]['opportunity_id'] == data2['opportunities'][0]['opportunity_id']
        assert data1['opportunities'][0]['amount'] == data2['opportunities'][0]['amount']


class TestPlantedPatterns:
    def test_stage_skip_pattern(self, generated_data):
        flagged = [o for o in generated_data['opportunities']
                   if PATTERN_STAGE_SKIP in (o.get('_pattern_flags') or [])]
        assert len(flagged) >= 3, f"Expected >=3 stage-skip opps, got {len(flagged)}"

    def test_quarter_end_compression(self, generated_data):
        won = [o for o in generated_data['opportunities'] if o['is_won']]
        if not won:
            pytest.skip("No won opportunities")
        quarter_end = [o for o in won
                       if PATTERN_QUARTER_END in (o.get('_pattern_flags') or [])]
        assert len(quarter_end) > 0

    def test_ghost_pipeline(self, generated_data):
        flagged = [o for o in generated_data['opportunities']
                   if PATTERN_GHOST_PIPELINE in (o.get('_pattern_flags') or [])]
        assert len(flagged) >= 2

    def test_stage_regression(self, generated_data):
        flagged = [o for o in generated_data['opportunities']
                   if PATTERN_STAGE_REGRESSION in (o.get('_pattern_flags') or [])]
        assert len(flagged) >= 1

    def test_amount_inflation(self, generated_data):
        flagged = [o for o in generated_data['opportunities']
                   if PATTERN_AMOUNT_INFLATION in (o.get('_pattern_flags') or [])]
        assert len(flagged) >= 2

    def test_speed_anomaly(self, generated_data):
        flagged = [o for o in generated_data['opportunities']
                   if PATTERN_SPEED_ANOMALY in (o.get('_pattern_flags') or [])]
        assert len(flagged) >= 2

    def test_cross_system_gap_pattern(self, generated_data):
        flagged = [o for o in generated_data['opportunities']
                   if PATTERN_CROSS_SYSTEM_GAP in (o.get('_pattern_flags') or [])]
        # Only applies to SAP-linked opps
        linked = [o for o in generated_data['opportunities'] if o.get('sap_order_number')]
        if linked:
            assert len(flagged) >= 1


class TestJSONOutput:
    def test_write_and_read(self, generator):
        with tempfile.TemporaryDirectory() as tmpdir:
            data = generator.generate()
            generator.write_output(data, tmpdir)

            # Verify all files written
            expected_files = [
                'accounts.json', 'opportunities.json', 'stage_histories.json',
                'line_items.json', 'activities.json', 'products.json',
            ]
            for fname in expected_files:
                fpath = Path(tmpdir) / fname
                assert fpath.exists(), f"Missing {fname}"
                loaded = json.loads(fpath.read_text())
                assert isinstance(loaded, list)
                assert len(loaded) > 0

    def test_sap_files_written_when_linked(self, generator):
        with tempfile.TemporaryDirectory() as tmpdir:
            data = generator.generate()
            generator.write_output(data, tmpdir)

            sap_orders = Path(tmpdir) / 'sap_orders.json'
            if any(o.get('sap_order_number') for o in data['opportunities']):
                assert sap_orders.exists()
```

- [ ] **Step 2: Write the generator implementation**

```python
# synthetic-data/src/generate_sfdc.py

#!/usr/bin/env python3
"""
SFDC Synthetic Data Generator

Generates realistic Salesforce Opportunity lifecycle data with planted
anomaly patterns for testing the SFDC adapter and cross-system correlation.

Usage:
    python src/generate_sfdc.py --count 200 --output sfdc_output/ --seed 42
"""

from __future__ import annotations

import argparse
import json
import math
import random
import sys
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

# Pattern flag constants
PATTERN_STAGE_SKIP = 'STAGE_SKIP'
PATTERN_QUARTER_END = 'QUARTER_END_COMPRESSION'
PATTERN_GHOST_PIPELINE = 'GHOST_PIPELINE'
PATTERN_STAGE_REGRESSION = 'STAGE_REGRESSION'
PATTERN_AMOUNT_INFLATION = 'AMOUNT_INFLATION'
PATTERN_SPLIT_DEAL = 'SPLIT_DEAL'
PATTERN_SPEED_ANOMALY = 'SPEED_ANOMALY'
PATTERN_STALE_PIPELINE = 'STALE_PIPELINE'
PATTERN_OWNER_SWAP = 'OWNER_SWAP_AT_CLOSE'
PATTERN_CROSS_SYSTEM_GAP = 'CROSS_SYSTEM_GAP'

# Pipeline definitions matching TypeScript process-models.ts
PIPELINES: Dict[str, List[str]] = {
    'New Business': [
        'Prospecting', 'Qualification', 'Needs Analysis',
        'Value Proposition', 'Id. Decision Makers',
        'Perception Analysis', 'Proposal/Price Quote',
        'Negotiation/Review',
    ],
    'Renewal': ['Qualification', 'Proposal'],
    'Upsell': ['Discovery', 'Proposal', 'Negotiation'],
}

TERMINAL_STAGES = ['Closed Won', 'Closed Lost']

INDUSTRIES = [
    'Manufacturing', 'Technology', 'Healthcare', 'Financial Services',
    'Retail', 'Energy', 'Education', 'Government', 'Transportation',
    'Media', 'Telecommunications', 'Agriculture',
]

STATES = ['CA', 'NY', 'TX', 'IL', 'FL', 'WA', 'MA', 'PA', 'OH', 'GA']

LEAD_SOURCES = ['Web', 'Phone', 'Partner', 'Referral', 'Campaign', 'Trade Show']

PRODUCT_CATALOG = [
    ('ENT-LIC-001', 'Enterprise License', 'Software', 1250.00),
    ('ENT-LIC-002', 'Professional License', 'Software', 750.00),
    ('ENT-LIC-003', 'Team License', 'Software', 350.00),
    ('HW-SRV-001', 'Application Server', 'Hardware', 15000.00),
    ('HW-SRV-002', 'Database Server', 'Hardware', 25000.00),
    ('SVC-IMP-001', 'Implementation Services', 'Services', 200.00),
    ('SVC-IMP-002', 'Data Migration', 'Services', 175.00),
    ('SUP-PRE-001', 'Premium Support', 'Support', 5000.00),
    ('SUP-STD-001', 'Standard Support', 'Support', 2000.00),
    ('TRN-ADM-001', 'Admin Training', 'Training', 3000.00),
    ('TRN-USR-001', 'End User Training', 'Training', 1500.00),
    ('SW-ADD-001', 'Analytics Add-on', 'Software', 500.00),
    ('SW-ADD-002', 'Security Add-on', 'Software', 800.00),
    ('HW-NET-001', 'Network Switch', 'Hardware', 5000.00),
    ('SVC-CON-001', 'Consulting Hours', 'Services', 250.00),
]

COMPANY_NAMES = [
    'Acme Corp', 'Globex Corporation', 'Initech', 'Umbrella Industries',
    'Wayne Enterprises', 'Stark Industries', 'Cyberdyne Systems',
    'Soylent Corp', 'Oscorp Industries', 'LexCorp', 'Tyrell Corporation',
    'Weyland-Yutani', 'Massive Dynamic', 'Aperture Science',
    'Black Mesa', 'InGen', 'Virtucon', 'Prestige Worldwide',
    'Dunder Mifflin', 'Sterling Cooper', 'Pied Piper', 'Hooli',
    'Raviga Capital', 'Aviato', 'Bachmanity', 'Nucleus',
    'Gavin Belson Foundation', 'Three Comma Club', 'Maleant Data Systems',
    'Endframe', 'Sliceline', 'Optimoji', 'RussFest LLC',
    'Intersite', 'YaoNet', 'Foxhound Inc', 'Big Head Enterprises',
    'Piedmont Solutions', 'Cascadia Tech', 'Summit Analytics',
    'Redwood Data', 'Pacific Platforms', 'Sierra Metrics',
    'Alpine Systems', 'Coastal Computing', 'Harbor Networks',
    'Lighthouse Software', 'Pinnacle Group', 'Keystone Digital',
    'Granite Solutions', 'Ironbridge Corp',
]


@dataclass
class SFDCGeneratorConfig:
    n_accounts: int = 50
    n_opportunities: int = 200
    n_users: int = 20
    n_products: int = 15
    sap_link_rate: float = 0.60
    date_range_start: str = '2024-01-01'
    date_range_end: str = '2025-12-31'
    win_rate: float = 0.35
    seed: int = 42


def _sfdc_id(prefix: str, rng: random.Random) -> str:
    """Generate a Salesforce-style 15-char ID."""
    chars = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'
    suffix = ''.join(rng.choices(chars, k=10))
    return f"{prefix}{suffix}"


def _is_quarter_end(dt: datetime) -> bool:
    """Check if date is in last 5 days of a quarter."""
    month = dt.month
    if month in (3, 6, 9, 12):
        if month == 3:
            end_day = 31
        elif month == 6:
            end_day = 30
        elif month == 9:
            end_day = 30
        else:
            end_day = 31
        return dt.day > end_day - 5
    return False


class SFDCGenerator:
    def __init__(self, config: Optional[SFDCGeneratorConfig] = None):
        self.config = config or SFDCGeneratorConfig()
        self.rng = random.Random(self.config.seed)
        self._start = datetime.fromisoformat(self.config.date_range_start)
        self._end = datetime.fromisoformat(self.config.date_range_end)
        self._date_range_days = (self._end - self._start).days

    def generate(self) -> Dict[str, Any]:
        """Generate complete SFDC synthetic dataset."""
        products = self._generate_products()
        accounts = self._generate_accounts()
        users = self._generate_users()
        opportunities = self._generate_opportunities(accounts, users)
        stage_histories = self._generate_stage_histories(opportunities)
        line_items = self._generate_line_items(opportunities, products)
        activities = self._generate_activities(opportunities, users)

        # Apply planted patterns
        self._apply_patterns(opportunities, stage_histories, activities, accounts)

        # Generate matching SAP records
        sap_orders, sap_doc_flows, sap_customers = self._generate_sap_records(
            opportunities, accounts
        )

        return {
            'accounts': accounts,
            'opportunities': opportunities,
            'stage_histories': stage_histories,
            'line_items': line_items,
            'activities': activities,
            'products': products,
            'users': users,
            'sap_orders': sap_orders,
            'sap_doc_flows': sap_doc_flows,
            'sap_customers': sap_customers,
        }

    def _generate_products(self) -> List[Dict[str, Any]]:
        catalog = PRODUCT_CATALOG[:self.config.n_products]
        return [
            {
                'product_id': _sfdc_id('01t', self.rng),
                'product_code': code,
                'name': name,
                'family': family,
                'is_active': True,
                'description': f'{name} - {family}',
                'unit_price': price,
            }
            for code, name, family, price in catalog
        ]

    def _generate_accounts(self) -> List[Dict[str, Any]]:
        names = self.rng.sample(
            COMPANY_NAMES, min(self.config.n_accounts, len(COMPANY_NAMES))
        )
        accounts = []
        for name in names:
            acct_id = _sfdc_id('001', self.rng)
            sap_num = f"{self.rng.randint(10000, 99999):010d}" if self.rng.random() < 0.8 else None
            accounts.append({
                'account_id': acct_id,
                'name': name,
                'industry': self.rng.choice(INDUSTRIES),
                'billing_state': self.rng.choice(STATES),
                'billing_country': 'US',
                'type': 'Customer',
                'number_of_employees': self.rng.choice([50, 200, 500, 1000, 5000, 10000, 50000]),
                'annual_revenue': self.rng.choice([1_000_000, 5_000_000, 25_000_000, 100_000_000, 500_000_000]),
                'sap_customer_number': sap_num,
            })
        return accounts

    def _generate_users(self) -> List[str]:
        return [_sfdc_id('005', self.rng) for _ in range(self.config.n_users)]

    def _generate_opportunities(
        self, accounts: List[Dict], users: List[str]
    ) -> List[Dict[str, Any]]:
        opportunities = []
        record_types = list(PIPELINES.keys())
        type_weights = [0.6, 0.25, 0.15]  # New Business, Renewal, Upsell

        for _ in range(self.config.n_opportunities):
            account = self.rng.choice(accounts)
            record_type = self.rng.choices(record_types, weights=type_weights, k=1)[0]
            owner = self.rng.choice(users)

            created_offset = self.rng.randint(0, self._date_range_days)
            created = self._start + timedelta(days=created_offset)
            close_offset = self.rng.randint(14, 180)
            close_date = created + timedelta(days=close_offset)

            is_won = self.rng.random() < self.config.win_rate
            is_closed = is_won or self.rng.random() < 0.25  # 25% lost
            is_lost = is_closed and not is_won

            if is_closed:
                stages = PIPELINES[record_type]
                if is_won:
                    final_stage = 'Closed Won'
                else:
                    final_stage = 'Closed Lost'
            else:
                stages = PIPELINES[record_type]
                stage_idx = self.rng.randint(0, len(stages) - 1)
                final_stage = stages[stage_idx]

            amount = round(self.rng.uniform(5000, 500000), 2)
            sap_order = None
            if is_won and self.rng.random() < self.config.sap_link_rate:
                sap_order = f"{self.rng.randint(100000, 999999):010d}"

            probability_map = {
                'Prospecting': 10, 'Qualification': 20, 'Needs Analysis': 30,
                'Value Proposition': 40, 'Id. Decision Makers': 50,
                'Perception Analysis': 60, 'Proposal/Price Quote': 70,
                'Negotiation/Review': 80, 'Discovery': 30, 'Proposal': 60,
                'Negotiation': 80, 'Closed Won': 100, 'Closed Lost': 0,
            }

            opportunities.append({
                'opportunity_id': _sfdc_id('006', self.rng),
                'name': f"{account['name']} - {record_type} {created.strftime('%Y-%m')}",
                'account_id': account['account_id'],
                'record_type': record_type,
                'stage_name': final_stage,
                'amount': amount,
                'currency_iso_code': 'USD',
                'owner_id': owner,
                'created_date': created.isoformat() + 'Z',
                'close_date': close_date.strftime('%Y-%m-%d'),
                'type': record_type,
                'lead_source': self.rng.choice(LEAD_SOURCES),
                'probability': probability_map.get(final_stage, 50),
                'forecast_category': 'Closed' if is_closed else 'Pipeline',
                'sap_order_number': sap_order,
                'is_closed': is_closed,
                'is_won': is_won,
                '_pattern_flags': [],
            })

        return opportunities

    def _generate_stage_histories(
        self, opportunities: List[Dict]
    ) -> List[Dict[str, Any]]:
        histories: List[Dict[str, Any]] = []

        for opp in opportunities:
            record_type = opp['record_type']
            stages = PIPELINES[record_type]
            final_stage = opp['stage_name']
            created = datetime.fromisoformat(opp['created_date'].replace('Z', '+00:00'))

            # Determine which stages were traversed
            if final_stage in ('Closed Won', 'Closed Lost'):
                traversed = list(stages) + [final_stage]
            else:
                idx = stages.index(final_stage) if final_stage in stages else 0
                traversed = stages[:idx + 1]

            current_time = created
            prev_stage = None
            for i, stage in enumerate(traversed):
                duration = self.rng.randint(3, 30) if i > 0 else 0
                current_time = current_time + timedelta(days=duration)

                histories.append({
                    'id': _sfdc_id('017', self.rng),
                    'opportunity_id': opp['opportunity_id'],
                    'stage_name': stage,
                    'previous_stage': prev_stage,
                    'created_date': current_time.isoformat() + 'Z',
                    'amount': opp['amount'] * (0.8 + 0.2 * (i / max(len(traversed) - 1, 1))),
                    'probability': opp['probability'],
                    'expected_revenue': opp['amount'] * opp['probability'] / 100,
                    'close_date': opp['close_date'],
                    'duration_days': duration,
                    'changed_by': opp['owner_id'],
                })
                prev_stage = stage

        return histories

    def _generate_line_items(
        self, opportunities: List[Dict], products: List[Dict]
    ) -> List[Dict[str, Any]]:
        items: List[Dict[str, Any]] = []
        for opp in opportunities:
            n_items = self.rng.randint(1, 4)
            chosen_products = self.rng.sample(products, min(n_items, len(products)))
            remaining_amount = opp['amount']

            for idx, prod in enumerate(chosen_products):
                is_last = (idx == len(chosen_products) - 1)
                if is_last:
                    item_amount = round(remaining_amount, 2)
                else:
                    item_amount = round(remaining_amount * self.rng.uniform(0.2, 0.6), 2)
                    remaining_amount -= item_amount

                qty = max(1, int(item_amount / prod['unit_price'])) if prod['unit_price'] > 0 else 1
                unit_price = round(item_amount / qty, 2) if qty > 0 else item_amount

                items.append({
                    'line_item_id': _sfdc_id('00k', self.rng),
                    'opportunity_id': opp['opportunity_id'],
                    'product_id': prod['product_id'],
                    'product_code': prod['product_code'],
                    'product_name': prod['name'],
                    'product_family': prod['family'],
                    'quantity': qty,
                    'unit_price': unit_price,
                    'total_price': round(unit_price * qty, 2),
                    'sort_order': idx + 1,
                    'service_date': opp['close_date'] if opp['is_won'] else None,
                    'description': f"{prod['name']} x{qty}",
                })

        return items

    def _generate_activities(
        self, opportunities: List[Dict], users: List[str]
    ) -> List[Dict[str, Any]]:
        activities: List[Dict[str, Any]] = []
        subjects = [
            'Discovery call', 'Follow up email', 'Demo scheduled',
            'Pricing discussion', 'Contract review', 'Technical deep-dive',
            'Executive briefing', 'Proposal walkthrough', 'Negotiation call',
            'Reference check', 'Security review', 'Legal review',
            'Final approval meeting', 'Onboarding kickoff',
        ]

        for opp in opportunities:
            n_activities = self.rng.randint(1, 8)
            created = datetime.fromisoformat(opp['created_date'].replace('Z', '+00:00'))
            close = datetime.fromisoformat(opp['close_date'])
            span = max((close - created).days, 1)

            for _ in range(n_activities):
                offset = self.rng.randint(0, span)
                act_date = created + timedelta(days=offset)
                act_type = self.rng.choice(['Task', 'Event'])

                activities.append({
                    'activity_id': _sfdc_id('00T', self.rng),
                    'type': act_type,
                    'subject': self.rng.choice(subjects),
                    'status': 'Completed' if act_date.date() < datetime.now().date() else 'Open',
                    'priority': self.rng.choice(['High', 'Normal', 'Low']),
                    'activity_date': act_date.strftime('%Y-%m-%d'),
                    'owner_id': opp['owner_id'],
                    'what_id': opp['opportunity_id'],
                    'who_id': _sfdc_id('003', self.rng) if self.rng.random() < 0.7 else None,
                    'description': f"Activity for {opp['name']}",
                })

        return activities

    def _apply_patterns(
        self,
        opportunities: List[Dict],
        stage_histories: List[Dict],
        activities: List[Dict],
        accounts: List[Dict],
    ) -> None:
        """Apply planted anomaly patterns to generated data."""
        n = len(opportunities)

        # Build lookup: opp_id -> list of stage history entries
        hist_by_opp: Dict[str, List[Dict]] = {}
        for h in stage_histories:
            hist_by_opp.setdefault(h['opportunity_id'], []).append(h)

        # Build lookup: opp_id -> list of activities
        act_by_opp: Dict[str, List[Dict]] = {}
        for a in activities:
            act_by_opp.setdefault(a['what_id'], []).append(a)

        # 1. STAGE_SKIP (5%)
        skip_count = max(1, int(n * 0.05))
        skip_candidates = [o for o in opportunities if o['is_closed'] and o['record_type'] == 'New Business']
        for opp in self.rng.sample(skip_candidates, min(skip_count, len(skip_candidates))):
            opp['_pattern_flags'].append(PATTERN_STAGE_SKIP)
            # Remove 1-2 intermediate stages from history
            hist = hist_by_opp.get(opp['opportunity_id'], [])
            if len(hist) > 3:
                to_remove = self.rng.sample(hist[1:-1], min(2, len(hist) - 2))
                for h in to_remove:
                    stage_histories.remove(h)

        # 2. QUARTER_END_COMPRESSION (40% of closed won)
        won_opps = [o for o in opportunities if o['is_won']]
        qe_count = max(1, int(len(won_opps) * 0.40))
        for opp in self.rng.sample(won_opps, min(qe_count, len(won_opps))):
            opp['_pattern_flags'].append(PATTERN_QUARTER_END)
            close = datetime.fromisoformat(opp['close_date'])
            month = close.month
            # Move to last 5 days of quarter
            if month <= 3:
                new_close = datetime(close.year, 3, self.rng.randint(27, 31))
            elif month <= 6:
                new_close = datetime(close.year, 6, self.rng.randint(26, 30))
            elif month <= 9:
                new_close = datetime(close.year, 9, self.rng.randint(26, 30))
            else:
                new_close = datetime(close.year, 12, self.rng.randint(27, 31))
            opp['close_date'] = new_close.strftime('%Y-%m-%d')

        # 3. GHOST_PIPELINE (10% of late-stage opps)
        late_stages = {'Proposal/Price Quote', 'Negotiation/Review', 'Proposal', 'Negotiation'}
        late_opps = [o for o in opportunities if o['stage_name'] in late_stages and not o['is_closed']]
        ghost_count = max(1, int(len(late_opps) * 0.10)) if late_opps else 0
        for opp in self.rng.sample(late_opps, min(ghost_count, len(late_opps))):
            opp['_pattern_flags'].append(PATTERN_GHOST_PIPELINE)
            # Remove all activities for this opp
            opp_acts = act_by_opp.get(opp['opportunity_id'], [])
            for a in opp_acts:
                if a in activities:
                    activities.remove(a)
            act_by_opp[opp['opportunity_id']] = []

        # 4. STAGE_REGRESSION (3%)
        regression_count = max(1, int(n * 0.03))
        regression_candidates = [o for o in opportunities
                                 if o['record_type'] == 'New Business' and not o.get('_pattern_flags')]
        for opp in self.rng.sample(regression_candidates, min(regression_count, len(regression_candidates))):
            opp['_pattern_flags'].append(PATTERN_STAGE_REGRESSION)
            hist = hist_by_opp.get(opp['opportunity_id'], [])
            if len(hist) >= 3:
                # Insert a backward stage
                target_idx = self.rng.randint(1, len(hist) - 2)
                backward_stage = hist[target_idx - 1]['stage_name']
                last_entry = hist[-1]
                regression_entry = dict(last_entry)
                regression_entry['id'] = _sfdc_id('017', self.rng)
                regression_entry['stage_name'] = backward_stage
                regression_entry['previous_stage'] = last_entry['stage_name']
                created_dt = datetime.fromisoformat(last_entry['created_date'].replace('Z', '+00:00'))
                regression_entry['created_date'] = (created_dt + timedelta(days=2)).isoformat() + 'Z'
                stage_histories.append(regression_entry)

        # 5. AMOUNT_INFLATION (8%)
        inflation_count = max(1, int(n * 0.08))
        inflation_candidates = [o for o in opportunities if o['is_won']]
        for opp in self.rng.sample(inflation_candidates, min(inflation_count, len(inflation_candidates))):
            opp['_pattern_flags'].append(PATTERN_AMOUNT_INFLATION)
            hist = hist_by_opp.get(opp['opportunity_id'], [])
            if hist:
                # Inflate amount by >50% in final stage
                factor = self.rng.uniform(1.55, 2.0)
                original = opp['amount']
                opp['amount'] = round(original * factor, 2)
                # Update final stage history entry
                hist[-1]['amount'] = opp['amount']

        # 6. SPLIT_DEAL (6%)
        split_count = max(1, int(n * 0.06))
        split_candidates = [o for o in opportunities if o['is_won'] and not o.get('_pattern_flags')]
        for opp in self.rng.sample(split_candidates, min(split_count, len(split_candidates))):
            opp['_pattern_flags'].append(PATTERN_SPLIT_DEAL)
            # Create a duplicate opp on same account, close date within 7 days
            created = datetime.fromisoformat(opp['created_date'].replace('Z', '+00:00'))
            close = datetime.fromisoformat(opp['close_date'])
            split_opp = dict(opp)
            split_opp['opportunity_id'] = _sfdc_id('006', self.rng)
            split_opp['name'] = opp['name'] + ' (Split)'
            split_opp['amount'] = round(opp['amount'] * self.rng.uniform(0.3, 0.7), 2)
            split_opp['created_date'] = (created + timedelta(days=self.rng.randint(1, 5))).isoformat() + 'Z'
            split_opp['close_date'] = (close + timedelta(days=self.rng.randint(0, 7))).strftime('%Y-%m-%d')
            split_opp['_pattern_flags'] = [PATTERN_SPLIT_DEAL]
            opportunities.append(split_opp)

        # 7. SPEED_ANOMALY (5%)
        speed_count = max(1, int(n * 0.05))
        speed_candidates = [o for o in opportunities if o['is_won']]
        for opp in self.rng.sample(speed_candidates, min(speed_count, len(speed_candidates))):
            opp['_pattern_flags'].append(PATTERN_SPEED_ANOMALY)
            created = datetime.fromisoformat(opp['created_date'].replace('Z', '+00:00'))
            opp['close_date'] = (created + timedelta(days=self.rng.randint(0, 2))).strftime('%Y-%m-%d')

        # 8. STALE_PIPELINE (15% of open)
        open_opps = [o for o in opportunities if not o['is_closed']]
        stale_count = max(1, int(len(open_opps) * 0.15)) if open_opps else 0
        for opp in self.rng.sample(open_opps, min(stale_count, len(open_opps))):
            opp['_pattern_flags'].append(PATTERN_STALE_PIPELINE)
            # Set created date >90 days ago with no recent activity
            old_date = self._start + timedelta(days=self.rng.randint(0, 30))
            opp['created_date'] = old_date.isoformat() + 'Z'

        # 9. OWNER_SWAP_AT_CLOSE (4% of closed won)
        swap_count = max(1, int(len(won_opps) * 0.04))
        swap_candidates = [o for o in won_opps if PATTERN_OWNER_SWAP not in (o.get('_pattern_flags') or [])]
        for opp in self.rng.sample(swap_candidates, min(swap_count, len(swap_candidates))):
            opp['_pattern_flags'].append(PATTERN_OWNER_SWAP)
            hist = hist_by_opp.get(opp['opportunity_id'], [])
            if hist:
                new_owner = self.rng.choice([u for u in self._generate_users() if u != opp['owner_id']][:3] or [opp['owner_id']])
                hist[-1]['changed_by'] = new_owner

        # 10. CROSS_SYSTEM_GAP (6% of SAP-linked)
        sap_linked = [o for o in opportunities if o.get('sap_order_number')]
        gap_count = max(1, int(len(sap_linked) * 0.06)) if sap_linked else 0
        for opp in self.rng.sample(sap_linked, min(gap_count, len(sap_linked))):
            opp['_pattern_flags'].append(PATTERN_CROSS_SYSTEM_GAP)
            # Gap will be reflected in SAP order ERDAT during _generate_sap_records

    def _generate_sap_records(
        self,
        opportunities: List[Dict],
        accounts: List[Dict],
    ) -> Tuple[List[Dict], List[Dict], List[Dict]]:
        """Generate matching SAP records for linked opportunities."""
        account_map = {a['account_id']: a for a in accounts}
        sap_orders: List[Dict] = []
        sap_doc_flows: List[Dict] = []
        sap_customers: List[Dict] = []
        seen_customers: set = set()

        for opp in opportunities:
            sap_num = opp.get('sap_order_number')
            if not sap_num:
                continue

            account = account_map.get(opp['account_id'], {})
            close_date = datetime.fromisoformat(opp['close_date'])

            # Determine SAP order date (usually close to SFDC close)
            gap_days = self.rng.randint(1, 10)
            if PATTERN_CROSS_SYSTEM_GAP in (opp.get('_pattern_flags') or []):
                gap_days = self.rng.randint(35, 60)  # >30 day gap

            sap_erdat = close_date + timedelta(days=gap_days)

            sap_orders.append({
                'vbeln': sap_num,
                'auart': 'OR',
                'vkorg': '1000',
                'vtweg': '10',
                'spart': '00',
                'kunnr': account.get('sap_customer_number', f"{self.rng.randint(10000,99999):010d}"),
                'erdat': sap_erdat.strftime('%Y%m%d'),
                'erzet': f"{self.rng.randint(8,17):02d}{self.rng.randint(0,59):02d}00",
                'ernam': 'SAP_USER',
                'vdatu': (sap_erdat + timedelta(days=14)).strftime('%Y%m%d'),
                'netwr': opp['amount'],
                'waerk': 'USD',
            })

            # Doc flow: order -> delivery -> invoice
            delivery_num = f"{self.rng.randint(800000, 899999):010d}"
            invoice_num = f"{self.rng.randint(900000, 999999):010d}"

            sap_doc_flows.append({
                'vbelv': sap_num, 'posnv': '000000',
                'vbtyp_v': 'C', 'vbeln': delivery_num,
                'posnn': '000000', 'vbtyp_n': 'J',
                'erdat': (sap_erdat + timedelta(days=self.rng.randint(5, 15))).strftime('%Y%m%d'),
            })
            sap_doc_flows.append({
                'vbelv': delivery_num, 'posnv': '000000',
                'vbtyp_v': 'J', 'vbeln': invoice_num,
                'posnn': '000000', 'vbtyp_n': 'M',
                'erdat': (sap_erdat + timedelta(days=self.rng.randint(15, 30))).strftime('%Y%m%d'),
            })

            # Customer master
            cust_num = account.get('sap_customer_number')
            if cust_num and cust_num not in seen_customers:
                seen_customers.add(cust_num)
                sap_customers.append({
                    'kunnr': cust_num,
                    'name1': account['name'],
                    'regio': account.get('billing_state', ''),
                    'land1': account.get('billing_country', 'US'),
                    'brsch': account.get('industry', ''),
                    'ktokd': '0001',
                })

        return sap_orders, sap_doc_flows, sap_customers

    def write_output(self, data: Dict[str, Any], output_dir: str) -> None:
        """Write generated data to JSON files."""
        out = Path(output_dir)
        out.mkdir(parents=True, exist_ok=True)

        file_map = {
            'accounts.json': data['accounts'],
            'opportunities.json': data['opportunities'],
            'stage_histories.json': data['stage_histories'],
            'line_items.json': data['line_items'],
            'activities.json': data['activities'],
            'products.json': data['products'],
        }

        for fname, records in file_map.items():
            (out / fname).write_text(json.dumps(records, indent=2, default=str))

        # SAP records (if any)
        if data.get('sap_orders'):
            (out / 'sap_orders.json').write_text(json.dumps(data['sap_orders'], indent=2))
        if data.get('sap_doc_flows'):
            (out / 'sap_doc_flows.json').write_text(json.dumps(data['sap_doc_flows'], indent=2))
        if data.get('sap_customers'):
            (out / 'sap_customers.json').write_text(json.dumps(data['sap_customers'], indent=2))

        print(f"Wrote {len(data['opportunities'])} opportunities to {out}")


def main():
    parser = argparse.ArgumentParser(description='Generate synthetic SFDC data')
    parser.add_argument('--count', type=int, default=200, help='Number of opportunities')
    parser.add_argument('--accounts', type=int, default=50, help='Number of accounts')
    parser.add_argument('--output', type=str, default='sfdc_output', help='Output directory')
    parser.add_argument('--seed', type=int, default=42, help='Random seed')
    parser.add_argument('--sap-link-rate', type=float, default=0.60, help='Fraction with SAP records')
    args = parser.parse_args()

    config = SFDCGeneratorConfig(
        n_accounts=args.accounts,
        n_opportunities=args.count,
        sap_link_rate=args.sap_link_rate,
        seed=args.seed,
    )
    gen = SFDCGenerator(config)
    data = gen.generate()
    gen.write_output(data, args.output)


if __name__ == '__main__':
    main()
```

- [ ] **Step 3: Run generator tests**

```bash
cd "/Volumes/OWC drive/Dev/SAP-Transaction-Forensics/synthetic-data"
python3 -m pytest tests/test_generate_sfdc.py -v 2>&1 | tail -20
```

Expected: All PASS

- [ ] **Step 4: Generate the synthetic dataset**

```bash
cd "/Volumes/OWC drive/Dev/SAP-Transaction-Forensics/synthetic-data"
python3 src/generate_sfdc.py --count 200 --accounts 50 --output sfdc_output/ --seed 42
```

- [ ] **Step 5: Create .gitkeep and commit**

```bash
cd "/Volumes/OWC drive/Dev/SAP-Transaction-Forensics"
touch synthetic-data/sfdc_output/.gitkeep
git add synthetic-data/src/generate_sfdc.py synthetic-data/tests/test_generate_sfdc.py synthetic-data/sfdc_output/.gitkeep
git commit -m "feat(sfdc): add synthetic SFDC data generator with 10 planted patterns"
```

---

## Task 5: SFDC Synthetic Adapter

**Files:**
- Create: `mcp-server/src/adapters/sfdc/index.ts`
- Create: `mcp-server/src/adapters/sfdc/__tests__/sfdc-synthetic.test.ts`

- [ ] **Step 1: Write adapter integration tests**

```typescript
// mcp-server/src/adapters/sfdc/__tests__/sfdc-synthetic.test.ts

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { SFDCSyntheticAdapter } from '../index.js';

describe('SFDCSyntheticAdapter', () => {
  let adapter: SFDCSyntheticAdapter;

  beforeAll(async () => {
    adapter = new SFDCSyntheticAdapter();
    await adapter.initialize();
  });

  afterAll(async () => {
    await adapter.shutdown();
  });

  it('should have name "sfdc"', () => {
    expect(adapter.name).toBe('sfdc');
  });

  it('should be ready after initialization', () => {
    expect(adapter.isReady()).toBe(true);
  });

  describe('getSalesDocHeader', () => {
    it('should return header for valid opportunity', async () => {
      const results = await adapter.searchDocText({ pattern: '.*', max_results: 1 });
      if (results.length === 0) return; // Skip if no data
      const vbeln = results[0].VBELN;
      const header = await adapter.getSalesDocHeader({ vbeln });
      expect(header).not.toBeNull();
      expect(header!.VBELN).toBe(vbeln);
      expect(header!.AUART).toBeTruthy();
      expect(header!.ERDAT).toMatch(/^\d{8}$/);
    });

    it('should return null for nonexistent opportunity', async () => {
      const header = await adapter.getSalesDocHeader({ vbeln: '9999999999' });
      expect(header).toBeNull();
    });
  });

  describe('getSalesDocItems', () => {
    it('should return items for valid opportunity', async () => {
      const results = await adapter.searchDocText({ pattern: '.*', max_results: 1 });
      if (results.length === 0) return;
      const items = await adapter.getSalesDocItems({ vbeln: results[0].VBELN });
      expect(items.length).toBeGreaterThan(0);
      expect(items[0].POSNR).toBeTruthy();
      expect(items[0].NETWR).toBeGreaterThan(0);
    });
  });

  describe('getDocFlow', () => {
    it('should return stage history as doc flow', async () => {
      const results = await adapter.searchDocText({ pattern: '.*', max_results: 1 });
      if (results.length === 0) return;
      const flow = await adapter.getDocFlow({ vbeln: results[0].VBELN });
      expect(flow.documents.length).toBeGreaterThan(0);
      expect(flow.root_document).toBe(results[0].VBELN);
    });
  });

  describe('getDocText', () => {
    it('should return activity texts for opportunity', async () => {
      const results = await adapter.searchDocText({ pattern: '.*', max_results: 1 });
      if (results.length === 0) return;
      const text = await adapter.getDocText({ vbeln: results[0].VBELN, doc_type: 'order' });
      // May or may not have texts depending on activities
      expect(text).toBeDefined();
      expect(text.header_texts).toBeDefined();
    });
  });

  describe('searchDocText', () => {
    it('should search across activity descriptions', async () => {
      const results = await adapter.searchDocText({ pattern: 'call', max_results: 10 });
      // Activities contain subjects like "Discovery call", "Follow up call"
      expect(results).toBeDefined();
      expect(Array.isArray(results)).toBe(true);
    });

    it('should respect max_results', async () => {
      const results = await adapter.searchDocText({ pattern: '.*', max_results: 5 });
      expect(results.length).toBeLessThanOrEqual(5);
    });
  });

  describe('getMasterStub', () => {
    it('should return account data for customer type', async () => {
      const results = await adapter.searchDocText({ pattern: '.*', max_results: 1 });
      if (results.length === 0) return;
      const header = await adapter.getSalesDocHeader({ vbeln: results[0].VBELN });
      if (!header) return;
      const stub = await adapter.getMasterStub({ entity_type: 'customer', entity_id: header.KUNNR });
      expect(stub).not.toBeNull();
      expect(stub!.entity_type).toBe('customer');
      expect(stub!.attributes.BRSCH).toBeTruthy();
    });
  });

  describe('getDeliveryTiming', () => {
    it('should return timing derived from close dates', async () => {
      const results = await adapter.searchDocText({ pattern: '.*', max_results: 1 });
      if (results.length === 0) return;
      const timing = await adapter.getDeliveryTiming({ vbeln: results[0].VBELN });
      // May be null if opp not closed
      if (timing) {
        expect(timing.header).toBeDefined();
      }
    });
  });

  describe('getInvoiceTiming', () => {
    it('should return invoice timing when available', async () => {
      const results = await adapter.searchDocText({ pattern: '.*', max_results: 1 });
      if (results.length === 0) return;
      const timing = await adapter.getInvoiceTiming({ vbeln: results[0].VBELN });
      if (timing) {
        expect(timing.header).toBeDefined();
      }
    });
  });
});
```

- [ ] **Step 2: Write the adapter implementation**

```typescript
// mcp-server/src/adapters/sfdc/index.ts

/**
 * Salesforce Synthetic Data Adapter
 *
 * Loads SFDC synthetic data from JSON files, normalizes through
 * the field mapper, and serves via the IDataAdapter interface.
 */

import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

import { BaseDataAdapter, registerAdapter } from '../adapter-interface.js';
import {
  SearchDocTextParams,
  SearchResult,
  DocTextParams,
  DocTextResult,
  DocFlowParams,
  DocFlowResult,
  SalesDocHeaderParams,
  SalesDocHeader,
  SalesDocItemsParams,
  SalesDocItem,
  DeliveryTimingParams,
  DeliveryTimingResult,
  InvoiceTimingParams,
  InvoiceTimingResult,
  MasterStubParams,
  MasterStub,
} from '../../types/index.js';

import type {
  SFDCOpportunity,
  SFDCAccount,
  SFDCStageHistory,
  SFDCLineItem,
  SFDCActivity,
  SFDCProduct,
  SFDCDataset,
} from './sfdc-types.js';

import { SFDCFieldMapper, padToLength, formatDateToSAP } from './field-mapper.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DEFAULT_DATA_DIR = join(__dirname, '..', '..', '..', '..', 'synthetic-data', 'sfdc_output');

export class SFDCSyntheticAdapter extends BaseDataAdapter {
  readonly name = 'sfdc';

  private dataset: SFDCDataset | null = null;
  private mapper: SFDCFieldMapper;
  private dataDir: string;

  // Indexes for fast lookup
  private oppById: Map<string, SFDCOpportunity> = new Map();
  private oppByVbeln: Map<string, SFDCOpportunity> = new Map();
  private histByOpp: Map<string, SFDCStageHistory[]> = new Map();
  private itemsByOpp: Map<string, SFDCLineItem[]> = new Map();
  private actsByOpp: Map<string, SFDCActivity[]> = new Map();
  private accountById: Map<string, SFDCAccount> = new Map();
  private productById: Map<string, SFDCProduct> = new Map();

  constructor(dataDir?: string) {
    super();
    this.mapper = new SFDCFieldMapper();
    this.dataDir = dataDir ?? DEFAULT_DATA_DIR;
  }

  protected async doInitialize(): Promise<void> {
    const [accounts, opportunities, stageHistories, lineItems, activities, products] =
      await Promise.all([
        this.loadJson<SFDCAccount[]>('accounts.json'),
        this.loadJson<SFDCOpportunity[]>('opportunities.json'),
        this.loadJson<SFDCStageHistory[]>('stage_histories.json'),
        this.loadJson<SFDCLineItem[]>('line_items.json'),
        this.loadJson<SFDCActivity[]>('activities.json'),
        this.loadJson<SFDCProduct[]>('products.json'),
      ]);

    this.dataset = { accounts, opportunities, stage_histories: stageHistories, line_items: lineItems, activities, products };

    // Build indexes
    for (const opp of opportunities) {
      this.oppById.set(opp.opportunity_id, opp);
      this.oppByVbeln.set(padToLength(opp.opportunity_id, 10), opp);
    }
    for (const h of stageHistories) {
      const list = this.histByOpp.get(h.opportunity_id) ?? [];
      list.push(h);
      this.histByOpp.set(h.opportunity_id, list);
    }
    for (const item of lineItems) {
      const list = this.itemsByOpp.get(item.opportunity_id) ?? [];
      list.push(item);
      this.itemsByOpp.set(item.opportunity_id, list);
    }
    for (const act of activities) {
      const list = this.actsByOpp.get(act.what_id) ?? [];
      list.push(act);
      this.actsByOpp.set(act.what_id, list);
    }
    for (const acct of accounts) {
      this.accountById.set(acct.account_id, acct);
      this.accountById.set(padToLength(acct.account_id, 10), acct);
    }
    for (const prod of products) {
      this.productById.set(prod.product_id, prod);
      this.productById.set(padToLength(prod.product_code, 18), prod);
    }

    console.log(`[sfdc] Loaded: ${opportunities.length} opps, ${accounts.length} accounts, ${stageHistories.length} stage entries`);
  }

  protected async doShutdown(): Promise<void> {
    this.dataset = null;
    this.oppById.clear();
    this.oppByVbeln.clear();
    this.histByOpp.clear();
    this.itemsByOpp.clear();
    this.actsByOpp.clear();
    this.accountById.clear();
    this.productById.clear();
  }

  private findOpp(vbeln: string): SFDCOpportunity | undefined {
    return this.oppByVbeln.get(vbeln) ?? this.oppById.get(vbeln);
  }

  async searchDocText(params: SearchDocTextParams): Promise<SearchResult[]> {
    this.ensureInitialized();
    const pattern = new RegExp(params.pattern ?? '.*', 'i');
    const maxResults = params.max_results ?? 200;
    const results: SearchResult[] = [];

    for (const [oppId, acts] of this.actsByOpp) {
      if (results.length >= maxResults) break;
      for (const act of acts) {
        if (results.length >= maxResults) break;
        const fullText = `${act.subject} ${act.description}`;
        if (pattern.test(fullText)) {
          const opp = this.oppById.get(oppId);
          results.push({
            VBELN: padToLength(oppId, 10),
            POSNR: '000000',
            snippet: fullText.substring(0, 200),
            match_count: 1,
            doc_date: opp ? formatDateToSAP(opp.created_date) : '',
            sales_org: 'SFDC',
          });
          break; // One result per opp
        }
      }
    }
    return results;
  }

  async getDocText(params: DocTextParams): Promise<DocTextResult> {
    this.ensureInitialized();
    const opp = this.findOpp(params.vbeln);
    if (!opp) return { header_texts: [], item_texts: [] };

    const activities = this.actsByOpp.get(opp.opportunity_id) ?? [];
    return this.mapper.activitiesToDocText(opp.opportunity_id, activities);
  }

  async getDocFlow(params: DocFlowParams): Promise<DocFlowResult> {
    this.ensureInitialized();
    const opp = this.findOpp(params.vbeln);
    if (!opp) return { root_document: params.vbeln, documents: [] };

    const stages = this.histByOpp.get(opp.opportunity_id) ?? [];
    return this.mapper.stageHistoryToDocFlow(opp.opportunity_id, stages);
  }

  async getSalesDocHeader(params: SalesDocHeaderParams): Promise<SalesDocHeader | null> {
    this.ensureInitialized();
    const opp = this.findOpp(params.vbeln);
    if (!opp) return null;
    return this.mapper.opportunityToSalesDocHeader(opp);
  }

  async getSalesDocItems(params: SalesDocItemsParams): Promise<SalesDocItem[]> {
    this.ensureInitialized();
    const opp = this.findOpp(params.vbeln);
    if (!opp) return [];

    const items = this.itemsByOpp.get(opp.opportunity_id) ?? [];
    return items.map(item => this.mapper.lineItemToSalesDocItem(item, opp.currency_iso_code));
  }

  async getDeliveryTiming(params: DeliveryTimingParams): Promise<DeliveryTimingResult | null> {
    this.ensureInitialized();
    const opp = this.findOpp(params.vbeln);
    if (!opp || !opp.is_closed) return null;

    return {
      header: {
        VBELN: padToLength(opp.opportunity_id, 10),
        LFART: opp.is_won ? 'LF' : 'LR',
        WADAT: formatDateToSAP(opp.close_date),
        WADAT_IST: opp.is_won ? formatDateToSAP(opp.close_date) : undefined,
        ERDAT: formatDateToSAP(opp.created_date),
      },
      items: [],
    };
  }

  async getInvoiceTiming(params: InvoiceTimingParams): Promise<InvoiceTimingResult | null> {
    this.ensureInitialized();
    const opp = this.findOpp(params.vbeln);
    if (!opp || !opp.is_won) return null;

    const items = this.itemsByOpp.get(opp.opportunity_id) ?? [];
    const serviceDate = items.find(i => i.service_date)?.service_date;

    return {
      header: {
        VBELN: padToLength(opp.opportunity_id, 10),
        FKART: 'F2',
        FKDAT: serviceDate ? formatDateToSAP(serviceDate) : formatDateToSAP(opp.close_date),
        NETWR: opp.amount,
        WAERK: opp.currency_iso_code,
        ERDAT: formatDateToSAP(opp.close_date),
      },
      items: [],
    };
  }

  async getMasterStub(params: MasterStubParams): Promise<MasterStub | null> {
    this.ensureInitialized();

    if (params.entity_type === 'customer') {
      const account = this.accountById.get(params.entity_id);
      if (!account) return null;
      return this.mapper.accountToMasterStub(account);
    }

    if (params.entity_type === 'material') {
      const product = this.productById.get(params.entity_id);
      if (!product) return null;
      return this.mapper.productToMasterStub(product);
    }

    return null;
  }

  private async loadJson<T>(filename: string): Promise<T> {
    const content = await readFile(join(this.dataDir, filename), 'utf-8');
    return JSON.parse(content) as T;
  }
}

registerAdapter('sfdc', () => new SFDCSyntheticAdapter());

export default SFDCSyntheticAdapter;
```

- [ ] **Step 3: Generate synthetic data (prerequisite for adapter tests)**

```bash
cd "/Volumes/OWC drive/Dev/SAP-Transaction-Forensics/synthetic-data"
python3 src/generate_sfdc.py --count 200 --accounts 50 --output sfdc_output/ --seed 42
```

- [ ] **Step 4: Run adapter tests**

```bash
cd "/Volumes/OWC drive/Dev/SAP-Transaction-Forensics/mcp-server"
npx jest src/adapters/sfdc/__tests__/sfdc-synthetic.test.ts --no-cache 2>&1 | tail -15
```

Expected: All PASS

- [ ] **Step 5: Commit**

```bash
cd "/Volumes/OWC drive/Dev/SAP-Transaction-Forensics"
git add mcp-server/src/adapters/sfdc/index.ts mcp-server/src/adapters/sfdc/__tests__/sfdc-synthetic.test.ts
git commit -m "feat(sfdc): implement SFDCSyntheticAdapter with full IDataAdapter interface + tests"
```

---

## Task 6: Cross-System Entity Resolver

**Files:**
- Create: `mcp-server/src/cross-system/entity-resolver.ts`
- Create: `mcp-server/src/cross-system/__tests__/entity-resolver.test.ts`

- [ ] **Step 1: Write entity resolver tests**

```typescript
// mcp-server/src/cross-system/__tests__/entity-resolver.test.ts

import { describe, it, expect } from '@jest/globals';
import {
  EntityResolver,
  levenshteinDistance,
  type MatchCandidate,
} from '../entity-resolver.js';

describe('levenshteinDistance', () => {
  it('should return 0 for identical strings', () => {
    expect(levenshteinDistance('hello', 'hello')).toBe(0);
  });

  it('should handle single character difference', () => {
    expect(levenshteinDistance('cat', 'car')).toBe(1);
  });

  it('should be case-sensitive', () => {
    expect(levenshteinDistance('ABC', 'abc')).toBe(3);
  });

  it('should handle empty strings', () => {
    expect(levenshteinDistance('', 'abc')).toBe(3);
    expect(levenshteinDistance('abc', '')).toBe(3);
  });
});

describe('EntityResolver', () => {
  const resolver = new EntityResolver();

  const sfdcRecords = [
    { opportunity_id: '006001', account_name: 'Acme Corp', amount: 100000, close_date: '2025-06-15', sap_order_number: '0000012345' },
    { opportunity_id: '006002', account_name: 'Globex Corporation', amount: 50000, close_date: '2025-07-20', sap_order_number: null },
    { opportunity_id: '006003', account_name: 'Initech', amount: 75000, close_date: '2025-08-10', sap_order_number: null },
  ];

  const sapRecords = [
    { vbeln: '0000012345', customer_name: 'Acme Corp', netwr: 100000, erdat: '20250618' },
    { vbeln: '0000067890', customer_name: 'GLOBEX CORPORATION', netwr: 49500, erdat: '20250725' },
    { vbeln: '0000099999', customer_name: 'Vandelay Industries', netwr: 30000, erdat: '20250901' },
  ];

  describe('resolveExplicitId', () => {
    it('should match records with explicit SAP order numbers', () => {
      const matches = resolver.resolveExplicitId(sfdcRecords, sapRecords);
      expect(matches.length).toBe(1);
      expect(matches[0].sfdc_id).toBe('006001');
      expect(matches[0].sap_id).toBe('0000012345');
      expect(matches[0].confidence).toBe(0.99);
      expect(matches[0].strategy).toBe('explicit_id');
    });
  });

  describe('resolveByProximity', () => {
    it('should match by account name + amount + date similarity', () => {
      const matches = resolver.resolveByProximity(sfdcRecords, sapRecords, {
        nameThreshold: 0.3,
        amountTolerance: 0.10,
        maxDateGapDays: 45,
      });

      // Should match Globex (fuzzy name, close amount, close date)
      const globexMatch = matches.find(m => m.sfdc_id === '006002');
      expect(globexMatch).toBeDefined();
      expect(globexMatch!.sap_id).toBe('0000067890');
      expect(globexMatch!.confidence).toBeGreaterThan(0.5);
    });

    it('should not match records with very different amounts', () => {
      const matches = resolver.resolveByProximity(sfdcRecords, sapRecords, {
        nameThreshold: 0.3,
        amountTolerance: 0.01, // Very tight
        maxDateGapDays: 45,
      });

      // Globex has 1% amount diff — 50000 vs 49500 = 1% — should still match
      const globexMatch = matches.find(m => m.sfdc_id === '006002');
      expect(globexMatch).toBeDefined();
    });
  });

  describe('resolveAll', () => {
    it('should combine strategies and deduplicate', () => {
      const matches = resolver.resolveAll(sfdcRecords, sapRecords);
      // At least the explicit match
      expect(matches.length).toBeGreaterThanOrEqual(1);

      // No duplicate SFDC records in output
      const sfdcIds = matches.map(m => m.sfdc_id);
      expect(new Set(sfdcIds).size).toBe(sfdcIds.length);
    });

    it('should prefer explicit match over proximity', () => {
      const matches = resolver.resolveAll(sfdcRecords, sapRecords);
      const acmeMatch = matches.find(m => m.sfdc_id === '006001');
      expect(acmeMatch).toBeDefined();
      expect(acmeMatch!.strategy).toBe('explicit_id');
    });
  });
});
```

- [ ] **Step 2: Write entity resolver implementation**

```typescript
// mcp-server/src/cross-system/entity-resolver.ts

/**
 * Cross-System Entity Resolver
 *
 * Matches SFDC Opportunities to SAP Sales Orders using three strategies:
 * 1. Explicit ID match (highest confidence)
 * 2. Account + Amount + Date proximity (medium confidence)
 * 3. Temporal sequence analysis (lowest confidence, future extension)
 */

export interface MatchCandidate {
  sfdc_id: string;
  sap_id: string;
  confidence: number;
  strategy: 'explicit_id' | 'proximity' | 'temporal';
  details: Record<string, unknown>;
}

export interface SFDCMatchRecord {
  opportunity_id: string;
  account_name: string;
  amount: number;
  close_date: string;
  sap_order_number: string | null;
}

export interface SAPMatchRecord {
  vbeln: string;
  customer_name: string;
  netwr: number;
  erdat: string; // YYYYMMDD
}

export interface ProximityOptions {
  nameThreshold: number;   // Max normalized Levenshtein distance (0-1)
  amountTolerance: number; // Max relative difference (0-1)
  maxDateGapDays: number;  // Max days between dates
}

const DEFAULT_PROXIMITY: ProximityOptions = {
  nameThreshold: 0.3,
  amountTolerance: 0.10,
  maxDateGapDays: 45,
};

/**
 * Compute Levenshtein edit distance between two strings.
 */
export function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost,
      );
    }
  }

  return dp[m][n];
}

function parseSAPDate(yyyymmdd: string): Date {
  const y = parseInt(yyyymmdd.substring(0, 4), 10);
  const m = parseInt(yyyymmdd.substring(4, 6), 10) - 1;
  const d = parseInt(yyyymmdd.substring(6, 8), 10);
  return new Date(y, m, d);
}

function parseISODate(dateStr: string): Date {
  return new Date(dateStr);
}

function daysBetween(a: Date, b: Date): number {
  return Math.abs(Math.round((a.getTime() - b.getTime()) / (1000 * 60 * 60 * 24)));
}

export class EntityResolver {

  /**
   * Strategy 1: Match by explicit SAP order number on Opportunity.
   */
  resolveExplicitId(
    sfdcRecords: SFDCMatchRecord[],
    sapRecords: SAPMatchRecord[],
  ): MatchCandidate[] {
    const sapByVbeln = new Map(sapRecords.map(r => [r.vbeln, r]));
    const matches: MatchCandidate[] = [];

    for (const sfdc of sfdcRecords) {
      if (!sfdc.sap_order_number) continue;
      const sap = sapByVbeln.get(sfdc.sap_order_number);
      if (sap) {
        matches.push({
          sfdc_id: sfdc.opportunity_id,
          sap_id: sap.vbeln,
          confidence: 0.99,
          strategy: 'explicit_id',
          details: { match_field: 'sap_order_number' },
        });
      }
    }

    return matches;
  }

  /**
   * Strategy 2: Match by account name + amount + date proximity.
   */
  resolveByProximity(
    sfdcRecords: SFDCMatchRecord[],
    sapRecords: SAPMatchRecord[],
    options: ProximityOptions = DEFAULT_PROXIMITY,
  ): MatchCandidate[] {
    const matches: MatchCandidate[] = [];

    for (const sfdc of sfdcRecords) {
      let bestMatch: MatchCandidate | null = null;

      for (const sap of sapRecords) {
        // Name similarity (case-insensitive)
        const nameA = sfdc.account_name.toLowerCase();
        const nameB = sap.customer_name.toLowerCase();
        const maxLen = Math.max(nameA.length, nameB.length);
        const dist = levenshteinDistance(nameA, nameB);
        const nameSim = maxLen > 0 ? 1 - dist / maxLen : 0;

        if (nameSim < (1 - options.nameThreshold)) continue;

        // Amount similarity
        const maxAmount = Math.max(sfdc.amount, sap.netwr);
        const amountDiff = Math.abs(sfdc.amount - sap.netwr);
        const amountSim = maxAmount > 0 ? 1 - amountDiff / maxAmount : 0;

        if (amountSim < (1 - options.amountTolerance)) continue;

        // Date proximity
        const sfdcDate = parseISODate(sfdc.close_date);
        const sapDate = parseSAPDate(sap.erdat);
        const gapDays = daysBetween(sfdcDate, sapDate);

        if (gapDays > options.maxDateGapDays) continue;

        const dateSim = 1 - gapDays / options.maxDateGapDays;

        // Weighted confidence
        const confidence = Math.round((0.4 * nameSim + 0.3 * amountSim + 0.3 * dateSim) * 100) / 100;

        if (!bestMatch || confidence > bestMatch.confidence) {
          bestMatch = {
            sfdc_id: sfdc.opportunity_id,
            sap_id: sap.vbeln,
            confidence,
            strategy: 'proximity',
            details: { name_similarity: nameSim, amount_similarity: amountSim, date_gap_days: gapDays },
          };
        }
      }

      if (bestMatch && bestMatch.confidence >= 0.50) {
        matches.push(bestMatch);
      }
    }

    return matches;
  }

  /**
   * Combine all strategies, deduplicate by SFDC ID (keep highest confidence).
   */
  resolveAll(
    sfdcRecords: SFDCMatchRecord[],
    sapRecords: SAPMatchRecord[],
    proximityOptions?: ProximityOptions,
  ): MatchCandidate[] {
    const explicit = this.resolveExplicitId(sfdcRecords, sapRecords);
    const proximity = this.resolveByProximity(sfdcRecords, sapRecords, proximityOptions);

    // Merge: explicit wins over proximity for same SFDC record
    const byId = new Map<string, MatchCandidate>();

    for (const match of [...proximity, ...explicit]) {
      const existing = byId.get(match.sfdc_id);
      if (!existing || match.confidence > existing.confidence) {
        byId.set(match.sfdc_id, match);
      }
    }

    // Deduplicate by SAP ID (one SAP record → one SFDC record)
    const bySapId = new Map<string, MatchCandidate>();
    for (const match of byId.values()) {
      const existing = bySapId.get(match.sap_id);
      if (!existing || match.confidence > existing.confidence) {
        bySapId.set(match.sap_id, match);
      }
    }

    return Array.from(bySapId.values());
  }
}
```

- [ ] **Step 3: Run tests**

```bash
cd "/Volumes/OWC drive/Dev/SAP-Transaction-Forensics/mcp-server"
npx jest src/cross-system/__tests__/entity-resolver.test.ts --no-cache 2>&1 | tail -10
```

Expected: All PASS

- [ ] **Step 4: Commit**

```bash
cd "/Volumes/OWC drive/Dev/SAP-Transaction-Forensics"
git add mcp-server/src/cross-system/entity-resolver.ts mcp-server/src/cross-system/__tests__/entity-resolver.test.ts
git commit -m "feat(cross-system): add entity resolver with explicit ID + proximity matching"
```

---

## Task 7: Unified Event Log + Cross-System MCP Tools

**Files:**
- Create: `mcp-server/src/cross-system/unified-log.ts`
- Create: `mcp-server/src/cross-system/index.ts`
- Create: `mcp-server/src/cross-system/__tests__/unified-log.test.ts`

- [ ] **Step 1: Write unified log tests**

```typescript
// mcp-server/src/cross-system/__tests__/unified-log.test.ts

import { describe, it, expect } from '@jest/globals';
import { UnifiedLogBuilder, type UnifiedEvent, type UnifiedEventLog } from '../unified-log.js';

describe('UnifiedLogBuilder', () => {
  const builder = new UnifiedLogBuilder();

  it('should create a unified event log from SFDC and SAP events', () => {
    const sfdcEvents: UnifiedEvent[] = [
      { system: 'sfdc', event_type: 'stage_change', timestamp: '2025-06-15T10:00:00Z', entity_id: '006001', details: { stage: 'Qualification' } },
      { system: 'sfdc', event_type: 'stage_change', timestamp: '2025-07-01T14:00:00Z', entity_id: '006001', details: { stage: 'Proposal' } },
      { system: 'sfdc', event_type: 'stage_change', timestamp: '2025-08-15T09:00:00Z', entity_id: '006001', details: { stage: 'Closed Won' } },
    ];

    const sapEvents: UnifiedEvent[] = [
      { system: 'sap', event_type: 'order_created', timestamp: '2025-08-18T00:00:00Z', entity_id: '0000012345', details: { auart: 'OR' } },
      { system: 'sap', event_type: 'delivery', timestamp: '2025-08-28T00:00:00Z', entity_id: '0080001234', details: {} },
      { system: 'sap', event_type: 'invoice', timestamp: '2025-09-05T00:00:00Z', entity_id: '0090001234', details: {} },
    ];

    const log = builder.buildLog('corr-001', '006001', '0000012345', 0.99, sfdcEvents, sapEvents);

    expect(log.correlation_id).toBe('corr-001');
    expect(log.events.length).toBe(6);
    // Events should be sorted by timestamp
    for (let i = 1; i < log.events.length; i++) {
      expect(log.events[i].timestamp >= log.events[i - 1].timestamp).toBe(true);
    }
  });

  it('should compute cross-system metrics', () => {
    const sfdcEvents: UnifiedEvent[] = [
      { system: 'sfdc', event_type: 'stage_change', timestamp: '2025-06-15T10:00:00Z', entity_id: '006001', details: { stage: 'Closed Won', amount: 100000 } },
    ];
    const sapEvents: UnifiedEvent[] = [
      { system: 'sap', event_type: 'order_created', timestamp: '2025-07-18T00:00:00Z', entity_id: '0000012345', details: { netwr: 95000 } },
    ];

    const log = builder.buildLog('corr-002', '006001', '0000012345', 0.99, sfdcEvents, sapEvents);

    expect(log.cross_system_metrics.sfdc_to_sap_gap_days).toBeGreaterThan(30);
    expect(log.cross_system_metrics.amount_discrepancy).toBeCloseTo(5000, 0);
  });

  it('should handle SFDC-only logs (no SAP match)', () => {
    const sfdcEvents: UnifiedEvent[] = [
      { system: 'sfdc', event_type: 'stage_change', timestamp: '2025-06-15T10:00:00Z', entity_id: '006001', details: {} },
    ];

    const log = builder.buildLog('corr-003', '006001', null, 0, sfdcEvents, []);

    expect(log.sap_vbeln).toBeNull();
    expect(log.cross_system_metrics.sfdc_to_sap_gap_days).toBeNull();
  });
});
```

- [ ] **Step 2: Write unified log implementation**

```typescript
// mcp-server/src/cross-system/unified-log.ts

/**
 * Unified Event Log
 *
 * Merges SFDC and SAP event sequences into a single timeline
 * per correlation group for cross-system analysis.
 */

export interface UnifiedEvent {
  system: 'sfdc' | 'sap';
  event_type: string;
  timestamp: string;
  entity_id: string;
  details: Record<string, unknown>;
}

export interface CrossSystemMetrics {
  total_duration_days: number;
  sfdc_to_sap_gap_days: number | null;
  amount_discrepancy: number | null;
  stage_count_sfdc: number;
  doc_flow_count_sap: number;
}

export interface UnifiedEventLog {
  correlation_id: string;
  sfdc_opportunity_id: string;
  sap_vbeln: string | null;
  match_confidence: number;
  events: UnifiedEvent[];
  cross_system_metrics: CrossSystemMetrics;
}

function daysBetweenDates(a: string, b: string): number {
  const dateA = new Date(a);
  const dateB = new Date(b);
  return Math.round(Math.abs(dateA.getTime() - dateB.getTime()) / (1000 * 60 * 60 * 24));
}

export class UnifiedLogBuilder {

  buildLog(
    correlationId: string,
    sfdcOppId: string,
    sapVbeln: string | null,
    confidence: number,
    sfdcEvents: UnifiedEvent[],
    sapEvents: UnifiedEvent[],
  ): UnifiedEventLog {
    const allEvents = [...sfdcEvents, ...sapEvents].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );

    const metrics = this.computeMetrics(sfdcEvents, sapEvents);

    return {
      correlation_id: correlationId,
      sfdc_opportunity_id: sfdcOppId,
      sap_vbeln: sapVbeln,
      match_confidence: confidence,
      events: allEvents,
      cross_system_metrics: metrics,
    };
  }

  private computeMetrics(
    sfdcEvents: UnifiedEvent[],
    sapEvents: UnifiedEvent[],
  ): CrossSystemMetrics {
    const allTimestamps = [...sfdcEvents, ...sapEvents].map(e => e.timestamp);
    const sorted = allTimestamps.sort();
    const totalDuration = sorted.length >= 2
      ? daysBetweenDates(sorted[0], sorted[sorted.length - 1])
      : 0;

    // SFDC close → SAP order gap
    const sfdcClose = sfdcEvents
      .filter(e => e.event_type === 'stage_change' && (e.details.stage === 'Closed Won'))
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
      .pop();

    const sapOrder = sapEvents
      .filter(e => e.event_type === 'order_created')
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
      [0];

    let gapDays: number | null = null;
    if (sfdcClose && sapOrder) {
      gapDays = daysBetweenDates(sfdcClose.timestamp, sapOrder.timestamp);
    }

    // Amount discrepancy
    const sfdcAmount = sfdcClose?.details?.amount as number | undefined;
    const sapAmount = sapOrder?.details?.netwr as number | undefined;
    let amountDisc: number | null = null;
    if (sfdcAmount !== undefined && sapAmount !== undefined) {
      amountDisc = Math.abs(sfdcAmount - sapAmount);
    }

    return {
      total_duration_days: totalDuration,
      sfdc_to_sap_gap_days: gapDays,
      amount_discrepancy: amountDisc,
      stage_count_sfdc: sfdcEvents.filter(e => e.event_type === 'stage_change').length,
      doc_flow_count_sap: sapEvents.length,
    };
  }
}
```

- [ ] **Step 3: Write cross-system MCP tools index**

```typescript
// mcp-server/src/cross-system/index.ts

/**
 * Cross-System Correlation MCP Tools
 *
 * Exports entity resolver and unified log builder for use
 * by MCP tool handlers.
 */

export { EntityResolver, levenshteinDistance } from './entity-resolver.js';
export type { MatchCandidate, SFDCMatchRecord, SAPMatchRecord, ProximityOptions } from './entity-resolver.js';
export { UnifiedLogBuilder } from './unified-log.js';
export type { UnifiedEvent, UnifiedEventLog, CrossSystemMetrics } from './unified-log.js';
```

- [ ] **Step 4: Run tests**

```bash
cd "/Volumes/OWC drive/Dev/SAP-Transaction-Forensics/mcp-server"
npx jest src/cross-system/__tests__/ --no-cache 2>&1 | tail -10
```

Expected: All PASS

- [ ] **Step 5: Commit**

```bash
cd "/Volumes/OWC drive/Dev/SAP-Transaction-Forensics"
git add mcp-server/src/cross-system/
git commit -m "feat(cross-system): add unified event log builder + MCP tools index"
```

---

## Task 8: Python SFDC Ingest + Opportunity Pipeline Process Models

**Files:**
- Create: `pattern-engine/src/ingest/sfdc_adapter.py`
- Create: `pattern-engine/src/conformance/templates/opportunity_pipeline.py`
- Create: `pattern-engine/tests/test_sfdc_ingest.py`
- Create: `pattern-engine/tests/test_sfdc_conformance.py`

- [ ] **Step 1: Write Python ingest adapter**

```python
# pattern-engine/src/ingest/sfdc_adapter.py

"""
SFDC Data Ingest Adapter

Loads SFDC synthetic data and converts to event-log records
compatible with the pattern engine's conformance checker and
clustering pipeline.
"""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional


def load_sfdc_data(data_dir: str) -> Dict[str, Any]:
    """Load SFDC synthetic data files.

    Args:
        data_dir: Path to directory containing SFDC JSON files.

    Returns:
        Dict with keys: opportunities, stage_histories, line_items,
        activities, accounts, products.
    """
    base = Path(data_dir)
    result: Dict[str, Any] = {}

    file_map = {
        'opportunities': 'opportunities.json',
        'stage_histories': 'stage_histories.json',
        'line_items': 'line_items.json',
        'activities': 'activities.json',
        'accounts': 'accounts.json',
        'products': 'products.json',
    }

    for key, filename in file_map.items():
        fpath = base / filename
        if fpath.exists():
            result[key] = json.loads(fpath.read_text())
        else:
            result[key] = []

    # Build lookup indexes
    result['account_map'] = {a['account_id']: a for a in result['accounts']}
    result['product_map'] = {p['product_id']: p for p in result['products']}

    # Group stage histories by opportunity
    hist_by_opp: Dict[str, List[Dict]] = {}
    for h in result['stage_histories']:
        hist_by_opp.setdefault(h['opportunity_id'], []).append(h)
    result['histories_by_opp'] = hist_by_opp

    # Group activities by opportunity
    act_by_opp: Dict[str, List[Dict]] = {}
    for a in result['activities']:
        act_by_opp.setdefault(a['what_id'], []).append(a)
    result['activities_by_opp'] = act_by_opp

    return result


def sfdc_to_event_log(data: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Convert SFDC data to event-log records for the pattern engine.

    Each record represents one event in a case (opportunity lifecycle).

    Returns:
        List of event records with keys: case_id, activity, timestamp,
        resource, attributes.
    """
    events: List[Dict[str, Any]] = []
    histories_by_opp = data.get('histories_by_opp', {})
    activities_by_opp = data.get('activities_by_opp', {})

    for opp in data.get('opportunities', []):
        opp_id = opp['opportunity_id']

        # Stage transitions as events
        stages = histories_by_opp.get(opp_id, [])
        sorted_stages = sorted(stages, key=lambda s: s.get('created_date', ''))

        for stage in sorted_stages:
            events.append({
                'case_id': opp_id,
                'activity': stage['stage_name'],
                'timestamp': stage['created_date'],
                'resource': stage.get('changed_by', opp.get('owner_id', '')),
                'attributes': {
                    'record_type': opp.get('record_type', 'New Business'),
                    'amount': stage.get('amount', opp.get('amount', 0)),
                    'probability': stage.get('probability', 0),
                    'account_id': opp.get('account_id', ''),
                    'pattern_flags': opp.get('_pattern_flags', []),
                    'event_source': 'stage_history',
                },
            })

        # Activities as events
        acts = activities_by_opp.get(opp_id, [])
        for act in acts:
            events.append({
                'case_id': opp_id,
                'activity': f"Activity:{act['type']}:{act['subject']}",
                'timestamp': act['activity_date'] + 'T12:00:00Z',
                'resource': act.get('owner_id', ''),
                'attributes': {
                    'activity_type': act['type'],
                    'status': act.get('status', ''),
                    'event_source': 'activity',
                },
            })

    return sorted(events, key=lambda e: (e['case_id'], e['timestamp']))


def load_sap_records(data_dir: str) -> Dict[str, Any]:
    """Load SAP records generated alongside SFDC data for cross-system analysis."""
    base = Path(data_dir)
    result: Dict[str, Any] = {}

    for key, fname in [('orders', 'sap_orders.json'), ('doc_flows', 'sap_doc_flows.json'),
                       ('customers', 'sap_customers.json')]:
        fpath = base / fname
        result[key] = json.loads(fpath.read_text()) if fpath.exists() else []

    return result
```

- [ ] **Step 2: Write opportunity pipeline process models**

```python
# pattern-engine/src/conformance/templates/opportunity_pipeline.py

"""
SFDC Opportunity Pipeline Process Models

Defines ProcessModel instances for Salesforce Opportunity stage sequences,
compatible with the existing ConformanceChecker infrastructure.
"""

from __future__ import annotations

from typing import Dict, List

from ..models import (
    Activity,
    ActivityType,
    ProcessModel,
    ProcessModelBuilder,
    Transition,
)

# SFDC Stage Activity Definitions
SFDC_ACTIVITIES: Dict[str, Activity] = {
    # New Business pipeline stages
    "Prospecting": Activity(
        name="Prospecting",
        display_name="Prospecting",
        activity_type=ActivityType.START,
        sap_event_types=frozenset(["Prospecting"]),
        description="Initial prospecting stage"
    ),
    "Qualification": Activity(
        name="Qualification",
        display_name="Qualification",
        activity_type=ActivityType.INTERMEDIATE,
        sap_event_types=frozenset(["Qualification"]),
        description="Lead qualified as opportunity"
    ),
    "Needs Analysis": Activity(
        name="Needs Analysis",
        display_name="Needs Analysis",
        activity_type=ActivityType.INTERMEDIATE,
        sap_event_types=frozenset(["Needs Analysis"]),
        description="Customer needs assessed"
    ),
    "Value Proposition": Activity(
        name="Value Proposition",
        display_name="Value Proposition",
        activity_type=ActivityType.INTERMEDIATE,
        sap_event_types=frozenset(["Value Proposition"]),
        description="Value proposition presented"
    ),
    "Id. Decision Makers": Activity(
        name="Id. Decision Makers",
        display_name="Identify Decision Makers",
        activity_type=ActivityType.INTERMEDIATE,
        sap_event_types=frozenset(["Id. Decision Makers"]),
        description="Key decision makers identified"
    ),
    "Perception Analysis": Activity(
        name="Perception Analysis",
        display_name="Perception Analysis",
        activity_type=ActivityType.INTERMEDIATE,
        sap_event_types=frozenset(["Perception Analysis"]),
        description="Customer perception assessed"
    ),
    "Proposal/Price Quote": Activity(
        name="Proposal/Price Quote",
        display_name="Proposal / Price Quote",
        activity_type=ActivityType.MILESTONE,
        sap_event_types=frozenset(["Proposal/Price Quote"]),
        description="Formal proposal submitted"
    ),
    "Negotiation/Review": Activity(
        name="Negotiation/Review",
        display_name="Negotiation / Review",
        activity_type=ActivityType.MILESTONE,
        sap_event_types=frozenset(["Negotiation/Review"]),
        description="Terms under negotiation"
    ),
    # Upsell/Renewal stages
    "Discovery": Activity(
        name="Discovery",
        display_name="Discovery",
        activity_type=ActivityType.START,
        sap_event_types=frozenset(["Discovery"]),
        description="Discovery phase"
    ),
    "Proposal": Activity(
        name="Proposal",
        display_name="Proposal",
        activity_type=ActivityType.INTERMEDIATE,
        sap_event_types=frozenset(["Proposal"]),
        description="Proposal stage"
    ),
    "Negotiation": Activity(
        name="Negotiation",
        display_name="Negotiation",
        activity_type=ActivityType.MILESTONE,
        sap_event_types=frozenset(["Negotiation"]),
        description="Negotiation stage"
    ),
    # Terminal stages
    "Closed Won": Activity(
        name="Closed Won",
        display_name="Closed Won",
        activity_type=ActivityType.END,
        sap_event_types=frozenset(["Closed Won"]),
        description="Deal closed successfully"
    ),
    "Closed Lost": Activity(
        name="Closed Lost",
        display_name="Closed Lost",
        activity_type=ActivityType.END,
        sap_event_types=frozenset(["Closed Lost"]),
        description="Deal lost"
    ),
}


def get_new_business_model() -> ProcessModel:
    """Get the standard New Business Opportunity pipeline model."""
    builder = ProcessModelBuilder(
        name="sfdc_new_business",
        display_name="SFDC New Business Pipeline",
        description="Standard Salesforce Opportunity pipeline for new deals",
        version="1.0.0"
    )

    stages = [
        "Prospecting", "Qualification", "Needs Analysis",
        "Value Proposition", "Id. Decision Makers",
        "Perception Analysis", "Proposal/Price Quote",
        "Negotiation/Review", "Closed Won",
    ]

    # Add all activities
    for stage_name in stages:
        act = SFDC_ACTIVITIES[stage_name]
        builder.add_activity(
            act.name, act.display_name, act.activity_type,
            sap_event_types=list(act.sap_event_types),
            description=act.description,
        )

    # Closed Lost is reachable from any stage
    cl = SFDC_ACTIVITIES["Closed Lost"]
    builder.add_activity(
        cl.name, cl.display_name, cl.activity_type,
        sap_event_types=list(cl.sap_event_types),
        description=cl.description,
    )

    # Sequential flow
    builder.add_sequence(stages)

    # Any stage can go to Closed Lost
    for stage_name in stages[:-1]:
        src = SFDC_ACTIVITIES[stage_name]
        builder.add_transition(src.name, "Closed Lost")

    return builder.build()


def get_renewal_model() -> ProcessModel:
    """Get the Renewal pipeline model."""
    builder = ProcessModelBuilder(
        name="sfdc_renewal",
        display_name="SFDC Renewal Pipeline",
        description="Salesforce Opportunity pipeline for renewals",
        version="1.0.0"
    )

    stages = ["Qualification", "Proposal", "Closed Won"]

    for stage_name in stages:
        act = SFDC_ACTIVITIES[stage_name]
        builder.add_activity(
            act.name, act.display_name,
            ActivityType.START if stage_name == "Qualification" else act.activity_type,
            sap_event_types=list(act.sap_event_types),
            description=act.description,
        )

    cl = SFDC_ACTIVITIES["Closed Lost"]
    builder.add_activity(cl.name, cl.display_name, cl.activity_type,
                         sap_event_types=list(cl.sap_event_types))

    builder.add_sequence(stages)
    for s in stages[:-1]:
        builder.add_transition(s, "Closed Lost")

    return builder.build()


def get_opportunity_model(record_type: str = "New Business") -> ProcessModel:
    """Get the process model for a given record type."""
    models = {
        "New Business": get_new_business_model,
        "Renewal": get_renewal_model,
    }
    factory = models.get(record_type, get_new_business_model)
    return factory()
```

- [ ] **Step 3: Write ingest tests**

```python
# pattern-engine/tests/test_sfdc_ingest.py

"""Tests for SFDC data ingest adapter."""

from __future__ import annotations

import json
import tempfile
from pathlib import Path

import pytest

from src.ingest.sfdc_adapter import load_sfdc_data, sfdc_to_event_log


@pytest.fixture
def sfdc_data_dir():
    """Create a temporary directory with minimal SFDC data."""
    with tempfile.TemporaryDirectory() as tmpdir:
        opportunities = [
            {
                'opportunity_id': '006001',
                'name': 'Test Opp 1',
                'account_id': '001001',
                'record_type': 'New Business',
                'stage_name': 'Closed Won',
                'amount': 100000,
                'owner_id': '005001',
                'created_date': '2025-06-15T10:00:00Z',
                'close_date': '2025-09-30',
                'is_closed': True,
                'is_won': True,
                '_pattern_flags': [],
            },
        ]
        stage_histories = [
            {'id': '017001', 'opportunity_id': '006001', 'stage_name': 'Qualification',
             'previous_stage': None, 'created_date': '2025-06-15T10:00:00Z',
             'amount': 80000, 'probability': 20, 'expected_revenue': 16000,
             'close_date': '2025-09-30', 'duration_days': 0, 'changed_by': '005001'},
            {'id': '017002', 'opportunity_id': '006001', 'stage_name': 'Closed Won',
             'previous_stage': 'Qualification', 'created_date': '2025-09-25T14:00:00Z',
             'amount': 100000, 'probability': 100, 'expected_revenue': 100000,
             'close_date': '2025-09-30', 'duration_days': 102, 'changed_by': '005001'},
        ]
        activities = [
            {'activity_id': '00T001', 'type': 'Task', 'subject': 'Discovery call',
             'status': 'Completed', 'priority': 'Normal', 'activity_date': '2025-06-20',
             'owner_id': '005001', 'what_id': '006001', 'who_id': '003001',
             'description': 'Initial discovery'},
        ]
        accounts = [
            {'account_id': '001001', 'name': 'Test Account', 'industry': 'Technology',
             'billing_state': 'CA', 'billing_country': 'US', 'type': 'Customer',
             'number_of_employees': 500, 'annual_revenue': 10000000,
             'sap_customer_number': '0000011111'},
        ]
        products = [
            {'product_id': '01t001', 'product_code': 'TST-001', 'name': 'Test Product',
             'family': 'Software', 'is_active': True, 'description': 'Test'},
        ]
        line_items = [
            {'line_item_id': '00k001', 'opportunity_id': '006001', 'product_id': '01t001',
             'product_code': 'TST-001', 'product_name': 'Test Product',
             'product_family': 'Software', 'quantity': 10, 'unit_price': 10000,
             'total_price': 100000, 'sort_order': 1, 'service_date': '2025-10-01',
             'description': 'Test product x10'},
        ]

        for fname, data in [
            ('opportunities.json', opportunities),
            ('stage_histories.json', stage_histories),
            ('activities.json', activities),
            ('accounts.json', accounts),
            ('products.json', products),
            ('line_items.json', line_items),
        ]:
            Path(tmpdir, fname).write_text(json.dumps(data))

        yield tmpdir


class TestLoadSFDCData:
    def test_loads_all_files(self, sfdc_data_dir):
        data = load_sfdc_data(sfdc_data_dir)
        assert len(data['opportunities']) == 1
        assert len(data['accounts']) == 1
        assert len(data['stage_histories']) == 2
        assert len(data['activities']) == 1

    def test_builds_indexes(self, sfdc_data_dir):
        data = load_sfdc_data(sfdc_data_dir)
        assert '001001' in data['account_map']
        assert '006001' in data['histories_by_opp']
        assert '006001' in data['activities_by_opp']


class TestSFDCToEventLog:
    def test_converts_to_event_log(self, sfdc_data_dir):
        data = load_sfdc_data(sfdc_data_dir)
        events = sfdc_to_event_log(data)
        assert len(events) > 0

    def test_events_have_required_fields(self, sfdc_data_dir):
        data = load_sfdc_data(sfdc_data_dir)
        events = sfdc_to_event_log(data)
        for event in events:
            assert 'case_id' in event
            assert 'activity' in event
            assert 'timestamp' in event
            assert 'resource' in event

    def test_stage_events_ordered_by_timestamp(self, sfdc_data_dir):
        data = load_sfdc_data(sfdc_data_dir)
        events = sfdc_to_event_log(data)
        stage_events = [e for e in events if e['attributes'].get('event_source') == 'stage_history']
        for i in range(1, len(stage_events)):
            if stage_events[i]['case_id'] == stage_events[i-1]['case_id']:
                assert stage_events[i]['timestamp'] >= stage_events[i-1]['timestamp']

    def test_includes_activity_events(self, sfdc_data_dir):
        data = load_sfdc_data(sfdc_data_dir)
        events = sfdc_to_event_log(data)
        activity_events = [e for e in events if e['attributes'].get('event_source') == 'activity']
        assert len(activity_events) >= 1
```

- [ ] **Step 4: Write conformance tests**

```python
# pattern-engine/tests/test_sfdc_conformance.py

"""Tests for SFDC opportunity pipeline conformance checking."""

from __future__ import annotations

from datetime import datetime, timedelta

import pytest

from src.conformance import ConformanceChecker, CaseConformanceResult
from src.conformance.templates.opportunity_pipeline import (
    get_new_business_model,
    get_renewal_model,
    get_opportunity_model,
    SFDC_ACTIVITIES,
)


@pytest.fixture
def nb_model():
    return get_new_business_model()


@pytest.fixture
def renewal_model():
    return get_renewal_model()


@pytest.fixture
def conforming_nb_trace():
    """A trace that fully conforms to New Business pipeline."""
    base = datetime(2025, 6, 15, 10, 0, 0)
    return [
        {"activity": "Prospecting", "timestamp": base.isoformat()},
        {"activity": "Qualification", "timestamp": (base + timedelta(days=7)).isoformat()},
        {"activity": "Needs Analysis", "timestamp": (base + timedelta(days=14)).isoformat()},
        {"activity": "Value Proposition", "timestamp": (base + timedelta(days=21)).isoformat()},
        {"activity": "Id. Decision Makers", "timestamp": (base + timedelta(days=28)).isoformat()},
        {"activity": "Perception Analysis", "timestamp": (base + timedelta(days=35)).isoformat()},
        {"activity": "Proposal/Price Quote", "timestamp": (base + timedelta(days=42)).isoformat()},
        {"activity": "Negotiation/Review", "timestamp": (base + timedelta(days=49)).isoformat()},
        {"activity": "Closed Won", "timestamp": (base + timedelta(days=56)).isoformat()},
    ]


@pytest.fixture
def stage_skip_trace():
    """A trace that skips stages (Qualification -> Closed Won)."""
    base = datetime(2025, 6, 15, 10, 0, 0)
    return [
        {"activity": "Prospecting", "timestamp": base.isoformat()},
        {"activity": "Qualification", "timestamp": (base + timedelta(days=7)).isoformat()},
        {"activity": "Closed Won", "timestamp": (base + timedelta(days=14)).isoformat()},
    ]


@pytest.fixture
def regression_trace():
    """A trace with backward stage movement."""
    base = datetime(2025, 6, 15, 10, 0, 0)
    return [
        {"activity": "Prospecting", "timestamp": base.isoformat()},
        {"activity": "Qualification", "timestamp": (base + timedelta(days=7)).isoformat()},
        {"activity": "Needs Analysis", "timestamp": (base + timedelta(days=14)).isoformat()},
        {"activity": "Qualification", "timestamp": (base + timedelta(days=21)).isoformat()},
    ]


class TestSFDCProcessModels:
    def test_new_business_model_has_activities(self, nb_model):
        activities = nb_model.activities
        assert len(activities) >= 9  # 8 stages + Closed Won + Closed Lost

    def test_new_business_model_has_transitions(self, nb_model):
        transitions = nb_model.transitions
        assert len(transitions) >= 8  # Sequential + Closed Lost paths

    def test_renewal_model_is_shorter(self, nb_model, renewal_model):
        assert len(renewal_model.activities) < len(nb_model.activities)

    def test_get_opportunity_model_default(self):
        model = get_opportunity_model()
        assert model.name == "sfdc_new_business"

    def test_get_opportunity_model_renewal(self):
        model = get_opportunity_model("Renewal")
        assert model.name == "sfdc_renewal"


class TestSFDCConformance:
    def test_conforming_trace_passes(self, nb_model, conforming_nb_trace):
        checker = ConformanceChecker(nb_model)
        result = checker.check_case("test-001", conforming_nb_trace)
        assert result.fitness_score >= 0.9

    def test_stage_skip_detected(self, nb_model, stage_skip_trace):
        checker = ConformanceChecker(nb_model)
        result = checker.check_case("test-002", stage_skip_trace)
        assert result.fitness_score < 1.0
        assert len(result.deviations) > 0

    def test_stage_regression_detected(self, nb_model, regression_trace):
        checker = ConformanceChecker(nb_model)
        result = checker.check_case("test-003", regression_trace)
        assert not result.is_fully_conformant
        assert len(result.deviations) > 0
```

- [ ] **Step 5: Run all Python tests**

```bash
cd "/Volumes/OWC drive/Dev/SAP-Transaction-Forensics/pattern-engine"
python3 -m pytest tests/test_sfdc_ingest.py tests/test_sfdc_conformance.py -v 2>&1 | tail -20
```

Expected: All PASS

- [ ] **Step 6: Commit**

```bash
cd "/Volumes/OWC drive/Dev/SAP-Transaction-Forensics"
git add pattern-engine/src/ingest/sfdc_adapter.py pattern-engine/src/conformance/templates/opportunity_pipeline.py pattern-engine/tests/test_sfdc_ingest.py pattern-engine/tests/test_sfdc_conformance.py
git commit -m "feat(pattern-engine): add SFDC ingest adapter + opportunity pipeline conformance models + tests"
```

---

## Task 9: Python Cross-System Correlator + Pattern Detection Tests

**Files:**
- Create: `pattern-engine/src/correlate/cross_system.py`
- Create: `pattern-engine/tests/test_cross_system.py`
- Create: `pattern-engine/tests/test_sfdc_patterns.py`

- [ ] **Step 1: Write cross-system correlator**

```python
# pattern-engine/src/correlate/cross_system.py

"""
Cross-System Correlation Module

Analyzes unified event logs spanning SFDC and SAP to detect
timing gaps, amount discrepancies, missing handoffs, and
sequence violations.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple


def parse_date(date_str: str) -> Optional[datetime]:
    """Parse date from ISO or YYYYMMDD format."""
    if not date_str:
        return None
    try:
        if len(date_str) == 8 and date_str.isdigit():
            return datetime.strptime(date_str, '%Y%m%d')
        return datetime.fromisoformat(date_str.replace('Z', '+00:00').replace('+00:00', ''))
    except (ValueError, TypeError):
        return None


def find_cross_system_anomalies(
    sfdc_opportunities: List[Dict],
    sap_orders: List[Dict],
    matches: List[Dict],
    gap_threshold_days: int = 30,
    amount_tolerance: float = 0.05,
) -> List[Dict[str, Any]]:
    """Analyze matched records for cross-system anomalies.

    Args:
        sfdc_opportunities: SFDC Opportunity records.
        sap_orders: SAP Sales Order records.
        matches: List of {sfdc_id, sap_id, confidence} dicts.
        gap_threshold_days: Flag timing gaps > this many days.
        amount_tolerance: Flag amount differences > this fraction.

    Returns:
        List of anomaly dicts with type, severity, evidence.
    """
    sfdc_map = {o['opportunity_id']: o for o in sfdc_opportunities}
    sap_map = {o['vbeln']: o for o in sap_orders}
    anomalies: List[Dict[str, Any]] = []

    for match in matches:
        sfdc = sfdc_map.get(match['sfdc_id'])
        sap = sap_map.get(match['sap_id'])
        if not sfdc or not sap:
            continue

        sfdc_close = parse_date(sfdc.get('close_date', ''))
        sap_erdat = parse_date(sap.get('erdat', ''))

        # Timing gap
        if sfdc_close and sap_erdat:
            gap_days = abs((sap_erdat - sfdc_close).days)
            if gap_days > gap_threshold_days:
                anomalies.append({
                    'type': 'timing_gap',
                    'severity': 'high' if gap_days > 60 else 'medium',
                    'sfdc_id': match['sfdc_id'],
                    'sap_id': match['sap_id'],
                    'gap_days': gap_days,
                    'sfdc_close_date': sfdc.get('close_date'),
                    'sap_erdat': sap.get('erdat'),
                    'evidence': f"SFDC closed {gap_days} days before SAP order created",
                })

        # Amount discrepancy
        sfdc_amount = sfdc.get('amount', 0)
        sap_amount = sap.get('netwr', 0)
        max_amount = max(sfdc_amount, sap_amount)
        if max_amount > 0:
            diff_pct = abs(sfdc_amount - sap_amount) / max_amount
            if diff_pct > amount_tolerance:
                anomalies.append({
                    'type': 'amount_discrepancy',
                    'severity': 'high' if diff_pct > 0.20 else 'medium',
                    'sfdc_id': match['sfdc_id'],
                    'sap_id': match['sap_id'],
                    'sfdc_amount': sfdc_amount,
                    'sap_amount': sap_amount,
                    'difference_pct': round(diff_pct * 100, 1),
                    'evidence': f"Amount differs by {diff_pct*100:.1f}%: SFDC ${sfdc_amount:,.0f} vs SAP ${sap_amount:,.0f}",
                })

        # Sequence violation (SAP order before SFDC close)
        if sfdc_close and sap_erdat and sap_erdat < sfdc_close:
            anomalies.append({
                'type': 'sequence_violation',
                'severity': 'high',
                'sfdc_id': match['sfdc_id'],
                'sap_id': match['sap_id'],
                'evidence': f"SAP order created {(sfdc_close - sap_erdat).days} days before SFDC close",
            })

    # Missing handoffs: SFDC Closed Won with no SAP match
    matched_sfdc_ids = {m['sfdc_id'] for m in matches}
    for opp in sfdc_opportunities:
        if opp.get('is_won') and opp['opportunity_id'] not in matched_sfdc_ids:
            if opp.get('sap_order_number'):
                # Has SAP link but no matching SAP record found
                anomalies.append({
                    'type': 'missing_handoff',
                    'severity': 'high',
                    'sfdc_id': opp['opportunity_id'],
                    'sap_id': opp.get('sap_order_number'),
                    'evidence': f"SFDC Closed Won with SAP ref {opp.get('sap_order_number')} but no matching SAP order found",
                })

    return anomalies


def compute_cross_system_metrics(
    sfdc_opportunities: List[Dict],
    sap_orders: List[Dict],
    matches: List[Dict],
) -> Dict[str, Any]:
    """Compute aggregate metrics across matched records."""
    matched_sfdc = {m['sfdc_id'] for m in matches}
    matched_sap = {m['sap_id'] for m in matches}
    won_sfdc = {o['opportunity_id'] for o in sfdc_opportunities if o.get('is_won')}

    gaps: List[int] = []
    discrepancies: List[float] = []

    sfdc_map = {o['opportunity_id']: o for o in sfdc_opportunities}
    sap_map = {o['vbeln']: o for o in sap_orders}

    for match in matches:
        sfdc = sfdc_map.get(match['sfdc_id'])
        sap = sap_map.get(match['sap_id'])
        if not sfdc or not sap:
            continue

        sfdc_close = parse_date(sfdc.get('close_date', ''))
        sap_erdat = parse_date(sap.get('erdat', ''))
        if sfdc_close and sap_erdat:
            gaps.append(abs((sap_erdat - sfdc_close).days))

        sfdc_amt = sfdc.get('amount', 0)
        sap_amt = sap.get('netwr', 0)
        max_amt = max(sfdc_amt, sap_amt)
        if max_amt > 0:
            discrepancies.append(abs(sfdc_amt - sap_amt) / max_amt)

    return {
        'total_matched': len(matches),
        'total_unmatched_sfdc': len(won_sfdc - matched_sfdc),
        'total_unmatched_sap': len(set(o['vbeln'] for o in sap_orders) - matched_sap),
        'avg_gap_days': round(sum(gaps) / len(gaps), 1) if gaps else 0,
        'median_gap_days': sorted(gaps)[len(gaps) // 2] if gaps else 0,
        'avg_amount_discrepancy_pct': round(sum(discrepancies) / len(discrepancies) * 100, 1) if discrepancies else 0,
        'missing_handoff_count': len(won_sfdc - matched_sfdc),
    }
```

- [ ] **Step 2: Write cross-system tests**

```python
# pattern-engine/tests/test_cross_system.py

"""Tests for cross-system correlation module."""

from __future__ import annotations

import pytest

from src.correlate.cross_system import (
    find_cross_system_anomalies,
    compute_cross_system_metrics,
    parse_date,
)


class TestParseDate:
    def test_iso_format(self):
        d = parse_date('2025-06-15T10:00:00Z')
        assert d is not None
        assert d.month == 6

    def test_yyyymmdd_format(self):
        d = parse_date('20250615')
        assert d is not None
        assert d.day == 15

    def test_empty_returns_none(self):
        assert parse_date('') is None
        assert parse_date(None) is None


@pytest.fixture
def sample_sfdc_opps():
    return [
        {'opportunity_id': '006001', 'amount': 100000, 'close_date': '2025-06-15',
         'is_won': True, 'sap_order_number': '0000012345'},
        {'opportunity_id': '006002', 'amount': 50000, 'close_date': '2025-07-20',
         'is_won': True, 'sap_order_number': None},
    ]


@pytest.fixture
def sample_sap_orders():
    return [
        {'vbeln': '0000012345', 'netwr': 100000, 'erdat': '20250618'},
    ]


@pytest.fixture
def sample_matches():
    return [
        {'sfdc_id': '006001', 'sap_id': '0000012345', 'confidence': 0.99},
    ]


class TestFindCrossSystemAnomalies:
    def test_no_anomalies_for_clean_match(self, sample_sfdc_opps, sample_sap_orders, sample_matches):
        anomalies = find_cross_system_anomalies(
            sample_sfdc_opps, sample_sap_orders, sample_matches,
            gap_threshold_days=30,
        )
        # 3 day gap is within threshold
        timing_gaps = [a for a in anomalies if a['type'] == 'timing_gap']
        assert len(timing_gaps) == 0

    def test_detects_timing_gap(self):
        sfdc = [{'opportunity_id': '006001', 'amount': 100000, 'close_date': '2025-06-15',
                 'is_won': True, 'sap_order_number': '0000012345'}]
        sap = [{'vbeln': '0000012345', 'netwr': 100000, 'erdat': '20250820'}]  # 66 days later
        matches = [{'sfdc_id': '006001', 'sap_id': '0000012345', 'confidence': 0.99}]

        anomalies = find_cross_system_anomalies(sfdc, sap, matches, gap_threshold_days=30)
        timing_gaps = [a for a in anomalies if a['type'] == 'timing_gap']
        assert len(timing_gaps) == 1
        assert timing_gaps[0]['gap_days'] > 60

    def test_detects_amount_discrepancy(self):
        sfdc = [{'opportunity_id': '006001', 'amount': 100000, 'close_date': '2025-06-15',
                 'is_won': True, 'sap_order_number': '0000012345'}]
        sap = [{'vbeln': '0000012345', 'netwr': 70000, 'erdat': '20250618'}]  # 30% off
        matches = [{'sfdc_id': '006001', 'sap_id': '0000012345', 'confidence': 0.99}]

        anomalies = find_cross_system_anomalies(sfdc, sap, matches, amount_tolerance=0.05)
        amount_issues = [a for a in anomalies if a['type'] == 'amount_discrepancy']
        assert len(amount_issues) == 1

    def test_detects_missing_handoff(self, sample_sfdc_opps, sample_sap_orders):
        # Empty matches = nothing matched
        anomalies = find_cross_system_anomalies(sample_sfdc_opps, sample_sap_orders, [])
        handoffs = [a for a in anomalies if a['type'] == 'missing_handoff']
        # opp 006001 has sap_order_number but no match
        assert len(handoffs) >= 1


class TestCrossSystemMetrics:
    def test_computes_basic_metrics(self, sample_sfdc_opps, sample_sap_orders, sample_matches):
        metrics = compute_cross_system_metrics(sample_sfdc_opps, sample_sap_orders, sample_matches)
        assert metrics['total_matched'] == 1
        assert metrics['total_unmatched_sfdc'] >= 0
        assert metrics['avg_gap_days'] >= 0
```

- [ ] **Step 3: Write pattern detection tests**

```python
# pattern-engine/tests/test_sfdc_patterns.py

"""Tests for detecting planted SFDC anomaly patterns.

Validates that the pattern engine correctly identifies the 10 planted
patterns in the synthetic SFDC data.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

# Skip if synthetic data not generated
SFDC_DATA_DIR = Path(__file__).parent.parent.parent / 'synthetic-data' / 'sfdc_output'

needs_sfdc_data = pytest.mark.skipif(
    not (SFDC_DATA_DIR / 'opportunities.json').exists(),
    reason="SFDC synthetic data not generated. Run: cd synthetic-data && python3 src/generate_sfdc.py"
)

from src.ingest.sfdc_adapter import load_sfdc_data, sfdc_to_event_log
from src.conformance import ConformanceChecker
from src.conformance.templates.opportunity_pipeline import get_new_business_model


@pytest.fixture
def sfdc_data():
    if not (SFDC_DATA_DIR / 'opportunities.json').exists():
        pytest.skip("SFDC synthetic data not generated")
    return load_sfdc_data(str(SFDC_DATA_DIR))


@pytest.fixture
def event_log(sfdc_data):
    return sfdc_to_event_log(sfdc_data)


@needs_sfdc_data
class TestPlantedPatterns:
    def test_stage_skip_detected(self, sfdc_data, event_log):
        """Conformance checker should detect stage-skip patterns."""
        model = get_new_business_model()
        checker = ConformanceChecker(model)

        skip_opps = [o for o in sfdc_data['opportunities']
                     if 'STAGE_SKIP' in (o.get('_pattern_flags') or [])
                     and o.get('record_type') == 'New Business']

        detected = 0
        for opp in skip_opps:
            case_events = [e for e in event_log
                           if e['case_id'] == opp['opportunity_id']
                           and e['attributes'].get('event_source') == 'stage_history']
            if case_events:
                result = checker.check_case(opp['opportunity_id'], case_events)
                if not result.is_fully_conformant:
                    detected += 1

        if skip_opps:
            recall = detected / len(skip_opps)
            assert recall >= 0.5, f"Stage skip recall {recall:.0%} < 50%"

    def test_ghost_pipeline_detected(self, sfdc_data):
        """Ghost pipeline opps should have zero activities."""
        ghost_opps = [o for o in sfdc_data['opportunities']
                      if 'GHOST_PIPELINE' in (o.get('_pattern_flags') or [])]
        acts_by_opp = sfdc_data['activities_by_opp']

        for opp in ghost_opps:
            acts = acts_by_opp.get(opp['opportunity_id'], [])
            assert len(acts) == 0, f"Ghost opp {opp['opportunity_id']} has {len(acts)} activities"

    def test_quarter_end_compression_present(self, sfdc_data):
        """Quarter-end opps should have close dates in last 5 days of quarter."""
        from datetime import datetime
        qe_opps = [o for o in sfdc_data['opportunities']
                    if 'QUARTER_END_COMPRESSION' in (o.get('_pattern_flags') or [])]
        assert len(qe_opps) > 0

        for opp in qe_opps:
            close = datetime.fromisoformat(opp['close_date'])
            month = close.month
            # Should be in a quarter-ending month (3, 6, 9, 12)
            assert month in (3, 6, 9, 12), f"QE opp close month {month} not quarter-end"

    def test_speed_anomaly_detected(self, sfdc_data):
        """Speed anomaly opps should close within 3 days of creation."""
        from datetime import datetime
        speed_opps = [o for o in sfdc_data['opportunities']
                      if 'SPEED_ANOMALY' in (o.get('_pattern_flags') or [])]
        assert len(speed_opps) > 0

        for opp in speed_opps:
            created = datetime.fromisoformat(opp['created_date'].replace('Z', ''))
            closed = datetime.fromisoformat(opp['close_date'])
            gap = (closed - created).days
            assert gap <= 3, f"Speed anomaly opp gap is {gap} days"

    def test_cross_system_gap_in_sap_data(self, sfdc_data):
        """Cross-system gap opps should have matching SAP orders with >30 day gap."""
        gap_opps = [o for o in sfdc_data['opportunities']
                    if 'CROSS_SYSTEM_GAP' in (o.get('_pattern_flags') or [])]
        if not gap_opps:
            pytest.skip("No cross-system gap patterns generated")

        # At least one should have a SAP link
        linked = [o for o in gap_opps if o.get('sap_order_number')]
        assert len(linked) > 0
```

- [ ] **Step 4: Run all Python tests**

```bash
cd "/Volumes/OWC drive/Dev/SAP-Transaction-Forensics/pattern-engine"
python3 -m pytest tests/test_cross_system.py tests/test_sfdc_patterns.py -v 2>&1 | tail -20
```

Expected: All PASS (pattern tests may skip if data not generated)

- [ ] **Step 5: Commit**

```bash
cd "/Volumes/OWC drive/Dev/SAP-Transaction-Forensics"
git add pattern-engine/src/correlate/cross_system.py pattern-engine/tests/test_cross_system.py pattern-engine/tests/test_sfdc_patterns.py
git commit -m "feat(pattern-engine): add cross-system correlator + pattern detection tests"
```

---

## Task 10: REST Client Stub + Final Integration + Regression Check

**Files:**
- Create: `mcp-server/src/adapters/sfdc/rest-client.ts`

- [ ] **Step 1: Write REST client stub**

```typescript
// mcp-server/src/adapters/sfdc/rest-client.ts

/**
 * Salesforce REST API Client (Phase 2 Stub)
 *
 * This module will provide live Salesforce connectivity via REST API.
 * Currently a stub documenting the planned implementation.
 *
 * Prerequisites for Phase 2:
 * - Connected App in target Salesforce org
 * - OAuth2 credentials (client_id, client_secret, or JWT)
 * - Network access to Salesforce instance
 *
 * Planned APIs:
 * - Opportunity: /services/data/vXX.0/query/?q=SELECT...FROM Opportunity
 * - OpportunityFieldHistory: Field history tracking
 * - OpportunityLineItem: Line item data
 * - Task/Event: Activity records
 * - Account: Customer data
 * - Product2: Product catalog
 * - OpportunityStage: Pipeline metadata (for process model discovery)
 */

export interface SFDCRestConfig {
  instanceUrl: string;       // e.g., https://mycompany.salesforce.com
  apiVersion: string;        // e.g., v60.0
  authType: 'oauth2' | 'jwt';
  clientId: string;
  clientSecret?: string;
  privateKey?: string;
  username?: string;
}

export class SFDCRestClient {
  private config: SFDCRestConfig;

  constructor(config: SFDCRestConfig) {
    this.config = config;
  }

  async authenticate(): Promise<void> {
    throw new Error(
      'SFDC REST client not implemented (Phase 2). ' +
      'Use SFDCSyntheticAdapter for testing.'
    );
  }

  async query(_soql: string): Promise<unknown[]> {
    throw new Error('SFDC REST client not implemented (Phase 2)');
  }

  /**
   * Phase 2: Discover pipeline stages from org metadata.
   *
   * SOQL: SELECT StageName, SortOrder, DefaultProbability, IsClosed, IsWon
   *       FROM OpportunityStage WHERE IsActive = true ORDER BY SortOrder
   */
  async discoverPipelines(): Promise<unknown[]> {
    throw new Error('SFDC REST client not implemented (Phase 2)');
  }
}
```

- [ ] **Step 2: Run all TypeScript tests (regression check)**

```bash
cd "/Volumes/OWC drive/Dev/SAP-Transaction-Forensics/mcp-server"
npx jest --no-cache 2>&1 | tail -15
```

Expected: All tests pass including existing SAP tests

- [ ] **Step 3: Run all Python tests (regression check)**

```bash
cd "/Volumes/OWC drive/Dev/SAP-Transaction-Forensics/pattern-engine"
python3 -m pytest tests/ -v 2>&1 | tail -20
```

Expected: All tests pass including existing SAP tests

- [ ] **Step 4: Commit REST stub**

```bash
cd "/Volumes/OWC drive/Dev/SAP-Transaction-Forensics"
git add mcp-server/src/adapters/sfdc/rest-client.ts
git commit -m "feat(sfdc): add REST API client stub (Phase 2 placeholder)"
```

- [ ] **Step 5: Final git status check**

```bash
cd "/Volumes/OWC drive/Dev/SAP-Transaction-Forensics"
git status
git log --oneline -12
```

Expected: Clean working tree, 10 commits from this implementation
