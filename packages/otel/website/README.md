# @ihsm/otel documentation site

[Docusaurus](https://docusaurus.io/) app for the OpenTelemetry add-on. Production build targets
[filasieno.github.io/ihsm-otel](https://filasieno.github.io/ihsm-otel/) (`baseUrl: /ihsm-otel/`).

## Layout

```
packages/otel/
├── website/
│   ├── docs-src/          # Committed MDX sources
│   ├── docs/              # GITIGNORED — copied from docs-src by sync:docs
│   ├── docusaurus.config.ts
│   ├── sidebars.ts
│   └── src/css/custom.css
├── scripts/prepare-website-docs.mjs
└── docs-build/            # GITIGNORED — Docusaurus static output
```

## npm scripts

Run from **`packages/otel/`**:

| Command | Purpose |
| ------- | ------- |
| `npm run sync:docs` | Copy `website/docs-src/` → `website/docs/` |
| `npm run doc` | Dev server (port 3000) |
| `npm run doc:build` | Production static site → `docs-build/` |

`prestart` / `prebuild` on the website workspace run `ensure-website-docs.mjs` when `website/docs/` is missing.
