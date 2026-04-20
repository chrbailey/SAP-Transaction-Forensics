# ARCHIVED — Superseded by SAP-Transaction-Forensics

This repository is **archived and no longer maintained** as of 2026-04-16.

## Use this instead

**[chrbailey/SAP-Transaction-Forensics](https://github.com/chrbailey/SAP-Transaction-Forensics)** — the successor repo contains everything in this repo plus:

- 1,663 passing tests (70 test suites)
- 23 MCP tools for forensic analysis
- 7 evidence systems: Provenance Graph, Extraction Registry, Contradiction Engine (12-category), Schema Validator (438 fields), Reality-Gap Detector, Finding Lifecycle (8-state), Reviewer Handoff Packets
- 19 deterministic extraction paths (SAP O2C, FI/CO, P2P + Salesforce + NetSuite)
- Worker/Critic/Ralph pattern-discovery loop (24 Python tests)
- Field-level provenance with SHA-256 replay verification

## What this repo was

A static demo site built around the Salesforce/HERB dataset — 6 analysis tabs (Overview, CRM Pipeline, BPI Challenge, IDES Compliance, Client Cases, NLP Patterns) rendered at `transaction-forensics.vercel.app`. The NLP pipeline (TF-IDF + KMeans on 37,064 documents) lives in `analyze.py`.

The live Vercel demo will continue to render because the static `public/` artifacts are preserved. No new features, fixes, or data updates will land here.

## Why archived

All forensic-engine development moved to the successor repo in Q1 2026. This repo's scope shrank to "static viewer for the HERB NLP demo," which the successor now absorbs. Keeping two repos diluted attention and led to README drift between them.

For questions or historical context, the commit history is preserved in read-only form.
