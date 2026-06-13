# Tutorial 00 — config, handles, and `hsm`

Start here for the **v0.1** protocol model.

## What you learn

1. **Plain config `interface`** — one bag per machine: `context`, `services`, `notifications`, `internalServices`, `internalNotifications`, `port`. Do **not** `extends Config`; satisfy the shape structurally.
2. **`TopState<YourConfig>`** — the root state class takes your config interface as its single type parameter.
3. **State handler methods** — protocol keys are discovered from methods on your state classes (`async` → services, sync → notifications).
4. **Generated handles** — `makeActor` returns flat methods: `conn.open()`, `await conn.fetchFrames(n)`; no `post` / `call` / `Proxy`.
5. **`this.hsm` in handlers** — machinery only behind `hsm`: `this.hsm.transition(Open)`, `this.hsm.actor.close()`, `this.hsm.immediate…`, `this.hsm.port.defer(ms)…`, `this.hsm.sleep(ms)`.
6. **Reserved names** — `ctx`, `hsm`, `onEntry`, `onExit`, `onError`, `onUnhandled` cannot be protocol keys.

## Run

```bash
npm run test:examples:node -- --grep 'Tutorial 00'
```

See [`machine.ts`](./machine.ts) and the [reference](https://filasieno.github.io/ihsm/reference).
