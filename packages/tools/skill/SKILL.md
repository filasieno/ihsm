---
name: ihsm
description: Design and author hierarchical state machines with the ihsm TypeScript library (states as classes, events as methods, hierarchy as inheritance, actor mailbox). Use when creating or reviewing an ihsm state machine, designing a *Protocol interface, modelling a state chart, deciding how each state reacts to each event, writing deterministic simulation tests with ihsm/testing (makeTestActor, @mock, makeTestPort, TestPort), or working with makeHsm, TopState, transition, post, call, postNow, onEntry/onExit, restore, or @InitialState.
---

# Authoring ihsm state machines

`ihsm` models domain logic as **classes**: states are classes, events are methods,
hierarchy is class inheritance, transitions are `this.transition(NextState)`, and the
runtime is an **actor** with a serialized mailbox. A machine has a `Context` (domain
data) and a `Protocol` (its event vocabulary). The library is built for **Deterministic
Simulation Testing** — determinism is the design center, not an afterthought.

Do **not** start by writing classes. Author a machine in phases: event storming →
protocol design → state chart → per-state decision matrix → implementation. The hard
part is not the API, it is **factoring the hierarchy** so the right behaviour is
selected for every (state, event) pair.

## Two semantics you must internalize

These differ and drive every design decision:

| Member | Inherited via prototype chain? | If a state omits it |
|--------|--------------------------------|---------------------|
| **Protocol methods** (`start`, `onData`, `getStatus`) | **Yes** | Dispatch walks up to a parent handler. If no ancestor defines it → `onUnhandled` |
| **`onEntry` / `onExit`** | **No** | Only states with their *own* hook run it during a transition. A child never triggers a parent's `onEntry` automatically |

So: omitting a protocol method = "delegate to parent (or be unhandled)". `onEntry`/`onExit`
are per-state lifecycle, run only where explicitly defined along the transition path.

## Phase 1 — Event storming

An event storming phase should be done to try to collect all possible events that a
State Machine must react to. List every signal from **outside** the machine — client
commands, queries, and observations from the environment (OS, network, subprocess,
timers). Do not invent internal sequencing events yet.

## Phase 2 — Protocol design

The `*Protocol` interface is the **user-facing mailbox**. It should only contain
EXTERNAL EVENTS to make it clear to the user what a state machine reacts to. It must
not carry actor-internal sequencing.

Classify each storming result into exactly one kind:

| Kind | Naming | Shape | Sent with | Posted by |
|------|--------|-------|-----------|-----------|
| **Command** | imperative verb (`start`, `stop`, `kill`) | `(payload...): void` | `post` (fire-and-forget) | clients |
| **Query** | noun/`get*` | `(resolve, reject, payload...): Promise<void>` | `call` (sync request/response) | clients |
| **Environment signal** | `on`-prefixed (`onData`, `onProcessExit`, `onPortReady`) | `(payload...): void` | `post` | the outside world / port layer |

Rules:

- **Commands should be imperative verbs.**
- **External signal events should be prefixed with `on`.** Reserve `onEntry`/`onExit`
  for state lifecycle — never put them on the protocol; use e.g. `onProcessExit`.
- **Queries** use the `(resolve, reject, ...)` signature and return `Promise<void>`;
  clients `await hsm.call('getStatus')` and receive a typed result.
- Forbidden on the protocol: internal scheduling/lifecycle glue (`onFinishStop`,
  `onPortNotReady`), and anything only the actor posts to itself. Internal follow-ups
  use `this.post` / `this.postNow` / `this.deferredPost` from handlers instead.

Litmus test: *would an external client or the environment post this?* If only the actor
posts it to itself, it does not belong in the protocol.

## Ports — the only channel to the outside world

A **port** is the only possible way to allow the state machine to talk to the external
world. All I/O — spawning processes, sockets, DB calls, file system, timers that matter —
goes through a port interface; handlers never import `node:child_process`, `node:fs`, etc.
directly.

- **Ports must be passed when creating the context.** The `Context` holds the port(s);
  `makeHsm(Top, new Ctx(port))`. Handlers reach them as `this.ctx.port`.
- A port method that **generates external events** must require the calling state handler
  to pass a **disposable event sink** — a minimal `post("on…")` forward target — and must
  return a `Disposable`. The sink forwards environment signals back into the machine as
  `on*` protocol events.
- **The sink is per port call.** Each call gets its own sink and its own `Disposable`
  subscription. The handler stores the disposable in `ctx` and disposes it on
  exit/teardown; handlers ignore late events once the subscription is gone.

```typescript
interface Port {
  kill(pid: number, signal: string): Promise<void>;            // awaited request, no events
  spawn(spec: SpawnSpec, sink: EventSink,                      // generates events:
        options?: SpawnOptions): Promise<{ pid: number; subscription: Disposable }>;
}

// EventSink mirrors exactly the on* members of the protocol; implemented by the Hsm itself.
interface EventSink {
  post(event: "onSpawn"): void;
  post(event: "onData", stream: "stdout" | "stderr", chunk: string): void;
  post(event: "onProcessExit", code: number | null, signal: string | null): void;
  // … one overload per environment signal
}
```

The real port wires OS callbacks to `sink.post("on…")`; in tests, a `@mock` port records
outbound calls and the test settles internal `on*` events with `port.send("on…")` when
ready — this is what makes testing deterministic.

## Phase 3 — State chart and hierarchy

States are classes extending `TopState<Ctx, Protocol>` or a parent state. Hierarchy must
be designed to factor correctly which behaviour is selected: put a handler on the
**lowest common ancestor** of every state that shares that reaction. Leaf-specific
reactions go on the leaf.

- Mark each composite's default child with the `@ihsm.InitialState` decorator on the
  class (not `ihsm.InitialState(Class)` at the module bottom).
- Top state: queries / always-valid handlers only; no environment `on*`.
- Intermediate state: shared reactions (e.g. an `ProcessObserving` parent that buffers
  `onData` for all running phases).
- Leaf state: phase-specific lifecycle reactions.

## Phase 4 — Decision matrix (the core step)

Then for each protocol method, for each state, a proper decision must be taken and
documented. Every cell resolves to exactly one of:

- **must be unhandled** — the event cannot legitimately arrive here; let it reach
  `onUnhandled` (fatal — default throws `UnhandledEventError`). Achieved by omitting the
  method *and* having no ancestor define it. Use when arrival is a **protocol bug** that
  must surface loudly.
- **must delegate to parent (not implemented)** — omit the method on this state so the
  parent's handler runs via prototype inheritance.
- **must be empty** — define `method() {}`. Use when the event **can** arrive (duplicate
  client command, orphaned timer, late port callback after unsubscribe) but must be
  swallowed without crashing — optionally log a warning inside the empty body. Not
  decoration: every empty override needs a documented reason.
- **must implement proper behaviour for reliability** — when the event can arrive in
  production and ignoring it or crashing would be wrong (e.g. `onData` after teardown
  should be dropped with a guard, not unhandled; `onProcessExit` in `Stopped` might need
  explicit cleanup). Prefer guarding in `ctx` over empty swallow when state matters.
- **must implement a proper behaviour** — define the handler: mutate `ctx`, and/or
  `this.transition(Next)`.

Write the matrix down (a table of states × protocol methods) and record the choice and
reason for each cell before coding. See [reference.md](reference.md) for a filled
template and a worked example.

## Phase 5 — Implementation rules

- `transition()` is **scheduled**; it runs after the current handler returns. Only the
  last call in a handler wins.
- **Never** call `transition()` at the end of an async `onEntry` — the runtime clears a
  transition requested inside `onEntry`/`onExit`. Instead `post` an `on*` event that
  reflects a real external observation, and transition from that handler.
- `ctx` is **data only** (buffers, ids, flags), mutated from state handlers; no logic or
  thin helper methods on it.
- Create with `makeHsm(TopState, ctx, initialize?)`. In Node, class names are preserved,
  so do not call `registerStateNames`; enable `experimentalDecorators` in `tsconfig.json`.

## Phase 6 — Deterministic Simulation Testing (DST)

**Determinism is the whole point of using a state machine.** ihsm is built for
[Deterministic Simulation Testing](https://filasieno.github.io/ihsm/testing): the same
inputs always produce the same outputs, and a failure replays exactly. Concurrency is
serialized (run-to-completion dispatch + `await sync()` barriers); wall-clock time,
ambient randomness, and real I/O are virtualized behind the **`Port`** seam.

Production imports `ihsm`; tests import **`ihsm/testing`** — a separate entry point that
never ships in production bundles:

```typescript
import { makeHsm, TopState } from 'ihsm';                              // production
import { makeTestActor, makeTestPort, mock, TestPort } from 'ihsm/testing'; // tests only
```

### Test surfaces

| Tool | Role |
|------|------|
| **`makeTestActor`** | White-box actor: merged public + internal protocol, typed `port`, `subscribe()` for golden traces |
| **`@mock` + `makeTestPort`** | Scriptable port stubs — `port.method.default(impl)`, `.once(impl)`, `.calls` |
| **`TestPort`** | Virtual clock (`advance(ms)`), scripted random (`feedRandom`, `feedUUID`), `record` / `trace` |
| **`restore(state, ctx)`** | Place the machine in any state without running `onEntry`/`onExit` |
| **`port.send(event, …)`** | Push internal `on*` events inward when the test decides |
| **`await sync()`** | Drain the mailbox — the determinism barrier between steps |

Two rules: **never perform I/O outside a port**, and **never `sleep()` on wall-clock
time** — call `port.advance(ms)` and `await sync()` instead.

### Mechanical exhaustive testing (mandatory strategy)

Do **not** improvise a handful of scenario tests. Use a **mechanical but reliable**
strategy that systematically covers the state × event surface. Because dispatch is
serialized and the port is scripted, every test is deterministic — no flakes, no races.

**Algorithm — BFS over reachable states:**

1. **Create the machine** — `makeTestActor(Top, freshCtx(), makeTestPort(MockPort))`.
   Pass `{ initialize: false }` when you will `restore()` states directly.
2. **Enumerate every state class** under the root (all exported state classes).
3. **Seed a worklist** with the `@InitialState` leaf.
4. **Loop until the worklist is empty:**
   - **Dequeue** a state `S`.
   - **List every event** that can arrive in `S` — all commands, queries, and
     environment `on*` from the Phase 4 decision matrix (public + internal where the
     port drives them).
   - **Create one test per event** `E`:
     - `sm.restore(S, freshCtx())` — place the machine (fresh ctx per test).
     - Script port stubs (`port.method.default(…)`) so outbound calls succeed
       deterministically; do **not** auto-deliver responses unless the scenario needs it.
     - Fire `E` — `sm.post(…)`, `await sm.call(…)`, or `port.send('on…', …)` for
       port-driven signals.
     - `await sm.sync()` — barrier.
     - **Assert** the documented outcome (state, `ctx`, `port.trace`, unhandled).
     - If `E` lands in state `T` not yet visited, **enqueue `T`**.
5. Repeat until every reachable state has been dequeued and every event tested.

This produces a **large set of tests following all reachable paths**. A missing
(state × event) test is a **missing design decision** from Phase 4.

### Negative smoke tests (after the worklist)

When the BFS pass is complete, run a **second pass over the full cartesian product**
(state × protocol event) — not only reachable paths. For every cell marked **must not
be received** in Phase 4 (or not yet decided), fire the event anyway as a **smoke test**
(`restore(S)` → post/call/send `E` → `await sync()`). Observe what actually happens,
then **choose and document** one of three strategies:

| Strategy | When to choose | Implementation | Test asserts |
|----------|----------------|----------------|--------------|
| **Fatal unhandled** | Arrival means a client/protocol bug; must never be silent | Omit handler (no ancestor defines it) → `onUnhandled` / `UnhandledEventError` | `dispatchErrorCallback` receives error; state unchanged |
| **Empty swallow + warning** | Event can legitimately arrive but must be ignored (duplicate command, idempotent retry, orphaned `deferredPost`) | `method() { log.warn(…); }` — blocks inherited handler | state and `ctx` unchanged; optional trace/log line |
| **Implement for reliability** | Event can arrive in production and wrong handling causes bugs (late port signal, race with teardown, partial cleanup) | Guard in handler (`if (!ctx.subscription) return;`) or explicit transition/cleanup | documented state/`ctx` outcome; machine stays consistent |

Do **not** leave negative cells implicit. If smoke test reveals the current code throws
but production can deliver the event, **fix the matrix** — either add an empty override
or implement proper handling; do not ship accidental fatals. If smoke test passes
silently via parent delegation but the event should be fatal here, add an empty override
to block inheritance or move the handler.

Prefer **golden traces** (`port.trace`, `test.subscribe(m => port.record(…))`) alongside
final state — two runs with the same inputs must yield byte-identical traces.

### Decision matrix → test assertions

| Documented outcome | Assertion |
|--------------------|-----------|
| implement behaviour | resulting state and/or `ctx` mutation; port calls in `port.method.calls` |
| empty no-op | state and `ctx` unchanged |
| delegate to parent | the parent's behaviour is observed |
| unhandled | `onUnhandled` fired or `UnhandledEventError` via `dispatchErrorCallback` |

### Mock port pattern

```typescript
@mock
abstract class MockSupervisorPort extends TestPort<SupervisorTop> {
  abstract spawn(spec: SpawnSpec): ResultWithSubscription<number>;
  abstract kill(pid: number, signal: string): Promise<void>;
}

const port = makeTestPort(MockSupervisorPort);
port.spawn.default(() => ({
  value: 1234,
  subscription: { dispose: () => port.record('dispose') },
}));

const sm = makeTestActor(SupervisorTop, new Ctx(port), port, { initialize: false });
sm.restore(Running, ctx);
sm.post('onProcessExit', 0, null);
await sm.sync();
expect(sm.currentStateName).to.equal('Stopped');
```

**Cardinal rule:** port stubs record outbound calls and return handles synchronously; the
test settles internal events with `port.send('on…')` when ready. One mock serves every
scenario (happy path, slow reply, error, cancellation).

See [reference.md](reference.md) for runtime gotchas, a worked supervisor example, and
restore-based test templates.

## Quick API reference

```typescript
import * as ihsm from "ihsm";

interface DoorProtocol {
  open(): void;                                                   // command
  close(): void;                                                  // command
  getOpenCount(resolve: ihsm.ResolveCallback<number>,            // query
               reject: ihsm.RejectCallback): void;
  onJam(reason: string): void;                                    // environment signal
}

class DoorTop extends ihsm.TopState<DoorCtx, DoorProtocol> {
  getOpenCount(resolve: ihsm.ResolveCallback<number>): void { resolve(this.ctx.openCount); }
}

@ihsm.InitialState
class Closed extends DoorTop {
  open(): void { this.ctx.openCount++; this.transition(Open); }
  close(): void {}                       // empty: expected no-op, avoids onUnhandled
}

class Open extends DoorTop {
  close(): void { this.transition(Closed); }
  // open omitted: delegates to DoorTop (unhandled) — opening an open door is a bug
}

const door = ihsm.makeHsm(DoorTop, { openCount: 0 });
door.post("open");
await door.sync();                       // drain mailbox
const n = await door.call("getOpenCount");
```

Messaging: `post` (fire-and-forget), `call` (typed `await`ed request/response),
`deferredPost(ms, ...)` (timer then post), `this.postNow` (hi-priority, handler-only),
`sync()` (drain queue, client/test only).

For full runtime semantics, the decision-matrix template, and a worked subprocess-
supervisor example, see [reference.md](reference.md).
