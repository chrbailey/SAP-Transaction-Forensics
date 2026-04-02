/**
 * CSV Adapter with Provenance Logging
 *
 * Factory function that wraps the CSV adapter with the ProvenanceLogger
 * middleware. Every adapter call is recorded in the provenance database
 * with field-level extraction records.
 *
 * The CSV adapter itself is NOT modified -- this is a separate composition
 * layer that consumers opt into by calling createCSVAdapterWithProvenance()
 * instead of constructing CSVAdapter directly.
 */

import { CSVAdapter } from './index.js';
import { ProvenanceDB } from '../../provenance/schema.js';
import { ProvenanceLogger } from '../../provenance/logger.js';
import type { IDataAdapter } from '../adapter-interface.js';

/**
 * Create a CSV adapter wrapped with provenance logging.
 *
 * Every IDataAdapter method call will be intercepted by the ProvenanceLogger,
 * which computes deterministic query/replay hashes, flattens results into
 * field-level ExtractionRecords, and persists them via batch insert.
 *
 * @param filePaths  CSV file path(s) to load -- passed through to CSVAdapter
 * @param provenanceDbPath  Path to the SQLite provenance database (created if absent)
 * @returns The wrapped adapter (IDataAdapter) and the provenance database handle
 */
export function createCSVAdapterWithProvenance(
  filePaths: string | string[],
  provenanceDbPath: string
): { adapter: IDataAdapter; provenanceDb: ProvenanceDB; csvAdapter: CSVAdapter } {
  const csvAdapter = new CSVAdapter(filePaths);
  const provenanceDb = new ProvenanceDB(provenanceDbPath);
  const logger = new ProvenanceLogger(provenanceDb, 'csv', 'SAP');
  const adapter = logger.wrapAdapter(csvAdapter);
  return { adapter, provenanceDb, csvAdapter };
}
