# ihsm

Class-based hierarchical state machines and actor mailboxes for TypeScript.

The project was moved into **`packages/ihsm/`** (same tree as before, new path). The repo root is only Git, CI, and a thin Nix forwarder.

```bash
npm install ihsm
```

## Development

```bash
cd packages/ihsm
nix develop
npm run test:all
npm run build
```

From the repo root, `nix flake check` still works (forwards to `packages/ihsm`).

See [`packages/README.md`](packages/README.md) for the multipackage roadmap (`@ihsm/core`, `@ihsm/react`, …).
