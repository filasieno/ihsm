# Examples

Runnable ihsm example machines used by the documentation site (interactive playgrounds) and by `npm run test:examples`.

| Series | Folders | Docs |
| ------ | ------- | ---- |
| **Config (start here)** | `00-config` | [Tutorial 00](./00-config/README.md) — `Config`, `notify` / `call`, `hsm` |
| **Standard** | `01-*` … `19-*` (no 06/16) | [Reference](/reference) — one playground per section |
| **Testing (DST)** | `testing-01-*` … `testing-05-*` | [Deterministic testing](/testing) |

Each example folder contains `machine.ts`, `interactive.ts`, and `tutorial.spec.ts`. Client code uses **`actor.notify`**, **`actor.notifyNow`**, and **`actor.call`** — not flat methods on the handle. Shared helpers live in [`shared/`](./shared/).

These are **not** published to npm — only `lib/` ships on the package.
