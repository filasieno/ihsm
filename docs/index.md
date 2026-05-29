---
layout: home

hero:
  name: ihsm
  text: Documentation
  tagline: Reference manual first — concepts, semantics, and hands-on tutorials for Samek/QP-style class state machines in TypeScript.
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
    details: Key concepts, static typing, messaging, transitions, restore(), errors, XState comparison — the canonical guide.
    link: /reference/
  - title: Fifteen tutorials
    details: Literate walkthroughs with UML statecharts and runnable code — one ihsm feature per tutorial.
    link: /reference/tutorials/
  - title: Typed actor mailbox
    details: post() for events, call() for typed request/response, zero production dependencies, 100% runtime coverage.
  - title: API reference
    details: TypeDoc generated from src/index.ts — HsmFactory, HsmTopState, errors, trace levels.
    link: /api/
---

## Install

```shell
npm install ihsm@latest
```

Requires **Node.js 20+**.

## Build and preview the site locally

**Prerequisites:** Node.js 20+, npm, and **Java** (PlantUML renders tutorial
statecharts during the build).

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
