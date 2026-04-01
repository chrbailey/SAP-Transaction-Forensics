/**
 * Extraction Registry Metadata Utilities
 *
 * Version management, path validation, and summary generation
 * for extraction path definitions.
 */

import type { ExtractionPath } from './types.js';

/** Validate that an extraction path ID follows the naming convention */
export function validatePathId(id: string): { valid: boolean; error?: string } {
  if (!id || typeof id !== 'string') {
    return { valid: false, error: 'Path ID must be a non-empty string' };
  }

  const parts = id.split('.');
  if (parts.length !== 3) {
    return {
      valid: false,
      error: `Path ID must have 3 parts (system.domain.name), got ${parts.length}: '${id}'`,
    };
  }

  const [system, domain, name] = parts as [string, string, string];

  // system: lowercase letters only
  if (!/^[a-z]+$/.test(system)) {
    return {
      valid: false,
      error: `System segment must be lowercase letters only, got: '${system}'`,
    };
  }

  // domain: lowercase letters, digits, and hyphens (must start with letter)
  if (!/^[a-z][a-z0-9-]*$/.test(domain)) {
    return {
      valid: false,
      error: `Domain segment must be lowercase letters, digits, and hyphens (start with letter), got: '${domain}'`,
    };
  }

  // name: lowercase letters, digits, and hyphens (must start with letter)
  if (!/^[a-z][a-z0-9-]*$/.test(name)) {
    return {
      valid: false,
      error: `Name segment must be lowercase letters, digits, and hyphens (start with letter), got: '${name}'`,
    };
  }

  return { valid: true };
}

/** Validate a version string (simplified semver: major.minor or major.minor.patch) */
export function validateVersion(version: string): { valid: boolean; error?: string } {
  if (!version || typeof version !== 'string') {
    return { valid: false, error: 'Version must be a non-empty string' };
  }

  if (!/^\d+\.\d+(\.\d+)?$/.test(version)) {
    return {
      valid: false,
      error: `Version must be major.minor or major.minor.patch, got: '${version}'`,
    };
  }

  return { valid: true };
}

/** Compare two versions, return 1 if a > b, -1 if a < b, 0 if equal */
export function compareVersions(a: string, b: string): number {
  const partsA = a.split('.').map(Number);
  const partsB = b.split('.').map(Number);
  const len = Math.max(partsA.length, partsB.length);

  for (let i = 0; i < len; i++) {
    const segA = partsA[i] ?? 0;
    const segB = partsB[i] ?? 0;
    if (segA > segB) return 1;
    if (segA < segB) return -1;
  }

  return 0;
}

/** Validate an extraction path definition for completeness */
export function validatePath(path: ExtractionPath): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Valid ID
  const idResult = validatePathId(path.id);
  if (!idResult.valid) {
    errors.push(idResult.error!);
  }

  // Valid version
  const versionResult = validateVersion(path.version);
  if (!versionResult.valid) {
    errors.push(versionResult.error!);
  }

  // Non-empty query
  if (!path.query || path.query.trim().length === 0) {
    errors.push('Query must be a non-empty string');
  }

  // At least one expected field
  if (!path.expectedFields || path.expectedFields.length === 0) {
    errors.push('Must have at least one expected field');
  }

  // All required parameters have descriptions
  if (path.parameters) {
    for (const param of path.parameters) {
      if (param.required && (!param.description || param.description.trim().length === 0)) {
        errors.push(`Required parameter '${param.name}' must have a description`);
      }
    }
  }

  // No duplicate parameter names
  if (path.parameters) {
    const paramNames = path.parameters.map((p) => p.name);
    const uniqueNames = new Set(paramNames);
    if (uniqueNames.size !== paramNames.length) {
      const dupes = paramNames.filter((n, i) => paramNames.indexOf(n) !== i);
      errors.push(`Duplicate parameter names: ${[...new Set(dupes)].join(', ')}`);
    }
  }

  // No duplicate field names
  if (path.expectedFields) {
    const fieldNames = path.expectedFields.map((f) => f.name);
    const uniqueFields = new Set(fieldNames);
    if (uniqueFields.size !== fieldNames.length) {
      const dupes = fieldNames.filter((n, i) => fieldNames.indexOf(n) !== i);
      errors.push(`Duplicate field names: ${[...new Set(dupes)].join(', ')}`);
    }
  }

  return { valid: errors.length === 0, errors };
}

/** Generate a summary of registry contents */
export function generateRegistrySummary(paths: ExtractionPath[]): {
  totalPaths: number;
  bySystem: Record<string, number>;
  byDomain: Record<string, number>;
  byQueryType: Record<string, number>;
  withTestData: number;
} {
  const bySystem: Record<string, number> = {};
  const byDomain: Record<string, number> = {};
  const byQueryType: Record<string, number> = {};
  let withTestData = 0;

  for (const path of paths) {
    bySystem[path.systemType] = (bySystem[path.systemType] ?? 0) + 1;
    byDomain[path.domain] = (byDomain[path.domain] ?? 0) + 1;
    byQueryType[path.queryType] = (byQueryType[path.queryType] ?? 0) + 1;
    if (path.testData) {
      withTestData++;
    }
  }

  return {
    totalPaths: paths.length,
    bySystem,
    byDomain,
    byQueryType,
    withTestData,
  };
}
