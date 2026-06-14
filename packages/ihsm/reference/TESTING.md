# Deterministic Simulation Testing

Most state-machine bugs are not logic bugs — they are *timing* bugs. A socket replies a
millisecond late, two events race through a queue, a retry fires while a teardown is half-done.
Such bugs reproduce once in a thousand CI runs and never on your laptop.

**Deterministic Simulation Testing (DST)** removes every source of nondeterminism from a test so
that the *same inputs always produce the same outputs* — and a failure can be **replayed exactly**.

ihsm is built for this: serialized run-to-completion dispatch, one **`Port`** seam for all impurity,
and a compile-time **public / internal** protocol split. Work through the five runnable examples
below first (each has a live playground and a `tutorial.spec.ts` in `examples/`). The theory,
checklist, and tooling reference come **after** the examples — once you have seen DST in action.

> **Prerequisites:** [`Reference`](/reference) — especially `Config`, `makeActor`, `notify` /
> `call`, and `await actor.hsm.sync()`.

## How this chapter is organized

The stages grow in complexity. Run the playground, then read the matching `tutorial.spec.ts` in the
repo.

1. **Deferred timers & simulated time** — never wait on the wall clock.
2. **Network fetch behind a port** — control *what* the response is and *when* it lands.
3. **Event streaming behind a port** — gate a push source so it goes quiet on unsubscribe.
4. **Fault injection & seeded DST** — manufacture reproducible failure.
5. **Subscriptions & disposables** — own a `Disposable` and prove it is released exactly once.

---

## 1. Deferred timers & simulated time

The foundation: never block on real time. A `Heartbeat` machine ticks **every hour** with
`hsm.port.defer(ms)`, backed by the port timer service. A test swaps in a `TestPort` and
`advance()`s it to simulate 48 hours in microseconds.

**DST takeaways from this example:**

- **Virtual clock (checklist A1, D):** `TestPort.advance(ms)` fires due deferred timers on demand — no `sleep`, no flaky CI.
- **Two test surfaces:** `makeTestActor` exposes the merged protocol (notify `onTick` directly); `TestPort` records outbound work and drives time.
- **Reproducibility (A7):** run the same `advance` loop twice; `ctx.ticks` and `clock.now` match byte-for-byte.
- **Production path vs white-box:** `makeActor` + `TestPort` exercises the public `start`/`stop` path; `makeTestActor` can drive `notify.onTick()` with no clock at all.

<!-- @example:testing-01-deferred-timers -->

## 2. Network fetch behind a port

The network is the canonical flaky dependency. Behind a port, a test decides what the response is —
`request` is a `@mock` method scripted with `request.default` — and exactly when it arrives, by
pushing `onResponse` / `onFailure` inward with `send`.

**DST takeaways from this example:**

- **Virtualized I/O (A4):** no sockets, DNS, or real latency — the mock is the entire network.
- **Outbound vs inbound channels:** `request.default` scripts what the machine *calls*; `port.send('onResponse', …)` is when the test *settles* the request — never both in one synchronous stub call.
- **In-flight states without timers:** pin `Fetching` with `initialize: false`, then notify the settled event — the flaky window is observable and deterministic.
- **Golden trace:** `port.trace` lists `request:…` and `abort` in order; cancelled requests provably drop late responses.

<!-- @example:testing-02-network-fetch -->

## 3. Event streaming behind a port

A push source emits on its own schedule — the classic flaky input. Behind a port, delivery happens
only while a subscription is live; `stopListening` disposes the handle and the source goes quiet.

**DST takeaways from this example:**

- **Device state in the mock, observed state in the actor:** the mock owns `cursor` / `live`; the machine stores only moves received while subscribed — they legitimately diverge.
- **Subscription lifecycle (B2):** adversity is scripted — moves before `listen`, while live, and after `dispose` — without reimplementing the machine.
- **No races:** `sync()` barriers between each drive command; serialized dispatch means no interleaved handler runs.

<!-- @example:testing-03-event-streaming -->

## 4. Fault injection & seeded DST

The payoff: make *failure* reproducible. A retrying worker's faults come from a **seeded** PRNG
scripted into the `@mock`'s `attempt` — never `Math.random()` or the clock.

**DST takeaways from this example:**

- **Seed-driven faults (C):** `feedRandom` + `port.random()` in `attempt.default` — same seed ⇒ same `ctx.log` and `port.trace`.
- **Hand injection vs seeded:** script `attempt` as a no-op and notify `onResult` yourself to walk the retry budget deterministically.
- **Oracle (F):** assert `port.attempt.calls`, `ctx.log`, and terminal state together — not just "no throw".
- **Replay workflow (G):** capture seed + trace on failure; re-run the spec with that seed in CI.

<!-- @example:testing-04-fault-injection -->

## 5. Subscriptions & disposables

A subscription outlives the call that created it — it needs a `Disposable` and an owner. ihsm
models the VS Code pattern: `ResultWithSubscription`, context-owned handle, `dispose()` on teardown.

**DST takeaways from this example:**

- **`@mock` + `makeTestPort`:** script `watch.default` to return value + `Disposable`; prove `dispose` runs exactly once via `port.trace`.
- **Idempotent teardown:** overlapping `stop` / `onClosed` paths stay safe — assert no double-dispose side effects.
- **Golden trace as oracle:** `['watch:/path', 'dispose watch /path']` is byte-identical across runs when the scenario is unchanged.

<!-- @example:testing-05-subscriptions-and-disposables -->

---

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

**How ihsm maps here:** [example 4](#_4-fault-injection-seeded-dst) walks through seeded fault injection via `@mock` +
`makeTestPort` — the `attempt` stub runs a seeded PRNG and the test decides when results land.

### D. Time control

| Requirement | What it protects |
| --- | --- |
| **Virtual clock** — decoupled from wall clock, advanceable arbitrarily | Timeouts, retries, and "days" of behaviour run in seconds |

**How ihsm maps here:** `TestPort.advance(ms)` fires due `hsm.port.defer(ms)` timers on demand;
`hsm.port.defer(ms)` itself delegates to `port.setTimeout`, so production and test share the same API
with different clocks. See [example 1](#_1-deferred-timers-simulated-time).

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
directly, or use `Math.random()` — route through `this.hsm.port` instead.

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
   interleaves with another. `await actor.hsm.sync()` resolves only once every job enqueued before it
   has finished, draining chained notifications in order. There is no interleaving to race on — you
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

- **`makeActor`** returns an `ExternalActor<C>` — the **production** surface (public notifications +
  services only).
- **`makeTestActor`** returns a test handle over the **merged** protocol plus typed `port`.
  Tests can call internal notifications directly (`test.notify.onTick()`) or use `port.send('onTick')`.

Both factories take the **three mandatory** arguments `topState`, `ctx`, `port` **positionally**,
followed by an **optional** options bag `{ initialize?, traceLevel?, traceWriter?, … }`. `Config`
is **inferred from `topState`**, so call sites carry no explicit generics; never wrap the factories
in a helper and never pass `undefined` placeholders. Tests use **`makeTestActor`** with a
**`makeTestPort`** mock.

> **Import the test surface from `ihsm/testing`.** The mock machinery, the manual clock, and
> `makeTestActor` ship in a **separate entry point** so they are never bundled into production code
> that only imports `ihsm`. Production code does `import { makeActor, TopState } from 'ihsm'`; test
> files do `import * as ihsm from 'ihsm/testing'` (which also re-exports the entire core API).

**`makeTestActor` defaults to `VERBOSE_DEBUG` tracing** — a failing test should be fully readable
out of the box. Drop verbosity only by passing an explicit `options.traceLevel` when you need a
quiet run.

| Goal | Factory | Surface | Use when |
| ---- | ------- | ------- | -------- |
| Production wiring | `makeActor` | public `notify` / `call` only | shipping code; clients must not post internal events |
| Black-box test | `makeActor` + mock port | public only | exercise the real public path; assert recorded port calls |
| White-box test | `makeTestActor` | merged protocol + `port` | pin a state, drive internal events, assert port interactions |

## Mock ports: `@mock`, `makeTestPort`, and per-call scripting

A mock port is built on the abstract **`TestPort`** base, which gives every mock a consistent test
surface for free:

- `this.send(event, ...args)` posts an internal event **inward** through the lazily-bound actor.
- `this.record(label, ...args)` logs an outbound call for assertions (also callable from a test,
  e.g. inside a `dispose` closure).
- `messages` / `events` / `trace` expose the recorded log; `last` and `count` are conveniences;
  `clear()` empties the recorded list.

`TestPort<T>` takes the machine's root state **constructor** as its single type argument (`typeof WatcherTop`) — `Config` and
the port surface are inferred from it. **You never implement the port.** Declare each port method as
an `abstract` member whose **signature matches the real port**, decorate the class with **`@mock`**,
and build it with **`makeTestPort`**:

```ts
@ihsm.mock
abstract class WatcherMock extends ihsm.TestPort<typeof WatcherTop> {
  abstract watch(path: string): ihsm.ResultWithSubscription<number>;
}

const port = ihsm.makeTestPort(WatcherMock);
```

Each abstract method becomes a **scriptable `Stubbed` method**:

- **`port.watch.default(impl)`** — persistent implementation (every call runs it).
- **`port.watch.once(impl)`** — one-shot, FIFO queue; consumed before `default`.
- **`port.watch.calls`** — typed argument tuples for assertions.
- **`port.watch.reset()`** — clear scripts and recorded calls.

### Two channels: `default`/`once` (outbound) vs `send` (inbound)

**`default` / `once` script what a method the machine *calls* returns**; **`send` pushes an
internal event *inward***. Do not deliver a response from inside the synchronous stub unless the
test asked for it — that separation is what makes one mock serve every scenario.

| Example | Records (outbound calls) | How the tester drives the back-channel |
| ------- | ------------------------ | -------------------------------------- |
| testing-01 timers | — | `clock.advance(ms)` — fire due `hsm.port.defer(ms)` timers |
| testing-02 network | `request` | `request.default` returns an id; `port.send('onResponse', …)` settles it |
| testing-03 stream | `subscribe` | mock `moveTo` / `path`; delivers only while `live` |
| testing-04 faults | `attempt` | seeded `attempt.default` or hand-posted `onResult` |
| testing-05 subscriptions | `watch` | `watch.default` scripts value + `Disposable` |

### Device state lives in the mock

A mock can model the simulated outside world in **public** fields the test reads and drives. In
testing-03 the pointer lives in the mock (`cursor`, `live`); the machine stores only what it
observed while subscribed.

### Watching a machine: `hsm.subscribe` → `TestPort.record`

```ts
const port = new ihsm.TestPort<typeof HeartbeatTop>();
const test = ihsm.makeTestActor(HeartbeatTop, new HeartbeatCtx(), port);
const sub = test.hsm.subscribe(m => port.record(m.event, ...m.payload));
test.notify.start();
await test.hsm.sync();
expect(port.events).to.include('start');
sub.dispose();
```

`subscribe` fires for every dispatched event and is absent from the production `ExternalActor`.

## The golden-trace technique

Because dispatch is serialized and run-to-completion, and the port records what it was asked to do,
a test can capture an exact, ordered transcript — a *golden trace* — and assert on it. Two runs
that should be identical produce byte-identical traces; a diff localizes the regression precisely.

## Two rules that keep every test deterministic

> **Never perform I/O outside a port**, and **never sleep on wall-clock time in a test.**

Advance the machine with `sync()` and feed internal events yourself instead of waiting. Every
example above obeys these two rules — that is why they cannot flake.
