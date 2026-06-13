# ihsm reference

Deeper runtime semantics, the decision-matrix template, transition gotchas, and a worked
example. Read `SKILL.md` first for the authoring phases.

## Runtime semantics that drive design

### Protocol method dispatch (inherited)

On dispatch the runtime reads `currentState.prototype[eventName]`. Because that is a
prototype lookup, **protocol handlers are inherited**: if the leaf does not define the
method, JavaScript walks up the class chain and runs the first ancestor that does. If no
class up to `TopState` defines it, `eventHandler` is `undefined` and the runtime routes
to `onUnhandled` (default: throws `UnhandledEventError`).

Consequences:

- **Omit a method** → delegate to the nearest ancestor handler.
- **Omit it everywhere** → the event is unhandled in that state.
- **Empty override** `m() {}` → blocks an inherited handler / swallows the event here.

### onEntry / onExit (NOT inherited)

When building a transition, ihsm filters the exit and entry paths to classes that define
their **own** hook (`Object.prototype.hasOwnProperty.call(proto, 'onEntry')`). Each state
node along the path runs only its own `onEntry`/`onExit`. A child entering does not
trigger a parent's `onEntry` automatically. If you want a parent's lifecycle to also run,
call `super.onEntry()` explicitly — but beware double-running: when you `transition` to a
composite, the runtime already descends `@InitialState` and runs **both** the composite's
and the leaf's own `onEntry`.

### Transitions

`this.hsm.transition(Next)` is scheduled, not immediate. After the handler returns the runtime
computes the lowest-common-ancestor path, runs `onExit` up to (not including) the LCA, then
`onEntry` down to the target (descending `@InitialState` chains for composites). Paths are
cached per `From=>To`.

Gotchas:

- A `transition()` requested inside `onEntry`/`onExit` is **cleared** when that lifecycle
  dispatch ends. Never finish an async `onEntry` with `transition()`. Instead, enqueue an
  `on*` notification (reflecting a real external observation) and transition from its handler.
- Only the **last** `transition()` in a handler wins.
- Self-transition with unchanged initial descent skips exit/entry.

### Mailbox and messaging

One job runs at a time; generated notification/service methods enqueue. While an async
handler `await`s, new messages queue (no re-entrancy).

| API | Where | Use |
|-----|-------|-----|
| `actor.event(...)` | client | fire-and-forget notification |
| `await actor.service(...)` | client | typed `Promise` reply |
| `this.hsm.actor.event(...)` | handler | normal follow-up after handler + transition |
| `this.hsm.immediate.event(...)` | handler | hi-priority; drains before normal `actor` queue |
| `this.hsm.defer(ms).event(...)` | handler | port timer then enqueue |
| `await actor.hsm.sync()` | client / tests | drain queue to marker |

### Errors

`UnhandledEventError` (no handler), `EventHandlerError` (handler threw),
`TransitionError` (`onEntry`/`onExit` threw), `InitializationError`, `FatalError`.
Override `onUnhandled(error)` / `onError(error)` on a state to recover or redirect;
defaults rethrow. Unrecovered errors hit `dispatchErrorCallback`.

## Decision-matrix template

Fill one cell per (state × protocol method). Mark each with one outcome and a one-line
reason.

Legend: **U** = fatal unhandled (protocol bug) · **P** = delegate to parent (omit) ·
**E** = empty swallow (can arrive, ignore + optional warn) · **B** = implement behaviour
(including reliability guards for late/duplicate events). Negative cells (**U**, **E**)
get a dedicated smoke test after the BFS worklist pass.

| State \ Event | `start` (cmd) | `stop` (cmd) | `onProcessExit` (env) | `getStatus` (query) |
|---------------|---------------|--------------|-----------------------|---------------------|
| `Top`         | —             | —            | —                     | **B** answer in any state |
| `Uninitialized` | **E** no-op until initialized | **P** | **U** no process yet | (P→Top) |
| `Stopped`     | **B** → `Starting` | **E** already stopped | **U** | (P→Top) |
| `Starting`    | **E** already starting | **B** → `Stopping` | **B** spawn died → fail | (P→Top) |
| `Running`     | **E** | **B** → `Stopping` | **B** → `Stopped` | (P→Top) |
| `Stopping`    | **E** | **E** already stopping | **B** → `Stopped` | (P→Top) |

`—` = method not relevant to that abstraction level. Cells reaching `Top` show the
inherited handler in parentheses.

## Worked example: subprocess supervisor

A state machine that supervises an external process. Hierarchy factors shared subprocess
IO into an intermediate `ProcessObserving` state so `Starting`, `Running`, and `Stopping`
all inherit `onData`/`onEnd` without repeating them.

```typescript
interface SupervisorProtocol {
  // commands (imperative verbs, fire-and-forget)
  start(): void;
  stop(): void;
  // queries (call → typed result)
  initialize(resolve: ihsm.ResolveCallback<void>, reject: ihsm.RejectCallback, port: Port): Promise<void>;
  getCurrentStateName(resolve: ihsm.ResolveCallback<string>, reject: ihsm.RejectCallback): Promise<void>;
  // environment signals (on-prefixed; posted by the port/OS, never the actor to itself)
  onSpawn(): void;
  onData(stream: "stdout" | "stderr", chunk: string): void;
  onProcessExit(code: number | null, signal: NodeJS.Signals | null): void;
  onPortReady(): void;
  onKillGraceElapsed(): void;
}

// Top: queries valid in every state, no environment on*
class SupervisorTop extends ihsm.TopState<Ctx, SupervisorProtocol> {
  getCurrentStateName(resolve: ihsm.ResolveCallback<string>): void { resolve(this.currentStateName); }
}

// Intermediate: shared subprocess IO for every "process armed" phase
class ProcessObserving extends SupervisorTop {
  onData(stream: "stdout" | "stderr", chunk: string): void { appendIo(this.ctx, stream, chunk); }
}

@ihsm.InitialState
class Uninitialized extends SupervisorTop {
  start(): void {}                                    // E: ignore until initialized
  async initialize(resolve: ihsm.ResolveCallback<void>, reject: ihsm.RejectCallback, port: Port) {
    this.ctx.port = port; resolve(); this.transition(Stopped);
  }
}

class Stopped extends SupervisorTop {
  onEntry(): void { disposeProcess(this.ctx); }       // own lifecycle; not inherited
  start(): void { this.transition(Starting); }        // B
  stop(): void {}                                     // E: already stopped
}

class Starting extends ProcessObserving {             // inherits onData
  onPortReady(): void { this.transition(Running); }   // B: external observation drives transition
  onProcessExit(): void { this.transition(Stopped); } // B: spawn died
  start(): void {}                                    // E: already starting
  stop(): void { this.transition(Stopping); }         // B
}

class Running extends ProcessObserving {
  onProcessExit(): void { this.transition(Stopped); }
  stop(): void { this.transition(Stopping); }
  start(): void {}                                    // E
}

class Stopping extends ProcessObserving {
  onEntry(): void {                                   // start the kill, schedule grace timer
    void this.ctx.port.kill(this.ctx.pid, "SIGTERM");
    this.deferredPost(this.ctx.killGraceMs, "onKillGraceElapsed");
  }
  onKillGraceElapsed(): void { void this.ctx.port.kill(this.ctx.pid, "SIGKILL"); }
  onProcessExit(): void { this.transition(Stopped); }
}
```

Notes tying back to the principles:

- Spawning happens in `Starting.onEntry` (async I/O) but the state advances only when the
  environment posts `onPortReady` / `onProcessExit` — never via `transition()` at the end
  of `onEntry`.
- `onData` lives once on `ProcessObserving`; `Stopped`/`Uninitialized` do not extend it, so
  late `onData` there is unhandled by design.
- `start()`/`stop()` empty overrides exist only where a client command can legitimately
  arrive but should be a no-op.

## Ports, sinks, and the context

The port is passed when the context is built; the machine reads it as `this.ctx.port`.

```typescript
class Ctx {
  port: Port;
  pid?: number;
  subscription?: Disposable;          // the per-call sink subscription
  killGraceMs = 300;
  constructor(port: Port) { this.port = port; }
}

const hsm = ihsm.makeHsm(SupervisorTop, new Ctx(realPort));
```

A handler that triggers external events passes the machine itself as the per-call sink and
keeps the returned `Disposable`:

```typescript
async onEntry(): Promise<void> {                       // in Starting / ProbingPort
  const sink = this.ctx.mailbox!;                      // = the Hsm, an EventSink
  const { pid, subscription } = await this.ctx.port.spawn(spec, sink, { listen });
  this.ctx.pid = pid;
  this.ctx.subscription = subscription;                // disposed on exit/teardown
}
```

Disposing the subscription detaches OS listeners; handlers also guard with
`if (this.ctx.subscription === undefined) return;` so signals that arrive after teardown
are ignored.

## Mock port for deterministic tests (`ihsm/testing`)

Import test helpers from `ihsm/testing` only — never from production code. Use
`@mock` + `makeTestPort` so port methods are scriptable stubs; the test drives internal
`on*` events with `port.send(…)` when ready — no real subprocess, no wall-clock races.

```typescript
import { makeTestActor, makeTestPort, mock, TestPort } from 'ihsm/testing';

@mock
abstract class MockSupervisorPort extends TestPort<SupervisorTop> {
  abstract spawn(spec: SpawnSpec): ihsm.ResultWithSubscription<number>;
  abstract kill(pid: number, signal: string): Promise<void>;
}

const port = makeTestPort(MockSupervisorPort);
port.spawn.default(() => ({
  value: 1234,
  subscription: { dispose: () => port.record('dispose') },
}));
port.kill.default(async (pid, signal) => { port.record('kill', pid, signal); });
```

Do **not** auto-deliver `on*` responses inside stubs — return handles synchronously, then
`port.send('onPortReady')` (or `port.send('onProcessExit', 0, null)`) when the test is
ready to settle.

## Mechanical BFS test generation

Exhaust the state × event surface with a worklist — do not hand-pick scenarios:

1. Create `makeTestActor(Top, freshCtx(), port, { initialize: false })`.
2. Enumerate every state class under the root.
3. Seed the worklist with the `@InitialState` leaf.
4. While the worklist is not empty: dequeue `S`; for each protocol event `E` reachable in
   `S`, write one test (`restore(S)` → fire `E` → `await sync()` → assert); enqueue any
   new destination state not yet visited.
5. A missing (state × event) test is an undecided Phase 4 cell.

## Negative smoke tests (after the worklist)

After the BFS pass, iterate **every** (state × event) cell the matrix marks as *must not
be received* (or still undecided). Smoke-test each: `restore(S)` → fire `E` →
`await sync()` → observe. Pick one strategy and add an explicit test:

| Strategy | Use when | Code | Assert |
|----------|----------|------|--------|
| **Fatal unhandled** | Protocol violation — must never arrive | omit handler | `UnhandledEventError` |
| **Empty + warning** | Can arrive, must be ignored | `e() { warn(…); }` | no state/`ctx` change |
| **Reliability handler** | Can arrive in production; silence or crash is wrong | guard or explicit cleanup | documented outcome |

If smoke reveals a mismatch (throws when production can deliver, or swallows when it
should fatal), **update Phase 4** and the implementation before shipping.

## restore-based test: one cell of the matrix

Each generated test places the machine in a precise state, fires one event, and asserts
the documented outcome.

```typescript
it('Running + onProcessExit → Stopped (behaviour)', async () => {
  const port = makeTestPort(MockSupervisorPort);
  port.spawn.default(() => ({ value: 1234, subscription: { dispose() {} } }));
  const ctx = new Ctx(port);
  ctx.pid = 1234;
  const sm = makeTestActor(SupervisorTop, ctx, port, { initialize: false });
  sm.restore(Running, ctx);

  sm.post('onProcessExit', 0, null);
  await sm.sync();

  expect(sm.currentStateName).to.equal('Stopped');
});

it('Stopped + stop() is a no-op (empty)', async () => {
  const port = makeTestPort(MockSupervisorPort);
  const sm = makeTestActor(SupervisorTop, new Ctx(port), port, { initialize: false });
  sm.restore(Stopped, sm.ctx);
  sm.post('stop');
  await sm.sync();
  expect(sm.currentStateName).to.equal('Stopped');
});

it('Stopped + onProcessExit is unhandled', async () => {
  const port = makeTestPort(MockSupervisorPort);
  const errors: Error[] = [];
  const sm = makeTestActor(SupervisorTop, new Ctx(port), port, {
    initialize: false,
    dispatchErrorCallback: (_hsm, err) => errors.push(err),
  });
  sm.restore(Stopped, sm.ctx);
  sm.post('onProcessExit', 0, null);
  await sm.sync();
  expect(errors[0]?.name).to.equal('UnhandledEventError');
});
```

After a real `start()` reaches `Starting`, settle the port observation explicitly:
`port.send('onPortReady'); await sm.sync();` then assert `Running`.

Wire `sm.subscribe(m => port.record(m.event, ...m.payload))` for a golden trace that must
be byte-identical across runs.
