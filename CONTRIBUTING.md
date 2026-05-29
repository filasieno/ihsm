# Contributing to ihsm

Thank you for your interest in contributing to **ihsm** — a zero-dependency,
Samek/QP-style hierarchical state machine for TypeScript.

This guide explains how to set up your environment, meet project quality
standards, and submit changes that maintainers can review quickly.

## Table of contents

- [Code of conduct](#code-of-conduct)
- [Ways to contribute](#ways-to-contribute)
- [Development setup](#development-setup)
- [Project structure](#project-structure)
- [Quality requirements](#quality-requirements)
- [Coding standards](#coding-standards)
- [Writing tests](#writing-tests)
- [Documentation](#documentation)
- [Submitting changes](#submitting-changes)
- [Commit messages](#commit-messages)
- [Pull request checklist](#pull-request-checklist)
- [Release process](#release-process)
- [Getting help](#getting-help)

## Code of conduct

This project follows [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md): **be good**.

## Ways to contribute

You do not need to write code to help:

| Contribution | Where to start |
| ------------ | -------------- |
| Bug reports | [Open a bug report](https://github.com/filasieno/ihsm/issues/new?template=bug_report.yml) |
| Feature ideas | [Open a feature request](https://github.com/filasieno/ihsm/issues/new?template=feature_request.yml) |
| Documentation | Edit `README.md`, `CONTRIBUTING.md`, or JSDoc in `src/index.ts` |
| Code fixes / features | Fork → branch → PR (this guide) |
| Security issues | [GitHub Security Advisories](https://github.com/filasieno/ihsm/security/advisories/new) — **never** use public issues |

## Development setup

### Prerequisites

| Tool | Version |
| ---- | ------- |
| Node.js | **20.x or 22.x** (LTS recommended) |
| npm | 9+ (ships with Node) |
| Git | 2.x |

### Clone and install

```shell
git clone https://github.com/filasieno/ihsm.git
cd ihsm
npm ci
```

Use `npm ci` (not `npm install`) so your lockfile matches CI.

### Verify your setup

```shell
npm test
```

All tests must pass and coverage must remain **100%** on runtime sources (see
[Quality requirements](#quality-requirements)).

> **Node 22:** Mocha is configured with `no-experimental-strip-types` in
> `.mocharc.json` so TypeScript decorators work with `ts-node`.

## Project structure

```text
ihsm/
├── src/
│   ├── index.ts              # Public API, types, HsmFactory, errors
│   ├── internal/
│   │   ├── hsm.ts            # Actor mailbox, transition cache, call()
│   │   ├── dispatch.*.ts     # Production / debug / verbose dispatch
│   │   └── utils.ts
│   └── spec/                 # Mocha tests (100% coverage target)
├── benchmark/                # ihsm vs XState comparisons (dev only)
├── docs/api/                 # Generated TypeDoc (gitignored, CI artifact)
├── .github/workflows/        # CI, docs deployment
├── typedoc.json
└── package.json
```

**Design philosophy:** states are **classes**, events are **methods**, hierarchy
is **inheritance**. See the [README](README.md) for feature rationale.

## Quality requirements

ihsm holds a high bar because the runtime is small and security-sensitive:

### 1. Tests must pass

```shell
npm test
```

96+ unit tests cover production, debug, and verbose dispatch paths.

### 2. Coverage must stay at 100%

Coverage is measured with `nyc` over `src/` (specs excluded):

| Metric | Required |
| ------ | -------- |
| Statements | **100%** |
| Branches | **100%** |
| Functions | **100%** |
| Lines | **100%** |

If you add code under `src/`, add tests under `src/spec/`. Uncovered lines will
fail CI.

### 3. Zero production dependencies

Do **not** add runtime `dependencies` to `package.json`. The library must
remain embeddable with no transitive deps.

### 4. CI must pass

Every PR runs [`.github/workflows/ci.yml`](.github/workflows/ci.yml):

- **Test & coverage** on Node 20 and 22
- **ESLint** + **Prettier** check
- **TypeDoc** build
- **TypeScript compile** (informational until TS 5.8 strict fixes land)

## Coding standards

### TypeScript

- Strict mode is enabled (`tsconfig.json`).
- Public API lives in `src/index.ts`; implementation in `src/internal/`.
- Mark non-public symbols with `@internal` (excluded from TypeDoc).
- Use tabs for indentation (matches existing code).

### Lint and format

```shell
npm run lint                 # ESLint
npx prettier --check './src/**/*.ts'
npm run prettier             # auto-fix formatting
```

Fix lint issues before opening a PR.

### State machine conventions

When adding examples or tests:

1. Extend `HsmTopState<Context, Protocol>`.
2. Declare events on a `Protocol` interface.
3. Mark initial substates with `@HsmInitialState`.
4. Call `this.transition(NextState)` only when the active state should change.
5. Use `call()` for request/response handlers (see `src/spec/call.spec.ts`).

```typescript
interface Protocol {
  doWork(value: string): Promise<void>;
  getStatus(resolve: (result: string) => void, reject: (error: Error) => void): void;
}
```

## Writing tests

Tests use **Mocha** + **Chai** and live in `src/spec/*.spec.ts`.

### Patterns

- Test all three trace levels where behavior differs (`TRACE_LEVELS` in
  `spec.utils.ts`).
- Use `await sm.sync()` after `post()` to wait for the mailbox to drain.
- Use `createTestDispatchErrorCallback(true)` when testing error paths that
  must not throw out of the dispatch loop.
- Name files `<feature>.spec.ts` and describe blocks after the feature.

### Example skeleton

```typescript
import { expect } from 'chai';
import 'mocha';
import { HsmFactory, HsmInitialState, HsmTopState, HsmTraceLevel } from '../';
import { TRACE_LEVELS, clearLastError } from './spec.utils';

class TopState extends HsmTopState<MyCtx, MyProtocol> {}

@HsmInitialState
class Idle extends TopState {}

for (const traceLevel of TRACE_LEVELS) {
  describe(`MyFeature (traceLevel = ${traceLevel})`, () => {
    // ...
  });
}
```

Run a single file:

```shell
NODE_OPTIONS='--no-experimental-strip-types' npx nyc mocha src/spec/call.spec.ts
```

## Documentation

### API reference (TypeDoc)

```shell
npm run doc
open docs/api/index.html
```

Docs are published to [GitHub Pages](https://filasieno.github.io/ihsm/) on
push to `master`.

When changing public types or methods, update JSDoc in `src/index.ts` with
`@category` tags. Use `@param`, `@returns`, and `@example` where helpful.

### README and guides

- Keep [README.md](README.md) concise; link here for contributor details.
- Large design docs belong in future `docs/REFERENCE.md` (not required for
  small PRs).

## Submitting changes

### 1. Fork and branch

```shell
git checkout -b fix/short-description
# or
git checkout -b feat/short-description
```

Use lowercase, hyphen-separated branch names.

### 2. Make focused changes

- One logical change per PR when possible.
- Avoid unrelated formatting or drive-by refactors.
- Keep the diff minimal — ihsm favors small, reviewable patches.

### 3. Run the full check locally

```shell
npm test
npm run lint
npm run doc
npm run build    # optional; may fail until TS strict migration completes
```

### 4. Open a pull request

Fill in the [pull request template](.github/pull_request_template.md).
Link related issues (`Fixes #123`).

Maintainers review for correctness, coverage, API stability, and alignment with
the class-based HSM model.

## Commit messages

Use clear, imperative subject lines:

```text
fix dispatch: clear transition state in finally block

Add a regression test for deferred post ordering when the mailbox is busy.
```

Guidelines:

- **Subject:** ≤ 72 characters, imperative mood (`add`, `fix`, `docs`, not `added`).
- **Body:** explain *why*, not only *what*, when non-obvious.
- **Footer:** reference issues (`Fixes #42`).

## Pull request checklist

Before requesting review, confirm:

- [ ] `npm test` passes with **100%** coverage
- [ ] New behavior has tests in `src/spec/`
- [ ] No new production `dependencies`
- [ ] ESLint and Prettier pass
- [ ] Public API changes include JSDoc updates
- [ ] README or CONTRIBUTING updated if workflow changed
- [ ] PR description explains the change and how you tested it
- [ ] You have read and agree to the [Code of Conduct](CODE_OF_CONDUCT.md)

## Release process

Maintainers only:

1. Bump `version` in `package.json` (semver).
2. Ensure `master` is green on CI.
3. `npm run dist` → publish to npm.
4. Tag: `git tag v0.0.x && git push origin v0.0.x`.

Contributors do not need to version-bump; maintainers handle releases.

## Getting help

- **Questions:** [GitHub Discussions](https://github.com/filasieno/ihsm/discussions) or an issue with the `question` label
- **Bugs:** [bug report template](https://github.com/filasieno/ihsm/issues/new?template=bug_report.yml)
- **Features:** [feature request template](https://github.com/filasieno/ihsm/issues/new?template=feature_request.yml)

We appreciate thoughtful contributions — especially tests, docs, and benchmarks
that keep ihsm tiny, typed, and fully covered.
