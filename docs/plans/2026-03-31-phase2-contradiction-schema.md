# Phase 2: Contradiction Engine + Schema Validator — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan.

**Goal:** Build cross-system contradiction detection with a typed 12-category taxonomy, and a pre-flight schema validator that verifies extraction paths are valid for a specific client instance before any query runs.

**Architecture:** Two new subsystems: (1) `contradiction/` — deterministic comparison engine that runs cross-system and intra-system checks at scale, producing typed ContradictionFindings linked to the provenance graph; (2) `schema-validator/` — connects to the IDES reference schema and validates extraction paths against actual client instance schemas.

**Tech Stack:** TypeScript (ES2022, NodeNext), SQLite via better-sqlite3, Jest (ESM mode), existing provenance infrastructure from Phase 1.

---

## File Structure

### Contradiction Engine
- `src/contradiction/types.ts` — ContradictionType enum, ContradictionFinding, ComparisonResult
- `src/contradiction/engine.ts` — ContradictionEngine class with 12 typed comparators
- `src/contradiction/comparators/amount.ts` — Amount divergence (cross-system + intra-system)
- `src/contradiction/comparators/temporal.ts` — Date conflicts + temporal impossibility
- `src/contradiction/comparators/status.ts` — Status incompatibility + approval bypass
- `src/contradiction/comparators/entity.ts` — Entity mismatch, duplicate reference, orphan record
- `src/contradiction/comparators/change.ts` — Retroactive change, SoD violation, schema ghost
- `src/contradiction/scoring.ts` — Severity scoring formulas
- `src/contradiction/index.ts` — Barrel export

### Schema Validator
- `src/schema-validator/types.ts` — SchemaValidation, ValidationLevel, ClientSchema
- `src/schema-validator/validator.ts` — SchemaValidator class
- `src/schema-validator/ides-reference.ts` — IDES reference schema (from 45MB dump)
- `src/schema-validator/index.ts` — Barrel export

### MCP Tools
- `src/tools/contradiction-tools.ts` — 2 new tools: detect_contradictions, validate_schema

### Tests (14 files)
- contradiction-types, contradiction-engine, amount-comparator, temporal-comparator, status-comparator, entity-comparator, change-comparator, scoring, schema-validator, ides-reference, contradiction-mcp-tools, contradiction-integration, schema-integration, phase2-integration
