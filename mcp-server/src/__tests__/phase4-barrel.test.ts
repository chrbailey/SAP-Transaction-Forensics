/**
 * Phase 4 Barrel Export Tests
 *
 * Verifies that the handoff module barrel exports are correctly wired,
 * factory functions produce working instances, and all renderer classes
 * are importable.
 */

import { describe, test, expect } from '@jest/globals';
import {
  // Types re-exported (compile-time check — import as type below)
  // Renderers
  FindingRenderer,
  SummaryGenerator,
  ChecklistGenerator,
  GapRenderer,
  // Generator
  DefaultHandoffPacketGenerator,
  createDefaultGenerator,
} from '../handoff/index.js';

import type {
  HandoffConfig,
  HandoffPacket,
  RenderedFinding,
  EvidenceFile,
  ManifestEntry,
  ExtractionManifest,
  ChecklistItem,
  ReviewerChecklist,
  HandoffPacketGenerator,
  ManifestGenerator,
  SummaryParams,
  GapType,
  GapSeverity,
  GapFinding,
} from '../handoff/index.js';

// ============================================================================
// Barrel export availability
// ============================================================================

describe('Handoff barrel — all exports importable', () => {
  test('renderer classes are constructors', () => {
    expect(typeof FindingRenderer).toBe('function');
    expect(typeof SummaryGenerator).toBe('function');
    expect(typeof ChecklistGenerator).toBe('function');
    expect(typeof GapRenderer).toBe('function');

    expect(new FindingRenderer()).toBeInstanceOf(FindingRenderer);
    expect(new SummaryGenerator()).toBeInstanceOf(SummaryGenerator);
    expect(new ChecklistGenerator()).toBeInstanceOf(ChecklistGenerator);
    expect(new GapRenderer()).toBeInstanceOf(GapRenderer);
  });

  test('DefaultHandoffPacketGenerator is a constructor', () => {
    expect(typeof DefaultHandoffPacketGenerator).toBe('function');
    const gen = new DefaultHandoffPacketGenerator();
    expect(gen).toBeInstanceOf(DefaultHandoffPacketGenerator);
  });

  test('createDefaultGenerator is a function', () => {
    expect(typeof createDefaultGenerator).toBe('function');
  });

  test('type imports compile correctly (compile-time check)', () => {
    // These assignments verify types are importable without runtime errors
    const config: HandoffConfig = {
      engagementId: 'E-001',
      clientName: 'Test',
      preparedBy: 'Tester',
      dateRange: { from: '2025-01-01', to: '2025-12-31' },
      systemsAccessed: ['SAP'],
      scope: 'Test scope',
      includeReproduction: true,
      includeChecklist: true,
      outputDir: '/tmp',
    };
    expect(config.engagementId).toBe('E-001');

    const gt: GapType = 'design';
    const gs: GapSeverity = 'HIGH';
    expect(gt).toBe('design');
    expect(gs).toBe('HIGH');
  });
});

// ============================================================================
// createDefaultGenerator factory
// ============================================================================

describe('Handoff barrel — createDefaultGenerator', () => {
  test('returns a HandoffPacketGenerator', () => {
    const gen = createDefaultGenerator();
    expect(gen).toBeDefined();
    expect(typeof gen.generate).toBe('function');
  });

  test('generator produces a valid packet with minimal config', async () => {
    const gen = createDefaultGenerator();

    const config: HandoffConfig = {
      engagementId: 'ENG-TEST-001',
      clientName: 'Test Client',
      preparedBy: 'Test Analyst',
      dateRange: { from: '2025-01-01', to: '2025-06-30' },
      systemsAccessed: ['SAP'],
      scope: 'FY2025 H1 Process Audit',
      includeReproduction: true,
      includeChecklist: true,
      outputDir: '/tmp/test-output',
    };

    const packet = await gen.generate(config);

    // Verify packet structure
    expect(packet.config).toEqual(config);
    expect(typeof packet.summary).toBe('string');
    expect(packet.summary.length).toBeGreaterThan(0);
    expect(packet.summary).toContain('Test Client');

    expect(Array.isArray(packet.findings)).toBe(true);
    expect(Array.isArray(packet.contradictions)).toBe(true);
    expect(Array.isArray(packet.realityGaps)).toBe(true);

    expect(packet.manifest).toBeDefined();
    expect(packet.manifest.engagementId).toBe('ENG-TEST-001');

    expect(packet.checklist).toBeDefined();
    expect(packet.checklist.engagementId).toBe('ENG-TEST-001');
    expect(packet.checklist.totalCount).toBeGreaterThan(0);

    expect(typeof packet.provenanceGraph).toBe('string');
    expect(typeof packet.generatedAt).toBe('string');
  });
});
