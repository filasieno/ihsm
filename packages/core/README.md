# @ihsm/core

[![npm version](https://img.shields.io/npm/v/@ihsm/core)](https://www.npmjs.com/package/@ihsm/core)
[![ihsm peer](https://img.shields.io/npm/v/ihsm?label=ihsm)](https://www.npmjs.com/package/ihsm)

Scoped npm entry point for [ihsm](https://www.npmjs.com/package/ihsm). Same runtime, same `ihsm/testing` subpath — use whichever import style fits your monorepo.

```bash
npm install @ihsm/core
```

```ts
import { makeHsm, TopState } from '@ihsm/core';
import { makeTestActor, TestPort } from '@ihsm/core/testing';
```

Implementation lives in the **`ihsm`** package (`packages/ihsm`). This package re-exports it and pins the same semver.

📖 [Documentation](https://filasieno.github.io/ihsm/)
