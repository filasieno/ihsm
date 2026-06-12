# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-06-12

### Added

- **`Config`** — single type bag (`context`, `services`, `notifications`, `internalServices`, `internalNotifications`, `port`) replacing v0.0.x positional `TopState<Context, Public, Internal, Port>` generics.
- **Generated actor handles** — materialized prototypes per `(rootState, width)`; flat user method names (`conn.open()`, `await conn.fetchFrames(n)`). **No `Proxy`.**
- **`makeActor` / `makeInternalActor` / `makeOwnerActor`** (`makeHsm` alias) — factories infer `Config` from `TopState`; `manifestFor<Config>()` + `static readonly manifest` on the root state class.
- **`HandlerHsm` / `ActorHsm`** — machinery namespace behind **`this.hsm`** (handlers) and **`actor.hsm`** (clients): `transition`, `actor` / `immediate` / `defer`, `port`, `sleep`, trace.
- **Promise services** — `Config.services` / `internalServices` members return `Promise<Reply>` on the client; handlers may return values or `Promise` (no `resolve`/`reject` injection).
- **`RequestingPort`** — opt-in port base widening `port.actor` with `internalServices`.
- **`SelfCallDeadlockError`** — debug-build guard when a service targets the machine currently dispatching (Node `AsyncLocalStorage`).
- **`CallTimeoutError`** — optional `{ timeoutMs }` trailing arg on service client methods.
- **`ProtocolCollisionError`**, **`ReservedNames`**, **`buildProtocolIndex`** — runtime + compile-time protocol collision guards.
- **`examples/00-config/`** — tutorial for the new model.

### Changed

- **Breaking:** removed string dispatch **`post`**, **`call`**, **`send`**, **`postNow`**, **`deferredPost`** from the public actor surface (use generated methods and `hsm.actor` / `hsm.immediate` / `hsm.defer`).
- **Breaking:** handler machinery moved behind **`this.hsm`** (`this.transition(…)` → `this.hsm.transition(…)`).
- **Breaking:** removed **`ResolveCallback`** / **`RejectCallback`** service handler pattern.
- All **`examples/`** and specs migrated to `Config` + generated handles.
- **`TestPort.send`** — forwards to `port.actor.<internalNotification>(…)` for deterministic inbound events.

### Migration (0.0.x → 0.1.0)

| Before | After |
| ------ | ----- |
| `interface DoorProtocol { open(): void }` + `TopState<Ctx, Protocol>` | `interface DoorConfig extends Config { context; notifications: { open(): void } }` + `manifestFor` |
| `door.post('open')` | `door.open()` |
| `await wallet.call('getBalance')` | `await wallet.getBalance()` |
| `this.transition(S)` | `this.hsm.transition(S)` |
| `this.post('tick')` | `this.hsm.actor.tick()` |
| `getBalance(resolve, reject)` handler | `getBalance(): Promise<number>` handler |
| `makeHsm(Top, ctx)` | `makeOwnerActor(Top, ctx, new Port())` |
| `await door.sync()` | `await door.hsm.sync()` |
| `port.send('onData', x)` (tests) | `port.actor!.onData(x)` or `port.send('onData', x)` on `TestPort` |

## [0.0.22] - 2026-06-09

### Added

- **`@ihsm/core`** — scoped npm package (`packages/core`) that re-exports `ihsm` and `ihsm/testing`; published alongside `ihsm` on each release.
- **`RandomService`** — `random`, `cryptoRandom`, `randomUUID`, `getRandomValues` (standard JS random surface).
- **`Port<TopState>`** — production port base with JS-like timer services (`setTimeout`, `setInterval`, `clearTimeout`, `clearInterval`) and `RandomService`.
- **`TestPort`** — virtual clock (`advance`, `now`, `pending`), mocked random (`feedRandom`, `feedCryptoRandom`, `feedUUID`, `feedRandomBytes`, `resetRandom`), and built-in timer/random APIs matching `Port` without calling globals.
- **`PortHandle<Context, Internal>`** — renamed runtime binding interface (was `Port`).
- Expanded **Deterministic Simulation Testing** intro in `reference/TESTING.md` (checklist A–I).

### Changed

- **`deferredPost`** delegates to `port.setTimeout(callback, millis)` instead of `port.schedule(millis, callback)`.
- Domain port interfaces extend **`PortHandle`**, not `Port`; production implementations extend **`Port<TopState>`**.
- **`TestPort`** is now a concrete class (instantiate directly for timer-only tests); `@mock` subclasses remain abstract.
- Documentation, examples, and reference playgrounds updated for the new port model.

### Removed

- **`DefaultPort`**, **`ManualClockPort`**, **`DefaultTestPort`**, and **`TimerService`** / `schedule()` — superseded by `Port` and `TestPort`. Trace events with `test.subscribe(m => port.record(...))`.

### Migration

| Before | After |
| ------ | ----- |
| `new DefaultPort()` | `new Port()` |
| `new ManualClockPort<T>()` | `new TestPort<T>()` |
| `extends BasePort<T>` (production) | `extends Port<T>` |
| `interface X extends Port<Ctx, Internal>` | `interface X extends PortHandle<Ctx, Internal>` |
| `port.schedule(ms, fn)` | `port.setTimeout(fn, ms)` |
| `handle.dispose()` (timer) | `port.clearTimeout(handle)` |
| `new DefaultTestPort(actor)` | `actor.subscribe(m => port.record(m.event, ...m.payload))` |

## [0.0.21] - 2026-06-01

### Added

- **`scripts/ensure-website-docs.mjs`** — `prestart` / `prebuild` only regenerate `website/docs/` when API or reference output is missing.
- **`scripts/expand-reference-examples.mjs`** and **`scripts/reference-examples.mjs`** — expanded Reference sections (when/why, state diagram, full commented sources, trace panel) from `examples/`.
- Staging prepare (`website/.docs-staging/`) so a failed doc step never leaves an empty `website/docs/`.
- **`examples/shared/playground-top.ts`** — `PlaygroundTopState` with `onUnhandled` that logs and ignores wrong events in trace-panel demos.

### Changed

- Reference page: per-example **when and why**, **full `machine.ts` listings**, diagram immediately above each **Trace** panel (removed redundant “before trace” heading).
- Documentation site: dark LibreDB-style theme, **1920px** centered layout (sidebar + content).
- Examples and reference: drop redundant **`implements Protocol`** on state classes — `TopState<Ctx, Protocol>` already binds typing for `makeHsm` / `post` / `call`.
- `render-plantuml.mjs`: optional SVG render in dev when PlantUML is absent; **`IHSM_REQUIRE_PLANTUML=1`** in Nix/CI (unchanged strict verify).
- `npm run clean` also removes `website/static/img/plantuml/`.
- Example READMEs: `/reference` links and `npm run test:examples` (was `test:tutorials`).

### Fixed

- Docs dev server “Can't resolve `@site/docs/api/…`” after partial `sync:docs` (API generated before reference; cache cleared on successful prepare).
- Trace panel no longer enters **FatalErrorState** when dispatching an event that is invalid for the active state (e.g. `open` while in `Open`).

## [0.0.20] - 2026-06-01

### Added

- Single **Reference** documentation page (`/reference`) with the full manual from
  `reference/REFERENCE.md` and **inline interactive playgrounds** per section.
- Runnable example machines relocated to top-level **`examples/`** (was `tutorials/`).

### Changed

- Documentation site: **Reference + API only** (removed per-topic Guide); `/guide` and
  `/tutorials` redirect to `/reference`.
- `npm run test:examples` replaces `test:tutorials`; browser suite entry renamed to `examples`.
- **`package.json` `description`** and README tagline: class-based HSM + actor mailbox positioning.
- CI: pure Nix gate (`nix flake check`); removed legacy `.travis.yml`.
- GitHub Actions CI uses `verify-no-generated-in-source.sh` (fixed stale script name).

### Removed

- `tutorials/` tree (content merged into reference; machines live under `examples/`).
- `scripts/generate-topics-mdx.mjs` and per-topic `/guide/*` pages.

### Security

- **`npm` overrides** pin `serialize-javascript` to `^7.0.5` (GHSA-5c6j-r48x-rmvq, high) and
  `diff` to `^8.0.3` (GHSA-73rr-hh4g-fpgx, moderate) for transitive devDependencies
  (Mocha, Docusaurus/webpack). `npm audit` reports **0 vulnerabilities**.

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

[0.0.19]: https://github.com/filasieno/ihsm/compare/0.0.18...0.0.19
[0.0.18]: https://github.com/filasieno/ihsm/compare/0.0.14...0.0.18
[0.0.14]: https://github.com/filasieno/ihsm/releases/tag/0.0.14
