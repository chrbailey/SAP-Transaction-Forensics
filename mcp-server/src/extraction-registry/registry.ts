/**
 * Extraction Registry — Public API
 *
 * Named, versioned, deterministic extraction paths for
 * SAP, NetSuite, and Salesforce systems.
 */

// Types
export type {
  QueryType,
  FieldType,
  ExtractionDomain,
  ParameterDefinition,
  FieldDefinition,
  TestExpectation,
  ExtractionPath,
  ExtractionResult,
  RegistryMetadata,
} from './types.js';

// Core registry
export { ExtractionRegistry } from './index.js';

// Metadata utilities
export {
  validatePathId,
  validateVersion,
  compareVersions,
  validatePath,
  generateRegistrySummary,
} from './metadata.js';

// SAP extraction paths
export { SAP_O2C_PATHS } from './sap/o2c.js';
export { SAP_FICO_PATHS } from './sap/fi-co.js';
export { SAP_P2P_PATHS } from './sap/p2p.js';

// SFDC extraction paths
export { SFDC_PIPELINE_PATHS } from './sfdc/pipeline.js';

// NetSuite extraction paths
export { NETSUITE_USER_AUDIT_PATHS } from './netsuite/user-audit.js';

// All paths combined
import { SAP_O2C_PATHS } from './sap/o2c.js';
import { SAP_FICO_PATHS } from './sap/fi-co.js';
import { SAP_P2P_PATHS } from './sap/p2p.js';
import { SFDC_PIPELINE_PATHS } from './sfdc/pipeline.js';
import { NETSUITE_USER_AUDIT_PATHS } from './netsuite/user-audit.js';
import { ExtractionRegistry } from './index.js';

export const ALL_EXTRACTION_PATHS = [
  ...SAP_O2C_PATHS,
  ...SAP_FICO_PATHS,
  ...SAP_P2P_PATHS,
  ...SFDC_PIPELINE_PATHS,
  ...NETSUITE_USER_AUDIT_PATHS,
];

/** Create a pre-loaded registry with all built-in paths */
export function createDefaultRegistry(): ExtractionRegistry {
  const registry = new ExtractionRegistry();
  registry.registerAll(ALL_EXTRACTION_PATHS);
  return registry;
}
