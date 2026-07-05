# Government-Readiness Technical Review

**Repository:** SAP-Transaction-Forensics
**Date:** 2026-07-05
**Objective:** Validate and harden the complete system toward high-assurance ("NSA-grade") forensics that an SDVOSB can sell to the US federal government.
**Method:** Deep multi-track review — evidence-integrity/security, TypeScript architecture, Python analytics engine, test/CI/reproducibility, federal compliance, and new-data-source expansion research. Several of the most serious findings were reproduced at runtime, not just read.

---

## 1. Bottom line up front

The product has a **genuinely good chassis for federal sale** — read-only, on-prem, air-gap-friendly, no telemetry (verified in code), local-LLM by default, deterministic demo, an honest threat model, and unusually clean surface engineering (`tsc` clean under maximal-strict settings, ~2,076 tests passing repo-wide, zero `any`, zero circular dependencies, non-root containers, real CI matrix).

But the two mechanisms the product actually **markets as "evidence-grade"** do not work, and I verified this directly:

1. **The SHA-256 "replay hash" does not cover the data it claims to protect.** `mcp-server/src/provenance/logger.ts:334-340` passes `Object.keys(result)` as the *replacer array* to `JSON.stringify`. For an array-of-rows result the replacer is a list of indices, so every row serializes to `{}`. Reproduced:

   ```
   real data:    [{vbeln:'123',netwr:'1000'},{vbeln:'124',netwr:'2000'}]
   tampered data:[{vbeln:'XXX',netwr:'9999999'},{vbeln:'YYY',netwr:'0'}]
   → both hash to d827049039f82a8b65a9b0f52e637cf3bc5d1e0dec7d6198edf901a5e3dcae7d
   IDENTICAL — tampering is undetected.
   ```
   The stored replay hash is effectively a function of row count only. Independent verification is also impossible because a *second, different* canonicalizer exists in `provenance/replay.ts` — the two never agree — and `ProvenanceQuery.getSummary` "verifies" a stored hash against itself (a tautology).

2. **The handoff packet is not self-verifying.** The verification script actually shipped by the generator (`handoff/generator.ts:722-750`) only `echo`s the expected hashes; it computes nothing and compares nothing. A correct verifier exists in `handoff/manifest.ts` but is not the one wired into the packet. Evidence CSVs are also built from the finding's own fields rather than read back from the provenance store, so the "evidence" always agrees with a possibly-altered finding.

On top of that, **currency parsing is wrong by 1000×** on both sides of the Atlantic — reproduced: both `1.234,56` (EU) and `1,234.56` (US) collapse to `1.234` — and this feeds every FI/CO forensic threshold. And the `SECURITY.md` document contradicts the shipped code in ways a competent evaluator falsifies in under an hour (e.g. line 96 lists "FI/CO tables (financial accounting)" under **"Data NOT Accessed"** while the product ships five FI/CO forensic tools that read BKPF/BSEG).

**Verdict on the "NSA-grade" framing:** retire it. The repo's own threat model (`docs/threat_model.md:457`) states that a nation-state adversary is explicitly out of scope, and an evaluator will find that line. More importantly, until the evidence chain is real, the product cannot honestly be called "evidence-grade," let alone NSA-grade. The good news: **almost none of this requires re-architecting** — the provenance DAG / replay-hash / handoff-manifest design is the right chassis; the defects are integration, data-semantics, and honesty gaps that are fixable on a weeks-to-months timeline.

The single highest-leverage action is free and can be done this week: **make the documentation stop contradicting the code.** One caught overclaim poisons every other claim in a technical evaluation.

---

## 2. What is actually solid (do not break these)

These were verified and are real selling points:

- **No telemetry / phone-home.** The only outbound endpoints in `mcp-server/src` are opt-in: Anthropic, OpenAI, localhost Ollama, and the SFDC/HuggingFace/4TU adapters. No analytics, no update checks.
- **Read-only by design**, row cap (200/query), 2-minute timeout, rate limiter (`policies/limits.ts`).
- **Local-LLM by default** (`DEFAULT_LLM_CONFIG` = Ollama); cloud providers require explicit env keys.
- **Deterministic demo** — `make demo` runs end-to-end in ~3 minutes with no Docker and leaves the tree clean; SFDC synthetic generation is byte-identical across runs at seed 42.
- **Surface engineering is government-grade:** `tsc --noEmit` clean under `strict` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`; 1,639 mcp-server tests + 367 pattern-engine + others green; zero `any`/`@ts-ignore` in production TS; zero circular deps; all SQL parameterized (no injection found in the finding/provenance stores); non-root container users.
- **Honest threat model and a copy-paste SAP least-privilege guide** (`docs/SAP_AUTHORIZATION.md`).
- **On-prem/read-only positioning legitimately sidesteps FedRAMP** (see §7).

The paradox to internalize: **micro-quality is excellent; macro-correctness is not.** The 2,076 passing tests exercise components in isolation and never drive the shipped 27-tool server end-to-end, which is why every defect below coexists with a green suite.

---

## 3. Critical findings (evidence credibility)

These go directly to whether a forensic output would survive adversarial review or support a Federal Rules of Evidence 902(13)/(14) self-authentication claim.

| # | Finding | Location | Impact |
|---|---|---|---|
| C-1 | **Replay hash covers row-count only** (replacer-array bug); tamper any value, hash unchanged. Verified. | `provenance/logger.ts:334-340` | The central SHA-256 claim is false. |
| C-2 | **Two divergent canonicalizers**; independent verification can never reproduce stored hashes; `getSummary` compares a hash to itself. | `provenance/logger.ts` vs `provenance/replay.ts`; `provenance/query.ts:92` | Replay verification is tautological. |
| C-3 | **Shipped handoff verify script only `echo`s hashes** — computes/compares nothing. | `handoff/generator.ts:722-750` | "Independently verifiable" packet ships a no-op verifier. |
| C-4 | **Handoff evidence built from the finding's own fields**, not read back from provenance; no packet signature or manifest digest. | `handoff/generator.ts:525-543` | An analyst can alter a finding pre-handoff undetected. |
| C-5 | **Currency parsing off by 1000×** on both EU and US formats. Verified: `1.234,56`→`1.234`, `1,234.56`→`1.234`. Also present in Python (`csv_loader.py:630`). | `ecc_rfc/mappers.ts:83-96`, `csv/index.ts:107-147` | Every FI/CO threshold (approval-split at 50k, round-amount) runs on garbage magnitudes. |
| C-6 | **8 of 12 contradiction comparators are inert or always-throw** through the engine (`as unknown as Comparator` signature mismatch; throws swallowed as `console.error`). | `contradiction/index.ts:107-135`, `engine.ts:160-164` | An examiner gets "0 contradictions" on data full of them — silent false negatives on the fraud categories that matter most. |
| C-7 | **Entity resolution fails on its strongest key**: SAP ALPHA-padded `0000012345` never matches SFDC `12345` (exact-string compare, no normalization). Verified. | `cross-system/entity-resolver.ts:142-152` | Highest-confidence cross-system linkage silently fails on real data; fabricates ORPHAN findings. |
| C-8 | **Conformance metric is structurally wrong in both directions**: BPI routing dead (`adapter.name` literal mismatch `'BPI Challenge 2019'` vs `'bpi'`), phantom optional-step check forces ≥2 deviations on every case, and `C/J/M` category case-folding drops deliveries/invoices → fabricated "critical" findings. | `check_conformance.ts:503-524,317-320,574` | The headline conformance number is not trustworthy. |
| C-9 | **OCEL 2.0 O2C export is not valid OCEL** (dicts keyed by ID, no `id`/`name` members); `pm4py.read_ocel2_json` fails. Same defect in Python (`ocel/exporter.py`, attributes as dict not array). | `tools/export_ocel.ts:63-68` | "OCEL 2.0 export for PM4Py/Celonis" fails import. |
| C-10 | **Finding rehydration destroys lifecycle state**: restart restores every finding via `createFinding` → forces `DETECTED`, empties transitions, mints new UUID, resets `detectedAt`. | `finding-lifecycle/index.ts:61-79` | RESOLVED findings reset to active; audit trail erased on every restart. |
| C-11 | **Shell injection in the reviewer verification script**: audited-system data interpolated unescaped into a bash script the packet tells reviewers to run. | `handoff/manifest.ts:210-218`, `generator.ts:739-744` | `$( )`/backticks execute on the reviewer's machine. |
| C-12 | **"Shareable" redaction is reversible**: deterministic SHA-256 truncated to 32 bits with a public hardcoded salt (`sap_workflow_mining`). Original doc numbers recovered in a trivial loop; ~50% collision at ~77k docs. | `pattern-engine/src/redaction/redactor.py:401-431` | Redacted output leaks PII to anyone with the (MIT-licensed, public) repo. |
| C-13 | **Statistical evidence silently dropped from pattern cards** (int vs str cluster-key mismatch): cards show `effects: 0 / confidence: LOW` while the sibling `correlation_stats.json` shows the cluster as notable. Verified end-to-end. | `report/pattern_card.py:300` vs `correlate/outcome_analyzer.py:192` | The flagship report contradicts its own supporting data. |

---

## 4. High-severity findings (by domain)

**Evidence / security**
- No tamper-evidence at rest: `extraction_records` is a plain writable SQLite table — no per-record digest, no hash-chaining, no signatures, no append-only storage (`provenance/schema.ts`). A NIST 800-86 / chain-of-custody review needs content-addressed, hash-chained, signed, RFC-3161-timestamped records on WORM media.
- LLM free-text harvested as evidence: `llm/prompts/process-query.ts:248-268` regexes 10-digit numbers and table names out of the model's *answer* and returns them as `document_references`. A hallucinated document number becomes cited evidence.
- Fabricated statistics fed to the LLM as ground truth: `tools/ask_process.ts:186-206` injects hardcoded "234 occurrences / 567 occurrences" patterns regardless of data, while the prompt says "Never make up statistics."
- Prompt injection: SAP/SFDC free-text (attacker-controllable order notes) is embedded into LLM prompts with no fencing or isolation (`ask_process.ts:379-398`).
- No SNC/TLS on RFC despite `SECURITY.md` claiming it; `.env.rfc` (live SAP creds) is **not** gitignored though the docs instruct `cp .env.rfc.example .env.rfc`.
- Server-side ReDoS: user-supplied regex compiled and run over document text in five adapters, with no complexity/timeout guard.

**TypeScript architecture**
- **9 advertised "Evidence Infrastructure" tools are never registered** (`tools/index.ts` exposes 18 analysis + 9 governance = 27; the evidence stack — `query_provenance`, `run_extraction`, `detect_contradictions`, `validate_schema`, `analyze_reality_gaps`, `manage_finding`, `get_finding_summary`, `generate_handoff_packet`, `list_extraction_paths` — is implemented and tested but unreachable). ~36% of production code is dead from an MCP client's view, and CLAUDE.md's headline features do not exist in the shipped server.
- `console.log` on 24 code paths corrupts the stdio JSON-RPC transport (governance holds write raw lines to stdout mid-request).
- `createAdapter` hard-throws "not yet implemented" for `ecc_rfc` even though the ECC RFC adapter is a complete 7-file implementation — the "Live RFC connection" quickstart cannot work.
- SFDC 15/18-char IDs truncated to 10 chars (`field-mapper.ts:36-40`) → distinct opportunities collide on real orgs.
- Governance hold/approve workflow deadlocks: an approved operation is never actually executed; re-issuing the call creates a new hold.
- Reality-gap engine runs stop-word substring matchers inline; the real detectors exist but use an incompatible rule-type union and are never called.
- Retired Claude model default (`claude-3-sonnet-20240229`) → `ask_process` 404s out of the box.

**Python engine**
- Fabricated "document text" invented on CSV import when no text file is supplied, merged into `consolidated_text` with no provenance marker and nondeterministically (builtin `hash()`).
- SALT "real SAP data" runs on synthesized delivery/GI/invoice events at flat +3/+4/+5 days (`salt_adapter.py:407`) — timing results are constant-latency artifacts under a "real data" banner.
- ML evaluation would mislead an auditor: `StandardScaler` fit on the full dataset before split (leakage); random split on time-ordered process data; features from completed traces encode the label; GradientBoosting "prediction intervals" are meaningless; `pickle` model load is an RCE vector.
- Demo reads the answer key: `analyze_sfdc.py` counts the generator's planted `_pattern_flags` and reports them as detections — an SAP-literate evaluator opening `opportunities.json` sees the tool "detecting" labels it was handed.
- Statistics: clusters tested against a baseline that includes the cluster; no multiple-comparison correction behind a "p < 0.05" footnote.
- `click` missing from `requirements.txt` → documented install path fails with `ModuleNotFoundError`.

**Finding lifecycle / SQLite**
- Two contradictory state machines, two `FindingLifecycleDB` classes (the weaker `INSERT OR REPLACE`, history-truncating one is exported); non-atomic, unvalidated, TOCTOU-racy transitions with no CHECK constraint; the dedup UNIQUE index is void because SQLite treats NULLs as distinct.

**Test / CI / reproducibility / hygiene**
- Coverage is **0% on exactly the security-critical paths**: the live RFC adapter, all three LLM providers, `policies/field-access.ts` and `policies/row-limits.ts`, and the Python evidence-ledger/report generators. Branch coverage 44.9% (TS) / 56% (Python).
- CI has broad version-matrix testing but **zero security tooling**: no CodeQL, no Dependabot, no `npm audit`/`pip-audit` gate (a critical-severity dev dependency sits unflagged), no secret scanning, no SBOM, no coverage floor, actions pinned by tag not SHA, Docker bases by floating tag, no image scan.
- Python deps are unpinned `>=` ranges with no lockfile — the "same seed → same report" reproducibility claim is undermined by dependency drift.
- Version identifiers disagree three ways (CHANGELOG 3.0.1 / package.json 1.0.1 / pyproject 0.1.1); zero git tags, so `release.yml` has never run.
- **Due-diligence embarrassments committed to the repo:** `agent1-work/` contains READMEs/CHANGELOGs/SECURITY.mds for **four unrelated projects** (restaurant, lex-intel, prompt-optimizer, dossier); `.agent3-staging/` and `.claude/context-checkpoint.md` are committed AI session scratch; a 54 MB generated `orders.json` and ~20 MB of Kaggle data (check redistribution rights) are in git history; `herb-nlp/` is an unrelated pipeline not in CI.
- **CLAUDE.md documents three directories that do not exist** (`src/evidence/`, `src/fi-co/`, `src/schema/`) and wrong env-var names (`SAP_HOST` vs `SAP_RFC_ASHOST`, `OLLAMA_BASE_URL` vs `OLLAMA_HOST`).

---

## 5. Claims-vs-code: the overclaims a federal evaluator will flag

These are credibility-damage items — reframe or fix before any technical evaluation. Honesty about a gap scores far better than discovered fiction.

| Claim | Location | Reality |
|---|---|---|
| "FI/CO tables (financial accounting)" under **Data NOT Accessed** | `SECURITY.md:96` | Ships five FI/CO tools reading BKPF/BSEG. **Verified.** A security doc contradicting the feature list reads as stale or deceptive. |
| Audit log example shows `session_id`, `client_ip` | `SECURITY.md:301-305` | `audit-logger.ts` logs no user context; stdio has no client IP. Fabricated fields in a forensics security doc. |
| "Web Viewer (localhost only)" | `SECURITY.md:53,174` | Express binds all interfaces; compose publishes the port to the host; no auth. |
| "Default retention: 90 days" | `SECURITY.md:319` | Rotation is size-based (5×10MB); `LOG_DIR` env is ignored. |
| Architecture diagram: Pattern Engine → MCP Server over HTTP :3000; compose healthchecks `/health` | `SECURITY.md`, `docker-compose.yml` | The MCP server has **no HTTP listener at all**; the healthcheck can never pass. |
| "Replay hash confirms data is identical to source" | `README`, `manifest.ts` | Verification never contacts the source and the shipped script no-ops. **Verified.** |
| "Complete chain of custody" | `README.md:215` | No operator identity, no signatures. It is a chain of *integrity*, not *custody*. |
| SOC 2 / HIPAA / PCI mapping tables | `SECURITY.md:369-395` | No SOC 2 report exists; recast as "supports the customer's program," not product properties. |
| "NetSuite via API (all read-only)" | `README.md:818`, CLAUDE.md | **No NetSuite adapter exists** — only three SuiteQL query strings as metadata, with no client and no `executeExtraction` implementation. |
| "OCEL 2.0 export for PM4Py/Celonis" | CLAUDE.md, tool desc | O2C export is not valid OCEL 2.0; PM4Py import fails. |
| "NSA-grade" (aspirational) | positioning | `threat_model.md:457` excludes nation-state adversaries. Keep it out of the repo and the pitch. |

---

## 6. New data sources to add (expansion research)

The current adapter set is SAP ECC (RFC, real), S/4HANA OData (**explicit stub** — throws on every method), CSV (FI/CO only), Salesforce, SALT, BPI 2019, and synthetic. NetSuite is **vaporware**. Critically, the SAP forensic *blind spots* are exactly the sources a real government engagement demands: no change documents, no security audit log, no authorization-based SoD (the current `analyze_sod` is behavioral-only), no table logging, no transport logs, and no ACDOCA (so it cannot read the S/4 universal journal — and S/4 is where Army GFEBS and Navy ERP live).

### Top 5, ranked by (federal-sales impact × feasibility)

1. **USAspending.gov + SAM.gov Entity/Exclusions demo stack** — *very high impact, very high feasibility.* Free, keyless/free-key REST + CSV bulk. The missing **real-government-data demo**: Benford's law on contract actions, split purchases under thresholds, awards to excluded/debarred parties, shell-vendor clustering by shared address/officers, and three-way budget↔GL↔award reconciliation via account Files A/B/C. Cross-joining SAM exclusions against a customer's SAP `LFA1` vendor master is a live product feature, not just a demo. No FedRAMP, no credentials, no NDA to build it. (Note: FPDS-NG was decommissioned 2026-02-24 — build against the SAM.gov Contract Awards API.)
2. **SAP forensic pack: CDHDR/CDPOS change documents + SM20/RSAU security audit log + USR02/AGR_* authorization data.** Converts the product from process analytics into genuine forensics: field-level change evidence (the classic vendor-bank-account-change → payment → change-back demo), login/RFC/debug activity, and authorization-based SoD (what auditors actually mean). Extends the existing `ecc_rfc` pool + extraction registry. Reads are well-documented — `CHANGEDOCUMENT_READ`, `RSAU_API_GET_LOG_DATA` (RFC-released 2021), `RFC_READ_TABLE` with per-table `S_TABU_NAM` — and **Microsoft Sentinel's SAP connector is a proven reference architecture** to model on. Encode the gotchas: LFBK bank changes are delete+insert (`CHNGIND` I) not updates; CDPOS lives in cluster table CDCLS; SAL DB storage (`RSAU_BUF_DATA`) needs the API, not table reads.
3. **Deltek Costpoint adapter** — the SDVOSB's home turf. DCAA-compliance forensics (timecard fraud, cross-contract mischarging, indirect-rate manipulation) for GovCons is a paying niche with no incumbent process-mining tool and a shorter sales cycle than agency sales. Documented SOAP + REST/JWT integration; model on the SFDC adapter.
4. **Oracle EBS / U.S. Federal Financials** — the largest non-SAP federal ERP estate (DOI IBC, Treasury ARC, DOT Delphi, DoD DAI, Air Force DEAMS). `GL_JE_HEADERS`/`GL_JE_LINES`/`GL_BALANCES` + R12 `XLA_*` map almost 1:1 onto the existing BKPF/BSEG analytics. Combined with SAP, covers essentially every major DoD/civilian ERP — the "one forensics layer over all your ERPs" story.
5. **USSGL / GTAS conformance reference model** — not an adapter but a federal-accounting reference model like the existing O2C/P2P models. "Does this agency GL conform to USSGL account/attribute edits" is a uniquely federal differentiator that generic competitors cannot match off the shelf; public specs, open keyless Treasury Fiscal Data API.

### Also worth doing
- **Kill the NetSuite vaporware** with a ~300-line SuiteQL-over-REST client (the three queries are already written) and implement the missing `executeExtraction` executor — this also makes `run_extraction` real for the first time.
- **Register the 9 unwired evidence tools** (prerequisite for most of the above; the extraction-registry is their natural home).
- **Finish or clearly label the S/4 OData stub** — GFEBS-adjacent buyers will ask about S/4 / ACDOCA specifically.
- **SIEM ingestion path** (Splunk/Sentinel/OCSF): agencies won't grant RFC access on day one but will let you read the Sentinel/Splunk workspace where SAP logs already land — a zero-new-attack-surface pitch matching the read-only ethos. OCSF has no ERP event class yet — emitting findings as OCSF Application-Activity events is a cheap differentiator for Amazon Security Lake shops.
- **More benchmark datasets** (cheap): BPI 2020 (T&E/expense claims), BPI 2018 (EU government subsidy payments), and the OCEL 2.0 SAP-IDES P2P/O2C sample logs (an OCEL *import* adapter also gives round-trip validation of the exporter). HuggingFace has essentially nothing relevant beyond SALT; 4TU.ResearchData is the real benchmark repository.

---

## 7. Compliance posture and go-to-market positioning

- **Position exclusively as self-hosted COTS inside the customer's ATO boundary (FISMA/RMF). Do not offer SaaS.** FedRAMP applies only to cloud service offerings; on-prem software is assessed inside the agency's own authorization. A FedRAMP authorization would cost years and mid-six figures for no benefit these buyers need. The read-only, air-gap-friendly design is the differentiator — make "air-gap mode" a *tested, verifiable* feature (a CI test asserting zero external endpoints; the cloud-LLM path behind a build/config flag customers can prove is disabled).
- **Controls the product can help customers satisfy (sellable):** AU-2/3/6/12 (it *is* an audit-analysis tool), AC-5 separation-of-duties evidence (`analyze_sod`), CM-3/CM-5 change evidence, AU-10-adjacent integrity evidence.
- **Controls the product itself fails today (blocking at Moderate+):** IA-2/AC-2/AC-3 (there is **no authentication anywhere** — the MCP server is single-user stdio; the viewer is an unauthenticated, no-TLS Express app binding all interfaces), AU-9/AU-9(3) (audit log is a plaintext file with no integrity protection — for a forensics tool this is also a courtroom-credibility problem), SC-8 (viewer plaintext HTTP), SC-13 (crypto is SHA-256 but not FIPS-*deliverable* on the Alpine images), SC-28 (no at-rest encryption), SI-2 (no vulnerability-management machinery), CM-6/CM-8 (no hardening baseline, no SBOM).
- **Evidence-grade (FRE 902(13)/(14)):** the handoff subsystem is ~70% of the way to a self-authentication story — but it needs (once the hashing is actually fixed) operator-identity + chain-of-custody metadata, a **digital signature** on the manifest (ideally RFC 3161 timestamped), and a 902(11) "declaration of a qualified person" certification template in the packet. Keep a hard wall between deterministic hash-verified extractions (evidence-grade) and ML/LLM narratives (investigative leads, never evidence) — proposed FRE 707 will subject machine-generated evidence to Rule 702 reliability standards.
- **FIPS 140-3:** FIPS 140-2 certs go Historical 2026-09-21. Node's bundled OpenSSL is not validated and Alpine/musl can't run FIPS mode. Offer a **FIPS deployment profile** (RHEL 9 / UBI9 base in FIPS mode, Node/Python linked to system OpenSSL — CMVP #4857/#4985). Claim "uses FIPS 140-3 validated modules when deployed on a FIPS-enabled OS," never "FIPS-validated product."
- **CMMC 2.0:** certifies organizations, not products. Start the SDVOSB's own 800-171 SSP + SPRS score now (Phase 2 C3PAO certification gate is 2026-11-10). The sellable framing: the tool generates evidence for a contractor's 800-171 3.3.x (audit) and 3.1.4 (SoD) assessment.
- **Section 508:** the viewer is in scope; an agency will request an ACR on VPAT 2.5 during market research. No ACR is a silent pre-award disqualifier. Current state: one `aria-` attribute, never tested.
- **SDVOSB mechanics:** SBA VetCert is mandatory and the hard prerequisite (do it first). VA Vets First (Rule of Two per *Kingdomware*; T4NG2/SPRUCE vehicles) is the strongest wedge and fits the FI/CO + SoD story. Fastest first dollars are subcontracts to primes doing ERP/financial-audit work — and those primes will ask for the exact artifact checklist below.

---

## 8. Prioritized remediation roadmap

### Tier 1 — Quick wins (days), mostly editing and CI YAML
1. **Rewrite `SECURITY.md` to match the code.** Fix every overclaim in §5; add an honest "the product does not yet provide user authentication; deploy behind…" section. *Removes the single fastest way to lose a technical evaluation.*
2. **Fix `docker-compose` drift** — remove the impossible HTTP healthcheck/port for the stdio server; bind the viewer to `127.0.0.1` by default.
3. **Purge the repo debris** — delete `agent1-work/`, `.agent3-staging/`, `.claude/context-checkpoint.md`, committed generated artifacts (`output/pattern_cards.md`, `pattern-engine/test_output/`); move `herb-nlp/` out; regenerate the 54 MB `orders.json` on demand (it's seeded) or use LFS; verify Kaggle redistribution rights.
4. **Regenerate CLAUDE.md** architecture/tools/env-vars from the actual tree (kill the three phantom directories and wrong env-var names).
5. **Turn on free scanning** — CodeQL (JS+Python), Dependabot (npm/pip/docker/actions), GitHub secret scanning + push protection, Trivy image scan; gate CI on `npm audit --omit=dev` and `pip-audit`; fix the dev-toolchain critical.
6. **Pin everything** — hash-pinned Python requirements (`pip-compile --generate-hashes`), digest-pinned Docker bases, `.nvmrc`/`.python-version`.
7. **Generate SBOMs in CI** and attach to releases; **sign releases** (cosign keyless + GitHub artifact attestations → SLSA Build L2).
8. **Reconcile the version number** to one value, tag `v3.0.1`, let `release.yml` run.
9. **Fix `.gitignore`** to exclude `.env.rfc` and `.env.*` (except `*.example`); fix the LICENSE copyright to a real legal entity.
10. **Retire "NSA-grade" and "complete chain of custody"** from all language.

### Tier 2 — Correctness (weeks) — the items that make the product's claims true
11. **Fix the replay hash** (C-1/C-2): one canonical hash module for logger + manifest + verifier, with a regression test that a single mutated field changes the hash; make replay actually re-extract and recompute, not compare stored-to-stored.
12. **Fix the handoff packet** (C-3/C-4/C-11): ship the real verifier, build evidence from provenance records, detached-sign the manifest, add operator/custody metadata + a FRE 902 certification template, and escape shell/CSV/Markdown (formula-injection guard).
13. **Fix currency parsing and money representation** (C-5): shared parser, explicit per-source format, decimal-string/minor-unit amounts (floats also break round-amount detection).
14. **Fix the comparator contract** (C-6) and make "could not evaluate" a first-class result instead of a swallowed throw.
15. **Normalize SAP/SFDC identifiers at every match point** (C-7): ALPHA leading zeros, trim, no truncation of SFDC IDs.
16. **Fix conformance** (C-8): the `'bpi'` name check, the phantom optional-step check, the C/J/M case-folding; then implement real token replay or re-document honestly and drop the literature/precision claims.
17. **Fix OCEL export** (C-9) to valid OCEL 2.0 (arrays with `id`/`name`; keep falsy-but-present values; dedupe shared-delivery events) and validate against PM4Py in CI.
18. **Harden the finding lifecycle** (C-10): single `FindingLifecycleDB`, compare-and-swap transitions in one transaction, verbatim `restore()`, CHECK constraints, schema versioning.
19. **Register the 9 evidence tools**; remove `console.log` from server paths; fix the governance hold/approve deadlock; wire `ecc_rfc` through the registry; update the retired Claude model default.
20. **Fix the Python analytics** (C-12/C-13 + highs): non-reversible per-deployment HMAC redaction covering all emitted artifacts; the cluster-key type mismatch; stop fabricating texts/deliveries; make the SFDC demo detect (and score against `_pattern_flags` as held-out ground truth); cluster-vs-complement stats with Benjamini-Hochberg; ML leakage/temporal-split/interval fixes; add `click` to requirements.
21. **Add authentication + TLS** to every network surface; **tamper-evident (hash-chained, signed-checkpoint) audit logging** honoring `LOG_DIR`; apply the shareable redactor to the LLM path with a boundary-crossing warning when the provider is not Ollama.
22. **Add golden-output end-to-end tests** (`run` on fixed input → byte-comparable output across two invocations and two `PYTHONHASHSEED`s) and coverage floors on the policy/RFC/report paths.

### Tier 3 — Strategic (months) — assurance and capture
23. **New data sources** per §6 — start with the USAspending/SAM.gov demo stack (this quarter) and the SAP forensic pack (CDHDR/CDPOS + SM20 + auth data).
24. **FIPS deployment profile** (UBI9, system OpenSSL, CI job running the suite in FIPS mode) before the 2026-09-21 FIPS 140-2 sunset.
25. **Multi-user RBAC + IdP** (OIDC/SAML) matching the 8-state finding lifecycle — enterprise/government buyers will not run approvals on the honor system.
26. **Write the three capture documents:** an 800-53 Rev 5 shared-responsibility control matrix, a hardening/secure-configuration + air-gap runbook (CM-6), and a data-location/at-rest guidance (SC-28); plus a VPAT 2.5 ACR for the viewer.
27. **Capture motion:** SBA VetCert; SAM/UEI + Section 889 reps; target VA Vets First primes; GSA MAS SIN 511210/54151S after commercial history; watch reauthorized SBIR (DHS/AFWERX) for the ML/pattern-discovery layer.

---

## 9. One-paragraph summary for the owner

The engineering *craft* here is real and rare — clean types, thousands of green tests, honest threat modeling, a read-only/on-prem/air-gap design that legitimately sidesteps FedRAMP and fits an SDVOSB capture motion. But the product currently *cannot deliver on its central promise*: the SHA-256 replay hash protects nothing (verified — tampered and untampered data hash identically), the "self-verifying" handoff packet ships a no-op verifier, currency is parsed 1000× wrong, most fraud comparators never actually run, and the security documentation contradicts the code in ways an evaluator falsifies in an hour. None of it needs a rewrite — the evidence pipeline is the right chassis — but the gap between the marketing and the machine is exactly what a competent government technical evaluation is built to find. Fix the documentation this week (free, and it protects everything else), make the evidence chain actually hold over the next few weeks, add the USAspending/SAM.gov demo and the SAP change-document/audit-log forensic pack to turn "process analytics" into genuine forensics, and drop "NSA-grade" for the defensible, provable claim: read-only, on-prem, hash-verified, FRE 902-aligned ERP forensics.
