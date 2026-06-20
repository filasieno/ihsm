# ihsm reference (mmkit conventions, 0.1.1)

Deeper material: invariant composition, the decision-matrix template, the handler verdict
ladder in code, the full spawn-factory checklist, a worked supervisor+connection example,
transition gotchas, and deterministic mock tests. Read `SKILL.md` first.

Canonical real sources to imitate (mmkit):
`packages/server/src/cbserver/actors/{server,connection,commandChannel,notificationChannel,reader,writer,stdoutLogReader,stderrLogReader}/`
and `packages/server/test/cbserver/*.mock.test.ts`.

## File layout recap

```
actors/<area>/
  <Name>Config.ts        MachineConfig bag + empty TopState + type aliases
  <Name>Context.ts       I<Name>Context class + waitFor*Bootstrap/Answer helpers
  <Name>Invariants.ts    assert<State>(ctx) chain — JSDoc is the canonical docs
  <Name>Actor.ts         state classes + hierarchy comment + registerStateNames
  <Name>Port.ts          ihsm.Port<typeof Top>; env → this.actor.notify.on*
  spawn<Child>Child(ren).ts   child-spawn factories (siblings, not arms/)
STATE-MACHINE-REPORT.md  index → per-actor invariants
EVENT-COVERAGE-REPORT.md every Node event → notify → handler verdict
```

## Config bag (faceted) — full example

```typescript
export interface CBConnectionServices {           // await actor.call.*
  getConnectionId(): Promise<ActorId>;
  tell(frames: string): Promise<CBCommandRequest>;
  ask(query: string, queryFormat?: string): Promise<CBCommandRequest>;
  // …
}
export interface CBConnectionNotifications {        // actor.notify.*  (external commands)
  close(): void;
}
export interface CBConnectionInternalNotifications { // on* (env) + do* (glue)
  doSpawnChannels(): void;
  doFinalizeClose(): void;
  doBreakTransport(message: string): void;
  onCommandChannelClosed(): void;
  onCommandChannelBroken(message: string): void;
}
export interface CBConnectionPort {                 // this.hsm.port.*
  spawnCommandChannel(parent: ihsm.ParentActor<typeof CBConnectionTop>, ctx: ICBCommandChannelContext, channelPort: CBCommandChannelPortInput): Promise<CBCommandChannelActor>;
  spawnNotificationChannel(parent: ihsm.ParentActor<typeof CBConnectionTop>, ctx: ICBNotificationChannelContext, channelPort: CBNotificationChannelPortInput): Promise<CBNotificationChannelActor>;
}
```

| Kind | Bucket | Naming | Posted by |
|------|--------|--------|-----------|
| Command | `notifications` | imperative verb | client `actor.notify` |
| Query | `services` | `get*` / noun | client `await actor.call` |
| Environment | `internalNotifications` | `on*` | port → `this.actor.notify.on*` |
| Internal glue | `internalNotifications` | `do*` | handler `this.notify.doX()` only |
| I/O / spawn | `port` | verb on Port class | `this.hsm.port.*` |

**Forbidden on the public protocol:** port method names; `do*` scheduling glue exposed to
clients; multiplexed stream handlers (`if (stream === "stdout")` — use separate
`onStdout*` / `onStderr*`); awaiting command/close/bootstrap promises inside `services`.

## Invariant composition = state hierarchy

The supervisor's invariant chain *is* its class tree. Deeper asserts call shallower ones, so
nesting is provable, not stylistic:

```typescript
assertInitialized(ctx)            // serverMailbox set
  ← assertProcessObserving(ctx)   //   + pid/subscription paired
      ← assertProcessActive(ctx)  //       + log readers armed
          ← assertRunning(ctx)    //           + (un-signalled live process)
```

```typescript
// CBServerInvariants.ts
export function assertProcessObserving(ctx: ICBServerContext): void {
  assertInitialized(ctx);
  const hasPid = ctx.pid !== undefined;
  const hasSub = ctx.processSubscription !== undefined;
  if (hasPid !== hasSub) throw new Error("pid and processSubscription must both be set or unset");
}
export function assertProcessActive(ctx: ICBServerContext): void {
  assertProcessObserving(ctx);
  assertLogReadersArmed(ctx);
}
```

JSDoc each `assert*` with **Why** (the domain reason it holds), **How checked**, and
**Inherited by**. That JSDoc is the canonical state-machine documentation — the
`STATE-MACHINE-REPORT.md` only indexes into it.

**Nesting test:** before nesting `Child` under `Parent`, confirm `assertChild` legitimately
begins by calling `assertParent`. If it cannot (the child does not hold the parent's
predicate), it is a *sibling*, not a child. Factor a shared handler onto the lowest state whose
invariant guarantees the handler's preconditions (e.g. `ProcessStdioForwarding.onStdoutData`
dereferences `ctx.children!`, so it sits on a state whose invariant requires log readers
armed; `SpawnArmed`, which has no children yet, overrides those handlers as **E**).

## Handler verdict ladder — in real code

Same event, different verdict per state. Examples from `CBServerActor.ts`:

```typescript
// B — behaviour: Stopped + start() boots
class Stopped extends ProcessDetached {
  start(): void { this._checkInvariant(); this.hsm.transition(Starting); }
}

// E — empty swallow: Initialized + start()/stop() are no-ops (already in that phase)
class Initialized extends CBServerTop {
  start(): void { this._checkInvariant(); }
  stop(): void  { this._checkInvariant(); }
  onStdoutLine(_line: string): void { this._checkInvariant(); } // late line after detach
}

// G — guard throw (client error): createConnection only legal in Running
class Initialized extends CBServerTop {
  async createConnection(): Promise<CBConnectionActor> {
    this._checkInvariant();
    throw new Error(`illegal state: createConnection is not allowed in ${this.hsm.currentStateName}`);
  }
}
class Running extends ProcessActive {
  async createConnection(options?: ICBConnectionOptions): Promise<CBConnectionActor> { /* B */ }
}

// P — delegate to parent: SpawnArmed omits onProcessExit so Starting's handler runs.
//     ConnectionIdle omits getConnectionId → inherits ConnectionBootstrap's.
//     Rule: a child NEVER repeats a parent body; it omits to inherit.

// U — unhandled: onProcessExit on a detached leaf with no process is implemented nowhere
//     reachable → UnhandledEventError. Asserted in a negative smoke test.
```

**Empty-with-warning (E variant).** When a swallowed event is *surprising but harmless*, make
it observable rather than silent:

```typescript
// CBCommandChannelActor.ts — a spontaneous notification ipcanswer with nothing awaiting it
onReaderNotification(answer: CBAnswer): void {
  this._checkInvariant();
  cbTrace("command-channel:ignored-notification", { completion: answer.completion });
  // swallowed: no state change, but logged for diagnosis
}
```

The user's phrasing maps directly: *"empty implementation (start in starting state) — emit a
warning"* is the **E** verdict with a `cbTrace` warning; *"a fatal error"* is **G** (throw);
*"unimplemented which means delegate to parent"* is **P** (omit); *"unimplemented again up to
unhandled"* is **U** (implemented nowhere → `UnhandledEventError`).

## Decision-matrix template

Fill one cell per `(state × protocol event)` with a verdict + one-line reason **before**
coding. Legend: **U** unhandled fatal · **P** delegate (omit) · **E** empty swallow (warn if
surprising) · **G** guard throw (client error) · **B** behaviour.

| State \ Event | `start` (cmd) | `stop` (cmd) | `createConnection` (query) | `onProcessExit` (env) |
|---------------|---------------|--------------|----------------------------|-----------------------|
| `Uninitialized` | U pre-init | U | (P→…) | U no process |
| `Initialized` | E ignore | E ignore | **G** illegal here | (P) |
| `Stopped` | **B** → `Starting` | E already stopped | G | U detached |
| `Starting` | E starting | (P→`ProcessObserving` → `Stopping`) | G not ready | **B** abort → detach |
| `Running` | E running | **B** → `Stopping` | **B** spawn child | **B** → `doCompleteStop` |
| `Stopping` | E | E already stopping | G | **B** → `doCompleteStop` |
| `Terminating` | E | E | G | **B** → `doCompleteStop` |

Cells reaching an ancestor (`P`) name the inherited handler. Every **U** and **E** cell gets a
dedicated negative smoke test after the BFS pass.

## Child-actor spawn factory (full checklist)

Failure mode: importing only `<Child>Config.ts` → `registerStateNames` never runs →
`child.call.initialize is not a function`.

```typescript
// spawnConnectionChild.ts
import { ConnectionUninitialized } from "./CBServerConnectionActor"; // actor module (side effects!)

export async function spawnConnectionChild(
  parent: ihsm.ParentActor<typeof CBServerTop>, context: CBConnectionContext, orchestratorPort: CBConnectionOrchestratorPort,
): Promise<CBConnectionActor> {
  const child = ihsm.makeChildActor(parent, CBConnectionTop, context, orchestratorPort, { initialize: false });
  child.hsm.restore(ConnectionUninitialized, context);
  await child.call.initialize();
  return child;
}
```

| Step | Action |
|------|--------|
| 1 | `import { <Child>Uninitialized } from "./...<Child>Actor"` (loads `registerStateNames`) |
| 2 | `makeChildActor(asParentActor(parent), ChildTop, ctx, port, { initialize: false })` |
| 3 | `child.hsm.restore(<Child>Uninitialized, ctx)` |
| 4 | `await child.call.initialize()` inside the factory |
| 5 | Parent calls the factory via `await this.hsm.port.spawn<Child>(...)` (never `makeChildActor` in a handler) |

The port method wraps the factory so tests mock it:

```typescript
// CBServerPort.ts (production)
async spawnConnection(server: CBServerActorRef, context: CBConnectionContext, orchestratorPort: CBConnectionOrchestratorPort) {
  return spawnConnectionChild(server as never as ihsm.ParentActor<typeof CBServerTop>, context, orchestratorPort);
}
```

## Worked example: supervisor hierarchy

```text
CBServerTop
* Uninitialized                 // pre-initialize()
- Initialized                   // serverMailbox set; queries + E/G no-ops live here
  * ProcessDetached             // no live process
    * Stopped                   // idle, ready to start()
    - ShuttingDown              // detached after shutdown request
  - ProcessDetaching            // log readers tearing down after exit
  - ProcessObserving            // pid/subscription paired
    * Starting
      * SpawnPending            // spawn in flight (no pid yet)
      - SpawnArmed              // pid known; arming log readers
      - TcpConnecting           // probing TCP listen
    - ProcessActive             // live process + log readers armed
      * Running                 // accepts createConnection (B)
      - Stopping                // closing TCP connections
      - Terminating             // SIGTERM sent; kill grace → SIGKILL
```

Each `- name`/`* name` leaf has its own `_checkInvariant()` → one `inv.assert*`. Shared stdio
forwarding sits on `ProcessStdioForwarding` (between `ProcessObserving` and `ProcessActive`)
because only there are `ctx.children` guaranteed armed.

Key handler placements:
- `start()` is **B** only on `Stopped`; **E** on `Initialized` (so `Starting`/`Running` inherit
  the no-op via **P**).
- `onProcessExit` is **B** on `ProcessActive` (→ `doCompleteStop`) and on `Starting`
  (→ abort startup); other phases inherit or are **U**.
- Spawning is in `SpawnPending.doStart` / `SpawnArmed.doBeginStartup` (async, via port); the
  state advances only when the port resolves or posts an `on*` — **never** `transition()` at
  the end of an async `onEntry`.

## Transition gotchas

- `this.hsm.transition(Next)` is **scheduled**, not immediate. After the handler returns, the
  runtime runs `onExit` up to the LCA, then `onEntry` down to the target (descending
  `@InitialState` for composites).
- A `transition()` requested inside `onEntry`/`onExit` is **cleared** when that lifecycle
  dispatch ends. Instead post an `on*`/`do*` and transition from its handler (see
  `Connecting.onEntry` → `doSpawnChannels` → `transition(ConnectionIdle)`).
- Only the **last** `transition()` in a handler wins.
- `onEntry` ends with `inv.assert<State>(this.ctx)` (not `_checkInvariant()`), because the
  runtime may still report the source leaf mid-transition.

## Errors

`UnhandledEventError` (no handler → routes to `onUnhandled`), `EventHandlerError`,
`TransitionError` (`onEntry`/`onExit` threw), `InitializationError`, `FatalError`. Override
`onUnhandled(error)` / `onError(error)` on a state to recover; defaults rethrow. Unrecovered
errors reach `dispatchErrorCallback` — in tests, pass one to capture and assert U cells.

## Deterministic mock tests

```typescript
import * as ihsm from "ihsm/testing";

@ihsm.mock("spawn", "kill", "probeTcpConnect", "armLogReaders", "spawnConnection")
abstract class MockCBServerPort extends ihsm.TestPort<typeof CBServerTop> {
  abstract spawn(config: CBServerConfig): Promise<ihsm.ResultWithSubscription<number>>;
  abstract kill(pid: number, signal?: NodeJS.Signals): Promise<void>;
  abstract probeTcpConnect(o: TcpConnectProbeOptions): Promise<boolean>;
}

const port = ihsm.makeTestPort(MockCBServerPort);
port.spawn.default(async () => ({ value: 1234, subscription: { dispose: () => port.record("dispose", 1234) } }));
port.kill.default(async (pid, sig) => { port.record("kill", pid, sig); port.send("onProcessExit", 0, null); });
```

Patterns:
- `port.<m>.default(impl)` persistent stub; `port.<m>.once(impl)` one-shot; `port.<m>.calls`
  inspects invocations.
- **Do not** auto-fire `on*` from inside a stub — return handles synchronously, then
  `port.send("onProcessExit", code, signal)` / `port.send("onSocketData", bytes)` when the test
  is ready to settle.
- `port.advance(ms)` fires virtual timers; never wall-clock sleep.
- `actor.hsm.restore(State, ctx)` places the machine precisely (no lifecycle hooks) so one test
  exercises one matrix cell.

### One matrix cell per test

```typescript
it("Running + onProcessExit → Stopped (B)", async () => {
  const port = makeMockPort(1234);
  const ctx = new CBServerContext(new CBServerConfig({ paths: { dataDir: "" } }));
  const actor = await bootRunning(ctx, port, 1234);
  port.send("onProcessExit", 0, null);
  await actor.hsm.sync(); await actor.hsm.sync();
  expect(actor.hsm.currentStateName).to.equal("Stopped");
});

it("Stopped + stop() is a no-op (E)", async () => {
  const actor = /* restore Stopped */;
  actor.notify.stop();
  await actor.hsm.sync();
  expect(actor.hsm.currentStateName).to.equal("Stopped");
});

it("Initialized + createConnection throws (G)", async () => {
  let err: Error | undefined;
  try { await actor.call.createConnection(); } catch (e) { err = e as Error; }
  expect(err?.message).to.match(/illegal state/i);
});

it("detached + onProcessExit is unhandled (U)", async () => {
  const errors: Error[] = [];
  const actor = ihsm.makeTestActor(CBServerTop, ctx, port, {
    dispatchErrorCallback: (_hsm, e) => errors.push(e),
  });
  actor.hsm.restore(/* a leaf with no onProcessExit anywhere up the chain */, ctx);
  actor.notify.onProcessExit(0, null);
  await actor.hsm.sync();
  expect(errors[0]?.name).to.equal("UnhandledEventError");
});
```

### BFS generation + negative smoke

1. `makeTestActor(Top, freshCtx(), port)` (or `{ initialize: false }` + `restore`).
2. Seed the worklist with the `@InitialState` leaf.
3. Dequeue `S`; for each event reachable in `S`, write one cell test; enqueue new destinations.
4. After BFS, iterate **every** `U` and `E` cell and add an explicit negative smoke test.
5. A missing `(state × event)` test = an undecided Phase 5 matrix cell — fix the matrix.

Golden trace: `actor.subscribe(m => port.record(m.event, ...m.payload))`, then assert the
recorded sequence is byte-identical across runs.

### Mock vs real

| Layer | File | Port | Timers |
|-------|------|------|--------|
| Mock unit | `*.mock.test.ts` | `@ihsm.mock` + `makeTestPort` | `port.advance` + `sync` |
| Real integration | `*.real.test.ts` | production port + real binary | short wall-clock (1–5s/step), gated on env var |

Strategy: child actor in isolation first → supervisor with mocked child spawn → real subprocess
last. The default `npm test` runs mock tests and ignores `*.real.test.js`.
