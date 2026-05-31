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
- **`then()` — decision pseudo-states with automatic follow-up transitions**
- **`postNow()` — hi-priority extended transitions within the same dispatch**
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

Requires **Node.js 22+** (provided by the Nix dev shell / package build).

## Development

**Prerequisite:** [Nix](https://nixos.org/download/) with flakes enabled. No separate Node.js or npm install is required.

```shell
git clone https://github.com/filasieno/ihsm.git
cd ihsm
nix develop          # optional: enter dev shell (direnv: allow once)
```

With [direnv](https://direnv.net/), run `direnv allow` once — the `.envrc` loads the flake dev shell automatically.

**Nixpkgs:** the flake follows `nixpkgs-unstable` for current Node.js and tooling, with the exact commit pinned in `flake.lock` (currently `e9a7635a57597d9754eccebdfc7045e6c8600e6b`). Reproducible builds use that lock; bump when you want newer packages:

```shell
nix flake update nixpkgs   # refresh lock to latest unstable
nix flake check            # verify after bump
```

### Nix build commands

| Command | Purpose |
| ------- | ------- |
| `nix build` | Compile TypeScript → `lib/`, run unit + tutorial tests |
| `nix build .#lint` | ESLint, Prettier, tutorial typecheck |
| `nix build .#docs` | Docusaurus site with interactive React tutorials |
| `nix flake check` | Library + lint (CI gate) |

Build outputs land in `./result/` (symlink). Library artifacts: `result/lib/`. Docs: `result/share/doc/ihsm/`.

Typical check before a PR:

```shell
nix flake check
nix build .#docs
bash scripts/verify-docs-site.sh site/build
```

### Dev shell scripts

Inside `nix develop`, `node_modules` comes from the same pinned `package-lock.json` as the Nix build:

| Command | Purpose |
| ------- | ------- |
| `npm test` | Unit tests + **100%** coverage (`nyc mocha`) |
| `npm run test:tutorials` | Hands-on tutorial specs |
| `npm run test:all` | Both test suites |
| `npm run lint` | ESLint + Prettier |
| `npm run build` | Compile TypeScript → `lib/` |
| `npm run doc:preview` | Docusaurus dev server with interactive tutorials |
| `npm run doc:site` | Static site → `site/build/` |
| `npm run verify:doc` | Assert production site output (same as CI) |

When `package-lock.json` changes, refresh the Nix npm hash:

```shell
nix run nixpkgs#prefetch-npm-deps -- package-lock.json
# → update npmDepsHash in flake.nix
```

### Documentation site

Interactive tutorials run ihsm in the browser (React + Docusaurus). Each page has sender/message
forms, a read-only trace panel, and a reset button. Mocha specs under `tutorials/*/tutorial.spec.ts`
exercise the same machines headlessly.

```shell
npm run doc:preview      # http://localhost:3000/ihsm/
npm run doc:site         # production build → site/build/
npm run verify:doc
```

## Contributing

Contributions are welcome — bug reports, docs, and code.

- Bug reports → [issue template](https://github.com/filasieno/ihsm/issues/new?template=bug_report.yml)
- Features → [issue template](https://github.com/filasieno/ihsm/issues/new?template=feature_request.yml)
- Security → [GitHub Security Advisories](https://github.com/filasieno/ihsm/security/advisories/new) (not public issues)

Please follow [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md). New behavior needs tests in `src/spec/`; tutorial changes need matching specs under `tutorials/`.

## License

[MIT](./LICENSE) © Fabio N. Filasieno, Roberto Boati
