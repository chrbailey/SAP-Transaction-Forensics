// mcp-server/src/adapters/sfdc/field-mapper.ts

/**
 * SFDC → SAP Field Mapper
 *
 * Normalizes Salesforce data into SAP type contracts.
 * All mappings are lossy where noted — SAP concepts without SFDC equivalents
 * are set to safe sentinel values (e.g., VKORG='SFDC', WERKS='SFDC').
 */

import type {
  SFDCOpportunity,
  SFDCLineItem,
  SFDCStageHistory,
  SFDCActivity,
  SFDCAccount,
  SFDCProduct,
} from './sfdc-types.js';
import { RECORD_TYPE_TO_AUART, STAGE_STATUS_MAP } from './sfdc-types.js';
import type {
  SalesDocHeader,
  SalesDocItem,
  DocFlowResult,
  DocTextResult,
  MasterStub,
} from '../../types/index.js';

// ============================================================================
// Utility Functions (exported for testing)
// ============================================================================

/**
 * Pad a string with leading zeros to the target length.
 * If the value is already longer, truncate to the target length.
 */
export function padToLength(value: string, len: number): string {
  if (value.length >= len) {
    return value.slice(0, len);
  }
  return value.padStart(len, '0');
}

/**
 * Convert ISO 8601 date/datetime string to SAP date format YYYYMMDD.
 * Returns empty string on invalid or empty input.
 */
export function formatDateToSAP(isoDate: string): string {
  if (!isoDate) return '';
  // Extract date portion: works for both '2024-03-15' and '2024-03-15T14:30:00.000Z'
  const datePart = isoDate.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart)) return '';
  return datePart.replace(/-/g, '');
}

/**
 * Extract HHMMSS time component from an ISO 8601 datetime string.
 * Returns '000000' if no time component is present.
 */
export function extractTime(isoDate: string): string {
  if (!isoDate) return '000000';
  // Look for 'T' separator indicating a datetime string
  const tIndex = isoDate.indexOf('T');
  if (tIndex === -1) return '000000';
  const timePart = isoDate.slice(tIndex + 1, tIndex + 9); // 'HH:MM:SS'
  if (timePart.length < 8) return '000000';
  return timePart.replace(/:/g, '').slice(0, 6);
}

// ============================================================================
// SFDCFieldMapper Class
// ============================================================================

export class SFDCFieldMapper {
  /**
   * Map a Salesforce Opportunity to a SAP Sales Document Header (VBAK shape).
   */
  opportunityToSalesDocHeader(opp: SFDCOpportunity): SalesDocHeader {
    return {
      VBELN: padToLength(opp.opportunity_id, 10),
      AUART: RECORD_TYPE_TO_AUART[opp.record_type] ?? 'ZSFX',
      VKORG: 'SFDC', // lossy — no direct SFDC equivalent
      VTWEG: '00',   // no distribution channel concept in SFDC
      SPART: '00',   // no division concept in SFDC
      KUNNR: padToLength(opp.account_id, 10),
      AUDAT: formatDateToSAP(opp.created_date),
      VDATU: formatDateToSAP(opp.close_date),
      ERNAM: opp.owner_id,
      ERDAT: formatDateToSAP(opp.created_date),
      ERZET: extractTime(opp.created_date),
      GBSTK: STAGE_STATUS_MAP[opp.stage_name] ?? 'A',
      NETWR: opp.amount,
      WAERK: opp.currency_iso_code,
    };
  }

  /**
   * Map a Salesforce Line Item to a SAP Sales Document Item (VBAP shape).
   */
  lineItemToSalesDocItem(item: SFDCLineItem, currency: string): SalesDocItem {
    return {
      VBELN: padToLength(item.opportunity_id, 10),
      POSNR: padToLength(item.sort_order.toString(), 6),
      MATNR: padToLength(item.product_code, 18),
      ARKTX: item.product_name,
      WERKS: 'SFDC', // lossy — no plant concept in SFDC
      KWMENG: item.quantity,
      VRKME: 'EA',   // default unit of measure; SFDC has no UoM
      NETWR: item.total_price,
      WAERK: currency,
      PSTYV: 'TAN',  // standard item category default
    };
  }

  /**
   * Map Salesforce Stage History entries to a SAP Document Flow result.
   * Stages are sorted chronologically ascending.
   */
  stageHistoryToDocFlow(oppId: string, stages: SFDCStageHistory[]): DocFlowResult {
    const sorted = [...stages].sort(
      (a, b) => new Date(a.created_date).getTime() - new Date(b.created_date).getTime()
    );

    return {
      root_document: padToLength(oppId, 10),
      flow: sorted.map((stage) => ({
        doc_type: 'SFDC_STAGE',
        doc_number: padToLength(stage.id, 10),
        doc_category: stage.stage_name,
        status: STAGE_STATUS_MAP[stage.stage_name],
        created_date: formatDateToSAP(stage.created_date),
        created_time: extractTime(stage.created_date),
        items: [],
      })),
    };
  }

  /**
   * Map a single SFDCActivity to a DocTextResult header_text entry shape.
   */
  activityToDocText(activity: SFDCActivity): {
    text_id: string;
    lang: string;
    text: string;
    changed_at: string;
  } {
    const textId = activity.type === 'Task' ? 'TASK' : 'EVNT';
    const text = [activity.subject, activity.description]
      .filter(Boolean)
      .join(' | ');

    return {
      text_id: textId,
      lang: 'EN',
      text,
      changed_at: formatDateToSAP(activity.activity_date),
    };
  }

  /**
   * Map a list of Salesforce Activities to a SAP DocTextResult.
   * Activities appear as header texts; item_texts is always empty (no item association).
   */
  activitiesToDocText(oppId: string, activities: SFDCActivity[]): DocTextResult {
    return {
      header_texts: activities.map((act) => this.activityToDocText(act)),
      item_texts: [],
    };
  }

  /**
   * Map a Salesforce Account to a safe MasterStub (customer).
   * Only non-PII fields are included: industry, region, category.
   */
  accountToMasterStub(account: SFDCAccount): MasterStub {
    return {
      ENTITY_TYPE: 'customer',
      ID: account.account_id,
      INDUSTRY: account.industry,
      REGION: account.billing_state,
      CATEGORY: account.type,
    };
  }

  /**
   * Map a Salesforce Product to a safe MasterStub (material).
   * Only non-PII fields are included: family/material group.
   */
  productToMasterStub(product: SFDCProduct): MasterStub {
    return {
      ENTITY_TYPE: 'material',
      ID: product.product_id,
      MATKL: product.family,
    };
  }
}
