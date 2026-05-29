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
| API reference (TypeDoc) | [filasieno.github.io/ihsm](https://filasieno.github.io/ihsm/) |
| Examples | [`src/spec/`](./src/spec/) |
| Contributing | [CONTRIBUTING.md](./CONTRIBUTING.md) |
| Code of conduct | [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md) |

API docs are rebuilt on every push to `master` (`.github/workflows/docs.yml`).

## Install

```shell
npm install ihsm@latest
```

Requires **Node.js 20+**.

## Development

```shell
git clone https://github.com/filasieno/ihsm.git
cd ihsm
npm ci
npm test          # unit tests + 100% coverage report
npm run build     # compile to lib/
npm run doc       # generate docs/api/
npm run benchmark # ihsm vs XState (dev dependency)
```

See **[CONTRIBUTING.md](./CONTRIBUTING.md)** for coding standards, PR checklist, and quality gates.

## Contributing

Contributions are welcome. Please read [CONTRIBUTING.md](./CONTRIBUTING.md) before opening a pull request.

- Bug reports → [issue template](https://github.com/filasieno/ihsm/issues/new?template=bug_report.yml)
- Features → [issue template](https://github.com/filasieno/ihsm/issues/new?template=feature_request.yml)
- Security → [GitHub Security Advisories](https://github.com/filasieno/ihsm/security/advisories/new)

## License

[MIT](./LICENSE) © Fabio N. Filasieno, Roberto Boati
