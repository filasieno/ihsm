[![CI](https://github.com/filasieno/ihsm/actions/workflows/ci.yml/badge.svg)](https://github.com/filasieno/ihsm/actions/workflows/ci.yml)
[![Documentation](https://github.com/filasieno/ihsm/actions/workflows/docs.yml/badge.svg)](https://github.com/filasieno/ihsm/actions/workflows/docs.yml)
[![Coverage Status](https://coveralls.io/repos/github/filasieno/ihsm/badge.svg?branch=master)](https://coveralls.io/github/filasieno/ihsm?branch=master)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![npm version](https://img.shields.io/npm/v/ihsm.svg)](https://www.npmjs.com/package/ihsm)
[![Node](https://img.shields.io/node/v/ihsm.svg)](https://github.com/filasieno/ihsm)

# ihsm

An _idiomatic_ hierarchical state machine library for TypeScript and JavaScript — **Samek/QP-style** class hierarchy with **cached LCA transitions**, **zero production dependencies**, and **100% code coverage** on the runtime.

## Quality

| Metric | Value |
|--------|-------|
| **Statements** | 100% |
| **Branches** | 100% |
| **Functions** | 100% |
| **Lines** | 100% |

Run the suite locally:

```shell
npm test
```

Coverage is enforced via `nyc` over all runtime sources under `src/` (excluding specs). Every dispatch path — production, debug, and verbose trace levels — is exercised.

## Features

- User-defined event payloads (typed `Protocol`)
- User-defined state context (`ctx`)
- Hierarchically nested states (class inheritance)
- Orthogonal regions (nest multiple machines; compose via `post`/`call`)
- Internal transitions (handle event without calling `transition()`)
- Explicit transitions with cached entry/exit sequences
- Guards (inline `if` in handlers)
- History (`ctx` + `restore()`)
- Entry / exit actions (`onEntry`, `onExit`)
- Async and sync handlers
- **`call()` — typed request/response through the actor mailbox** (unique)
- Actor-style messaging (`post`, `deferredPost`, serialized queue)
- Structured errors and trace levels

## Documentation

| Resource | Link |
|----------|------|
| **Documentation site** | [filasieno.github.io/ihsm](https://filasieno.github.io/ihsm/) |
| **Reference manual** | [docs/REFERENCE.md](./docs/REFERENCE.md) · [published](https://filasieno.github.io/ihsm/reference/) |
| **Tutorials** | [tutorials/](./tutorials/) · [in the docs site](https://filasieno.github.io/ihsm/reference/tutorials/) |
| **API reference** | [TypeDoc on the site](https://filasieno.github.io/ihsm/api/) |
| Examples | [`src/spec/`](./src/spec/) |
| Code of conduct | [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md) |

The full site (reference, tutorials, API) is rebuilt on every push to `master` / `main` (`.github/workflows/docs.yml`).

## Install

```shell
npm install ihsm@latest
```

Requires **Node.js 20+**.

## Development

**Prerequisites:** Node.js 20+, npm, Git. **Java 21+** is required only to build the documentation site (PlantUML statecharts).

```shell
git clone https://github.com/filasieno/ihsm.git
cd ihsm
npm ci
```

### Build commands

| Command | Purpose |
| ------- | ------- |
| `npm test` | Unit tests + **100%** coverage (`nyc mocha`) |
| `npm run test:tutorials` | Hands-on tutorial specs |
| `npm run test:all` | Both test suites |
| `npm run lint` | ESLint + Prettier |
| `npm run build` | Compile TypeScript → `lib/` |
| `npm run typecheck:tutorials` | Typecheck tutorial `machine.ts` files |
| `npm run check:plantuml` | Validate UML diagrams in READMEs |
| `npm run doc` | Full docs site → `docs/.vitepress/dist/` |
| `npm run doc:preview` | Dev server → http://localhost:5173/ihsm/ |
| `npm run verify:doc` | Assert production site output (same as CI) |
| `npm run benchmark` | ihsm vs XState comparison (dev dependency) |

Typical check before a PR:

```shell
npm run test:all
npm run lint
npm run check:plantuml
npm run doc && npm run verify:doc
```

### Documentation site

Sources of truth: `docs/REFERENCE.md`, `tutorials/*/README.md`, JSDoc in `src/index.ts`. Generated paths (`docs/reference/`, `docs/public/`, `docs/.vitepress/dist/`) are gitignored — edit sources only.

```shell
npm run doc:preview      # edit + hot reload (runs doc:prepare first)
npm run doc              # production build (PlantUML → SVG, TypeDoc, VitePress)
npm run verify:doc       # CI output checks
```

Preview the production build: `npm run doc` then `npx vitepress preview docs` → http://localhost:4173/ihsm/

Finer-grained scripts: `npm run doc:prepare` (sync markdown + diagrams + API only), `npm run doc:api` (TypeDoc only), `npm run doc:site` (VitePress only), `npm run traces:generate` (refresh tutorial trace samples).

## Contributing

Contributions are welcome — bug reports, docs, and code.

- Bug reports → [issue template](https://github.com/filasieno/ihsm/issues/new?template=bug_report.yml)
- Features → [issue template](https://github.com/filasieno/ihsm/issues/new?template=feature_request.yml)
- Security → [GitHub Security Advisories](https://github.com/filasieno/ihsm/security/advisories/new) (not public issues)

Please follow [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md). New behavior needs tests in `src/spec/`; tutorial changes need matching specs under `tutorials/`.

## License

[MIT](./LICENSE) © Fabio N. Filasieno, Roberto Boati
