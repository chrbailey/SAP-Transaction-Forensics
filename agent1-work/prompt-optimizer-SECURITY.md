# Security Policy

## Scope

`prompt-optimizer` ships two surfaces with different threat profiles:

1. **Deterministic scoring** (`evaluate`, `batch`, library API, GitHub Action).
   Pure string analysis. No network calls, no API keys, no LLM calls. The
   security surface is the input parser and regex set.

2. **LLM-backed commands** (`optimize`, `route --quality best` flows). These
   read API keys from the environment or config file and send prompts to the
   configured provider (Anthropic / OpenAI / Google). The security surface is
   credential handling and the outbound prompt content.

## Reporting a Vulnerability

Please report security issues privately via
[GitHub Security Advisories](https://github.com/chrbailey/prompt-optimizer/security/advisories/new).

Do not open a public issue for security reports.

Expect an acknowledgement within 7 days. Severity-based triage follows.

## Threat Model — Deterministic Scoring

- **Untrusted prompt input is expected.** The scoring functions accept
  arbitrary strings. Pathological inputs (very long strings, unbalanced
  punctuation) must not hang or crash.
- **No code execution.** The scorer never evaluates prompt content. Prompts
  are treated as opaque text.
- **Determinism is a property, not a trust boundary.** Same input → same
  output, by construction. This is documented in `docs/scoring.md`.

## Threat Model — LLM-Backed Commands

- **API keys are read from environment variables** (`ANTHROPIC_API_KEY`,
  `OPENAI_API_KEY`, `GOOGLE_API_KEY`) or a config file under the user's
  home directory. Never commit a populated config file.
- **Prompt content is sent to the configured provider.** If a prompt contains
  secrets, those secrets leave the machine. Treat the outbound channel as
  equivalent to any other LLM API call.
- **No retry storm protection.** Rate limiting is not enforced by this tool.
  Provider limits apply.

## Package Distribution

The package name `prompt-optimizer` on the public npm registry is owned by
a different author (Klaus Heringer, `klausners/prompt-optimizer`). This
repository is **not published to that package name** and any `npm install -g
prompt-optimizer` instructions in earlier documentation were incorrect.

For this repository, install from source:

```
git clone https://github.com/chrbailey/prompt-optimizer.git
cd prompt-optimizer && npm install && npm run build
```

## GitHub Action

The action is pinned at `chrbailey/prompt-optimizer/action@main`. Pinning to a
commit SHA rather than a branch is recommended for supply-chain safety in
production workflows.

## Secret Handling

- The tests and CI do not require any real API keys; scoring paths are
  exercised without network access.
- The `optimize` and `route --quality best` paths read API keys at runtime.
  Never log the value of an API key. Never include a populated `.env` in a
  commit.
