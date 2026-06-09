# Examples

Runnable ihsm example machines used by the documentation site (interactive playgrounds) and by `npm run test:examples`.

| Series | Folders | Docs |
| ------ | ------- | ---- |
| **Standard** | `01-*` … `17-*` (no 06/16) | [Reference](/reference) — one playground per section |
| **Testing (DST)** | `testing-01-*` … `testing-05-*` | [Deterministic testing](/testing) |

Each tutorial folder contains `machine.ts`, `interactive.ts`, and `tutorial.spec.ts`. Shared helpers live in [`shared/`](./shared/).

These are **not** published to npm — only `lib/` ships on the package.
