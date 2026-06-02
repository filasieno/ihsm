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

## Phase 2 — next: multipackage workspace

Add siblings without moving `ihsm` again:

```
packages/
  ihsm/          # npm "ihsm" — runtime (unchanged location)
  core/          # npm "@ihsm/core" — thin re-export of ihsm
  react/         # npm "@ihsm/react" — React bindings (peer: ihsm, react)
  …
```

Planned mechanics:

1. Root `package.json` — private workspace, `"workspaces": ["packages/*"]`
2. Root `package-lock.json` — single lockfile for all packages
3. `ihsm` stays the implementation; `@ihsm/*` packages depend on it via `workspace:*` / peers
4. Release: version `ihsm` and `@ihsm/core` together; add `@ihsm/react` when it exists
5. Nix: extend or wrap flake once more than one package needs CI (optional per-package derivations later)

No second bulk move — only new folders under `packages/`.
