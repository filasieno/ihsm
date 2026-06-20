# @ihsm/otel

[![npm version](https://img.shields.io/npm/v/@ihsm/otel)](https://www.npmjs.com/package/@ihsm/otel)
[![ihsm peer](https://img.shields.io/npm/v/ihsm?label=ihsm)](https://www.npmjs.com/package/ihsm)

OpenTelemetry bridge for [ihsm](https://www.npmjs.com/package/ihsm) — traces and structured logs via the native `Instrumentation` seam (`registerCollector` / `createConsoleInstrumentation`).

Peer-depends on **`ihsm`** (≥ 0.1.23). No tracing code in actor handlers; register a provider once, then every spawned actor reports automatically.

## Install

```bash
npm install ihsm @ihsm/otel
```

## Node (server)

```ts
import { registerCollector, makeActor, Port } from 'ihsm';
import { startOtelNode } from '@ihsm/otel/node';

const stop = startOtelNode({ serviceName: 'my-service' });
registerCollector(stop.instrumentation);

const actor = makeActor(Top, ctx, new Port(), { initialize: true });
```

## Browser

```ts
import { registerCollector } from 'ihsm';
import { startOtelBrowser } from '@ihsm/otel/browser';

const stop = startOtelBrowser({ serviceName: 'my-app' });
registerCollector(stop.instrumentation);
```

## Testing

```ts
import { createIhsmSignalCollector, settle, processSignals } from '@ihsm/otel/testing';
```

See [`OTEL-SPEC.md`](./OTEL-SPEC.md) and the spec under `spec/` for the conformance model.

## Release

Published on the same semver tag as **`ihsm`** and **`@ihsm/core`** via `.github/workflows/release.yml`.

**Production install** (`npm install @ihsm/otel`) pulls only `@opentelemetry/*` runtime deps plus peer **`ihsm`**. Test tooling, eslint, and the docs site (Docusaurus under `website/`) are **dev-only** and never published (`files: ["lib"]`).

## Development

```bash
# Build ihsm first (otel tests consume a packed tarball, not file:../ihsm — avoids ihsm's Docusaurus/Playwright tree)
cd ../ihsm && npm run build
cd ../otel && npm run pack:ihsm && npm ci
npm test
npm run verify:prod   # npm audit --omit=dev (production dependency tree only)
```

Docs site (optional, separate lockfile): `npm run doc:build`
