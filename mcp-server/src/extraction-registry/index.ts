/**
 * Extraction Registry Core
 *
 * Central registry holding all extraction paths with lookup,
 * validation, and filtering capabilities. Each path is a named,
 * versioned, deterministic query that produces reproducible results.
 */

import { validatePathId, validateVersion } from './metadata.js';

// Re-export all types for consumer convenience
export type { SystemType } from '../provenance/types.js';

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

// Re-export metadata utilities
export {
  validatePathId,
  validateVersion,
  compareVersions,
  validatePath,
  generateRegistrySummary,
} from './metadata.js';

import type { SystemType } from '../provenance/types.js';
import type { QueryType, ExtractionDomain, ExtractionPath, RegistryMetadata } from './types.js';

export class ExtractionRegistry {
  private paths: Map<string, ExtractionPath> = new Map();
  private lastUpdated: string = new Date().toISOString();

  /** Register an extraction path */
  register(path: ExtractionPath): void {
    // Validate ID format
    const idResult = validatePathId(path.id);
    if (!idResult.valid) {
      throw new Error(`Invalid path ID: ${idResult.error}`);
    }

    // Validate version
    const versionResult = validateVersion(path.version);
    if (!versionResult.valid) {
      throw new Error(`Invalid version: ${versionResult.error}`);
    }

    // Must have at least one expected field
    if (!path.expectedFields || path.expectedFields.length === 0) {
      throw new Error(`Path '${path.id}' must have at least one expected field`);
    }

    // No duplicate IDs
    if (this.paths.has(path.id)) {
      throw new Error(`Duplicate path ID: '${path.id}' is already registered`);
    }

    this.paths.set(path.id, path);
    this.lastUpdated = new Date().toISOString();
  }

  /** Register multiple paths at once */
  registerAll(paths: ExtractionPath[]): void {
    for (const path of paths) {
      this.register(path);
    }
  }

  /** Get a path by ID */
  get(id: string): ExtractionPath | undefined {
    return this.paths.get(id);
  }

  /** Get all paths, optionally filtered */
  list(filter?: {
    systemType?: SystemType;
    domain?: ExtractionDomain;
    queryType?: QueryType;
  }): ExtractionPath[] {
    const all = [...this.paths.values()];

    if (!filter) {
      return all;
    }

    return all.filter(path => {
      if (filter.systemType && path.systemType !== filter.systemType) return false;
      if (filter.domain && path.domain !== filter.domain) return false;
      if (filter.queryType && path.queryType !== filter.queryType) return false;
      return true;
    });
  }

  /** Validate parameters against a path's parameter definitions */
  validateParameters(
    pathId: string,
    params: Record<string, string>
  ): { valid: boolean; errors: string[] } {
    const path = this.paths.get(pathId);
    if (!path) {
      return { valid: false, errors: [`Unknown path ID: '${pathId}'`] };
    }

    const errors: string[] = [];

    for (const paramDef of path.parameters) {
      if (paramDef.required && !(paramDef.name in params)) {
        errors.push(`Missing required parameter: ${paramDef.name}`);
      }
    }

    return { valid: errors.length === 0, errors };
  }

  /** Get registry metadata */
  getMetadata(): RegistryMetadata {
    const all = [...this.paths.values()];

    const domains = [...new Set(all.map(p => p.domain))];
    const systems = [...new Set(all.map(p => p.systemType))];

    return {
      registryVersion: '1.0',
      lastUpdated: this.lastUpdated,
      pathCount: this.paths.size,
      domains,
      systems,
    };
  }

  /** Check if a path exists */
  has(id: string): boolean {
    return this.paths.has(id);
  }

  /** Get the count of registered paths */
  get size(): number {
    return this.paths.size;
  }
}
