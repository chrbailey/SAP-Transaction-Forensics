/**
 * Provenance Logger Middleware
 *
 * Wraps an IDataAdapter using the Decorator pattern to automatically log
 * every extraction to a provenance store. When any adapter method is called,
 * the logger:
 *
 *   1. Computes a deterministic query hash from method name + parameters
 *   2. Delegates to the underlying adapter
 *   3. Computes a replay hash from the result
 *   4. Flattens the result into field-level ExtractionRecord entries
 *   5. Persists all records via batch insert
 *
 * This provides a complete audit trail: every field value returned by any
 * adapter call can be traced back to the exact query that produced it.
 */

import { createHash } from 'node:crypto';
import type { IDataAdapter } from '../adapters/adapter-interface.js';
import type { ExtractionRecord, SystemType } from './types.js';

/**
 * Minimal interface for the provenance database.
 * Keeps this module decoupled from the concrete schema implementation.
 */
export interface ProvenanceStore {
  insertExtraction(record: ExtractionRecord): void;
  insertBatchExtractions(records: ExtractionRecord[]): void;
}

/**
 * Maps adapter method names to the SAP tables they query and the
 * parameter field used as the record identifier.
 */
const METHOD_TABLE_MAP: Record<string, { tables: string[]; idField: string }> = {
  searchDocText: { tables: ['STXH', 'STXL'], idField: 'pattern' },
  getDocText: { tables: ['STXH', 'STXL'], idField: 'doc_key' },
  getDocFlow: { tables: ['VBFA'], idField: 'vbeln' },
  getSalesDocHeader: { tables: ['VBAK'], idField: 'vbeln' },
  getSalesDocItems: { tables: ['VBAP'], idField: 'vbeln' },
  getDeliveryTiming: { tables: ['LIKP', 'LIPS'], idField: 'vbeln' },
  getInvoiceTiming: { tables: ['VBRK', 'VBRP'], idField: 'vbeln' },
  getMasterStub: { tables: ['KNA1', 'LFA1', 'MARA'], idField: 'id' },
};

/** The 8 data methods on IDataAdapter that we intercept. */
const ADAPTER_METHODS = [
  'searchDocText',
  'getDocText',
  'getDocFlow',
  'getSalesDocHeader',
  'getSalesDocItems',
  'getDeliveryTiming',
  'getInvoiceTiming',
  'getMasterStub',
] as const;

type AdapterMethodName = (typeof ADAPTER_METHODS)[number];

function isAdapterMethod(name: string): name is AdapterMethodName {
  return (ADAPTER_METHODS as readonly string[]).includes(name);
}

export class ProvenanceLogger {
  private store: ProvenanceStore;
  private adapterId: string;
  private systemType: SystemType;

  constructor(store: ProvenanceStore, adapterId: string, systemType: SystemType) {
    this.store = store;
    this.adapterId = adapterId;
    this.systemType = systemType;
  }

  /**
   * Wrap an adapter so every data method automatically logs provenance.
   * Non-data methods (initialize, shutdown, isReady, name) pass through unchanged.
   */
  wrapAdapter(adapter: IDataAdapter): IDataAdapter {
    const self = this;

    const wrapped: IDataAdapter = {
      get name() {
        return adapter.name;
      },

      initialize: () => adapter.initialize(),
      shutdown: () => adapter.shutdown(),
      isReady: () => adapter.isReady(),

      searchDocText: async (params) => {
        const result = await adapter.searchDocText(params);
        self.logExtraction('searchDocText', params as unknown as Record<string, unknown>, result);
        return result;
      },

      getDocText: async (params) => {
        const result = await adapter.getDocText(params);
        self.logExtraction('getDocText', params as unknown as Record<string, unknown>, result);
        return result;
      },

      getDocFlow: async (params) => {
        const result = await adapter.getDocFlow(params);
        self.logExtraction('getDocFlow', params as unknown as Record<string, unknown>, result);
        return result;
      },

      getSalesDocHeader: async (params) => {
        const result = await adapter.getSalesDocHeader(params);
        self.logExtraction('getSalesDocHeader', params as unknown as Record<string, unknown>, result);
        return result;
      },

      getSalesDocItems: async (params) => {
        const result = await adapter.getSalesDocItems(params);
        self.logExtraction('getSalesDocItems', params as unknown as Record<string, unknown>, result);
        return result;
      },

      getDeliveryTiming: async (params) => {
        const result = await adapter.getDeliveryTiming(params);
        self.logExtraction('getDeliveryTiming', params as unknown as Record<string, unknown>, result);
        return result;
      },

      getInvoiceTiming: async (params) => {
        const result = await adapter.getInvoiceTiming(params);
        self.logExtraction('getInvoiceTiming', params as unknown as Record<string, unknown>, result);
        return result;
      },

      getMasterStub: async (params) => {
        const result = await adapter.getMasterStub(params);
        self.logExtraction('getMasterStub', params as unknown as Record<string, unknown>, result);
        return result;
      },
    };

    return wrapped;
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  /**
   * Core logging pipeline: hash, flatten, persist.
   */
  private logExtraction(
    methodName: string,
    params: Record<string, unknown>,
    result: unknown
  ): void {
    if (result == null) return;

    const queryHash = this.computeQueryHash(methodName, params);
    const replayHash = this.computeReplayHash(result);
    const records = this.extractFieldRecords(methodName, params, result, queryHash, replayHash);

    if (records.length > 0) {
      this.store.insertBatchExtractions(records);
    }
  }

  /**
   * Flatten an adapter result into individual field-level ExtractionRecords.
   *
   * Strategy varies by result shape:
   * - Array results: one record per field per element
   * - Object results: one record per field (may recurse into nested objects)
   * - null/undefined: no records
   */
  private extractFieldRecords(
    methodName: string,
    params: Record<string, unknown>,
    result: unknown,
    queryHash: string,
    replayHash: string
  ): ExtractionRecord[] {
    const mapping = METHOD_TABLE_MAP[methodName];
    const tables = mapping ? mapping.tables : ['UNKNOWN'];
    const idField = mapping ? mapping.idField : 'id';
    const recordId = String(params[idField] ?? 'unknown');
    const now = new Date().toISOString();
    const records: ExtractionRecord[] = [];

    if (Array.isArray(result)) {
      for (const row of result) {
        if (row != null && typeof row === 'object') {
          this.flattenObject(
            row as Record<string, unknown>,
            tables[0] ?? 'UNKNOWN',
            recordId,
            queryHash,
            replayHash,
            now,
            records
          );
        }
      }
    } else if (result != null && typeof result === 'object') {
      // Single object result — may have nested arrays (e.g. DocTextResult, DocFlowResult)
      this.flattenObject(
        result as Record<string, unknown>,
        tables[0] ?? 'UNKNOWN',
        recordId,
        queryHash,
        replayHash,
        now,
        records
      );
    }

    return records;
  }

  /**
   * Recursively flatten a result object into field records.
   * Nested arrays are flattened with dotted field names (e.g. "flow.0.doc_number").
   * Nested objects are flattened with dotted field names (e.g. "header_timing.requested_date").
   */
  private flattenObject(
    obj: Record<string, unknown>,
    tableName: string,
    recordId: string,
    queryHash: string,
    replayHash: string,
    timestamp: string,
    out: ExtractionRecord[],
    prefix?: string
  ): void {
    for (const [key, value] of Object.entries(obj)) {
      const fieldName = prefix ? `${prefix}.${key}` : key;

      if (value == null) {
        // Skip null/undefined fields — nothing to record
        continue;
      } else if (Array.isArray(value)) {
        for (let i = 0; i < value.length; i++) {
          const element = value[i];
          if (element != null && typeof element === 'object') {
            this.flattenObject(
              element as Record<string, unknown>,
              tableName,
              recordId,
              queryHash,
              replayHash,
              timestamp,
              out,
              `${fieldName}.${i}`
            );
          } else {
            out.push(this.makeRecord(
              tableName, recordId, `${fieldName}.${i}`,
              String(element ?? ''), queryHash, replayHash, timestamp
            ));
          }
        }
      } else if (typeof value === 'object') {
        this.flattenObject(
          value as Record<string, unknown>,
          tableName,
          recordId,
          queryHash,
          replayHash,
          timestamp,
          out,
          fieldName
        );
      } else {
        const raw = String(value);
        out.push(this.makeRecord(
          tableName, recordId, fieldName,
          raw, queryHash, replayHash, timestamp
        ));
      }
    }
  }

  private makeRecord(
    tableName: string,
    recordId: string,
    fieldName: string,
    rawValue: string,
    queryHash: string,
    replayHash: string,
    timestamp: string
  ): ExtractionRecord {
    return {
      id: crypto.randomUUID(),
      adapterId: this.adapterId,
      systemType: this.systemType,
      tableName,
      recordId,
      fieldName,
      rawValue,
      normalizedValue: rawValue.trim().toUpperCase(),
      extractionTimestamp: timestamp,
      queryHash,
      replayHash,
      extractionPathId: `adapter:${this.adapterId}`,
      extractionPathVersion: '1.0.0',
    };
  }

  // ---------------------------------------------------------------------------
  // Hashing
  // ---------------------------------------------------------------------------

  /**
   * Deterministic hash of method name + sorted parameters.
   * Same inputs always produce the same hash.
   */
  private computeQueryHash(methodName: string, params: Record<string, unknown>): string {
    const sorted = Object.entries(params)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => [k, String(v ?? '')]);

    const canonical = JSON.stringify({ method: methodName, params: sorted });
    return createHash('sha256').update(canonical).digest('hex');
  }

  /**
   * Deterministic hash of a result value.
   * Same result always produces the same hash.
   */
  private computeReplayHash(result: unknown): string {
    const canonical = JSON.stringify(result, Object.keys(
      typeof result === 'object' && result !== null ? result : {}
    ).sort());
    return createHash('sha256').update(canonical).digest('hex');
  }
}
