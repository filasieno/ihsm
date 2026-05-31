# Examples

Runnable ihsm examples with UML statecharts, handler/client code, and specs in `machine.ts` and `tutorial.spec.ts`.

| # | Topic | Feature |
| - | ----- | ------- |
| 01 | [Hello state machine](./01-hello-state-machine/README.md) | `makeHsm`, `post`, `sync` |
| 02 | [Tracing](./02-tracing/README.md) | Trace levels, dispatch logs |
| 03 | [Context](./03-context/README.md) | Domain `ctx` |
| 04 | [Protocol typing](./04-protocol-typing/README.md) | Typed `Protocol` |
| 05 | [Hierarchy & transitions](./05-hierarchy/README.md) | Entry/exit, LCA, two deep stacks ([cases](./05-hierarchy/cases/)) |
| 07 | [Internal transitions](./07-internal-transitions/README.md) | No `transition()` |
| 08 | [Post & sync](./08-post-and-sync/README.md) | `post` (fire-and-forget), batch + `sync` |
| 09 | [Deferred post](./09-deferred-post/README.md) | Timers |
| 10 | [Call services](./10-call-services/README.md) | `call` (wait + return value) |
| 11 | [Restore](./11-restore/README.md) | `restore()`, suspend/resume |
| 12 | [Error recovery](./12-error-recovery/README.md) | `onError` |
| 13 | [Async handlers](./13-async-handlers/README.md) | `async`/`await` |
| 14 | [Nested machines](./14-nested-machines/README.md) | Orthogonal actors |
| 15 | [Complex workflow](./15-complex-workflow/README.md) | Integration |
| 16 | [then()](./16-then/README.md) | Decision pseudo states |
| 17 | [postNow()](./17-post-now/README.md) | Hi-priority extended transitions |

## Verify

```shell
npm run test:tutorials
npm run test:tutorials -- --grep 'Tutorial 01'
```

Background: [Reference manual](../docs/REFERENCE.md) · [Published site](https://filasieno.github.io/ihsm/reference/)
