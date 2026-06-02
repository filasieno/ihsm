[![CI](https://img.shields.io/github/actions/workflow/status/filasieno/ihsm/ci.yml?label=CI)](https://github.com/filasieno/ihsm/actions/workflows/ci.yml)
[![Documentation](https://img.shields.io/github/actions/workflow/status/filasieno/ihsm/docs.yml?label=docs)](https://github.com/filasieno/ihsm/actions/workflows/docs.yml)
[![License: MIT](https://img.shields.io/github/license/filasieno/ihsm)](https://github.com/filasieno/ihsm/blob/HEAD/LICENSE)
[![npm version](https://img.shields.io/npm/v/ihsm)](https://www.npmjs.com/package/ihsm)
[![Node](https://img.shields.io/badge/node-%3E%3D22-339933?logo=node.js)](https://github.com/filasieno/ihsm/blob/HEAD/package.json)

# ihsm

**Class-based hierarchical state machines and actor mailboxes for TypeScript** — typed `post`/`call`, **zero** production dependencies, **~4.6 KB gzip** in the browser. → [Documentation](https://filasieno.github.io/ihsm/)

ihsm is state management and orchestration for backends, session actors, protocol handlers, and embedded tooling: states are **classes**, events are **methods**, hierarchy is **inheritance**, and each machine is an **actor** with a serialized mailbox and run-to-completion dispatch.

Requires **Node.js 22+** (or a modern browser). Class names in traces and errors come from `Class.name` — no extra registration step in a typical npm/Node project.

It uses event-driven programming, class-based hierarchical statecharts, and the actor model to handle complex logic in predictable, robust ways. States are **classes**, events are **methods**, hierarchy is **inheritance**, and each machine is an **actor** with a serialized mailbox with RTC guarantees.

---

📖 [Read the documentation](https://filasieno.github.io/ihsm/)

📑 [API reference](https://filasieno.github.io/ihsm/api)

📖 [Reference](https://filasieno.github.io/ihsm/reference)

💬 [Open an issue](https://github.com/filasieno/ihsm/issues)

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
```

```ts
import { InitialState, makeHsm, TopState } from 'ihsm';

interface DoorCtx {
  openCount: number;
}

// All possible signals are enumerated in a formal protocol
interface DoorProtocol {
  open(): void;
  close(): void;
}

class DoorTop extends TopState<DoorCtx, DoorProtocol> {}

@InitialState
class Closed extends DoorTop {
  open(): void {
    this.ctx.openCount += 1;
    this.transition(Open);
  }
}

class Open extends DoorTop {
  close(): void {
    this.transition(Closed);
  }
}

const door = makeHsm(DoorTop, { openCount: 0 });
await door.sync(); // wait for initialization

door.post('open');
await door.sync();

console.log(door.currentStateName); // 'Open'
console.log(door.ctx.openCount);    // 1
```

---

## Typed services with `call()`

Most state-machine libraries make you reach for snapshots, child actors, or ad hoc callbacks to ask the machine a question. ihsm treats **services** as ordinary protocol methods — the runtime injects `resolve` / `reject`, and the client gets a typed `Promise`.

Define the service once on your `Protocol`. Implement it on a state class. Call it from anywhere that holds the `Hsm` handle.

```ts
import {
  InitialState,
  makeHsm,
  RejectCallback,
  ResolveCallback,
  TopState,
} from 'ihsm';

interface WalletCtx {
  balance: number;
}

// note the `getBalance` and `withdraw`.
// since they have a *resolve* and *reject* the are services allowing State Machines to serve requests **AND** transition at the same time if required. 
interface WalletProtocol {
  deposit(amount: number): void;
  getBalance(resolve: ResolveCallback<number>, reject: RejectCallback): void;
  withdraw(resolve: ResolveCallback<number>, reject: RejectCallback, amount: number): void;
}

class WalletTop extends TopState<WalletCtx, WalletProtocol> {
  deposit(amount: number): void {
    this.ctx.balance += amount;
  }

  getBalance(resolve: ResolveCallback<number>): void {
    resolve(this.ctx.balance);
  }

  withdraw(resolve: ResolveCallback<number>, reject: RejectCallback, amount: number): void {
    if (amount > this.ctx.balance) {
      reject(new Error('insufficient funds'));
      return;
    }
    this.ctx.balance -= amount;
    resolve(this.ctx.balance);
  }
}

@InitialState
class Open extends WalletTop {}

const wallet = makeHsm(WalletTop, { balance: 100 });
await wallet.sync();

wallet.post('deposit', 50);

const balance = await wallet.call('getBalance'); // Promise<number> — no extra sync()

try {
  await wallet.call('withdraw', 200);
} catch (err) {
  // reject() from the handler becomes a thrown Error here
}

const left = await wallet.call('getBalance'); // 150
```

**Events** (`void` handlers) → `post('deposit', 50)`. **Services** (`resolve` / `reject` handlers) → `await call('getBalance')`. Same mailbox, same serialization guarantees, full TypeScript inference on names, payloads, and return types.

See [Call services](https://filasieno.github.io/ihsm/reference#_4-messaging-post-call-sync) in the reference.

---

## Hierarchical (nested) state machines

Child states extend parent states. The prototype chain is the state tree; entering a composite runs `onEntry` from outer to inner initial leaf, exiting walks the lowest common ancestor path.
Hierarchical state machines are extreamly easy to write just a extend a class.
Also not that all states are stateless classes.
All state is stored in the actor context available at `this.ctx`.

```ts
import { InitialState, makeHsm, TopState } from 'ihsm';

interface PlayerCtx {
  track: string;
}

interface PlayerProtocol {
  play(): void;
  pause(): void;
  stop(): void;
}

class PlayerTop extends TopState<PlayerCtx, PlayerProtocol> {}

class Active extends PlayerTop {
  stop(): void {
    this.transition(Stopped);
  }
}

@InitialState
class Playing extends Active {
  pause(): void {
    this.transition(Paused);
  }
}

class Paused extends Active {
  play(): void {
    this.transition(Playing);
  }
}

@InitialState
class Stopped extends PlayerTop {
  play(): void {
    this.ctx.track = 'demo.mp3';
    this.transition(Playing);
  }
}

const player = makeHsm(PlayerTop, { track: '' });
await player.sync();

player.post('play');
await player.sync();
// active leaf: Playing — inherits stop() from Active
```

See [Hierarchy & transitions](https://filasieno.github.io/ihsm/reference#_5-transitions) in the reference.

---

## Messaging: `post`, `sync`, and `call`

Every machine is an actor with a **single-threaded mailbox**. While a handler runs, new messages queue — no re-entrancy.

| API | Role | Returns |
| --- | ---- | ------- |
| `post(event, …args)` | Fire-and-forget event | `void` (use `sync()` to wait) |
| `call(service, …args)` | Typed request/response | `Promise<T>` |
| `deferredPost(ms, event, …args)` | Timer then `post` | `void` |
| `sync()` | Drain queue up to marker | `Promise<void>` |

```ts
door.post('open');
await door.sync(); // handler + transition finished

const id = await account.call('lookup', 'user-42'); // await the service directly
```

Inside handlers you also get `transition()`, `sleep()`, and `postNow()` for hi-priority follow-up steps within the same dispatch turn.

See [Post & sync](https://filasieno.github.io/ihsm/reference#_4-messaging-post-call-sync) in the reference.

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
    this.transition(Done);
  }
}
```

See [Async handlers](https://filasieno.github.io/ihsm/reference#_9-async-handlers) in the reference.

---

## Install

Requires [Node.js](https://nodejs.org/) **22+**.

```bash
npm install ihsm
```

### Runtime support

ihsm ships modern **ES2022** ESM and CommonJS. Supported runtimes:

| Runtime | Minimum |
| ------- | ------- |
| Node.js | **22+** |
| Chrome / Edge | **94+** |
| Firefox | **93+** |
| Safari (macOS / iOS) | **15.4+** |

### Size and dependencies

Measured with `esbuild` bundling `lib/esm/index.js` for the browser (full runtime — mailbox, transitions, tracing, typed `call`):

| | |
| --- | --- |
| **Production dependencies** | **0** |
| **Published package** | `lib/` only (~46 KB npm tarball) |
| **Minified bundle** | **~22 KB** (21.7 KiB; single-file ESM/IIFE) |
| **Gzip** | **~4.6 KB** (typical CDN / HTTP transfer size) |
| **Tree-shaking** | `"sideEffects": false` — runtime is one cohesive module (~22 KB even when importing only `makeHsm`) |

Node loads the unminified `lib/` files directly (~18 KB entry, ~62 KB total); minify numbers apply to browser bundles.

No React, no RxJS, no interpreter plugins — just the runtime you import.

---

## Why?

Hierarchical statecharts are a formalism for modeling stateful, reactive systems. ihsm encodes them the **Samek/QP way**: class hierarchy, explicit transitions, cached LCA paths, and actor mailboxes — with compile-time safety from a single `Protocol` interface.

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
| Reference (concepts + interactive examples) | [/reference](https://filasieno.github.io/ihsm/reference) |
| API reference (TSDoc) | [/api](https://filasieno.github.io/ihsm/api) |
| Source: reference | [reference/REFERENCE.md](./reference/REFERENCE.md) |
| Source: example machines | [examples/](./examples/) |

The reference page combines the full manual with embedded playgrounds; the API is generated from TSDoc.

---

## Contributing

Contributions are welcome — bug reports, docs, and code. See **[CONTRIBUTING.md](./CONTRIBUTING.md)** for the development environment, build commands, and PR guidelines.

- Bug reports → [issue template](https://github.com/filasieno/ihsm/issues/new?template=bug_report.yml)
- Features → [issue template](https://github.com/filasieno/ihsm/issues/new?template=feature_request.yml)
- Security → [GitHub Security Advisories](https://github.com/filasieno/ihsm/security/advisories/new)

Please follow [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md).

---

## License

[MIT](./LICENSE) © Fabio N. Filasieno, Roberto Boati
