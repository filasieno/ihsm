> **v0.1.0:** use `makeTestActor(ConnTop, ctx, port)` — `Config` is inferred from `ConnTop`. Internal events: `test.onData(…)` on the test actor, or `port.send('onData', …)` / `port.actor!.onData(…)` on a bound `TestPort`. Sync: `await actor.hsm.sync()`. See [`examples/00-config/`](../examples/00-config/README.md).

Most state-machine bugs are not logic bugs — they are *timing* bugs. A socket replies a
millisecond late, two events race through a queue, a retry fires while a teardown is half-done.
Such bugs reproduce once in a thousand CI runs and never on your laptop. **Deterministic
Simulation Testing (DST)** is the discipline of removing every source of nondeterminism from a
test so that the *same inputs always produce the same outputs* — and, crucially, so that a
failure can be **replayed exactly**.

ihsm is built for this. A machine is a class hierarchy with serialized, run-to-completion dispatch
and a single, explicit seam to the impure world. Get the structure right and your tests need no mocks of
timers, no `sleep`, no "flaky, re-run it" annotations. This chapter builds the technique up in
five runnable stages, each with a live playground you can drive yourself.

## What is Deterministic Simulation Testing?

**Deterministic simulation testing (DST)** means running the real system inside a fully controlled,
reproducible simulated environment where a single seed produces an identical execution every time.
The goal is not merely to *claim* determinism — it is to make that claim **auditable**. A serious DST
program can demonstrate two things: that the environment is actually deterministic, and that the
simulation can actually find bugs.

The checklist below groups requirements by what each one protects. Not every project needs every
item on day one — but **sections A, B, and F are the definitional core**. A system missing any of
those is not doing DST, regardless of what the README calls it. Sections C, D, G, H, and I
separate a serious program from a token one.

> **Scope note:** items like "billions of simulated seconds" are maturity benchmarks set by projects
> like FoundationDB and TigerBeetle, not hard thresholds. Calibrate the bar to your system's risk
> profile.

### A. Determinism (the non-negotiable core)

| Requirement | What it protects |
| --- | --- |
| **Simulated clock** — no `Date.now()`, `Instant::now`, `gettimeofday`, `System.currentTimeMillis`, etc. anywhere in the system under test | Wall-clock time cannot reorder events between runs |
| **Seeded PRNG** — all randomness flows through one seeded generator; no `/dev/urandom`, no unseeded RNG, no hardware entropy | Random choices replay identically |
| **Deterministic concurrency** — typically one OS thread with a cooperative/simulated scheduler (async tasks, coroutines, fibers), or a scheduler that controls all interleavings; nothing relies on OS thread scheduling | Races cannot hide behind scheduling luck |
| **Virtualized I/O** — network, disk, and filesystem go through simulated interfaces; no real sockets or files in the deterministic run | External latency and failure modes are scripted, not ambient |
| **No nondeterministic ordering leaks** — hash-map/set iteration order, pointer/address values, and similar must not affect behaviour | Logic does not accidentally depend on implementation details |
| **No uncontrolled external inputs** — real DNS, varying environment variables, and the like must not cross the simulation boundary | The run is a closed world |
| **Reproducibility proof** — the same seed yields a byte- or event-identical execution, demonstrated continuously (run a seed twice, compare a hash of the full trace or final state) | Determinism is verified, not assumed |

**How ihsm maps here:** serialized run-to-completion dispatch pins concurrency (A3). The **`Port`**
boundary virtualizes I/O (A4) — sockets, processes, the filesystem, and timers all live behind
`port`, never in handlers directly. **`TestPort`** supplies a virtual clock (`advance()`) and
scriptable random (`feedRandom()`, `feedUUID()`, `feedRandomBytes()`) so tests never touch wall
clock or ambient RNG (A1, A2). The golden-trace technique (below) is your reproducibility proof
for a single scenario (A7).

### B. Simulation fidelity

| Requirement | What it protects |
| --- | --- |
| **Real production logic** — the system under test runs its actual code path, not a stub or reimplementation | You are testing the system, not a model of it |
| **Realistic adversity** — the simulator models message delay, reordering, duplication, partial writes, and similar | Tests exercise behaviour under stress, not only the happy path |
| **Explicit seam** — the boundary between the deterministic core and the simulator is defined and enforced | Nondeterminism cannot creep in through a forgotten side door |

**How ihsm maps here:** handlers and states are production code; only the **`Port`** is swapped in
tests (B1, B3). Mock ports script realistic adversity — slow replies, dropped events, fault
sequences — without reimplementing the machine (B2).

### C. Fault injection

| Requirement | What it protects |
| --- | --- |
| **Injectable faults** — network partitions, packet loss/reorder/duplication, node crashes and restarts, disk errors, corruption, clock skew, slow nodes | Failure modes are explored systematically, not only when they happen to occur |
| **Seed-driven injection** — fault schedules are themselves deterministic and varied across runs | Different seeds explore different failure histories |

**How ihsm maps here:** testing-04 walks through seeded fault injection via `@mock` +
`makeTestPort` — the `attempt` stub runs a seeded PRNG and the test decides when results land.

### D. Time control

| Requirement | What it protects |
| --- | --- |
| **Virtual clock** — decoupled from wall clock, advanceable arbitrarily | Timeouts, retries, and "days" of behaviour run in seconds |

**How ihsm maps here:** `TestPort.advance(ms)` fires due `hsm.defer(ms)` timers on demand;
`hsm.defer(ms)` itself delegates to `port.setTimeout`, so production and test share the same API
with different clocks.

### E. Workload generation

| Requirement | What it protects |
| --- | --- |
| **Seed-driven scenarios** — randomized workloads explore different histories per seed | The state space is sampled, not fixed to one script |
| **Biased generation** — ability to steer toward interesting regions of the state space | Rare corners are reached without abandoning randomness |

ihsm does not ship a workload generator — your tests or CI harness own scenario generation — but
the port/actor model keeps every generated scenario replayable once you capture the seed and trace.

### F. Oracles / property checking (so bugs are actually detected)

| Requirement | What it protects |
| --- | --- |
| **Safety invariants** — pervasive asserts checked during and after each run | Violations are caught at the point of failure, not only at the end |
| **Correctness oracle** — a consistency checker (linearizability, serializability) or reference model | Semantic correctness is verified, not only "no throw" |
| **Liveness checks** — the system makes progress once injected faults are healed | The system does not deadlock silently under recovery |

**How ihsm maps here:** golden traces are a lightweight oracle for ordering and side effects;
combine them with domain invariants on `ctx` and explicit `expect` assertions. `TestPort.trace`
and `Stubbed.calls` make regressions local.

### G. Reproducibility & debugging workflow

| Requirement | What it protects |
| --- | --- |
| **Captured seed and config on failure** | A red run is diagnosable without guesswork |
| **Deterministic replay** — the same seed reproduces the identical failure (same binary/architecture; cross-arch reproducibility is a known caveat) | Debuggers see the same history the CI saw |
| **Maturity bonus:** deterministic stepping or time-travel debugging | Failures are inspectable at arbitrary points |

**How ihsm maps here:** `VERBOSE_DEBUG` tracing (the `makeTestActor` default) plus a golden trace
and recorded seed give you a replay script; `sync()` barriers let you step the machine one
dispatch at a time.

### H. Coverage, scale, and continuous operation

| Requirement | What it protects |
| --- | --- |
| **Volume** — many distinct seeds run continuously in CI, not a one-off batch | Rare bugs surface over time |
| **Coverage accounting** — some measure of state-space or scenario coverage | You know what you have not tried yet |

Scale is your CI policy; ihsm keeps each individual run cheap enough to run thousands of them.

### I. Integrity guards (so the determinism claim does not silently rot)

| Requirement | What it protects |
| --- | --- |
| **Determinism check in CI** — re-run a seed and fail the build if execution diverges | Regressions in determinism are caught before they invalidate every replay |
| **Lint/guard rails** — ban forbidden calls (real time, real RNG, real threads, real I/O) in the system under test | New code cannot bypass the port boundary unnoticed |

Enforce I2 with code review and lint rules: handlers must not import `node:fs`, call `setTimeout`
directly, or use `Math.random()` — route through `this.port` instead.

### Distinguishing a real claim from a marketing one

Ask for evidence:

1. A **captured failing seed** you can replay yourself and watch fail identically.
2. The **determinism-check job** in CI and its pass history.
3. The list of **injectable fault types** and the **invariants/oracle** actually being asserted.
4. Confirmation that **production code paths** run inside the simulator — not a parallel test-only implementation.

If sections A, B, and F are not demonstrably satisfied, the program is not DST yet — it is
deterministic unit testing with extra steps.

## What makes a test nondeterministic

Three things, almost always:

1. **Concurrency** — two pieces of work interleave in an order you did not pin.
2. **Wall-clock time** — `setTimeout`, `Date.now()`, real network/disk latency.
3. **Ambient randomness** — `Math.random()`, UUIDs, hash-map iteration order.

If a test depends on any of these, it can fail intermittently. DST's answer is to make all three
*explicit and controllable*: serialize the work, replace the clock with a step you advance by
hand, and seed the randomness so it replays.

## The three properties ihsm gives you

Determinism is a first-class feature of ihsm, not an afterthought. It rests on three properties
you can lean on in every test:

1. **Serialized, run-to-completion dispatch.** Each handler runs to completion and never
   interleaves with another. `await hsm.hsm.sync()` resolves only once every job enqueued before it
   has finished, draining chained `post`s in order. There is no interleaving to race on — you
   advance the machine one barrier at a time.
2. **A `Port` boundary.** All impurity — sockets, child processes, clocks, the filesystem, the
   network — lives behind a single `port` object. Swap it for a mock and the machine above the
   port is pure. The port is the *only* place a test has to think about the outside world.
3. **A public / internal protocol split.** Events the outside world raises (`open`, `fetch`,
   `listen`) are separated from events the *port* raises back (`onConnected`, `onResponse`,
   `onMouseMove`). The two are required to be **disjoint**, enforced by the compiler. A client
   can never forge an internal event, and a test can drive *either* side directly.

## Two surfaces: `makeActor` and `makeTestActor`

The split shows up as two factory functions over the same machine:

- **`makeActor`** returns an `Actor<C>` — the **production** surface (public notifications +
  services only).
- **`makeTestActor`** returns a test handle over the **merged** protocol plus typed `port`.
  Tests can call internal notifications directly (`test.onData(…)`) or use `port.send` /
  `port.actor!.onData(…)`.

Both factories take the **three mandatory** arguments `topState`, `ctx`, `port` **positionally**,
followed by an **optional** options bag `{ initialize?, traceLevel?, traceWriter?, … }`. `Context`,
`Public`, and `Internal` are **inferred straight from `topState`**, so call sites carry no explicit
generics; never wrap them in a helper and never pass `undefined` placeholders. Tests use
**`makeTestActor`** with a **`makeTestPort`** mock; `makeActor` is the production surface, shown here
only in compile-time checks that prove the public/internal boundary. Both are timer-free.

> **Import the test surface from `ihsm/testing`.** The mock machinery, the manual clock, and
> `makeTestActor` ship in a **separate entry point** so they are never bundled into production code
> that only imports `ihsm`. Production code does `import { makeOwnerActor, TopState } from 'ihsm'`; test
> files do `import * as ihsm from 'ihsm/testing'` (which also re-exports the entire core API, so a
> spec can import everything it needs from `ihsm/testing` alone).

**`makeTestActor` defaults to `VERBOSE_DEBUG` tracing** — a failing test should be fully readable
out of the box. Never silence a test to a production trace level; drop verbosity only by passing an
explicit `options.traceLevel` when you really need a quiet run.

## Mock ports: `@mock`, `makeTestPort`, and per-call scripting

A mock port is built on the abstract **`TestPort`** base, which gives every mock a consistent test
surface for free:

- `this.send(event, ...args)` posts an internal event **inward** through the lazily-bound poster.
- `this.record(label, ...args)` logs an outbound call for assertions (also callable from a test,
  e.g. inside a `dispose` closure).
- `messages` / `events` / `trace` expose the recorded log; `last` and `count` are conveniences;
  `clear()` empties the recorded list.

`TestPort<T>` takes the machine's **root `TopState`** as its single type argument — every other type
(context, internal protocol, *and the port surface*) is derived from it, so the root state is the one
configuration point. **You never implement the port.** Declare each port method as an `abstract`
member whose **signature matches the real port**, decorate the class with **`@mock`**, and build it
with **`makeTestPort`**:

```ts
@ihsm.mock
abstract class WatcherMock extends ihsm.TestPort<WatcherTop> {
  abstract watch(path: string): ihsm.ResultWithSubscription<number>; // signature matches the port
}

const port = ihsm.makeTestPort(WatcherMock); // typed mock; port.actor is bound lazily by makeTestActor
```

Each abstract method comes back as a **scriptable `Stubbed` method** — the per-method analogue of a
`jest.fn()` / Sinon stub, fully typed from `TopState`. It is still callable with its exact signature
(so the machine invokes it normally), and carries the scripting + introspection surface the test
drives:

- **`port.watch.default(impl)`** — the **persistent** implementation (every call runs it).
- **`port.watch.once(impl)`** — a **one-shot** implementation, consumed by the next call; queue
  several to script a sequence. One-shots are consumed before the persistent `default`.
- **`port.watch.calls`** — the live, typed list of argument tuples the method was called with
  (`Parameters<typeof watch>[]`), for direct assertions.
- **`port.watch.reset()`** — clear queued/persistent scripts **and** recorded calls, to reuse a mock.

`default` / `once` take a closure with the method's **exact** parameters and return type, so scripts
stay type-safe:

```ts
port.watch.default(path => ({                              // script the result (fully type-safe)
  value: 7,
  subscription: { dispose: () => port.record(`dispose ${path}`) }, // the test controls teardown too
}));

port.watch('/etc/hosts');
expect(port.watch.calls).to.deep.equal([['/etc/hosts']]); // typed `[path: string][]`
```

Two things are automatic: every call is **recorded** first (so it shows up in `trace` and in
`method.calls`), and calling an **unscripted** method throws a `PreloadError` that names it — never a
silent `undefined`.

### Two channels: `default`/`once` (outbound) vs `send` (inbound)

Keep them distinct. **`default` / `once` script what a method the machine *calls* returns**; **`send`
pushes an internal event *inward***. The cardinal rule is **do not deliver an event from inside the
synchronous call** unless the test asked for it: a stub for `request` returns the request id and
abort handle but delivers *no* response, so the test can observe the in-flight `Fetching` state and
then settle it on its own command with `port.send('onResponse', …)`. That is what lets **one mock
serve every scenario** — the happy path, the slow reply, the error, and the cancellation.

| Example | Records (inbound calls) | How the tester drives the back-channel |
| ------- | ----------------------- | -------------------------------------- |
| testing-01 timers | — | `clock.advance(ms)` — fire due `hsm.defer(ms)` timers |
| testing-02 network | `request` / `abort` | `request.default` returns an id; `port.send('onResponse', …)` settles it |
| testing-03 stream | `subscribe` / `unsubscribe` | `port.moveTo(x, y)` drives device state; delivers only while `live` |
| testing-04 faults | `attempt` | `attempt.default` runs a seeded fault and `port.send('onResult', ok)` |
| testing-05 subscriptions | `watch` / `dispose` | `port.watch.default(impl)` — script the result + its `Disposable` |

### Device state lives in the mock

A mock is a **test instrument**, not a passive stub — it can model the simulated outside world in
**public** fields the test reads and drives. In testing-03 the OS pointer lives in the mock
(`cursor`, `live`), with drive commands the tester calls; the machine stores only what it *observed
while subscribed*. The two legitimately diverge.

```ts
@ihsm.mock
abstract class MockMouseStream extends ihsm.TestPort<MouseTop> {
  abstract subscribe(): ihsm.ResultWithSubscription<number>;
  cursor: Point = { x: 0, y: 0 }; // public device state — the simulated OS pointer
  live = false;
  moveTo(x: number, y: number): void {
    this.cursor = { x, y };
    if (this.live) this.send('onMouseMove', x, y); // delivered only while subscribed
    else this.record('drop', x, y);                // moved while unsubscribed — not delivered
  }
}
```

### Watching a machine: `subscribe` → `TestPort.record`

When you want a golden trace of every event posted through the machine, wire
`TestActor.subscribe` to your `TestPort`:

```ts
const port = new ihsm.TestPort<HeartbeatTop>();
const test = ihsm.makeTestActor(HeartbeatTop, new HeartbeatCtx(), port);
const sub = test.subscribe(m => port.record(m.event, ...m.payload));
test.start(); await test.hsm.sync();
expect(port.events).to.include('start');
port.clear();
sub.dispose();
```

`subscribe` fires for every event — client posts, handler self-posts, and port-driven internal
events alike — and is absent from the production `Actor`, so tracing never leaks into shipping code.

## The golden-trace technique

Because dispatch is serialized and run-to-completion, and the port records what it was asked to do, a test can
capture an exact, ordered transcript of everything that happened — a *golden trace* — and assert
on it. Two runs that should be identical produce byte-identical traces; a diff localizes the
regression precisely. This is far stronger than asserting a final value, and it is what makes a
replayed DST failure debuggable.

## Two rules that keep every test deterministic

> **Never perform I/O outside a port**, and **never sleep on wall-clock time in a test.**

Advance the machine with `sync()` and feed internal events yourself instead of waiting. Every
example below obeys these two rules — and that is the entire reason they cannot flake.

## How this chapter is organized

The stages grow in complexity. Each is a complete, runnable example under `examples/` with its
own `tutorial.spec.ts`; the headless command is shown with each playground.

1. **Deferred timers & simulated time** — the foundation: never wait on the wall clock.
2. **Network fetch behind a port** — control *what* the response is and *when* it lands.
3. **Event streaming behind a port** — gate a push source so it goes quiet on unsubscribe.
4. **Fault injection & seeded DST** — manufacture reproducible failure.
5. **Subscriptions & disposables** — own a `Disposable` and prove it is released exactly once.

## 1. Deferred timers & simulated time

The foundation of everything else: never block on real time. A `Heartbeat` machine ticks **every
hour** with `hsm.defer(ms)`, backed by the machine's standard **port timer service**. A test swaps in
a `TestPort` and `advance()`s it to simulate 48 hours in microseconds — establishing the two
test surfaces (test **actor** vs. test **port**) you reuse for the rest of the chapter.

<!-- @example:testing-01-deferred-timers -->

## 2. Network fetch behind a port

The network is the canonical flaky dependency. Behind a port, a test decides what the response is —
`request` is a `@mock` method scripted with `request.default` — and exactly when it arrives, by pushing
`onResponse` / `onFailure` inward with `send`, so the in-flight state is reachable and a cancelled
request provably can never mutate state.

<!-- @example:testing-02-network-fetch -->

## 3. Event streaming behind a port

A push source emits on its own schedule, which is what makes naive code flaky. Behind a port, the
source can only deliver while a subscription is live, so "stop listening" provably detaches — and
a test can drive the stream itself with no timers.

<!-- @example:testing-03-event-streaming -->

## 4. Fault injection & seeded DST

The payoff: make *failure* reproducible. A retrying worker's faults come from a **seeded** PRNG
scripted into the `@mock`'s `attempt` with `attempt.default` — never `Math.random()` or the clock — so the
same seed replays the exact fault sequence. Keep the seed, replay it, debug a perfectly reproducible
red run.

<!-- @example:testing-04-fault-injection -->

## 5. Subscriptions & disposables

A subscription outlives the call that created it, so it needs a teardown handle — a `Disposable` —
and an owner. ihsm models the VS Code pattern exactly: a port method returns `ResultWithSubscription`
(a value **plus** a `Disposable`), the machine owns the handle in its context, and disposes it on
`stop` or a source-initiated `onClosed`. The mock is built with `@mock` + `makeTestPort`, so the test
scripts each `watch` result with `port.watch.default(...)` — including its `Disposable` — and then
*proves* the handle is released exactly once, with a byte-identical golden trace across runs.

<!-- @example:testing-05-subscriptions-and-disposables -->
