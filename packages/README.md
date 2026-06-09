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

[`core/`](core/) is published as **`@ihsm/core`** — a thin re-export of `ihsm`, `ihsm/testing`, and `ihsm/transition-routines` (same semver, depends on `ihsm@<version>`). The unscoped **`ihsm`** package remains the implementation and primary install path.

```ts
import { makeHsm } from 'ihsm';              // unchanged
import { makeHsm } from '@ihsm/core';        // scoped alias
import { TestPort } from '@ihsm/core/testing';
import { executeTransitionRoutine } from 'ihsm/transition-routines';
```

Release (`.github/workflows/release.yml`) publishes **`ihsm`** then **`@ihsm/core`** on every tag.

### `@ihsm/tools` (in progress)

[`tools/`](tools/) — development utilities (state discovery, transition-table generation,
testdata oracle). Ships the Cursor agent skill for authoring and DST testing under
[`tools/skill/SKILL.md`](tools/skill/SKILL.md) (companion: [`reference.md`](tools/skill/reference.md)).

### Phase 2 — later

```
packages/
  react/         # npm "@ihsm/react" — React bindings (peer: ihsm, react)
  …
```

Optional follow-ups: root npm workspace + single lockfile, Nix derivation for `@ihsm/core`.

## Development tools (`packages/tools`)

[`tools/`](tools/) is **`@ihsm/tools`** — private monorepo package, **not** published to npm. Use it while developing machines and future runtime optimizations.

| Command | Purpose |
| ------- | ------- |
| `cd packages/tools && npm run build` | Compile library + `ihsm-tools` CLI |
| `npm test` | Oracle specs: `@ihsm/core` vs generated routines (full cartesian, verbose traces) |
| `npx ihsm-tools transitions -i ./machine.js -t DoorTop -o ./machine.transitions.ts` | Emit cartesian `State × State` transition table |

**v1:** full cartesian product delegating to `ihsm/transition-routines` (`planTransitionClasses`, `executeTransitionRoutine`).

**Next:** reachability analysis — only `from → to` pairs where `this.transition(Target)` appears in handler source.
