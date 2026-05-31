[![CI](https://img.shields.io/github/actions/workflow/status/filasieno/ihsm/ci.yml?branch=master&label=CI)](https://github.com/filasieno/ihsm/actions/workflows/ci.yml)
[![Documentation](https://img.shields.io/github/actions/workflow/status/filasieno/ihsm/docs.yml?branch=master&label=docs)](https://github.com/filasieno/ihsm/actions/workflows/docs.yml)
[![Coverage](https://img.shields.io/coverallsCoverage/github/filasieno/ihsm?branch=master)](https://coveralls.io/github/filasieno/ihsm?branch=master)
[![License: MIT](https://img.shields.io/github/license/filasieno/ihsm)](https://github.com/filasieno/ihsm/blob/master/LICENSE)
[![npm version](https://img.shields.io/npm/v/ihsm)](https://www.npmjs.com/package/ihsm)
[![Node](https://img.shields.io/badge/node-%3E%3D22-339933?logo=node.js)](https://github.com/filasieno/ihsm/blob/master/package.json)

# ihsm

An idiomatic hierarchical state machine package for TypeScript — **Samek/QP-style** class hierarchy with
**cached LCA transitions**, **zero production dependencies**, and **100% code coverage** on the runtime.

## Quality

| Metric | Value |
|--------|-------|
| **Statements** | 100% |
| **Branches** | 100% |
| **Functions** | 100% |
| **Lines** | 100% |

CI enforces full coverage on every push (`nix flake check`).

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
- **`then()` — decision pseudo-states with automatic follow-up transitions**
- **`postNow()` — hi-priority extended transitions within the same dispatch**
- Actor-style messaging (`post`, `deferredPost`, serialized queue)
- Structured errors and trace levels

## Documentation

| Resource | Link |
|----------|------|
| **Documentation site** | [filasieno.github.io/ihsm](https://filasieno.github.io/ihsm/) — reference manual + interactive tutorials |
| Reference (source) | [reference/REFERENCE.md](./reference/REFERENCE.md) |
| Tutorials (source) | [tutorials/](./tutorials/) |
| Examples | [`src/spec/`](./src/spec/) |
| Code of conduct | [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md) |
| Security | [SECURITY.md](./SECURITY.md) |

Each tutorial page on the documentation site combines prose, code samples, and an embedded playground
(sender/message forms, live trace, reset). The same machines are verified headlessly by Mocha specs under
`tutorials/*/tutorial.spec.ts`.

## Install

```shell
npm install ihsm@latest
```

Requires **Node.js 22+** at runtime.

## Requirements

**[Nix](https://nixos.org/download/)** with flakes enabled — the only prerequisite to build and test
from source.

## Building

```shell
git clone https://github.com/filasieno/ihsm.git
cd ihsm
```

### Development environment

**Always use the Nix dev shell** before running npm scripts. It provides Node 22,
PlantUML, Graphviz, and a store-pinned `node_modules` symlink (same lockfile as CI).

```shell
nix develop
# or: direnv allow    # .envrc → use flake; auto-enters the shell in supported terminals
```

Run npm commands **inside** that shell, or prefix each one with `nix develop --command`:

```shell
nix develop --command npm test
```

If you see `remove local node_modules/ to use Nix store deps`, delete a plain
`npm install` tree: `rm -rf node_modules` and enter `nix develop` again.

### Nix commands (CI parity)

| Command | Purpose |
| ------- | ------- |
| `nix flake check` | Full CI gate: library compile, unit + tutorial tests, lint, docs site |
| `nix build` | Compile library and run tests → `result/lib/` |
| `nix build .#lint` | TypeScript (full solution), ESLint, Prettier |
| `nix build .#docs` | Production documentation site → `result/share/doc/ihsm/` |

Full check before opening a PR:

```shell
nix flake check
```

After `nix build .#docs`, copy artifacts from `result/share/doc/ihsm/` or run
`bash scripts/verify-docs-site.sh result/share/doc/ihsm`.

### npm scripts

All commands below assume **`nix develop`** (interactive shell) or
**`nix develop --command …`** (one-shot). See [website/README.md](./website/README.md)
for docs-site layout and generated output.

#### Build

| Command | Purpose |
| ------- | ------- |
| `npm run build` | Compile the publishable library → `lib/cjs/` (CommonJS) and `lib/esm/` (ESM), then finalize |
| `npm run build-cjs` | Compile the CommonJS tree only → `lib/cjs/` |
| `npm run build-esm` | Compile the ESM tree only → `lib/esm/` |
| `npm run clean` | Remove generated artifacts (`lib/`, `.tsc/`, coverage, `docs-build/`, `website/docs/`, …) |
| `npm run dist` | Clean, then build library and documentation site (maintainer bundle) |

#### Test

| Command | Purpose |
| ------- | ------- |
| `npm test` | Run unit tests in `src/spec/` with NYC coverage |
| `npm run test:tutorials` | Run Mocha specs for all tutorials under `tutorials/` |
| `npm run test:all` | Run `npm test`, then `npm run test:tutorials` |
| `npm run coverage` | Print an LCOV coverage report from the last `npm test` run |

#### Quality

| Command | Purpose |
| ------- | ------- |
| `npm run typecheck` | Type-check the full project graph (CJS lib, ESM lib, tutorials, website); runs `sync:docs` first |
| `npm run lint` | Typecheck, then ESLint and Prettier check |
| `npm run prettier` | Auto-format TypeScript sources (`src/`, `tutorials/`, `website/`) |
| `npm run verify:source` | Fail if generated output (compiled `.js`/`.d.ts`, docs) appears in the source tree |
| `npm run release:check` | Local release gate: `test:all`, lint, build, doc, and `verify:doc` |

#### Documentation

| Command | Purpose |
| ------- | ------- |
| `npm run sync:docs` | Generate gitignored site inputs: `website/docs/`, `website/sidebars.ts`, PlantUML SVGs |
| `npm run doc` | `sync:docs`, then production Docusaurus build (website workspace) |
| `npm run doc:preview` | `sync:docs`, then Docusaurus dev server at [localhost:3010/ihsm/](http://localhost:3010/ihsm/) |
| `npm run doc:site` | `sync:docs`, then static site → `docs-build/` |
| `npm run verify:doc` | Sanity-check `docs-build/` (links, assets, tutorial pages) |

Release process: [RELEASING.md](./RELEASING.md).

## Contributing

Contributions are welcome — bug reports, docs, and code.

- Bug reports → [issue template](https://github.com/filasieno/ihsm/issues/new?template=bug_report.yml)
- Features → [issue template](https://github.com/filasieno/ihsm/issues/new?template=feature_request.yml)
- Security → [GitHub Security Advisories](https://github.com/filasieno/ihsm/security/advisories/new) (not public issues)

Please follow [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md). New behavior needs tests in `src/spec/`; tutorial changes need matching specs under `tutorials/`.

**Generated output is never committed** — only sources (`src/`, `tutorials/`, `reference/`, `website/docs-src/`). CI runs `scripts/verify-no-generated-in-source.sh`. Build artifacts (`lib/`, `website/docs/`, `docs-build/`, …) are gitignored and produced by Nix/npm.

## License

[MIT](./LICENSE) © Fabio N. Filasieno, Roberto Boati
