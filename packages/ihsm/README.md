[![CI](https://img.shields.io/github/actions/workflow/status/filasieno/ihsm/ci.yml?label=CI)](https://github.com/filasieno/ihsm/actions/workflows/ci.yml)
[![Documentation](https://img.shields.io/github/actions/workflow/status/filasieno/ihsm/docs.yml?label=docs)](https://github.com/filasieno/ihsm/actions/workflows/docs.yml)
[![License: MIT](https://img.shields.io/github/license/filasieno/ihsm)](https://github.com/filasieno/ihsm/blob/HEAD/LICENSE)
[![npm version](https://img.shields.io/npm/v/ihsm)](https://www.npmjs.com/package/ihsm)
[![npm @ihsm/core](https://img.shields.io/npm/v/@ihsm/core?label=%40ihsm%2Fcore)](https://www.npmjs.com/package/@ihsm/core)
[![npm @ihsm/otel](https://img.shields.io/npm/v/@ihsm/otel?label=%40ihsm%2Fotel)](https://www.npmjs.com/package/@ihsm/otel)
[![Node](https://img.shields.io/badge/node-%3E%3D22-339933?logo=node.js)](https://github.com/filasieno/ihsm/blob/HEAD/package.json)

# ihsm

**Class-based hierarchical state machines and run-to-completion actors for TypeScript, explicitly designed for [Deterministic Simulation Testing](https://filasieno.github.io/ihsm/testing) (DST)** — nominal **`Config`**, generated handles, promise **services**, **zero** production dependencies, **~4.6 KB gzip** in the browser. → [Documentation](https://filasieno.github.io/ihsm/) · [Tutorial 00 — Config](examples/00-config/README.md)

ihsm is state management and orchestration for backends, session actors, protocol handlers, and embedded tooling: states are **classes**, events are **methods**, hierarchy is **inheritance**, and each machine is an **actor** with serialized, run-to-completion dispatch.

> **Built for Deterministic Simulation Testing.** Determinism is not an add-on here — it is the design center. Every source of nondeterminism is pushed behind one seam: **serialized run-to-completion dispatch** (each handler runs to completion and never interleaves; `await actor.hsm.sync()` drains to a barrier), a single **`Port`** boundary for *all* I/O (sockets, clocks, the filesystem), and a compiler-enforced **public/internal protocol split**. Swap the port for a mock, replace the clock with one you advance by hand, and the same inputs always produce the same outputs — so a failure **replays exactly**. The dedicated [`ihsm/testing`](#entry-points) entry point ships `makeTestActor`, `@mock`/`makeTestPort`, and a `TestPort` virtual clock for this, and never bloats your production bundle. See the [Deterministic Testing chapter](https://filasieno.github.io/ihsm/testing).

Requires **Node.js 22+** (or a modern browser). Class names in traces and errors come from `Class.name` — no extra registration step in a typical npm/Node project.

It uses event-driven programming, class-based hierarchical statecharts, and the actor model to handle complex logic in predictable, robust ways. States are **classes**, events are **methods**, hierarchy is **inheritance**, and each machine is an **actor** with serialized, run-to-completion (RTC) dispatch.

---

📖 [Read the documentation](https://filasieno.github.io/ihsm/)

📖 [Reference](https://filasieno.github.io/ihsm/reference)

🧪 [Deterministic Testing](https://filasieno.github.io/ihsm/testing)

---

## Development (from source)

All build and test commands run in **`packages/ihsm/`** (this directory):

```bash
nix develop          # Node 22, Chromium, store-pinned node_modules
npm install          # only if not using the Nix shell symlink
npm run build        # → lib/cjs + lib/esm
npm run test:all
```

From the **repo root**, `nix develop` / direnv auto-`cd` here; `nix flake check` runs the same gates as CI.

---

## Super quick start

```bash
npm install ihsm
# scoped alias (same runtime, published in lockstep): npm install @ihsm/core
```

```ts
import { InitialState, makeActor, Port, TopState } from 'ihsm';

interface DoorCtx {
  openCount: number;
}

interface DoorConfig {
  context: DoorCtx;
  notifications: {
    open(): void;
    close(): void;
  };
}


class DoorTop extends TopState<DoorConfig> {
}

@InitialState
class Closed extends DoorTop {
  open(): void {
    this.ctx.openCount += 1;
    this.hsm.transition(Open);
  }
}

class Open extends DoorTop {
  close(): void {
    this.hsm.transition(Closed);
  }
}

const door = makeActor(DoorTop, { openCount: 0 }, new Port());
await door.hsm.sync();

door.notify.open();
await door.hsm.sync();

console.log(door.hsm.currentStateName); // 'Open'
console.log(door.ctx.openCount);        // 1
```

See **[examples/00-config/](examples/00-config/README.md)** for the full protocol tour.

---

## Typed services (promise-returning)

Services are declared on the protocol's `services` bucket. The generated client method **always** returns `Promise<Reply>` — callers must `await`, so RTC ordering is explicit.

```ts
import { InitialState, makeActor, Port, TopState } from 'ihsm';

interface WalletCtx {
  balance: number;
}

interface WalletConfig {
  notifications: { deposit(amount: number): void };
  services: {
    getBalance(): Promise<number>;
    withdraw(amount: number): Promise<number>;
  };
  context: WalletCtx;
}


class WalletTop extends TopState<WalletConfig> {

  deposit(amount: number): void {
    this.ctx.balance += amount;
  }

  getBalance(): number {
    return this.ctx.balance;
  }

  withdraw(amount: number): number {
    if (amount > this.ctx.balance) {
      throw new Error('insufficient funds');
    }
    this.ctx.balance -= amount;
    return this.ctx.balance;
  }
}

@InitialState
class Open extends WalletTop {}

const wallet = makeActor(WalletTop, { balance: 100 }, new Port());
await wallet.hsm.sync();

wallet.notify.deposit(50);

const balance = await wallet.call.getBalance();

try {
  await wallet.call.withdraw(200);
} catch {
  // handler throw → rejected Promise
}

const left = await wallet.call.getBalance(); // 150
```

**Notifications** → `wallet.notify.deposit(50)` (void). **Services** → `await wallet.call.getBalance()` (Promise). The split is **nominal** via `Config.notifications` vs `Config.services`.

See [Tutorial 00 — Config](examples/00-config/README.md) and the [reference](https://filasieno.github.io/ihsm/reference).

---

## Hierarchical (nested) state machines

Child states extend parent states. The prototype chain is the state tree; entering a composite runs `onEntry` from outer to inner initial leaf, exiting walks the lowest common ancestor path.
Hierarchical state machines are extreamly easy to write just a extend a class.
Also not that all states are stateless classes.
All state is stored in the actor context available at `this.ctx`.

```ts
import { InitialState, makeActor, Port, TopState } from 'ihsm';

interface PlayerCtx {
  track: string;
}

interface PlayerConfig {
  context: PlayerCtx;
  notifications: { play(): void; pause(): void; stop(): void };
}


class PlayerTop extends TopState<PlayerConfig> {
}

class Active extends PlayerTop {
  stop(): void {
    this.hsm.transition(Stopped);
  }
}

@InitialState
class Playing extends Active {
  pause(): void {
    this.hsm.transition(Paused);
  }
}

class Paused extends Active {
  play(): void {
    this.hsm.transition(Playing);
  }
}

@InitialState
class Stopped extends PlayerTop {
  play(): void {
    this.ctx.track = 'demo.mp3';
    this.hsm.transition(Playing);
  }
}

const player = makeActor(PlayerTop, { track: '' }, new Port());
await player.hsm.sync();

player.notify.play();
await player.hsm.sync();
// active leaf: Playing — inherits stop() from Active
```

See [Hierarchy & transitions](https://filasieno.github.io/ihsm/reference#_5-transitions) in the reference.

---

## Messaging: notifications, services, and sync

Every machine is an actor with **single-threaded, run-to-completion dispatch**. While a handler runs to completion, new messages queue — no re-entrancy.

| API | Role | Returns |
| --- | ---- | ------- |
| `actor.notify.event(…)` | Fire-and-forget notification | `void` (use `hsm.sync()` to wait) |
| `actor.notifyNow.event(…)` | Hi-priority notification | `void` |
| `await actor.call.service(…)` | Typed request/response | `Promise<T>` |
| `this.hsm.port.defer(ms).event(…)` | Timer then self-notification | handler-only |
| `await actor.hsm.sync()` | Drain queue up to marker | `Promise<void>` |

```ts
door.notify.open();
await door.hsm.sync();

const id = await account.call.lookup('user-42');
```

Inside handlers use `this.hsm.transition()`, `this.notify`, and `this.notifyNow`. For delays, `await new Promise(r => this.hsm.port.setTimeout(r, ms))`; for timer-driven self-notifications, `this.hsm.port.defer(ms).event(…)`.

See [Messaging](https://filasieno.github.io/ihsm/reference#_4-messaging-notifications-services-sync) in the reference.

---

## Async handlers

Handlers may be `async`. The runtime awaits the returned `Promise` before applying a scheduled `transition()` — so you can run an entire I/O pipeline inside one handler while staying in the same state.
This is important to minimize states and exploit RTC semantics.

```ts
@InitialState
class Idle extends FileTop {
  async transfer(from: string, to: string): Promise<void> {
    const data = await readFile(from);
    await writeFile(to, data);
    this.hsm.transition(Done);
  }
}
```

See [Async handlers](https://filasieno.github.io/ihsm/reference#_9-async-handlers) in the reference.

---

## Deterministic Simulation Testing (DST)

Production code imports `ihsm`; tests import `ihsm/testing`. Every source of nondeterminism lives behind a **`Port`** — sockets, clocks, randomness, the filesystem. Tests swap in a **`TestPort`** (virtual clock, scripted random, recorded message log) or an **`@mock`** port stub, then drive the machine with **`makeTestActor`** (merged public + internal protocol, `subscribe()` for golden traces).

Two rules: **never perform I/O outside a port**, and **never `sleep()` on wall-clock time in a test** — advance virtual time and `await actor.hsm.sync()` instead.

### Virtual clock — simulate days of timers in microseconds

`this.hsm.port.defer(ms).onTick()` arms timers through the port. Replace the real clock with `TestPort` and call `advance(ms)` by hand:

```ts
import { InitialState, TopState } from 'ihsm';
import { makeTestActor, TestPort } from 'ihsm/testing';

const HOUR_MS = 60 * 60 * 1000;

interface HeartbeatConfig {
  context: { ticks: number };
  notifications: { start(): void };
  internalNotifications: { onTick(): void };
}

class HeartbeatTop extends TopState<HeartbeatConfig> {
}

@InitialState
class Running extends HeartbeatTop {
  start(): void {
    this.hsm.port.defer(HOUR_MS).onTick();
  }
  onTick(): void {
    this.ctx.ticks += 1;
    this.hsm.port.defer(HOUR_MS).onTick();
  }
}

const clock = new TestPort<typeof HeartbeatTop>();
const test = makeTestActor(HeartbeatTop, new HeartbeatCtx(), clock);
await test.hsm.sync();

test.start();
await test.hsm.sync();

for (let hour = 0; hour < 48; hour++) {
  clock.advance(HOUR_MS); // fire the due tick — no real waiting
  await test.hsm.sync();
}

// test.ctx.ticks === 48
```

Or post the internal `onTick` directly — `makeTestActor` exposes the merged protocol, so no timer is required when you only care about handler logic.

### Mock port — control *what* the network returns and *when*

Put `fetch()` behind a port. The mock records outbound calls but does **not** auto-deliver responses; the test settles them with `port.send(...)` when ready:

```ts
import { mock, makeTestActor, makeTestPort, TestPort } from 'ihsm/testing';

@mock
abstract class MockFetchPort extends TestPort<typeof FetchTop> {
  abstract request(url: string): { value: number; subscription: { dispose(): void } };
}

const port = makeTestPort(MockFetchPort);
port.request.default(() => ({
  value: 1,
  subscription: { dispose: () => port.record('abort', 1) },
}));

const fetcher = makeTestActor(FetchTop, freshCtx(), port);
await fetcher.hsm.sync();

fetcher.fetch('https://example.com');
await fetcher.hsm.sync();
// fetcher.currentState === Fetching — in-flight, still timer-free

port.send('onResponse', 200, 'ok'); // you decide when the "network" replies
await fetcher.hsm.sync();
// fetcher.currentState === Done
// port.trace === ['request:https://example.com', 'onResponse:200,ok']
```

### Golden trace — record every posted event

Wire `subscribe` to the port message log for a byte-identical transcript across runs:

```ts
const port = new TestPort<typeof HeartbeatTop>();
const test = makeTestActor(HeartbeatTop, new HeartbeatCtx(), port);
const sub = test.subscribe(m => port.record(m.event, ...m.payload));

test.start();
await test.hsm.sync();
// port.events === ['start']

sub.dispose();
```

Runnable walkthroughs (timers, fetch, streaming, fault injection, disposables) live under [`examples/testing-*`](./examples/) and on the [Deterministic Testing chapter](https://filasieno.github.io/ihsm/testing). Headless: `npm run test:examples -- --grep 'Testing 0'`.

---

## Install

Requires [Node.js](https://nodejs.org/) **22+**.

```bash
npm install ihsm
```

### Entry points

ihsm is a **single package** with two entry points, so there is no second dependency to install or
version:

| Import | Contents | Ships in production? |
| ------ | -------- | -------------------- |
| `ihsm` | The runtime: `makeActor` / `makeActor`, `TopState`, ports, tracing | **yes** |
| `ihsm/testing` or `@ihsm/core/testing` | Deterministic-testing utilities: `makeTestActor`, `@mock` / `makeTestPort`, `TestPort` (re-exports the core API too) | **no** — test-only |

```ts
import { makeActor, TopState } from 'ihsm';                 // production code
import { makeTestActor, mock, TestPort } from 'ihsm/testing'; // tests only
```

Keeping the test machinery on a separate subpath (with `"sideEffects": false`) means a production
bundle that only imports `ihsm` never pulls in the mock/clock code. This mirrors how libraries such
as `rxjs/testing` (its `TestScheduler` virtual clock) and `@apollo/client/testing` ship test helpers
as a subpath rather than a second package — one install, one version, no dual-package hazard.

### Runtime support

ihsm ships modern **ES2022** ESM and CommonJS. Supported runtimes:

| Runtime | Minimum |
| ------- | ------- |
| Node.js | **22+** |
| Chrome / Edge | **94+** |
| Firefox | **93+** |
| Safari (macOS / iOS) | **15.4+** |

### Size and dependencies

Measured with `esbuild` bundling `lib/esm/index.js` for the browser (full runtime — run-to-completion dispatch, transitions, tracing, promise services):

| | |
| --- | --- |
| **Production dependencies** | **0** |
| **Published package** | `lib/` only (~46 KB npm tarball) |
| **Minified bundle** | **~22 KB** (21.7 KiB; single-file ESM/IIFE) |
| **Gzip** | **~4.6 KB** (typical CDN / HTTP transfer size) |
| **Tree-shaking** | `"sideEffects": false` — runtime is one cohesive module (~22 KB even when importing only `makeActor`) |

Node loads the unminified `lib/` files directly (~18 KB entry, ~62 KB total); minify numbers apply to browser bundles.

No React, no RxJS, no interpreter plugins — just the runtime you import.

---

## Why?

Hierarchical statecharts are a formalism for modeling stateful, reactive systems. ihsm encodes them the **Samek/QP way**: class hierarchy, explicit transitions, cached LCA paths, and run-to-completion actors — with compile-time safety from a single `Protocol` interface.

Good fit when you want:

- Typed events and services from one protocol definition
- Backend / session actors without a heavy framework
- Zero-dependency supply chain and a small browser bundle
- Class-based states that read like ordinary TypeScript

For visual editors and declarative chart JSON, libraries like [XState](https://github.com/statelyai/xstate) may fit better. See [Comparison with XState](https://filasieno.github.io/ihsm/reference#_13-comparison-with-xstate) in the reference.

Inspired by Harel statecharts and the SCXML family of notations.

---

## Documentation

| Resource | Link |
| -------- | ---- |
| **Documentation site** | [filasieno.github.io/ihsm](https://filasieno.github.io/ihsm/) |
| Deterministic Simulation Testing | [/testing](https://filasieno.github.io/ihsm/testing) |
| Reference (concepts + interactive examples) | [/reference](https://filasieno.github.io/ihsm/reference) |
| Source: DST chapter | [reference/TESTING.md](./reference/TESTING.md) |
| Source: reference | [reference/REFERENCE.md](./reference/REFERENCE.md) |
| Source: example machines | [examples/](./examples/) |

The reference page combines the manual with embedded playgrounds. The testing chapter runs five DST examples first, then the full technique.

---

## License

[MIT](./LICENSE) © Fabio N. Filasieno, Roberto Boati
