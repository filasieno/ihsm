# ihsm

Class-based hierarchical state machines and actor mailboxes for TypeScript.

The project lives under **`packages/ihsm/`** (same tree as before, new path). The repo root is Git, CI, and a thin Nix forwarder.

[![CI](https://img.shields.io/github/actions/workflow/status/filasieno/ihsm/ci.yml?label=CI)](https://github.com/filasieno/ihsm/actions/workflows/ci.yml)
[![Documentation](https://img.shields.io/github/actions/workflow/status/filasieno/ihsm/docs.yml?label=docs)](https://github.com/filasieno/ihsm/actions/workflows/docs.yml)
[![npm ihsm](https://img.shields.io/npm/v/ihsm?label=ihsm)](https://www.npmjs.com/package/ihsm)
[![npm @ihsm/core](https://img.shields.io/npm/v/@ihsm/core?label=%40ihsm%2Fcore)](https://www.npmjs.com/package/@ihsm/core)
[![npm @ihsm/otel](https://img.shields.io/npm/v/@ihsm/otel?label=%40ihsm%2Fotel)](https://www.npmjs.com/package/@ihsm/otel)
[![License: MIT](https://img.shields.io/github/license/filasieno/ihsm)](https://github.com/filasieno/ihsm/blob/HEAD/LICENSE)

```bash
npm install ihsm
# optional scoped alias + OpenTelemetry bridge:
npm install @ihsm/core @ihsm/otel
```

📖 [Documentation](https://filasieno.github.io/ihsm/) · [Reference](https://filasieno.github.io/ihsm/reference) · [Testing](https://filasieno.github.io/ihsm/testing)

## Development

```bash
cd packages/ihsm
nix develop
npm run test:all
npm run build
```

From the repo root, `nix flake check` still works (forwards to `packages/ihsm`).

See [`packages/README.md`](packages/README.md) for the multipackage roadmap (`@ihsm/core`, `@ihsm/react`, …).
