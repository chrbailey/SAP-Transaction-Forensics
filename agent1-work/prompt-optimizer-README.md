# Prompt Optimizer

[![CI](https://github.com/chrbailey/prompt-optimizer/actions/workflows/ci.yml/badge.svg)](https://github.com/chrbailey/prompt-optimizer/actions/workflows/ci.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.4-blue.svg)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://opensource.org/licenses/MIT)

**Deterministic prompt quality scoring for CI/CD.** Same input, same score,
every time — no LLM randomness, no API keys, no network calls for scoring.

```yaml
# Add to any PR workflow
- uses: chrbailey/prompt-optimizer/action@main
  with:
    path: '**/*.prompt.md'
    threshold: 60
```

## What This Is

- A 5-dimension string-based scorer: **Clarity (25%), Specificity (25%),
  Structure (15%), Completeness (20%), Efficiency (15%)**.
- A GitHub Action that runs that scorer over a glob of prompt files and fails
  the build when any prompt drops below a threshold.
- A CLI with `evaluate`, `optimize`, `route`, `batch`, `config`.
- A published rubric you can read (`docs/scoring.md`) — every deduction is
  documented.

## What This Is NOT

- **Not on the `prompt-optimizer` npm package name.** That name is already
  taken by a different project (Klaus Heringer's eval-loop for promptfoo).
  This repo is install-from-source only — see [Installation](#installation).
- **Not a semantic evaluator.** The scorer does pattern matching on strings.
  Well-formatted nonsense scores high; domain-expert shorthand scores low.
  Known limitations are spelled out in `docs/scoring.md`.
- **Not an LLM wrapper for scoring.** `evaluate` never calls a provider. Only
  `optimize` and `route --quality best` touch LLM APIs, and those require API
  keys you set yourself.
- **Not production-hardened.** One author, 56 passing tests, no integration
  test suite (the `tests/integration/` directory is empty). Treat it as a
  useful quality gate, not a silver bullet.

## Why Deterministic Scoring?

| Problem | LLM-as-Judge | Prompt Optimizer |
|---------|-------------|------------------|
| Evaluation consistency | Varies 10-20% between runs | Same input, same score, every time |
| CI/CD integration | Needs provider API keys | Zero API keys for scoring |
| Debugging a low score | "The AI said it was bad" | Open `docs/scoring.md`, see the rule that deducted |
| Cost per PR | $0.01-0.10 per prompt | Free |

## Quick Demo (Actual Scores)

These numbers are reproduced from running the scorer on 2026-04-16. Rerun
with `npx tsx -e "..."` to verify — the whole point is they don't change.

**Structured prompt — scores 90/100:**
```markdown
# Code Review Assistant

## Role
You are an expert code reviewer with 10+ years of TypeScript experience.

## Task
Review the provided code for security vulnerabilities and performance issues.

## Output Format
Return JSON: { "issues": [{ "severity": "...", "line": 42, "description": "..." }] }

## Constraints
- Focus on functional issues only
- Limit to 5 most critical issues
```
Breakdown: Clarity 100, Specificity 90, Structure 100, Completeness 80, Efficiency 100 → **90**

**Sloppy prompt — scores 54/100:**
```
review this code and tell me if there are any problems with it or whatever. make it better somehow. thanks
```
Breakdown: Clarity 85, Specificity 30, Structure 50, Completeness 50, Efficiency 50 → **54**

**Underspecified prompt — scores 52/100:**
```
Write a function to sort an array
```
Breakdown: Clarity 70, Specificity 50, Structure 50, Completeness 50, Efficiency 30 → **52**

Note that "sloppy" still scores above 50 because the rubric rewards complete
English sentences and punctuation. The scorer catches missing structure and
missing specifics; it cannot catch bad intent. This is a documented
limitation, not a bug.

## The Quality Gate for Prompts

```yaml
# .github/workflows/prompt-check.yml
name: Prompt Quality

on:
  pull_request:
    paths: ['**/*.prompt.md', 'prompts/**']

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: chrbailey/prompt-optimizer/action@main
        with:
          path: '**/*.prompt.md'
          threshold: 60
          annotations: true
```

PRs that drop a prompt below threshold fail with inline annotations.

## Scoring System

Every prompt is scored on 5 dimensions (0-100):

| Dimension | Weight | What It Measures |
|-----------|--------|------------------|
| Clarity | 25% | Absence of ambiguous pronouns ("it", "this", "stuff"), punctuation, structure markers |
| Specificity | 25% | Concrete details, numbers, precision words, quoted examples |
| Structure | 15% | Headers, lists, code blocks, paragraph separation |
| Completeness | 20% | Task, context, output format, constraints, examples |
| Efficiency | 15% | Token count in optimal range (50-200 estimated tokens) |

**Overall** = weighted average, rounded to nearest integer.

Full rubric — every `+5` and `-10` the scorer applies — is in
[docs/scoring.md](docs/scoring.md). The rubric is stable across runs and
versions; behavior changes are called out in `CHANGELOG.md`.

## Installation

### GitHub Action (recommended)

```yaml
- uses: chrbailey/prompt-optimizer/action@main
  with:
    path: '**/*.prompt.md'
    threshold: 60
```

Pin to a commit SHA (not `@main`) for production workflows.

### From source

```bash
git clone https://github.com/chrbailey/prompt-optimizer.git
cd prompt-optimizer
npm install
npm run build
./dist/cli/index.js evaluate "your prompt here" --metrics
```

### As a library (from a git dependency)

```bash
npm install git+https://github.com/chrbailey/prompt-optimizer.git
```

```typescript
import { calculatePromptScores } from 'prompt-optimizer';
const scores = calculatePromptScores("Your prompt here");
console.log(scores.overall); // 0-100
```

> There is a `prompt-optimizer` package on the public npm registry, but it is
> not this project — it is [klausners/prompt-optimizer](https://github.com/klausners/prompt-optimizer),
> an unrelated eval-loop for promptfoo. Do not `npm install -g prompt-optimizer`
> expecting this repository.

## CLI Commands

### `evaluate` — Score a Prompt

Pure deterministic scoring. No network calls.

```bash
prompt-optimizer evaluate "Write a function to sort an array" --metrics
```

### `optimize` — Improve a Prompt (requires API key)

Applies optimization techniques using an LLM. Requires one of
`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or `GOOGLE_API_KEY` in the environment.

```bash
prompt-optimizer optimize "Write a sorting function" \
  --techniques structured_reasoning,few_shot
```

### `route` — Select Best Model

Rules-based routing by task type, budget, and quality. Does not require an API
key unless `--quality best` is used with a provider-specific optimizer path.

```bash
prompt-optimizer route "Complex code review task" --quality best
```

### `batch` — Process Multiple Prompts

```bash
prompt-optimizer batch prompts.txt --output results.json --parallel 5
```

### `config` — Show or set CLI config

```bash
prompt-optimizer config list
prompt-optimizer config set provider anthropic
```

## GitHub Action Options

| Input | Default | Description |
|-------|---------|-------------|
| `path` | `**/*.prompt.md` | Glob pattern for prompt files |
| `threshold` | `60` | Minimum score to pass (0-100) |
| `fail-on-warning` | `false` | Fail if any prompt scores within 10 points of threshold |
| `annotations` | `true` | Add inline PR annotations for failures |
| `output-format` | `summary` | `summary`, `detailed`, or `json` |
| `config-file` | (empty) | Path to custom scoring config file |

| Output | Description |
|--------|-------------|
| `total-prompts` | Number of prompts scored |
| `passed-prompts` | Number above threshold |
| `failed-prompts` | Number below threshold |
| `average-score` | Mean score across all prompts |
| `lowest-score` | Lowest overall score found |
| `highest-score` | Highest overall score found |
| `results-json` | Full results as JSON string |

## Comparison with Alternatives

| Feature | Prompt Optimizer | DSPy | LiteLLM | Promptfoo |
|---------|------------------|------|---------|-----------|
| Deterministic scoring | Yes | No | No | Custom rules possible |
| No API key to run scoring | Yes | No | No | No for LLM-judged evals |
| GitHub Action | Yes | No | No | Community actions |
| Transparent rubric | Yes (`docs/scoring.md`) | No | N/A | Partial |
| Prompt optimization | 8 techniques (needs API) | Auto-compiled | No | No |
| Model routing | Task-aware rules | No | Fallback only | No |

**Use this when:** you want a quality gate that never varies and needs no API
keys in CI.

**Use something else when:** you need semantic correctness (Promptfoo with
LLM judges), automatic prompt compilation (DSPy), or a 100+ provider layer
(LiteLLM).

## Development

```bash
npm install
npm run build      # tsc
npm test           # 56 tests pass, ~1.3s
npm run lint
cd action && npm install && npm run build  # rebuild the bundled action
```

The test suite covers scoring determinism, weight math, edge cases, and
router logic. The `tests/integration/` directory is currently empty — the
shipped tests are unit tests only.

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      CLI / GitHub Action                    │
└─────────────────────────────────────────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        ▼                     ▼                     ▼
  Evaluator            Optimizer               Router
  (string rules)    (LLM-backed, needs key)  (rules table)
        │                     │                     │
        │                     ▼                     │
        │            ┌────────────────┐             │
        │            │ LLM Providers  │             │
        │            │ (Anthropic /   │             │
        │            │  OpenAI /      │             │
        │            │  Google)       │             │
        │            └────────────────┘             │
        │                                           │
        └─── No API key required for scoring ───────┘
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Priority areas:
- Additional scoring heuristics (with calibration examples)
- Filling in `tests/integration/` against fixture prompt files
- New optimization techniques (each needs a doc page)
- Documentation improvements

## License

MIT — see [LICENSE](LICENSE).

## Acknowledgments

- Inspired by ESLint / Prettier — the idea that a fast, deterministic checker
  sitting in the PR flow changes behavior in a way that a slow LLM judge
  can't.
- Built with help from [Claude Code](https://claude.ai/code).
