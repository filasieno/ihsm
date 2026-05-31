# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.0.19] - 2026-05-31

### Added

- **`index.browser.js`** — browser entry built from `src/index.browser.ts` (`package.json` `"browser"` field).
- Full **reference manual** published on the documentation site (`/reference`), generated from `reference/REFERENCE.md`.
- **`scripts/generate-reference-mdx.mjs`** and `npm run sync:reference` for docs sync.
- **`SECURITY.md`** — private vulnerability reporting via GitHub Security Advisories.
- Tutorial pages embed the **playground on the same page** as prose (generated from each tutorial README).

### Changed

- **Maintainer:** Fabio Nicola Filasieno (`fabio.filasieno@users.noreply.github.com`).
- Documentation site: **Docusaurus** with Nix CI, unified tutorials + playground, output under `docs-build/`.
- `npm run build` now runs **node + browser** TypeScript builds.
- `prepublishOnly` runs **all tests** (unit + tutorials) before publish.
- Tutorial and reference cross-links point at on-site `/reference` and `/tutorials` paths.
- CHANGELOG corrected for the 0.0.18 documentation stack (Docusaurus, not VitePress).

### Fixed

- Broken `browser` field (missing `lib/index.browser.js`).
- Reference page stub replaced with the full manual on GitHub Pages.

## [0.0.18] - 2026-05-31

### Added

- **`makeHsm()`** factory — replaces manual `HsmTopState` subclassing for most use cases.
- **`then()`** — decision pseudo-states with automatic follow-up transitions after handler completion.
- **`postNow()`** — hi-priority extended transitions scheduled before normal mailbox posts from the same handler.
- Tutorials **16 · then()** and **17 · postNow()**.
- Hierarchy tutorial **05** expanded with per-case walkthroughs (initialization, sibling, cross-branch, async, …).
- **Docusaurus** documentation site (reference, tutorials with embedded playgrounds) deployed to GitHub Pages.
- **Nix flake** for deterministic build, test, lint, and docs (`nix flake check`).
- PlantUML blocks in tutorial READMEs (rendered as code blocks on the docs site).

### Changed

- **Node.js 22+** required (`engines.node`).
- Tutorial **06** (entry/exit only) merged into **05 · Hierarchy & transitions**.
- README badges updated to shields.io (CI, docs, Coveralls, npm, license).
- TypeScript 6, ESLint 10, Mocha 11, NYC 18 toolchain refresh.
- 100% statement/branch/function/line coverage maintained across all dispatch paths.

### Removed

- Legacy VitePress `docs/` tree and XState benchmark scripts (`benchmark/`, `npm run benchmark`).

## [0.0.14] - 2022-03-15

Last npm release before the documentation and API refresh above.

[0.0.19]: https://github.com/filasieno/ihsm/compare/v0.0.18...v0.0.19
[0.0.18]: https://github.com/filasieno/ihsm/compare/v0.0.14...v0.0.18
[0.0.14]: https://github.com/filasieno/ihsm/releases/tag/v0.0.14
