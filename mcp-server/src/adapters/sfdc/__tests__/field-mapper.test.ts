// mcp-server/src/adapters/sfdc/__tests__/field-mapper.test.ts

import { describe, it, expect } from '@jest/globals';
import { padToLength, formatDateToSAP, extractTime, SFDCFieldMapper } from '../field-mapper.js';
import type {
  SFDCOpportunity,
  SFDCLineItem,
  SFDCStageHistory,
  SFDCActivity,
  SFDCAccount,
  SFDCProduct,
} from '../sfdc-types.js';

// ============================================================================
// Utility Function Tests
// ============================================================================

describe('padToLength', () => {
  it('pads a short string with leading zeros', () => {
    expect(padToLength('abc', 10)).toBe('0000000abc');
  });

  it('returns the string unchanged when already at exact length', () => {
    expect(padToLength('abcdefghij', 10)).toBe('abcdefghij');
  });

  it('truncates a string longer than the target length', () => {
    expect(padToLength('abcdefghijklm', 10)).toBe('abcdefghij');
  });

  it('handles empty string by padding entirely with zeros', () => {
    expect(padToLength('', 6)).toBe('000000');
  });

  it('handles numeric strings', () => {
    expect(padToLength('42', 6)).toBe('000042');
  });
});

describe('formatDateToSAP', () => {
  it('converts ISO datetime to YYYYMMDD', () => {
    expect(formatDateToSAP('2024-03-15T14:30:00.000Z')).toBe('20240315');
  });

  it('converts date-only ISO string to YYYYMMDD', () => {
    expect(formatDateToSAP('2024-03-15')).toBe('20240315');
  });

  it('returns empty string for empty input', () => {
    expect(formatDateToSAP('')).toBe('');
  });

  it('returns empty string for invalid input', () => {
    expect(formatDateToSAP('not-a-date')).toBe('');
  });

  it('handles year/month/day boundary correctly', () => {
    expect(formatDateToSAP('2023-12-31')).toBe('20231231');
  });
});

describe('extractTime', () => {
  it('extracts HHMMSS from ISO datetime', () => {
    expect(extractTime('2024-03-15T14:30:45.000Z')).toBe('143045');
  });

  it('returns 000000 for date-only string', () => {
    expect(extractTime('2024-03-15')).toBe('000000');
  });

  it('handles midnight correctly', () => {
    expect(extractTime('2024-03-15T00:00:00.000Z')).toBe('000000');
  });
});

// ============================================================================
// SFDCFieldMapper Tests
// ============================================================================

const mapper = new SFDCFieldMapper();

// ---- opportunityToSalesDocHeader ----

describe('SFDCFieldMapper.opportunityToSalesDocHeader', () => {
  const baseOpp: SFDCOpportunity = {
    opportunity_id: 'OPP001',
    name: 'Test Opportunity',
    account_id: 'ACC001',
    record_type: 'New Business',
    stage_name: 'Prospecting',
    amount: 50000,
    currency_iso_code: 'USD',
    owner_id: 'USER001',
    created_date: '2024-01-10T09:15:00.000Z',
    close_date: '2024-06-30',
    type: 'New Customer',
    lead_source: 'Web',
    probability: 10,
    forecast_category: 'Pipeline',
    sap_order_number: null,
    is_closed: false,
    is_won: false,
  };

  it('maps opportunity_id to VBELN with 10-char padding', () => {
    const header = mapper.opportunityToSalesDocHeader(baseOpp);
    expect(header.VBELN).toBe('0000OPP001');
  });

  it('maps record_type to AUART via RECORD_TYPE_TO_AUART', () => {
    const header = mapper.opportunityToSalesDocHeader(baseOpp);
    expect(header.AUART).toBe('ZNEW');
  });

  it('uses ZSFX as default AUART for unknown record types', () => {
    const opp = { ...baseOpp, record_type: 'Unknown Type' };
    const header = mapper.opportunityToSalesDocHeader(opp);
    expect(header.AUART).toBe('ZSFX');
  });

  it('sets VKORG to SFDC (lossy default)', () => {
    const header = mapper.opportunityToSalesDocHeader(baseOpp);
    expect(header.VKORG).toBe('SFDC');
  });

  it('maps account_id to KUNNR with 10-char padding', () => {
    const header = mapper.opportunityToSalesDocHeader(baseOpp);
    expect(header.KUNNR).toBe('0000ACC001');
  });

  it('maps amount to NETWR', () => {
    const header = mapper.opportunityToSalesDocHeader(baseOpp);
    expect(header.NETWR).toBe(50000);
  });

  it('maps currency_iso_code to WAERK', () => {
    const header = mapper.opportunityToSalesDocHeader(baseOpp);
    expect(header.WAERK).toBe('USD');
  });

  it('maps created_date to ERDAT and ERZET', () => {
    const header = mapper.opportunityToSalesDocHeader(baseOpp);
    expect(header.ERDAT).toBe('20240110');
    expect(header.ERZET).toBe('091500');
  });

  it('maps owner_id to ERNAM', () => {
    const header = mapper.opportunityToSalesDocHeader(baseOpp);
    expect(header.ERNAM).toBe('USER001');
  });

  it('derives status A for early stage (Prospecting)', () => {
    const header = mapper.opportunityToSalesDocHeader(baseOpp);
    expect(header.GBSTK).toBe('A');
  });

  it('derives status B for mid stage (Proposal/Price Quote)', () => {
    const opp = { ...baseOpp, stage_name: 'Proposal/Price Quote' };
    const header = mapper.opportunityToSalesDocHeader(opp);
    expect(header.GBSTK).toBe('B');
  });

  it('derives status C for Closed Won', () => {
    const opp = { ...baseOpp, stage_name: 'Closed Won', is_closed: true, is_won: true };
    const header = mapper.opportunityToSalesDocHeader(opp);
    expect(header.GBSTK).toBe('C');
  });

  it('derives status X for Closed Lost', () => {
    const opp = { ...baseOpp, stage_name: 'Closed Lost', is_closed: true, is_won: false };
    const header = mapper.opportunityToSalesDocHeader(opp);
    expect(header.GBSTK).toBe('X');
  });

  it('maps close_date to VDATU', () => {
    const header = mapper.opportunityToSalesDocHeader(baseOpp);
    expect(header.VDATU).toBe('20240630');
  });
});

// ---- lineItemToSalesDocItem ----

describe('SFDCFieldMapper.lineItemToSalesDocItem', () => {
  const baseItem: SFDCLineItem = {
    line_item_id: 'LI001',
    opportunity_id: 'OPP001',
    product_id: 'PROD001',
    product_code: 'SKU-ABC',
    product_name: 'Widget Pro',
    product_family: 'Hardware',
    quantity: 3,
    unit_price: 100,
    total_price: 300,
    sort_order: 1,
    service_date: '2024-07-01',
    description: 'Widget Pro line item',
  };

  it('maps opportunity_id to VBELN with 10-char padding', () => {
    const item = mapper.lineItemToSalesDocItem(baseItem, 'USD');
    expect(item.VBELN).toBe('0000OPP001');
  });

  it('maps sort_order to POSNR with 6-char padding', () => {
    const item = mapper.lineItemToSalesDocItem(baseItem, 'USD');
    expect(item.POSNR).toBe('000001');
  });

  it('maps product_code to MATNR with 18-char padding', () => {
    const item = mapper.lineItemToSalesDocItem(baseItem, 'USD');
    expect(item.MATNR).toBe('00000000000SKU-ABC');
  });

  it('maps product_name to ARKTX', () => {
    const item = mapper.lineItemToSalesDocItem(baseItem, 'USD');
    expect(item.ARKTX).toBe('Widget Pro');
  });

  it('sets WERKS to SFDC', () => {
    const item = mapper.lineItemToSalesDocItem(baseItem, 'USD');
    expect(item.WERKS).toBe('SFDC');
  });

  it('maps quantity to KWMENG', () => {
    const item = mapper.lineItemToSalesDocItem(baseItem, 'USD');
    expect(item.KWMENG).toBe(3);
  });

  it('maps total_price to NETWR', () => {
    const item = mapper.lineItemToSalesDocItem(baseItem, 'USD');
    expect(item.NETWR).toBe(300);
  });

  it('passes currency to WAERK', () => {
    const item = mapper.lineItemToSalesDocItem(baseItem, 'EUR');
    expect(item.WAERK).toBe('EUR');
  });
});

// ---- stageHistoryToDocFlow ----

describe('SFDCFieldMapper.stageHistoryToDocFlow', () => {
  const stages: SFDCStageHistory[] = [
    {
      id: 'SH002',
      opportunity_id: 'OPP001',
      stage_name: 'Qualification',
      previous_stage: 'Prospecting',
      created_date: '2024-01-20T10:00:00.000Z',
      amount: 50000,
      probability: 20,
      expected_revenue: 10000,
      close_date: '2024-06-30',
      duration_days: 10,
      changed_by: 'USER001',
    },
    {
      id: 'SH001',
      opportunity_id: 'OPP001',
      stage_name: 'Prospecting',
      previous_stage: null,
      created_date: '2024-01-10T09:00:00.000Z',
      amount: 50000,
      probability: 10,
      expected_revenue: 5000,
      close_date: '2024-06-30',
      duration_days: 0,
      changed_by: 'USER001',
    },
  ];

  it('sets root_document to padded opportunity_id', () => {
    const result = mapper.stageHistoryToDocFlow('OPP001', stages);
    expect(result.root_document).toBe('0000OPP001');
  });

  it('returns flow entries sorted chronologically', () => {
    const result = mapper.stageHistoryToDocFlow('OPP001', stages);
    expect(result.flow[0].created_date).toBe('20240110');
    expect(result.flow[1].created_date).toBe('20240120');
  });

  it('maps each stage to a flow entry with correct doc_type', () => {
    const result = mapper.stageHistoryToDocFlow('OPP001', stages);
    expect(result.flow[0].doc_type).toBe('SFDC_STAGE');
  });

  it('uses stage_name as doc_category', () => {
    const result = mapper.stageHistoryToDocFlow('OPP001', stages);
    expect(result.flow[0].doc_category).toBe('Prospecting');
  });

  it('includes created_time in each flow entry', () => {
    const result = mapper.stageHistoryToDocFlow('OPP001', stages);
    expect(result.flow[0].created_time).toBe('090000');
  });

  it('returns one flow entry per stage history record', () => {
    const result = mapper.stageHistoryToDocFlow('OPP001', stages);
    expect(result.flow.length).toBe(2);
  });
});

// ---- activityToDocText ----

describe('SFDCFieldMapper.activityToDocText', () => {
  const taskActivity: SFDCActivity = {
    activity_id: 'ACT001',
    type: 'Task',
    subject: 'Follow up call',
    status: 'Completed',
    priority: 'High',
    activity_date: '2024-02-15',
    owner_id: 'USER001',
    what_id: 'OPP001',
    who_id: null,
    description: 'Called prospect to discuss pricing.',
  };

  const eventActivity: SFDCActivity = {
    activity_id: 'ACT002',
    type: 'Event',
    subject: 'Demo Session',
    status: 'Held',
    priority: 'Normal',
    activity_date: '2024-02-20',
    owner_id: 'USER002',
    what_id: 'OPP001',
    who_id: 'CON001',
    description: 'Product demonstration.',
  };

  it('maps Task type to text_id TASK', () => {
    const entry = mapper.activityToDocText(taskActivity);
    expect(entry.text_id).toBe('TASK');
  });

  it('maps Event type to text_id EVNT', () => {
    const entry = mapper.activityToDocText(eventActivity);
    expect(entry.text_id).toBe('EVNT');
  });

  it('includes subject in text content', () => {
    const entry = mapper.activityToDocText(taskActivity);
    expect(entry.text).toContain('Follow up call');
  });

  it('includes description in text content', () => {
    const entry = mapper.activityToDocText(taskActivity);
    expect(entry.text).toContain('Called prospect to discuss pricing.');
  });

  it('uses EN as language', () => {
    const entry = mapper.activityToDocText(taskActivity);
    expect(entry.lang).toBe('EN');
  });
});

// ---- activitiesToDocText ----

describe('SFDCFieldMapper.activitiesToDocText', () => {
  const activities: SFDCActivity[] = [
    {
      activity_id: 'ACT001',
      type: 'Task',
      subject: 'Call',
      status: 'Completed',
      priority: 'Normal',
      activity_date: '2024-02-15',
      owner_id: 'USER001',
      what_id: 'OPP001',
      who_id: null,
      description: 'Prospecting call.',
    },
    {
      activity_id: 'ACT002',
      type: 'Event',
      subject: 'Demo',
      status: 'Held',
      priority: 'Normal',
      activity_date: '2024-02-20',
      owner_id: 'USER001',
      what_id: 'OPP001',
      who_id: null,
      description: 'Demo session.',
    },
  ];

  it('returns header_texts for each activity', () => {
    const result = mapper.activitiesToDocText('OPP001', activities);
    expect(result.header_texts.length).toBe(2);
  });

  it('returns empty item_texts array', () => {
    const result = mapper.activitiesToDocText('OPP001', activities);
    expect(result.item_texts).toEqual([]);
  });

  it('includes changed_at from activity_date', () => {
    const result = mapper.activitiesToDocText('OPP001', activities);
    expect(result.header_texts[0].changed_at).toBe('20240215');
  });
});

// ---- accountToMasterStub ----

describe('SFDCFieldMapper.accountToMasterStub', () => {
  const account: SFDCAccount = {
    account_id: 'ACC001',
    name: 'Acme Corporation',
    industry: 'Technology',
    billing_state: 'CA',
    billing_country: 'US',
    type: 'Customer',
    number_of_employees: 500,
    annual_revenue: 10000000,
    sap_customer_number: null,
  };

  it('sets ENTITY_TYPE to customer', () => {
    const stub = mapper.accountToMasterStub(account);
    expect(stub.ENTITY_TYPE).toBe('customer');
  });

  it('sets ID to account_id', () => {
    const stub = mapper.accountToMasterStub(account);
    expect(stub.ID).toBe('ACC001');
  });

  it('maps industry to INDUSTRY', () => {
    const stub = mapper.accountToMasterStub(account);
    expect(stub.INDUSTRY).toBe('Technology');
  });

  it('maps billing_state to REGION', () => {
    const stub = mapper.accountToMasterStub(account);
    expect(stub.REGION).toBe('CA');
  });

  it('maps type to CATEGORY', () => {
    const stub = mapper.accountToMasterStub(account);
    expect(stub.CATEGORY).toBe('Customer');
  });

  it('does not include PII: name', () => {
    const stub = mapper.accountToMasterStub(account);
    expect(stub).not.toHaveProperty('name');
  });

  it('does not include PII: annual_revenue', () => {
    const stub = mapper.accountToMasterStub(account);
    expect(stub).not.toHaveProperty('annual_revenue');
  });

  it('does not include PII: number_of_employees', () => {
    const stub = mapper.accountToMasterStub(account);
    expect(stub).not.toHaveProperty('number_of_employees');
  });
});

// ---- productToMasterStub ----

describe('SFDCFieldMapper.productToMasterStub', () => {
  const product: SFDCProduct = {
    product_id: 'PROD001',
    product_code: 'SKU-XYZ',
    name: 'Widget Pro',
    family: 'Hardware',
    is_active: true,
    description: 'A professional widget.',
  };

  it('sets ENTITY_TYPE to material', () => {
    const stub = mapper.productToMasterStub(product);
    expect(stub.ENTITY_TYPE).toBe('material');
  });

  it('sets ID to product_id', () => {
    const stub = mapper.productToMasterStub(product);
    expect(stub.ID).toBe('PROD001');
  });

  it('maps family to MATKL (material group)', () => {
    const stub = mapper.productToMasterStub(product);
    expect(stub.MATKL).toBe('Hardware');
  });

  it('does not include PII: name', () => {
    const stub = mapper.productToMasterStub(product);
    expect(stub).not.toHaveProperty('name');
  });

  it('does not include description', () => {
    const stub = mapper.productToMasterStub(product);
    expect(stub).not.toHaveProperty('description');
  });
});
