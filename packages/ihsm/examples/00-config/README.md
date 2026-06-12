# Tutorial 00 — `Config`, handles, and `hsm`

Start here for the **v0.1** protocol model.

## What you learn

1. **`Config`** — one bag: `context`, `services`, `notifications`, `internalServices`, `internalNotifications`, `port`.
2. **`manifestFor<Config>(…)`** — lists protocol keys per bucket; checked at compile time (`DisjointConfig`) and at construction (`ProtocolCollisionError`).
3. **Generated handles** — `makeActor` returns flat methods: `conn.open()`, `await conn.fetchFrames(n)`; no `post` / `call` / `Proxy`.
4. **`this.hsm` in handlers** — machinery only behind `hsm`: `this.hsm.transition(Open)`, `this.hsm.actor.close()`, `this.hsm.immediate…`, `this.hsm.defer(ms)…`, `this.hsm.sleep(ms)`.
5. **Reserved names** — `ctx`, `hsm`, `onEntry`, `onExit`, `onError`, `onUnhandled` cannot be protocol keys.

## Run

```bash
npm run test:examples:node -- --grep 'Tutorial 00'
```

See [`machine.ts`](./machine.ts) and the [reference](https://filasieno.github.io/ihsm/reference).
