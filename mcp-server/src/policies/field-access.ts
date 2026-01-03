/**
 * Field Access Policy
 *
 * Controls which fields can be accessed through the MCP tools.
 * Implements a whitelist approach to prevent exposure of:
 * - PII (Personally Identifiable Information)
 * - Sensitive business data
 * - Internal system fields
 *
 * Each document type has a defined set of allowed fields.
 * Any attempt to access forbidden fields will be blocked.
 */

import { AuditContext } from '../logging/audit-logger.js';

/**
 * Document types for field access control
 */
export type DocumentType =
  | 'sales_header'
  | 'sales_item'
  | 'sales_text'
  | 'delivery_header'
  | 'delivery_item'
  | 'invoice_header'
  | 'invoice_item'
  | 'master_customer'
  | 'master_vendor'
  | 'master_material'
  | 'doc_flow';

/**
 * Field access whitelist by document type
 *
 * Only these fields can be returned through the MCP tools.
 * Fields not in this list will be stripped from responses.
 */
export const ALLOWED_FIELDS: Record<DocumentType, readonly string[]> = {
  sales_header: [
    'VBELN', // Document number
    'AUART', // Document type
    'VKORG', // Sales organization
    'VTWEG', // Distribution channel
    'SPART', // Division
    'KUNNR', // Customer (ID only, no name)
    'KUNWE', // Ship-to party (ID only)
    'AUDAT', // Document date
    'VDATU', // Requested delivery date
    'ERNAM', // Created by (user ID)
    'ERDAT', // Created on
    'ERZET', // Created at
    'AENAM', // Changed by
    'AEDAT', // Changed on
    'GBSTK', // Overall status
    'NETWR', // Net value
    'WAERK', // Currency
    'BSTNK', // PO number
  ] as const,

  sales_item: [
    'VBELN', // Document number
    'POSNR', // Item number
    'MATNR', // Material number
    'ARKTX', // Item description
    'WERKS', // Plant
    'LGORT', // Storage location
    'KWMENG', // Order quantity
    'VRKME', // Sales unit
    'NETWR', // Net value
    'WAERK', // Currency
    'PSTYV', // Item category
    'ABGRU', // Rejection reason
    'EDATU', // Schedule line date
    'KBMENG', // Confirmed quantity
    'LIFSP', // Delivery block
    'FAKSP', // Billing block
  ] as const,

  sales_text: [
    'VBELN', // Document number
    'POSNR', // Item number
    'TDID', // Text ID
    'SPRAS', // Language
    'TEXT', // Text content
    'AENAM', // Changed by
    'AEDAT', // Changed on
  ] as const,

  delivery_header: [
    'VBELN', // Delivery number
    'LFART', // Delivery type
    'VSTEL', // Shipping point
    'ROUTE', // Route
    'KUNNR', // Ship-to party (ID only)
    'WADAT', // Planned GI date
    'WADAT_IST', // Actual GI date
    'LFDAT', // Delivery date
    'LDDAT', // Loading date
    'TDDAT', // Transport date
    'KOSTK', // Pick/pack status
    'WBSTK', // Goods movement status
    'GBSTK', // Overall status
    'BTGEW', // Total weight
    'GEWEI', // Weight unit
    'ERNAM', // Created by
    'ERDAT', // Created on
    'ERZET', // Created at
  ] as const,

  delivery_item: [
    'VBELN', // Delivery number
    'POSNR', // Item number
    'MATNR', // Material number
    'ARKTX', // Description
    'WERKS', // Plant
    'LGORT', // Storage location
    'LFIMG', // Delivery quantity
    'VRKME', // Sales unit
    'PIKMG', // Picked quantity
    'VGBEL', // Reference document
    'VGPOS', // Reference item
    'CHARG', // Batch
  ] as const,

  invoice_header: [
    'VBELN', // Invoice number
    'FKART', // Billing type
    'FKDAT', // Billing date
    'KUNRG', // Payer (ID only)
    'KUNAG', // Sold-to (ID only)
    'VKORG', // Sales organization
    'VTWEG', // Distribution channel
    'SPART', // Division
    'NETWR', // Net value
    'WAERK', // Currency
    'MWSBK', // Tax amount
    'BELNR', // Accounting document
    'GJAHR', // Fiscal year
    'BUDAT', // Posting date
    'FKSTO', // Billing status
    'ERNAM', // Created by
    'ERDAT', // Created on
    'ERZET', // Created at
  ] as const,

  invoice_item: [
    'VBELN', // Invoice number
    'POSNR', // Item number
    'MATNR', // Material number
    'ARKTX', // Description
    'FKIMG', // Billed quantity
    'VRKME', // Sales unit
    'NETWR', // Net value
    'WAERK', // Currency
    'VGBEL', // Reference document
    'VGPOS', // Reference item
    'AUBEL', // Sales order
    'AUPOS', // Sales order item
    'WERKS', // Plant
  ] as const,

  master_customer: [
    'ENTITY_TYPE', // Entity type
    'ID', // Customer ID
    'HASHED_ID', // Hashed ID
    'INDUSTRY', // Industry classification
    'REGION', // Geographic region (coarse)
    'CATEGORY', // Customer category/tier
    'KTOKD', // Account group
    'ERDAT', // Created on
  ] as const,

  master_vendor: [
    'ENTITY_TYPE', // Entity type
    'ID', // Vendor ID
    'HASHED_ID', // Hashed ID
    'INDUSTRY', // Industry classification
    'REGION', // Geographic region (coarse)
    'CATEGORY', // Vendor category
    'KTOKK', // Account group
    'ERDAT', // Created on
  ] as const,

  master_material: [
    'ENTITY_TYPE', // Entity type
    'ID', // Material ID
    'HASHED_ID', // Hashed ID
    'CATEGORY', // Material category
    'MTART', // Material type
    'MATKL', // Material group
    'SPART', // Division
    'ERDAT', // Created on
  ] as const,

  doc_flow: [
    'VBELV', // Preceding document
    'POSNV', // Preceding item
    'VBELN', // Subsequent document
    'POSNN', // Subsequent item
    'VBTYP_V', // Preceding category
    'VBTYP_N', // Subsequent category
    'RFMNG', // Reference quantity
    'RFWRT', // Reference value
    'ERDAT', // Created on
    'ERZET', // Created at
  ] as const,
} as const;

/**
 * Absolutely forbidden fields - NEVER expose these
 * These contain PII or sensitive data
 */
export const FORBIDDEN_FIELDS: readonly string[] = [
  // Personal names
  'NAME1',
  'NAME2',
  'NAME3',
  'NAME4',
  'NAMEV',
  'MCOD1',
  'MCOD2',
  'MCOD3',
  // Addresses
  'STRAS',
  'STRS2',
  'HAUSN',
  'PSTLZ',
  'ORT01',
  'ORT02',
  'LAND1',
  'REGIO',
  'PSTL2',
  'PFACH',
  'PFORT',
  // Contact information
  'TELF1',
  'TELF2',
  'TELFX',
  'TELX1',
  'TELTX',
  'TELBX',
  'SMTP_ADDR',
  'EMAIL',
  // Banking information
  'BANKL',
  'BANKN',
  'BKONT',
  'BANKA',
  'IBAN',
  'SWIFT',
  'KOINH',
  // Tax IDs and government IDs
  'STCEG',
  'STCD1',
  'STCD2',
  'STCD3',
  'STCD4',
  'STCD5',
  'STKZN',
  'STKZU',
  // Credit and financial
  'KLIMK',
  'CTLPC',
  'SKFOR',
  'CRBLB',
  // Authentication/Security
  'USNAM',
  'BNAME',
  'PASS',
  'CODVN',
  'USTYP',
  // GPS/Location
  'LATITUDE',
  'LONGITUDE',
  'ALTITUDE',
] as const;

/**
 * Field access configuration
 */
export interface FieldAccessConfig {
  /** Whether to enforce field restrictions */
  enforceRestrictions: boolean;
  /** Whether to log blocked field access attempts */
  logBlockedAccess: boolean;
  /** Whether to strip forbidden fields from output silently */
  silentStrip: boolean;
}

const DEFAULT_CONFIG: FieldAccessConfig = {
  enforceRestrictions: true,
  logBlockedAccess: true,
  silentStrip: true,
};

let currentConfig: FieldAccessConfig = { ...DEFAULT_CONFIG };

/**
 * Update field access configuration
 */
export function updateFieldAccessConfig(updates: Partial<FieldAccessConfig>): void {
  currentConfig = { ...currentConfig, ...updates };
}

/**
 * Get current field access configuration
 */
export function getFieldAccessConfig(): FieldAccessConfig {
  return { ...currentConfig };
}

/**
 * Check if a field is allowed for a document type
 */
export function isFieldAllowed(docType: DocumentType, fieldName: string): boolean {
  // First check if it's forbidden
  if (FORBIDDEN_FIELDS.includes(fieldName)) {
    return false;
  }

  // Then check if it's in the allowed list
  const allowedFields = ALLOWED_FIELDS[docType];
  return allowedFields.includes(fieldName as never);
}

/**
 * Check if a field is explicitly forbidden
 */
export function isFieldForbidden(fieldName: string): boolean {
  return FORBIDDEN_FIELDS.includes(fieldName);
}

/**
 * Result of field validation
 */
export interface FieldValidationResult {
  valid: boolean;
  allowedFields: string[];
  forbiddenFields: string[];
  unknownFields: string[];
}

/**
 * Validate a list of fields against the allowed list
 */
export function validateFields(docType: DocumentType, fields: string[]): FieldValidationResult {
  const allowedFields = ALLOWED_FIELDS[docType];
  const result: FieldValidationResult = {
    valid: true,
    allowedFields: [],
    forbiddenFields: [],
    unknownFields: [],
  };

  for (const field of fields) {
    if (FORBIDDEN_FIELDS.includes(field)) {
      result.forbiddenFields.push(field);
      result.valid = false;
    } else if (allowedFields.includes(field as never)) {
      result.allowedFields.push(field);
    } else {
      result.unknownFields.push(field);
    }
  }

  return result;
}

/**
 * Strip forbidden and unknown fields from an object
 */
export function stripForbiddenFields<T extends Record<string, unknown>>(
  docType: DocumentType,
  data: T,
  auditContext?: AuditContext
): Partial<T> {
  if (!currentConfig.enforceRestrictions) {
    return data;
  }

  const allowedFields = ALLOWED_FIELDS[docType];
  const result: Partial<T> = {};
  const strippedFields: string[] = [];

  for (const [key, value] of Object.entries(data)) {
    if (FORBIDDEN_FIELDS.includes(key)) {
      strippedFields.push(key);
    } else if (allowedFields.includes(key as never)) {
      (result as Record<string, unknown>)[key] = value;
    } else {
      // Unknown field - strip it but log
      strippedFields.push(key);
    }
  }

  if (strippedFields.length > 0 && currentConfig.logBlockedAccess && auditContext) {
    auditContext.policyViolation('fields_stripped', {
      doc_type: docType,
      stripped_fields: strippedFields,
    });
  }

  return result;
}

/**
 * Strip forbidden fields from an array of objects
 */
export function stripForbiddenFieldsArray<T extends Record<string, unknown>>(
  docType: DocumentType,
  data: T[],
  auditContext?: AuditContext
): Partial<T>[] {
  return data.map((item, index) =>
    stripForbiddenFields(docType, item, index === 0 ? auditContext : undefined)
  );
}

/**
 * Field access error class
 */
export class FieldAccessError extends Error {
  readonly forbiddenFields: string[];
  readonly docType: DocumentType;

  constructor(docType: DocumentType, forbiddenFields: string[]) {
    super(`Access to forbidden fields denied: ${forbiddenFields.join(', ')}`);
    this.name = 'FieldAccessError';
    this.docType = docType;
    this.forbiddenFields = forbiddenFields;
  }
}

/**
 * Assert that no forbidden fields are being accessed
 */
export function assertNoForbiddenFields(
  docType: DocumentType,
  fields: string[],
  auditContext?: AuditContext
): void {
  const validation = validateFields(docType, fields);

  if (validation.forbiddenFields.length > 0) {
    if (auditContext) {
      auditContext.policyViolation('forbidden_field_access_attempt', {
        doc_type: docType,
        forbidden_fields: validation.forbiddenFields,
      });
    }
    throw new FieldAccessError(docType, validation.forbiddenFields);
  }
}
