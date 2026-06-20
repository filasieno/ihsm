---
name: ihsm
description: Author hierarchical state machines with ihsm 0.1.1 the way mmkit/cbserver does — invariant-first design, the standard per-actor file layout (Config / Context / Invariants / Actor / Port + spawn factories), state nesting derived from invariant composition, the U/P/E/G/B handler verdict ladder, and deterministic mock-port tests (makeTestActor, @mock, restore, sync, port.send/advance). Use when creating or reviewing ihsm actors, deciding state hierarchy, classifying every (state × event) handler, writing *Invariants.ts, or modelling multi-actor networks (supervisor + connection + channels + readers).
---

# Authoring ihsm state machines (0.1.1, mmkit conventions)

`ihsm` models domain logic as **classes**: states are classes, the hierarchy is class
inheritance, events are methods, transitions are `this.hsm.transition(Next)`, and the runtime
is an **actor** with a serialized mailbox. Determinism is the design center.

In mmkit the design discipline is **invariant-first**: the state hierarchy is *derived from*
the invariant lattice, and every `(state × event)` cell is classified with one of five handler
verdicts. Do not start by writing classes — work the phases below.

Production import: `import * as ihsm from "ihsm"`. Tests only: `import * as ihsm from "ihsm/testing"`.

## Standard file layout (one actor)

Each actor is a directory of single-purpose files. Real example:
`packages/server/src/cbserver/actors/server/`.

| File | Role |
|------|------|
| `<Name>Config.ts` | Sub-interfaces (`services` / `notifications` / `internalNotifications` / `port`) → one `<Name>MachineConfig`; the **empty** `TopState`; actor + port type aliases |
| `<Name>Context.ts` | Mutable context class (`I<Name>Context`) + cross-actor wait helpers (`waitFor*Bootstrap`, `waitFor*Answer`) |
| `<Name>Invariants.ts` | `assert*(ctx)` predicate chain; **JSDoc is the canonical state documentation** (Why / How checked / Inherited by) |
| `<Name>Actor.ts` | State classes, hierarchy comment block, handler bodies, `registerStateNames` |
| `<Name>Port.ts` | Production `ihsm.Port<typeof Top>`; binds environment → `this.actor.notify.on*`; domain I/O + child-spawn methods |
| `spawn<Child>Child(ren).ts` | Child-spawn factories (sibling files; **not** `arms/`), invoked via `this.hsm.port.*` |

Network-level docs live beside the actors: `STATE-MACHINE-REPORT.md` (index → invariants),
`EVENT-COVERAGE-REPORT.md` (every Node event → notify → handler verdict), and a handler matrix
doc. Tests: `test/<area>/*.mock.test.ts` (fast, default) and `*.real.test.ts` (gated).

Enable `experimentalDecorators` in `tsconfig.json`.

## The Config bag and facets

One `<Name>MachineConfig` drives all typing. Split it into named sub-interfaces:

| Bucket | Handler shape | Client / caller facet | Members |
|--------|---------------|-----------------------|---------|
| `services` | `async …(): Promise<T>` | `await actor.call.*` | queries, `initialize` |
| `notifications` | `method(): void` | `actor.notify.*` | external commands (`start`, `stop`, `close`, `dispatch*`) |
| `internalNotifications` | sync `on*` / `do*` | port posts `on*`; handlers post `do*` | environment events + internal glue |
| `port` | methods on `Port` subclass | `this.hsm.port.*` | I/O, `spawn`, `kill`, child-spawn factories |
| `context` | mutable data | `ctx` / `this.ctx` | ids, queues, flags, child handles |

```typescript
// <Name>Config.ts
export interface CBConnectionMachineConfig {
  context: ICBConnectionContext;
  services: CBConnectionServices;            // await actor.call.*
  notifications: CBConnectionNotifications;   // actor.notify.*  (e.g. close())
  internalNotifications: CBConnectionInternalNotifications; // on* (env) + do* (glue)
  port: CBConnectionPort;                     // this.hsm.port.* (spawnCommandChannel, …)
}
export type CBConnectionActor = ihsm.ChildActor<CBConnectionMachineConfig>;
export type CBConnectionActorRef = ihsm.InboundActor<CBConnectionMachineConfig>;
export type CBConnectionActorHandle = ihsm.ExternalActor<CBConnectionMachineConfig>;
export class CBConnectionTop extends ihsm.TopState<CBConnectionMachineConfig> {
  protected _checkInvariant(): void {}
}
```

Classify each storming result: **command** → `notifications`; **query** → `services`;
**environment observation** → `internalNotifications` `on*`; **internal scheduling glue** →
`internalNotifications` `do*` (posted only from handlers via `this.notify.doX()`); **I/O** →
`port`. Litmus for `on*` vs `do*`: *would the outside world post this?* If only the actor
schedules it, it is `do*`.

Handlers use `this.notify.x()` / `this.notifyNow.x()` (priority), `this.hsm.transition(S)`,
`this.hsm.port.*`, `this.hsm.currentStateName`. Services return `Promise<T>` or throw.

## Two dispatch semantics (internalize these)

| Member | Inherited via prototype? | If a state omits it |
|--------|--------------------------|---------------------|
| Protocol handlers (`start`, `onData`, `initialize`, …) | **Yes** | walks up to first ancestor that defines it; else `onUnhandled` (default throws `UnhandledEventError`) |
| `onEntry` / `onExit` | **No** | only states that define their *own* hook run it |

So **omitting** a handler delegates to the parent; an **empty override** `m() {}` swallows the
event *here* and blocks the inherited handler.

## Invariants are the design center

`<Name>Invariants.ts` holds pure `assert<State>(ctx)` predicates. **Deeper asserts call
shallower ones first**, so a child's invariant is a strict superset of its parent's:

```typescript
export function assertProcessActive(ctx: ICBServerContext): void {
  assertProcessObserving(ctx);   // parent invariant must already hold
  assertLogReadersArmed(ctx);    // plus the child-specific predicate
}
export function assertRunning(ctx: ICBServerContext): void {
  assertProcessActive(ctx);      // Running ⊃ ProcessActive ⊃ ProcessObserving ⊃ Initialized
  if (ctx.serverMailbox === undefined) throw new Error("…");
}
```

JSDoc on each `assert*` is the **canonical documentation** — record *Why* the invariant holds,
*How checked*, and *Inherited by*. Do not duplicate this in field tables elsewhere.

**Nesting rule (the key design decision):** nest state `Child` under `Parent` **iff**
`assertChild` ⊇ `assertParent` (Child holds every Parent predicate plus more). The class
hierarchy must equal the invariant lattice. Do **not** nest merely to share code — nest only
when invariants compose. Factor shared handlers onto the **lowest** state whose invariant
guarantees they are safe (e.g. stdio forwarding lives on `ProcessStdioForwarding`, whose
invariant requires log-reader children to be armed).

Handler discipline:
- Every handler/service calls `this._checkInvariant()` **before** mutating context.
- Each leaf `_checkInvariant()` delegates to exactly one `inv.assert<State>(this.ctx)`.
- `onEntry`/`onExit` end with `inv.assert<State>(this.ctx)` **directly** — not
  `this._checkInvariant()` (the runtime may still report the source leaf mid-transition).
- Teardown glue (`doFinalizeClose`, `doBreakTransport`) may skip strict leaf invariants.

## The handler verdict ladder — classify every (state × event)

For each reachable `(state × event)`, choose exactly one verdict and document it. This is the
core of correct design: the same event gets a *different* verdict in different states.

| Code | Verdict | How to implement | Test asserts |
|------|---------|------------------|--------------|
| **P** | **Delegate to parent** | **Omit** the method — inherit the ancestor handler | event handled by ancestor; never duplicate the parent's body in the child |
| **B** | **Real behaviour** | implement: mutate `ctx`, `transition`, post `do*` | documented state change / output |
| **E** | **Empty swallow** | `m() { this._checkInvariant(); }` — optionally `cbTrace("actor:ignored-x", …)` to warn | no state/`ctx` change; warning observable if late event |
| **G** | **Guard throw** (client error) | `throw new Error("illegal state: …")` | rejected call / thrown error, machine unchanged |
| **U** | **Unhandled → fatal** | implement **nowhere** up the chain | `UnhandledEventError` via `dispatchErrorCallback` |

**P — "never have parent and child with the same implementation."** If a child would do exactly
what the parent does, *omit* it (P). Duplicating the body is a bug: it desynchronizes silently.

**B** is the only verdict that changes state.

**E** is for an event that can legitimately *arrive* in this state but must be ignored — e.g.
`start()` while already `Starting`/`Running` (idempotent no-op), or a late `onStdoutLine` after
detach. When the arrival is *surprising but harmless*, emit a warning (`cbTrace(...)`) inside
the empty body so it is observable, then return.

**G** is for a client API used in the wrong phase — a caller error, not a protocol violation:
`createConnection` outside `Running`, `close()` before the connection is ready. Throw a clear
`illegal state` error; the client sees a rejected promise.

**U** is a true protocol violation that must *never* occur if the model is correct (e.g.
`onProcessExit` when no process was ever spawned). Leave it unhandled so it crashes loudly in
tests. Every U (and every E) cell gets a dedicated negative smoke test.

> The user-facing ladder, in order: **P** (omit → parent) → **B** (behaviour) →
> **E** (empty, warn if surprising) → **G** (fatal client error / throw) →
> **U** (implemented nowhere → unhandled).

## Authoring phases

1. **Event storming** — list every external signal: client commands/queries + environment
   observations (subprocess, socket, timers, child-actor callbacks).
2. **Config bag** — classify each into a facet (table above); name `on*` vs `do*` precisely.
3. **Invariants** — write the `assert*` predicates and their composition chain *first*. The
   chain defines the state hierarchy.
4. **State chart** — derive nesting from invariant composition; `@ihsm.InitialState` on the
   bootstrap leaf and on the default leaf under each composite. Put a hierarchy comment at the
   top of `<Name>Actor.ts`.
5. **Decision matrix** — fill one verdict (U/P/E/G/B) per `(state × event)` with a one-line
   reason *before* coding. See [reference.md](reference.md).
6. **Implement** — handlers call `_checkInvariant()`; `onEntry` ends with `inv.assert*`.
7. **Test** — mock-port BFS over the matrix, then negative smoke tests, then optional real.

## Nested actor networks

Real systems are **trees of actors**. A parent composes children via a **port factory** so
tests can mock spawning — never call `makeChildActor` from a handler directly.

```typescript
// CBServerPort.ts — spawn method delegates to the factory file
async armLogReaders(server: CBServerActorRef) {
  return spawnLogReaderChildren(server as never as ihsm.ParentActor<typeof CBServerTop>, server);
}
// Running handler
this.ctx.children = await this.hsm.port.armLogReaders(server);
```

Each `spawn<Child>Child(ren).ts` factory must:

1. **Import `<Child>Actor.ts`** (the actor module, not config-only) so `registerStateNames`
   runs and `call.initialize` exists.
2. `ihsm.makeChildActor(asParentActor(parent), ChildTop, ctx, childPort, { initialize: false })`.
3. `child.hsm.restore(InitialLeaf, ctx)` on the leaf that owns `initialize()`.
4. `await child.call.initialize()` inside the factory.
5. Return the child handle.

Typical cbserver network: `CBServer` supervisor → stdout/stderr log readers + N `CBConnection`
orchestrators; each connection → command channel + notification channel (each channel → TCP
reader/writer). Messaging: parent→child void = `child.notify.x()`; parent→child service =
`await child.call.x()` (in a factory, never inside another `services` handler); child→parent =
`parent.notify.onX()` via a context mailbox.

## Run-to-completion (RTC) rules — these caused real bugs

1. `initialize()` must **not** await bootstrap. Set up the mailbox, transition to connecting;
   the client awaits `waitForConnectionBootstrap(ctx)` *outside* the service.
2. Never `await child.call.*` or `actor.hsm.sync()` inside a `services` handler — isolate
   spawn+init in a port factory.
3. Void commands are `notifications` (`notify.dispatchPwd()`), never `call`.
4. Never finish an async `onEntry` with `transition()` — post an `on*`/`do*` and transition
   from its handler. Only the **last** `transition()` in a handler wins.
5. Production port binds env → `this.actor.notify.on*()`.

## Deterministic testing (mock layer — mandatory)

```typescript
import * as ihsm from "ihsm/testing";

@ihsm.mock("spawn", "kill", "armLogReaders", "spawnConnection")
abstract class MockCBServerPort extends ihsm.TestPort<typeof CBServerTop> {
  abstract spawn(config: CBServerConfig): Promise<ihsm.ResultWithSubscription<number>>;
  abstract kill(pid: number, signal?: NodeJS.Signals): Promise<void>;
  // …
}

const port = ihsm.makeTestPort(MockCBServerPort);
port.spawn.default(async () => ({ value: 1234, subscription: { dispose() {} } }));

const actor = ihsm.makeTestActor(CBServerTop, ctx, port);
actor.hsm.restore(Uninitialized, ctx);     // place precisely, no lifecycle hooks
await actor.call.initialize();
await actor.hsm.sync();
actor.notify.start();
await actor.hsm.sync();
```

- `port.<m>.default(impl)` / `.once(impl)` script stubs; `port.send("onProcessExit", 0, null)`
  injects an environment event when the test is ready (do **not** auto-fire `on*` from a stub).
- `port.advance(ms)` drives virtual timers — never wall-clock `sleep`.
- `port.record(...)` / `port.calls` / `actor.subscribe(...)` build byte-identical golden traces.
- **BFS the matrix:** `restore(S)` → fire `E` → `await sync()` → assert verdict; enqueue new
  destination states. Then negative smoke tests for every U and E cell (a U cell asserts
  `UnhandledEventError` via a `dispatchErrorCallback` option).
- Real integration: separate `*.real.test.ts`, gated on a binary env var, short timeouts; same
  actor API, only the port is real.

## Quick API reference (0.1.1)

```typescript
import * as ihsm from "ihsm";
const actor = ihsm.makeActor(CBServerTop, ctx, new CBServerPort());
actor.notify.start();
await actor.hsm.sync();
const id = await actor.call.getConnectionId();

// inside a state class:
start(): void { this._checkInvariant(); this.hsm.transition(Starting); }   // B
stop(): void  { this._checkInvariant(); }                                  // E
async createConnection(): Promise<never> {                                 // G
  this._checkInvariant();
  throw new Error(`illegal state: createConnection not allowed in ${this.hsm.currentStateName}`);
}
// (omit a method entirely = P; implement nowhere = U)
onEntry(): void { this.notifyNow.doStart(); inv.assertSpawnPending(this.ctx); }
```

| Client | Handler self | Priority |
|--------|--------------|----------|
| `actor.notify.x()` | `this.notify.x()` | default queue |
| `actor.notifyNow.x()` | `this.notifyNow.x()` | priority queue (drains first) |
| `await actor.call.x()` | — (services on leaves) | awaited service |
| `await actor.hsm.sync()` | — | drain mailbox |
| `actor.hsm.restore(S, ctx)` | — (tests) | place without lifecycle hooks |

`registerStateNames({ Top })` then `registerStateNames(self)` at the bottom of `<Name>Actor.ts`.

For the decision-matrix template, invariant-chain example, full spawn factory, worked
supervisor+connection example, BFS generation, and negative smoke tests, see
[reference.md](reference.md).
