# Hands-on tutorials

These tutorials are part of the **[reference documentation](/reference/)** — read the manual first, then work through examples in order. **Start with tutorial 02 (Tracing)** before the rest: every chapter includes a colored trace sample explaining dispatch flow.

Each tutorial covers **one ihsm feature** with:

- a **UML statechart** (PlantUML)
- a **literate walkthrough** — prose woven with highlighted code snippets
- **runnable code** in `machine.ts` and `tutorial.spec.ts`

| # | Tutorial | Feature |
| - | -------- | ------- |
| 01 | [Hello state machine](./01-hello-state-machine/README.md) | Factory, `post`, `sync` |
| 02 | [Tracing](./02-tracing/README.md) | Trace levels, read dispatch logs |
| 03 | [Context](./03-context/README.md) | Domain `ctx` |
| 04 | [Protocol typing](./04-protocol-typing/README.md) | Typed `Protocol` |
| 05 | [Hierarchy](./05-hierarchy/README.md) | Deep hierarchy, every transition kind |
| 06 | [Entry & exit](./06-transitions-entry-exit/README.md) | LCA lifecycle |
| 07 | [Internal transitions](./07-internal-transitions/README.md) | No `transition()` |
| 08 | [Post & sync](./08-post-and-sync/README.md) | Mailbox |
| 09 | [Deferred post](./09-deferred-post/README.md) | Timers |
| 10 | [Call services](./10-call-services/README.md) | Typed `call()` |
| 11 | [Restore](./11-restore/README.md) | `restore()`, suspend/resume |
| 12 | [Error recovery](./12-error-recovery/README.md) | `onError` |
| 13 | [Async handlers](./13-async-handlers/README.md) | `async`/`await` |
| 14 | [Nested machines](./14-nested-machines/README.md) | Orthogonal actors |
| 15 | [Complex workflow](./15-complex-workflow/README.md) | Integration |

## Run tests

```shell
npm run test:tutorials
npm run test:tutorials -- --grep 'Tutorial 01'
```

Conceptual background: [Reference manual](../docs/REFERENCE.md) · [Published site](https://filasieno.github.io/ihsm/reference/)
