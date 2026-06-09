# @ihsm/core

Scoped npm entry point for [ihsm](https://www.npmjs.com/package/ihsm). Same runtime, same `ihsm/testing` subpath — use whichever import style fits your monorepo.

```ts
import { makeHsm, TopState } from '@ihsm/core';
import { makeTestActor, TestPort } from '@ihsm/core/testing';
```

Implementation lives in the **`ihsm`** package (`packages/ihsm`). This package re-exports it and pins the same semver.
