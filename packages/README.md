# Packages

## Phase 1 — done: bulk move

Everything that was the **ihsm repo** now lives under [`ihsm/`](ihsm/):

- `src/`, `examples/`, `scripts/`, `test/`, `website/`, `reference/`
- `package.json`, `package-lock.json`, `flake.nix`, `flake.lock`
- TypeScript, ESLint, Prettier, Mocha, Typedoc config
- Build output: `lib/`, `docs-build/`

The **git repo root** only keeps shared infra:

- `.github/` (CI)
- Root `flake.nix` → forwards to `packages/ihsm`
- `.envrc`, `.gitignore`, `CONTRIBUTING.md`, `RELEASING.md`, `LICENSE` (repo-level)

Develop and publish from **`packages/ihsm/`** (same commands as before, different cwd).

## Phase 2 — in progress: `@ihsm/core`

[`core/`](core/) is published as **`@ihsm/core`** — a thin re-export of `ihsm` and `ihsm/testing` (same semver, depends on `ihsm@<version>`). The unscoped **`ihsm`** package remains the implementation and primary install path.

```ts
import { makeHsm } from 'ihsm';              // unchanged
import { makeHsm } from '@ihsm/core';        // scoped alias
import { TestPort } from '@ihsm/core/testing';
```

Release (`.github/workflows/release.yml`) publishes **`ihsm`** then **`@ihsm/core`** on every tag.

### Phase 2 — later

```
packages/
  react/         # npm "@ihsm/react" — React bindings (peer: ihsm, react)
  …
```

Optional follow-ups: root npm workspace + single lockfile, Nix derivation for `@ihsm/core`.
