/**
 * SFDC Adapter with Provenance Logging
 *
 * Factory function that wraps a pre-configured SFDC adapter instance
 * with provenance logging. Does NOT modify the adapter class itself --
 * all logging is handled by the ProvenanceLogger decorator.
 */

import { ProvenanceDB } from '../../provenance/schema.js';
import { ProvenanceLogger } from '../../provenance/logger.js';
import type { IDataAdapter } from '../adapter-interface.js';

/**
 * Create an SFDC adapter wrapped with provenance logging.
 * System type is 'Salesforce' for the SFDC adapter.
 */
export function createSFDCAdapterWithProvenance(
  sfdcAdapter: IDataAdapter,
  provenanceDbPath: string
): { adapter: IDataAdapter; provenanceDb: ProvenanceDB } {
  const provenanceDb = new ProvenanceDB(provenanceDbPath);
  const logger = new ProvenanceLogger(provenanceDb, 'sfdc', 'Salesforce');
  const wrappedAdapter = logger.wrapAdapter(sfdcAdapter);
  return { adapter: wrappedAdapter, provenanceDb };
}
