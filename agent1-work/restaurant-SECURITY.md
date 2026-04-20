# Security Policy

## Scope and Status

This repository is a **development scaffold**, not a production system. It has
never been deployed in a production environment and has not undergone a formal
security review. Do not use it to store real worker PII, payroll data, or
payment credentials without first completing your own security hardening.

The README's "What This Is NOT" section is authoritative: external integrations
are mocked, authentication flows are scaffolded but not fully verified, and
several services are stubs. Treat any security claim not backed by a passing
test as unverified.

## Reporting a Vulnerability

If you find a security issue, please open a private report via
[GitHub Security Advisories](https://github.com/chrbailey/restaurant-scheduler/security/advisories/new).

Do not open a public issue for security reports.

Expect an acknowledgement within 7 days. Because this is a personal research
project, not a funded product, remediation timelines depend on severity and
whether the code path is actually exercised by the scaffold or only stubbed.

## What's In Scope

- Authentication and session handling (`backend/src/modules/identity`)
- Shift state machine authorization (`backend/src/modules/scheduling`)
- Claim and swap authorization (`backend/src/modules/shift-pool`)
- Database schema leakage (Prisma models in `backend/prisma/schema.prisma`)
- Secret handling in environment variables and `.env.production.example`

## What's Out of Scope

- Stubbed integrations (KitchenHub aggregator, Twilio SMS, SendGrid email)
- DailyPay client behavior against a live DailyPay endpoint
- Mobile app store distribution concerns (no builds have been shipped)
- Denial-of-service against the scaffold itself

## Secret Handling

- Never commit a populated `.env` file. Use `.env.production.example` as a
  template only — its values are placeholders.
- The CI workflow uses `JWT_SECRET: test-secret-key` as a fixed test value.
  That string must never be used in a real deployment.

## Dependency Updates

Dependabot is enabled for npm ecosystems (see `.github/dependabot.yml`). Merged
dependency PRs must pass the `CI` workflow before merge.
