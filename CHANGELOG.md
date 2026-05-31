# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.0.19] - 2026-05-31

### Added

- **Public state-naming API** — `defineStateName(StateClass, name)` and
  `registerStateNames(exports)` keep `currentStateName`, traces, and error
  messages stable in **minified browser bundles** (where `Class.name` is
  mangled). Documented in the reference manual (§6) and adopted by every
  tutorial; exercised by the minified browser test suite.
- **Genuine dual ESM + CommonJS build.** The package now ships native ESM
  (`lib/esm/`, real `import`/`export` with explicit `.js` extensions, Node-loadable
  and tree-shakeable) alongside CommonJS (`lib/cjs/`).
- **`exports` map** with `import`/`require` conditions and per-condition `types`,
  plus `main`, `module`, and `browser` entry points and `"sideEffects": false`.
- **`scripts/finalize-build.mjs`** — writes per-format `package.json` markers and
  rewrites ESM specifiers to genuine extensioned imports (no runtime deps).
- Full **reference manual** published on the documentation site (`/reference`), generated from `reference/REFERENCE.md`.
- **`SECURITY.md`** — private vulnerability reporting via GitHub Security Advisories.
- Tutorial pages embed the **playground on the same page** as prose (generated from each tutorial README).

### Changed

- **Maintainer:** Fabio Nicola Filasieno (`fabio.filasieno@users.noreply.github.com`).
- Documentation site: **Docusaurus** with Nix CI, unified tutorials + playground, output under `docs-build/`.
- `npm run build` now compiles **both** the CJS and ESM trees and finalizes them.
- `prepublishOnly` runs **all tests** (unit + tutorials) before publish.
- Tutorial and reference cross-links point at on-site `/reference` and `/tutorials` paths.
- CHANGELOG corrected for the 0.0.18 documentation stack (Docusaurus, not VitePress).

### Removed

- The CommonJS-only `index.browser.js` re-export entry (`src/index.browser.ts`,
  `tsconfig.browser.json`) — superseded by the real ESM build consumed via the
  `import`/`browser` conditions.
- `npm run verify:generated` and `scripts/verify-no-generated-tracked.sh`; the
  Nix sandbox guard `scripts/verify-no-generated-in-source.sh` (now also catching
  stray compiled output under `src/`/`tutorials/`) is the single enforced check.

### Fixed

- Generated `.d.ts` declarations no longer linger in `src/` / `tutorials/`; all
  TypeScript output is emitted to `lib/` and `.tsc/` and gitignored in source.
- Reference page stub replaced with the full manual on GitHub Pages.
- Spec state-class array types (`transition`, `error.transition`) now use the
  public `StateClass<Context, Protocol>` alias instead of a bare `new () => TopState`,
  fixing a construct-signature variance error surfaced by the toolchain upgrade.
- `tutorials/12-error-recovery` now references `ihsm.EventHandlerError` /
  `ihsm.UnhandledEventError` (previously unqualified, which broke `tsc -b`).
- Added the missing `eslint-config-prettier` dev dependency required by
  `eslint.config.mjs`, so `npm run lint` runs again; cleared the lint/type
  warnings it then surfaced in the spec suite.
- **Docs site build crash** — `registerStateNames(self)` in
  `tutorials/05-hierarchy` ran before the later `export const INIT_TRACE`,
  so enumerating the self-namespace under Webpack SSR threw `Cannot access
  'INIT_TRACE' before initialization`. The call is now the module's last
  statement, and the reference documents the placement rule.
- **Stale docs verification** — `scripts/verify-docs-site.sh` no longer asserts
  the removed `tutorials/16-then` page (which was failing the GitHub Pages
  deploy); it now also asserts the repeated statechart before "Reading the trace".

### Documentation

- Each tutorial page now repeats its **statechart diagram just before
  "Reading the trace"** (reusing the same rendered SVG) so the diagram and the
  trace are visible together without scrolling.

## [0.0.18] - 2026-05-31

### Added

- **`makeHsm()`** factory — replaces manual `TopState` subclassing for most use cases.
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
