# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.0.18] - 2026-05-31

### Added

- **`makeHsm()`** factory — replaces manual `HsmTopState` subclassing for most use cases.
- **`then()`** — decision pseudo-states with automatic follow-up transitions after handler completion.
- **`postNow()`** — hi-priority extended transitions scheduled before normal mailbox posts from the same handler.
- Tutorials **16 · then()** and **17 · postNow()**.
- Hierarchy tutorial **05** expanded with per-case walkthroughs (initialization, sibling, cross-branch, async, …).
- VitePress documentation site (reference manual, tutorials, TypeDoc API) deployed to GitHub Pages.
- PlantUML rendering via [Kroki](https://kroki.io) — no local Java required for doc builds.
- `.nvmrc` pinning Node.js 22.

### Changed

- **Node.js 22+** required (`engines.node`).
- Tutorial **06** (entry/exit only) merged into **05 · Hierarchy & transitions**.
- README badges updated to shields.io (CI, docs, Coveralls, npm, license).
- TypeScript 6, ESLint 10, Mocha 11, NYC 18 toolchain refresh.
- 100% statement/branch/function/line coverage maintained across all dispatch paths.

### Removed

- XState benchmark scripts and dev dependency (`benchmark/`, `npm run benchmark`).

## [0.0.14] - 2024

Last npm release before the documentation and API refresh above.

[0.0.18]: https://github.com/filasieno/ihsm/compare/v0.0.14...v0.0.18
[0.0.14]: https://github.com/filasieno/ihsm/releases/tag/v0.0.14
