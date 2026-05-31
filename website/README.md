# ihsm documentation site

[Docusaurus](https://docusaurus.io/) app for [filasieno.github.io/ihsm](https://filasieno.github.io/ihsm/).

This follows the usual **library + `website/`** layout: the npm package lives at the repo root; the docs app is a sibling folder.

## Development environment

**Always enter the Nix dev shell** from the repo root before running npm scripts here.
The shell provides Node 22, PlantUML, Graphviz, and store-pinned dependencies.

```shell
cd ihsm
nix develop
# or: direnv allow    # .envrc → use flake
```

Run commands inside that shell, or prefix with `nix develop --command`:

```shell
nix develop --command npm run doc:preview
```

## Layout

```
ihsm/
├── src/                         # Library (npm package ihsm → lib/)
├── reference/REFERENCE.md       # Reference manual source
├── tutorials/                   # Runnable examples + README prose
├── website/
│   ├── docs-src/                # Committed MDX sources only
│   ├── docs/                    # GITIGNORED — built by npm run sync:docs
│   ├── sidebars.ts              # GITIGNORED — generated
│   └── src/components/InteractiveTutorial/
├── scripts/prepare-website-docs.mjs
└── docs-build/                  # GITIGNORED — Docusaurus static output
```

## Generated vs source (never commit generated)

| Gitignored output | Source |
|-------------------|--------|
| `lib/cjs/`, `lib/esm/` | `src/` via `tsc` (CommonJS + ESM builds) |
| `.tsc/` | TypeScript project-reference cache |
| `website/docs/` | `docs-src/` + generators |
| `website/sidebars.ts` | `generate-tutorial-mdx.mjs` (unified Documentation sidebar) |
| `website/static/img/plantuml/` | PlantUML SVGs from tutorial/reference generators |
| `docs-build/` | `docusaurus build` |

Enforced by:

- `.gitignore`
- `bash scripts/verify-no-generated-in-source.sh` (CI + Nix sandbox; also fails on stray compiled output under `src/`/`tutorials/`)

**PlantUML:** `npm run sync:docs` renders ` ```plantuml ` blocks to SVG via the `plantuml` CLI (Graphviz required). The Nix dev shell and `nix build .#docs` provide both.

Hand-written site pages live in **`website/docs-src/`** only (`intro.mdx`, `tutorials/index.mdx`).

## TypeScript

Single [project-reference](https://www.typescriptlang.org/docs/handbook/project-references.html) solution:

| Config | Role |
|--------|------|
| `tsconfig.json` | Solution entry |
| `tsconfig.lib.json` | CommonJS library → `lib/cjs/` |
| `tsconfig.esm.json` | ESM library → `lib/esm/` |
| `tsconfig.tutorials.json` | Example machines (Mocha + webpack) |
| `website/tsconfig.json` | Docusaurus + React |

## npm scripts (docs-related)

Run from the **repo root** inside **`nix develop`**. Full list: [README.md](../README.md#npm-scripts).

| Command | Purpose |
| ------- | ------- |
| `npm run sync:docs` | Materialize `website/docs/`, `website/sidebars.ts`, and PlantUML SVGs from sources |
| `npm run verify:source` | Fail if generated output appears in the source tree |
| `npm run typecheck` | Type-check the full solution (lib + tutorials + website); runs `sync:docs` first |
| `npm run build` | Compile publishable library → `lib/cjs/` + `lib/esm/` (no Docusaurus bundle) |
| `npm run doc:preview` | `sync:docs`, then Docusaurus dev server (port 3010) |
| `npm run doc:site` | `sync:docs`, then production static site → `docs-build/` |
| `npm run doc` | `sync:docs`, then Docusaurus production build via the website workspace |
| `npm run verify:doc` | Sanity-check `docs-build/` output |

Sandboxed CI equivalent (no dev shell needed):

```shell
nix build .#docs       # production site + verify, outside npm
```

## Adding a tutorial

1. Create `tutorials/NN-name/` with `README.md`, `machine.ts`, `interactive.ts`, `tutorial.spec.ts`.
2. Add a row to `tutorials/README.md` (source index for contributors).
3. Inside `nix develop`, run `npm run sync:docs` — regenerates tutorial MDX, the table on `/tutorials`, and the unified sidebar.
