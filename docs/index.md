---
layout: home

hero:
  name: ihsm
  text: Documentation
  tagline: An idiomatic hierarchical state machine package for TypeScript — reference manual, tutorials, and API.
  actions:
    - theme: brand
      text: Read the reference
      link: /reference/
    - theme: alt
      text: Hands-on tutorials
      link: /reference/tutorials/
    - theme: alt
      text: API reference
      link: /api/

features:
  - title: Reference manual
    details: Key concepts, static typing, messaging, transitions, then(), makeHsm, restore(), errors, XState comparison — the canonical guide.
    link: /reference/
  - title: Seventeen tutorials
    details: Literate walkthroughs with UML statecharts and runnable code — one ihsm feature per tutorial.
    link: /reference/tutorials/
  - title: Typed actor mailbox
    details: post() for events, call() for typed request/response, then() for automatic follow-up, zero production dependencies.
  - title: API reference
    details: TypeDoc generated from src/index.ts — makeHsm, then(), HsmTopState, errors, trace levels.
    link: /api/
---

## Install

```shell
npm install ihsm@latest
```

Requires **Node.js 22+**.

## Build and preview the site locally

**Prerequisites:** Node.js 22+, npm. PlantUML statecharts render via
[Kroki](https://kroki.io) during the build (HTTPS, no local Java or Docker).

```shell
npm ci
npm run doc:preview    # dev server with hot reload
```

Open the dev server URL printed in the terminal (path **`/ihsm/`**, port **5173** by default).

For a production-style build (same output as GitHub Pages):

```shell
npm run doc            # → docs/.vitepress/dist/
npx vitepress preview docs
```

Preview serves **`/ihsm/`** on port **4173** by default.

Sources of truth: `docs/REFERENCE.md`, `tutorials/*/README.md`, JSDoc in
`src/index.ts`. See the [README](https://github.com/filasieno/ihsm#development)
for build commands.

The published site combines the **reference manual**, **tutorials** (under the
same navigation), and **TypeDoc API** into one GitHub Pages deployment.
