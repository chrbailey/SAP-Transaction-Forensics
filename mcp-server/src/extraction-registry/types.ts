/**
 * Extraction Registry Type Definitions
 *
 * Types for the deterministic extraction path system. Each path is a
 * named, versioned, reproducible query that produces identical results
 * given identical inputs.
 */

import type { SystemType } from '../provenance/types.js';

export type QueryType = 'sql' | 'saved-search' | 'soql' | 'rfc' | 'odata';
export type FieldType = 'string' | 'number' | 'date' | 'amount' | 'boolean';
export type ExtractionDomain = 'o2c' | 'fi-co' | 'p2p' | 'user-audit' | 'pipeline';

/** Definition of a query parameter */
export interface ParameterDefinition {
  name: string;
  type: FieldType;
  required: boolean;
  description: string;
  defaultValue?: string;
}

/** Definition of an expected output field */
export interface FieldDefinition {
  name: string;
  type: FieldType;
  sapFieldName?: string; // Original SAP field name if applicable
  netsuiteName?: string; // Original NetSuite field name if applicable
  sfdcName?: string; // Original Salesforce field name if applicable
  description: string;
}

/** Test expectations for validation against known data */
export interface TestExpectation {
  inputParams: Record<string, string>;
  expectedRowCount?: number;
  expectedHash?: string;
  description?: string;
}

/** A named, versioned, deterministic extraction path */
export interface ExtractionPath {
  id: string; // e.g., 'sap.o2c.order-header'
  version: string; // semver
  name: string; // Human-readable name
  description: string; // What this extracts and why
  systemType: SystemType;
  domain: ExtractionDomain;
  queryType: QueryType;
  query: string; // The actual query text
  parameters: ParameterDefinition[];
  expectedFields: FieldDefinition[];
  testData?: TestExpectation;
}

/** Result of running an extraction path */
export interface ExtractionResult {
  pathId: string;
  pathVersion: string;
  parameters: Record<string, string>;
  rows: Record<string, string>[];
  rowCount: number;
  replayHash: string;
  extractedAt: string; // ISO 8601
}

/** Registry metadata for version tracking */
export interface RegistryMetadata {
  registryVersion: string;
  lastUpdated: string;
  pathCount: number;
  domains: ExtractionDomain[];
  systems: SystemType[];
}
