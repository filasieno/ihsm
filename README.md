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
| **Documentation site** | [filasieno.github.io/ihsm](https://filasieno.github.io/ihsm/) |
| **Reference manual** | [reference/REFERENCE.md](./reference/REFERENCE.md) · [published](https://filasieno.github.io/ihsm/reference/) |
| **Tutorials** | [tutorials/](./tutorials/) · [published](https://filasieno.github.io/ihsm/tutorials/) |
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

| Command | What it builds / runs |
| ------- | --------------------- |
| `nix flake check` | Library compile, unit tests, tutorial tests, lint, docs site (full CI gate) |
| `nix build` | Library → `result/lib/` |
| `nix build .#lint` | ESLint, Prettier, tutorial typecheck |
| `nix build .#docs` | Documentation site → `result/share/doc/ihsm/` |

Full check before opening a PR:

```shell
nix flake check
```

### Documentation site

| Command | Purpose |
| ------- | ------- |
| `nix build .#docs` | Production static site |
| `nix develop --command npm run doc:preview` | Local preview at [localhost:3000/ihsm/](http://localhost:3000/ihsm/) |
| `nix develop --command npm run doc:site` | Production build → `docs-build/` |
| `nix develop --command npm run verify:doc` | Verify production site output |

After `nix build .#docs`, copy artifacts from `result/share/doc/ihsm/` or run
`bash scripts/verify-docs-site.sh result/share/doc/ihsm`.

### Library and tests

| Command | Purpose |
| ------- | ------- |
| `nix build` | Compile TypeScript → `lib/`, run unit + tutorial tests |
| `nix develop --command npm test` | Unit tests + coverage report |
| `nix develop --command npm run test:tutorials` | Tutorial specs only |
| `nix develop --command npm run test:all` | Both test suites |
| `nix develop --command npm run lint` | ESLint + Prettier |
| `nix develop --command npm run build` | Compile TypeScript → `lib/` |

Release process: [RELEASING.md](./RELEASING.md).

## Contributing

Contributions are welcome — bug reports, docs, and code.

- Bug reports → [issue template](https://github.com/filasieno/ihsm/issues/new?template=bug_report.yml)
- Features → [issue template](https://github.com/filasieno/ihsm/issues/new?template=feature_request.yml)
- Security → [GitHub Security Advisories](https://github.com/filasieno/ihsm/security/advisories/new) (not public issues)

Please follow [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md). New behavior needs tests in `src/spec/`; tutorial changes need matching specs under `tutorials/`.

## License

[MIT](./LICENSE) © Fabio N. Filasieno, Roberto Boati
