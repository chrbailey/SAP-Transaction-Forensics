# Changelog

All notable changes to this project are recorded here. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versioning is
[Semantic Versioning](https://semver.org/) but this repository has not yet
shipped a 1.0 — every release should be treated as experimental.

## [Unreleased]

### Added
- `SECURITY.md` describing scope, reporting flow, and scaffold caveats.
- `CHANGELOG.md` (this file).

### Removed
- `.github/workflows/release.yml`. The scaffold has no release pipeline —
  no tags are pushed, no Docker images published to ghcr.io, no npm
  artifacts built. The workflow was causing false-failure noise on every
  push since early 2026 by running a zero-job validator path. If a real
  release pipeline is added later, bring it back with proper tag triggers.

## [0.1.0] — 2026-01-18

### Added
- Initial scaffold: backend (NestJS), mobile (React Native + Expo SDK 55),
  web (Refine + React 19), shared TypeScript types.
- Prisma schema for `User`, `WorkerProfile`, `Restaurant`, `Shift`,
  `ShiftClaim`, `ShiftSwap`, `GhostKitchenSession`, `Notification`,
  `InstantPayEnrollment`.
- Shift priority scoring (`shift-matcher.service.ts`): own-employee bonus,
  tier, reputation, reliability bonus, no-show penalty.
- Shift state machine (`shift-state-machine.service.ts`).
- Ghost kitchen session tracking (platform breakdown as JSON, status
  transitions ACTIVE / PAUSED / ENDED).
- Notification service with push (Firebase Cloud Messaging), quiet hours,
  rate limiting, deduplication. SMS and email channels are stubs.
- GitHub Actions CI with per-package change detection (backend, mobile, web)
  and Docker build gated on pushes to `main`.
- Dependabot for npm ecosystems.
- Honest README documenting scaffold state, known stubs, and mocked
  integrations.

### Known Stubs
- `AggregatorClientService` logs "[Mock]" messages; no real KitchenHub calls.
- `notification.service.ts` SMS path `// TODO: Implement Twilio SMS sending`.
- `notification.service.ts` email path `// TODO: Implement email sending`.
- `DailyPayClient` requires real credentials; not exercised in CI.

### Not Shipped
- End-to-end tests.
- Production deployment. The Docker build succeeds in CI but no runtime has
  been validated against real infrastructure.
- Verified authentication flows beyond unit scaffolding.

[Unreleased]: https://github.com/chrbailey/restaurant-scheduler/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/chrbailey/restaurant-scheduler/releases/tag/v0.1.0
