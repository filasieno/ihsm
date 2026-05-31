# Documentation sources (committed)

Hand-written pages live here; `npm run sync:docs` copies them into gitignored `website/docs/` and
runs generators for reference + tutorials.

| Committed source | Generated in `website/docs/` |
|------------------|------------------------------|
| `intro.mdx` | Home (`/`) |
| `tutorials/index.mdx` (prose + table marker) | Tutorial hub (`/tutorials`) |
| `reference/REFERENCE.md` (repo root) | Reference manual (`/reference`) |
| `tutorials/NN-*/README.md` | Tutorial pages + playgrounds |

Also generated: `website/sidebars.ts` (unified Documentation sidebar).
