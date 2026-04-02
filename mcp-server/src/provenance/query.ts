/**
 * Provenance Query API
 *
 * "Show your work" capability — given a finding ID, reconstruct the
 * complete evidence chain from finding → evidence → extraction records.
 * Designed to work against any ProvenanceReader implementation (real DB
 * or in-memory mock).
 */

import type { ExtractionRecord, EvidenceRole, ProvenanceSummary, SystemType } from './types.js';

/**
 * Minimal reader interface matching ProvenanceDB query surface.
 * Decoupled from schema.ts so query logic can be tested with mocks.
 */
export interface ProvenanceReader {
  getExtractionsByFinding(findingId: string): Array<ExtractionRecord & { role: EvidenceRole }>;
  getExtraction(id: string): ExtractionRecord | null;
  getExtractionsByQuery(queryHash: string): ExtractionRecord[];
  verifyReplay(queryHash: string, currentReplayHash: string): boolean;
}

export class ProvenanceQuery {
  constructor(private reader: ProvenanceReader) {}

  /**
   * Get all extractions linked to a finding, grouped by evidence role.
   * Returns empty arrays for roles with no matching evidence.
   */
  getEvidenceChain(findingId: string): {
    primary: ExtractionRecord[];
    corroborating: ExtractionRecord[];
    contradicting: ExtractionRecord[];
  } {
    const extractions = this.reader.getExtractionsByFinding(findingId);

    const chain: {
      primary: ExtractionRecord[];
      corroborating: ExtractionRecord[];
      contradicting: ExtractionRecord[];
    } = {
      primary: [],
      corroborating: [],
      contradicting: [],
    };

    for (const ext of extractions) {
      const { role, ...record } = ext;
      chain[role].push(record);
    }

    return chain;
  }

  /**
   * Get a summary of provenance coverage for a finding.
   * Computes unique systems, tables, timestamps, and replayability.
   */
  getSummary(findingId: string): ProvenanceSummary {
    const extractions = this.reader.getExtractionsByFinding(findingId);

    if (extractions.length === 0) {
      return {
        findingId,
        extractionCount: 0,
        systemsCovered: [],
        tablesCovered: [],
        oldestExtraction: '',
        newestExtraction: '',
        allReplayable: true,
      };
    }

    const systems = new Set<SystemType>();
    const tables = new Set<string>();
    let oldest = extractions[0]!.extractionTimestamp;
    let newest = extractions[0]!.extractionTimestamp;
    let allReplayable = true;

    for (const ext of extractions) {
      systems.add(ext.systemType);
      tables.add(ext.tableName);

      if (ext.extractionTimestamp < oldest) {
        oldest = ext.extractionTimestamp;
      }
      if (ext.extractionTimestamp > newest) {
        newest = ext.extractionTimestamp;
      }

      // Verify replay by checking whether the stored replay hash still matches
      const replayOk = this.reader.verifyReplay(ext.queryHash, ext.replayHash);
      if (!replayOk) {
        allReplayable = false;
      }
    }

    return {
      findingId,
      extractionCount: extractions.length,
      systemsCovered: [...systems].sort(),
      tablesCovered: [...tables].sort(),
      oldestExtraction: oldest,
      newestExtraction: newest,
      allReplayable,
    };
  }

  /**
   * Get all unique tables touched by extractions for a finding,
   * with record counts per system/table pair.
   */
  getTableCoverage(
    findingId: string
  ): Array<{ systemType: SystemType; tableName: string; recordCount: number }> {
    const extractions = this.reader.getExtractionsByFinding(findingId);
    const countMap = new Map<
      string,
      { systemType: SystemType; tableName: string; count: number }
    >();

    for (const ext of extractions) {
      const key = `${ext.systemType}:${ext.tableName}`;
      const existing = countMap.get(key);
      if (existing) {
        existing.count++;
      } else {
        countMap.set(key, {
          systemType: ext.systemType,
          tableName: ext.tableName,
          count: 1,
        });
      }
    }

    return [...countMap.values()]
      .map(entry => ({
        systemType: entry.systemType,
        tableName: entry.tableName,
        recordCount: entry.count,
      }))
      .sort((a, b) => {
        const sys = a.systemType.localeCompare(b.systemType);
        return sys !== 0 ? sys : a.tableName.localeCompare(b.tableName);
      });
  }

  /**
   * Check if all extractions for a finding are still reproducible.
   * Caller provides a map of queryHash → currentReplayHash for each
   * query that was re-executed.
   */
  verifyFindingReplayability(
    findingId: string,
    currentHashes: Map<string, string>
  ): {
    allReplayable: boolean;
    staleExtractions: Array<{
      extractionId: string;
      queryHash: string;
      expected: string;
      actual: string;
    }>;
  } {
    const extractions = this.reader.getExtractionsByFinding(findingId);
    const staleExtractions: Array<{
      extractionId: string;
      queryHash: string;
      expected: string;
      actual: string;
    }> = [];

    for (const ext of extractions) {
      const currentHash = currentHashes.get(ext.queryHash);
      if (currentHash === undefined || currentHash !== ext.replayHash) {
        staleExtractions.push({
          extractionId: ext.id,
          queryHash: ext.queryHash,
          expected: ext.replayHash,
          actual: currentHash ?? '',
        });
      }
    }

    return {
      allReplayable: staleExtractions.length === 0,
      staleExtractions,
    };
  }
}
