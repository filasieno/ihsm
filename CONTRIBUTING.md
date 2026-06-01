# Contributing to ihsm

Thank you for considering a contribution. This document covers the development environment, build commands, and what we expect in pull requests.

## Getting started

```shell
git clone https://github.com/filasieno/ihsm.git
cd ihsm
```

### Requirements

**[Nix](https://nixos.org/download/)** with flakes enabled — the only prerequisite to build and test from source.

### Development environment

**Always use the Nix dev shell** before running npm scripts. It provides Node 22, PlantUML, Graphviz, and a store-pinned `node_modules` symlink (same lockfile as CI).

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

## Building

### Nix commands (CI parity)

| Command | Purpose |
| ------- | ------- |
| `nix flake check` | Full CI gate: library compile, unit + example tests, lint, docs site |
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
| `npm test` | Unit tests in Node (`src/spec/`), then the same specs minified in headless Chromium |
| `npm run test:node` | Node-only unit tests |
| `npm run test:browser` | Minified browser bundles for unit + example specs (Playwright + esbuild) |
| `npm run test:examples` | Example specs in Node, then minified in the browser |
| `npm run test:all` | `npm test` + `npm run test:examples` (both environments) |

First-time browser setup: `npx playwright install chromium` (not needed inside Nix dev shell — Chromium path is preset).

#### Quality

| Command | Purpose |
| ------- | ------- |
| `npm run typecheck` | Type-check the full project graph (CJS lib, ESM lib, examples, website); runs `sync:docs` first |
| `npm run lint` | Typecheck, then ESLint and Prettier check |
| `npm run prettier` | Auto-format TypeScript sources (`src/`, `examples/`, `website/`) |
| `npm run verify:source` | Fail if generated output (compiled `.js`/`.d.ts`, docs) appears in the source tree |
| `npm run release:check` | Local release gate: `test:all`, lint, build, doc, and `verify:doc` |

#### Documentation

| Command | Purpose |
| ------- | ------- |
| `npm run sync:docs` | Generate gitignored site inputs: `website/docs/reference.mdx`, `website/sidebars.ts`, PlantUML SVGs, API MDX from TSDoc |
| `npm run doc` | `sync:docs`, then production Docusaurus build (website workspace) |
| `npm run doc:preview` | `sync:docs`, then Docusaurus dev server at [localhost:3010/ihsm/](http://localhost:3010/ihsm/) |
| `npm run doc:site` | `sync:docs`, then static site → `docs-build/` |
| `npm run verify:doc` | Sanity-check `docs-build/` (links, assets, tutorial pages, API reference) |

Release process: [RELEASING.md](./RELEASING.md).

## Pull requests

- Bug reports → [issue template](https://github.com/filasieno/ihsm/issues/new?template=bug_report.yml)
- Features → [issue template](https://github.com/filasieno/ihsm/issues/new?template=feature_request.yml)
- Security → [GitHub Security Advisories](https://github.com/filasieno/ihsm/security/advisories/new) (not public issues)

Please follow [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md). New behavior needs tests in `src/spec/`; tutorial changes need matching specs under `examples/`.

**Generated output is never committed** — only sources (`src/`, `examples/`, `reference/`, `website/docs-src/`). CI runs `scripts/verify-no-generated-in-source.sh`. Build artifacts (`lib/`, `website/docs/`, `docs-build/`, …) are gitignored and produced by Nix/npm.

### TSDoc and API reference

Public API documentation lives in TSDoc comments on `src/index.ts`. After changing exports, run `npm run sync:docs` locally and verify the [API reference](https://filasieno.github.io/ihsm/api) section builds (`npm run verify:doc`).
