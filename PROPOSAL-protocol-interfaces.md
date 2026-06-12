# Proposal: split `Protocol` into Services / Notifications / InternalNotifications / InternalServices

**Status:** draft — not started · **Date:** 2026-06-12
**Scope:** `packages/ihsm/src/index.ts`, `src/testing.ts`, `src/internal/*`, all `src/spec/*.spec.ts`, `reference/REFERENCE.md`, `reference/TESTING.md`, `examples/*`, `website/docs-src/*`
**Versioning:** **major** (`2.0.0`). This is a breaking redesign of the protocol typing model, the actor client surface, and service handler signatures.

This document is written as an **executable prompt plan**: each phase below is a
self-contained prompt for an LLM coding agent, with context, tasks, and acceptance
criteria. Phases must be executed **in order**; each phase must leave the repo
green (`npm test`, `npm run lint`, `npm run build`) before the next begins.

Related: [`PROPOSAL-types.md`](PROPOSAL-types.md) (T-series; T2/T5/T6 shipped),
[`TODO.md`](TODO.md), [`packages/ihsm/reference/REFERENCE.md`](packages/ihsm/reference/REFERENCE.md).

---

## Glossary

| Term | Meaning |
| ---- | ------- |
| **Config** | The single type bag that configures a machine: `context`, the four protocol interfaces (`services`, `notifications`, `internalServices`, `internalNotifications`), and `port`. Passed as the type parameter to `TopState<Config>` and threaded through factories and test helpers. Replaces v1's positional `TopState<Context, Public, Internal, Port>` generics and the draft name `MachineSpec`. |
| **service** | A member of `services` or `internalServices` in `Config`. **Client invocation always returns `Promise<Reply>`** so callers must `await` (RTC across sequential invocations). |
| **notification** | A member of `notifications` or `internalNotifications` in `Config`. Client invocation returns `void`. |
| **protocol method** | Any service or notification member — **only user-defined names** appear on the client (`await actor.fetchFrames()`, `actor.open()`). No framework names (`call`, `post`, `tell`, `ask`, …). |
| **ActorCore** | The own-property layer of every client handle: **`ctx`** (domain context), **`hsm`** (reduced machinery facade, §2.7), and a private machine reference. Not part of `Config`. |
| **generated handle** | A **plain object** returned by the factories: `Object.create(prototypeForWidth)` carrying `ActorCore` fields, where the prototype holds one real method per protocol name, materialized once per root state class and width from the `ProtocolIndex` (§2.10). **No `Proxy` anywhere.** |
| **Actor** | Public generated handle from `makeActor`: methods for `Config.services` + `Config.notifications` only. |
| **InternalActor** | `makeInternalActor`: `Actor` + `Config.internalNotifications` methods on the same handle. |
| **OwnerActor** | `makeHsm` alias: `InternalActor` + `Config.internalServices` (parent owns child, tests). |
| **`hsm` facade** | The single machinery namespace. **Full** on the handler instance (`this.hsm.transition(…)`, `this.hsm.actor.close()`, `this.hsm.immediate.abort()`, `this.hsm.sleep(…)`); **reduced** on client handles (`actor.hsm.sync()`, introspection, trace). |
| **reserved name** | One of the few identifiers in `ReservedNames`: `ctx`, `hsm`, the lifecycle hooks (`onEntry`, `onExit`, `onError`, `onUnhandled`), and JS metadata. Everything else is free for user protocol names (§2.7). |

---

## 1. Motivation

Today a single `Protocol` interface mixes two kinds of members, discriminated by a
**structural heuristic** (`IsServiceMethod`): a member whose first two parameters
are callables `(resolve, reject, ...payload)` is a *service* (invoked with
`hsm.call`, awaitable); anything else is an *event* (posted with `hsm.post`,
fire-and-forget). This works, but has five costs:

1. **Heuristic misclassification** — an event that legitimately takes two leading
   function parameters is silently treated as a service.
2. **The resolve/reject footgun** — a service handler that returns without
   settling hangs the client's `Promise` forever, silently.
3. **Type machinery complexity** — `IsServiceMethod`, `ServiceName`,
   `ServiceKeys`, `EventKeys`, `ServiceRequest`, `ServiceResponse`, `PostedEvent`
   all exist to recover information the author already knows.
4. **Client boilerplate** — downstream code writes hand-rolled facades
   (20 × `return this.ihsm.call("x", ...)`) to get method-call ergonomics.
5. **RTC footgun (XState-class bug)** — string-dispatch `call()` / `post()` let
   client code fire multiple services in sequence **without `await`**. Each call
   enqueues a job but returns immediately; the caller believes work is ordered
   when it is only *scheduled*. ihsm's RTC guarantees apply inside the mailbox,
   not across un-awaited client calls.

The fix is twofold:

- Make discrimination **nominal** (membership in a `Config` field), not structural.
- Make the **client surface** a **generated handle**: a plain object whose
  methods are materialized from `Config` at construction — only **user-defined**
  service and notification names, e.g. `await actor.fetchFrames(…)` and
  `actor.open()` alongside `actor.ctx`. Every service returns `Promise<Reply>`
  at the type level. No `Proxy`: plain-object property lookup, full debugger /
  console / `Object.keys` visibility.
- Collapse **all machinery** under a single facade — **`this.hsm`** in handlers,
  **`actor.hsm`** on clients (reduced set) — so exactly **two words are
  reserved**: `ctx` and `hsm` (§2.6). Users are free to name protocol methods
  `transition`, `sleep`, `now`, `restore`, …

v1 string dispatch (`call`, `post`, `send`) is **removed**. v1 vocabulary
(ask/tell/call/post) does not appear on v2 surfaces.

---

## 2. The new model

### 2.1 Naming (normative)

Externally the only protocol vocabulary is **service** and **notification**, as
defined by the four `Config` fields. Each member is a **user-chosen method name**
exposed flat on the client handle — no `actor.services.*` namespace, no
framework method names.

| `Config` field | Client (user method name) | Returns | Visible on | Handler shape |
| -------------- | ------------------------- | ------- | ---------- | ------------- |
| `services` | `await actor.fetchFrames(...)` | `Promise<Reply>` | `makeActor` | `Reply \| Promise<Reply>` |
| `notifications` | `actor.open(...)` | `void` | `makeActor` | `void \| Promise<void>` |
| `internalServices` | `await owner.initialize(...)` | `Promise<Reply>` | `OwnerActor` — **never from self** | `Reply \| Promise<Reply>` |
| `internalNotifications` | `actor.onData(...)` / `port.actor.onData(...)` / `this.hsm.actor.onData(...)` | `void` | `InternalActor`, `Port` (via `actor`), handler self-handle (`this.hsm.actor`) | `void \| Promise<void>` |

Discrimination is **nominal** (which `Config` field declared the member), not
structural. The word *event* may be used in prose as an umbrella term only.

**Async rule (normative, compile-time):**

- Members declared on `services` / `internalServices` in `Config` **must** be
  typed as returning `Promise<Reply>` (including `Promise<void>`). A sync return
  type like `fetchFrames(...): CBAnswer` is a **compile error** on the Config interface.
- Members on `notifications` / `internalNotifications` may return `void` or
  `Promise<void>` — no `Promise` requirement on the Config declaration.
- **Handlers** are not required to be `async`: a service handler may return a
  plain value or a `Promise`; the runtime normalises both before settling the
  client promise. The async requirement applies to the **client contract** only.

### 2.2 `Config` — single bag for the whole machine

`TopState` and all factories take **one** type parameter — `Config` — instead of
four positional ones:

```typescript
export interface Config {
	context?: object;
	services?: object;
	notifications?: object;
	internalServices?: object;
	internalNotifications?: object;
	port?: object;
}

interface ConnConfig extends Config {
	context: ConnCtx;
	services: ConnServices;
	notifications: ConnNotifications;
	internalServices: ConnInternalServices;
	internalNotifications: ConnInternalNotifications;
	port: ConnPort;
}

class ConnTop extends TopState<ConnConfig> {}
```

No manual key registry on `TopState`. The runtime builds a **`ProtocolIndex`**
automatically at construction (§2.10) by scanning state-class prototypes.
`AssertHandlersMatchConfig<ConnConfig, ConnTop>` (compile-only) ensures every
`Config` key has a handler and every handler name maps to exactly one `Config`
bucket.

All `Config` fields optional, defaulting to `{}` (`context` defaults to `Any`).

**`TopState` is the single configuration point** — factories and ports never take
an explicit `Config` type argument at the call site. `Config` is inferred from
the root state class via `__ihsm`:

```typescript
/** Full `Config` bag carried on `TopState<Config>` / `prototype.__ihsm` */
export type ConfigOf<T> = T extends { readonly __ihsm: infer C extends Config } ? C : {};

/** Root state class argument — ties runtime class to its `Config` */
export type TopStateArg<C extends Config = Config> = StateClass<ConfigContext<C>, …> & {
	readonly prototype: { readonly __ihsm: C };
};
```

Extraction helpers (`ConfigOf<T>`, `ConfigContext<T>`, `ConfigServices<T>`,
`ConfigNotifications<T>`, `ConfigInternalServices<T>`,
`ConfigInternalNotifications<T>`, `ConfigPort<T>`) take **`T` = root `TopState`
subclass** (e.g. `ConnTop`), not a bare `Config` interface. They read named fields
via the phantom carrier, replacing positional `MachineTypes<C, P, I, Port>`.

```typescript
function makeActor<C extends Config>(
	topState: TopStateArg<C>,
	ctx: ConfigContext<C>,
	port: PortHandle<C>,
	options?: ActorOptions<C>,
	..._disjoint: DisjointConfig<C> extends true ? [] : [error: DisjointConfig<C>]
): Actor<C>;

const conn = makeActor(ConnTop, ctx, port); // C = ConnConfig — inferred
```

Tutorial **00** (`examples/00-config/`) and both READMEs must introduce `Config`
as the first concept after "state class" — before hierarchy, tracing, or testing.

### 2.3 Service handlers — no resolve/reject

Because membership in `services` / `internalServices` already identifies a member
as a service, the runtime settles the client's `Promise` from the **handler's
return value**:

```typescript
// Config declaration (ConnServices) — Promise required on the interface
fetchFrames(frames: string): Promise<CBAnswer>;

// implementation — sync or async; `implements` works either way
fetchFrames(frames: string): CBAnswer {
	const answer = this.doFetch(frames);
	this.hsm.transition(Idle);
	return answer;
}
```

- Handler returns / resolved promise → client resolves with that value.
- Handler throws / rejected promise → client rejects (after the `onError` /
  `onUnhandled` recovery chain, consistent with v1 dispatch errors).
- The "forgot to call resolve" hang is **structurally impossible**.

`ResolveCallback` / `RejectCallback` are deleted. Follow-up work after replying
is expressed by returning the reply, then scheduling a follow-up notification via
`this.hsm.actor.followUp(...)` (user-defined notification name).

### 2.4 Two client widths — `Actor` and `InternalActor` (+ `OwnerActor`)

**Key decision (normative):** there is **no exported `Hsm` client type**. What
authors called “internal methods” (transition, trace, logging) are **state
machinery** behind `this.hsm`, not a third protocol tier.

```typescript
/** Production black-box — public protocol only (generated handle) */
type Actor<C extends Config> = ActorCore<ConfigContext<C>>
	& ServiceClient<ConfigServices<C>>
	& NotificationClient<ConfigNotifications<C>>;

/** Supervisors / port wiring — adds internalNotifications on the same handle */
type InternalActor<C extends Config> = Actor<C>
	& NotificationClient<ConfigInternalNotifications<C>>;

/** Parent owns child — adds internalServices (composition only) */
type OwnerActor<C extends Config> = InternalActor<C>
	& ServiceClient<ConfigInternalServices<C>>;
```

| Factory | Returns (inferred `C = ConfigOf<topState>`) | Generated method width |
| ------- | ------------------------------------------- | ---------------------- |
| `makeActor(topState, …)` | `Actor<C>` | `services` + `notifications` |
| `makeInternalActor(topState, …)` | `InternalActor<C>` | above + `internalNotifications` |
| `makeHsm(topState, …)` (owner alias) | `OwnerActor<C>` | above + `internalServices` |

All factories take **`topState: TopStateArg<C>`** as the first argument; `C` is
inferred from the class — callers do not pass `Config` as a type parameter.
`makeActor` is the production black-box export. `makeInternalActor` adds
generated methods for `internalNotifications` only. `makeHsm` returns
`OwnerActor<C>` when the caller owns the machine and must invoke
`internalServices` (composition, tests).

The **runtime mailbox object** (`HsmObject` in `src/internal/`) stays an
implementation detail; it is not the public typing target.

### 2.5 Client handles — generated methods, no `Proxy`

Handles are **plain objects with materialized methods**. The client sees **only**
names from `Config` plus `ctx` and `hsm` — never framework dispatch names.

```typescript
const conn = makeActor(ConnTop, ctx, port);
await conn.fetchFrames(frames);  // Config.services — generated method → service job
conn.open();                     // Config.notifications — generated method → notification job
conn.ctx.openCount;              // domain context (own property)
await conn.hsm.sync();           // machinery — reduced public facade (own property)
```

**Generation rule (normative, §2.10 has the implementation):**

1. One **handle prototype per `(root state class, width)`** is built from the
   `ProtocolIndex` and cached: a real function per protocol name —
   `services` / `internalServices` names return the machine's `Promise`;
   `notifications` / `internalNotifications` names return `void`.
2. Each handle instance is `Object.create(prototypeForWidth)` plus three own
   properties: `ctx`, `hsm`, and a non-enumerable machine reference.
3. A name outside the width simply **does not exist** on the handle — plain
   `undefined`, no trap logic.

**Why no `Proxy` (normative):** the protocol is immutable after construction
(the index is already built eagerly for the collision guard, §2.9), so dynamic
trapping buys nothing. Plain objects give monomorphic property lookup (no trap
overhead on every call), and the debugger, console, autocomplete, `Object.keys`,
and spread all show the real protocol methods with zero extra machinery.

```typescript
const supervisor = makeInternalActor(ConnTop, ctx, port);
supervisor.onData(chunk);        // internalNotifications

const reader = makeHsm(ReaderTop, ctx, port);
await reader.initialize();       // internalServices
```

| Surface | `Config.services` | `Config.notifications` | `Config.internalServices` | `Config.internalNotifications` |
| ------- | ----------------- | ---------------------- | ------------------------- | -------------------------------- |
| `Actor` | generated | generated | — | — |
| `InternalActor` | generated | generated | — | generated |
| `OwnerActor` | generated | generated | generated | generated |
| `this` (handler) | **none** | via **`this.hsm.actor`** (self-handle, notifications only) | **none** | via **`this.hsm.actor`** |
| `Port` | — | — | — | via **`this.actor`** binding (`RequestingPort` adds internal services) |

### 2.6 Machinery namespace — `ctx` and `hsm` are the only reserved words

**Problem:** handlers are prototype methods, so user protocol names live in the
same namespace as everything `TopState` puts on `this`. Flat machinery
(`this.transition`, `this.sleep`, `this.defer`, `this.now`, `this.port`, …)
reserves ~25 highly plausible domain names, and every machinery addition would
shrink the user's namespace further.

**Fix (normative, 2.0):** collapse all machinery behind a single facade.

| Surface | Domain context | Machinery | User protocol |
| ------- | -------------- | --------- | ------------- |
| Handler `this` | **`this.ctx`** (v1 name kept) | **`this.hsm.*`** (full set, §2.7) | `this.<handler>` — prototype methods, dispatch only |
| Client actor | **`actor.ctx`** | **`actor.hsm.*`** (reduced set, §2.7) | `actor.<userMethod>()` flat |
| Port | — | **`this.actor`** binding (v1) | inbound via `this.actor.onData(…)` |

**Reserved words on `Config`: `ctx` and `hsm`.** Nothing else — plus the four
lifecycle hooks (`onEntry`, `onExit`, `onError`, `onUnhandled`), which dispatch
looks up by name on the prototype, and JS metadata (`constructor`, `__ihsm`).

This generalizes v1 precedent: v1 already had `this.ctx` and `this.hsm` (the
handler's view of the machine). v2 removes the flat *delegating* members from
`TopState` (`transition`, `unhandled`, `sleep`, `postNow`, `deferredPost`, `port`, trace
accessors) — they live only on `this.hsm`. Migration is mechanical:
`this.transition(Idle)` → `this.hsm.transition(Idle)`.

```typescript
class Closed extends ConnTop {
	async open(host: string): Promise<void> {
		const { ctx, hsm } = this;            // destructure once on hot paths
		ctx.openCount += 1;
		await hsm.sleep(10);
		hsm.actor.connected();                // schedule user notification on self
		hsm.transition(Open);
	}
}
```

#### Handler execution — three surfaces

| Surface | Mechanism | Example |
| ------- | --------- | ------- |
| **Client** | Generated methods on the handle (§2.5) | `await actor.fetchFrames()` · `actor.ctx` |
| **Dispatch** | Prototype-only lookup (`lookup.ts`) | `Closed.prototype.open.call(instance, …)` |
| **Handler schedule** | **`this.hsm.actor` / `immediate` / `defer(ms)`** self-handles (notifications only) | `this.hsm.actor.close()` · `this.hsm.immediate.abort()` |

Flat `this.open()` on the handler instance is **rejected** (ambiguous with the
handler method). Dispatch **never** uses `instance[name]` for handler lookup.

#### Case study: machinery words as user protocol names

| User defines | Allowed? | Why |
| ------------ | -------- | --- |
| `services.transition` | yes | machinery is `this.hsm.transition()`; `await actor.transition()` is the user service |
| `services.sleep`, `notifications.now`, `services.restore` | yes | machinery lives behind `hsm` |
| `notifications.open` + handler `open()` | yes | scheduling from handlers is `this.hsm.actor.open()` — no flat clash |
| `services.ctx` | **no** | `ctx` is the domain-context accessor on both surfaces |
| `services.hsm` | **no** | `hsm` is the machinery facade |
| `onEntry` as protocol name | **no** | lifecycle hook, prototype-resolved |

#### Service handlers inside a dispatch

Never invoke a **service** on your own machine from inside a running handler
(self-deadlock, §2.8). Use private methods. `this.hsm` exposes **no service
dispatch** — notifications only, via `this.hsm.actor.*` / `immediate.*` /
`defer(ms).*` (the self-handle excludes services by type).

### 2.7 The `hsm` facades — full handler set, reduced public set

Because all machinery sits behind `hsm`, member names **inside** the facade never
constrain `Config`. The facade contents below are API design, not reservations.

#### Reserved state symbols (normative, exhaustive)

```typescript
export const ReservedNames = [
	'ctx', 'hsm',                                      // machinery accessors
	'onEntry', 'onExit', 'onError', 'onUnhandled',     // lifecycle hooks
] as const;
```

This list is **exhaustive** — every other identifier is free for user protocol
names. It must appear verbatim in tutorial 00, `REFERENCE.md`, and the
`TopState` TSDoc. Adding machinery to a facade is **non-breaking**; adding a
reserved word is breaking and requires a major bump.

**Using a reserved symbol in a state class or on `Config` fails:**

| Misuse | Compile time | Runtime |
| ------ | ------------ | ------- |
| Reserved key on any `Config` protocol field (e.g. `services.ctx`) | `DisjointConfig<C>` error at the factory call site | `ProtocolCollisionError` from `buildProtocolIndex` |
| State class declares `ctx` / `hsm` as a method or redeclares the property | TS shadow error against `TopState`'s `readonly ctx` / `readonly hsm` declarations | `ProtocolCollisionError` — prototype scan finds a reserved name that is not the inherited accessor |
| Lifecycle hook name (`onEntry`, …) used as a `Config` key | `DisjointConfig<C>` error | `ProtocolCollisionError` |
| Lifecycle hook **implemented as a hook** in a state class | allowed — that is its purpose | excluded from the protocol index |

The runtime check is unconditional (not debug-only): `buildProtocolIndex` (§2.10)
throws at **construction**, before the first dispatch, so JS-only consumers fail
just as loudly as TypeScript users.

#### `HandlerHsm<C>` — `this.hsm` in handlers (full set)

| Member | Role |
| ------ | ---- |
| `transition(State)` | Schedule external transition (v1 name kept) |
| `actor` | Notifications-only handle on **self** — default queue (`this.hsm.actor.open()`, …) |
| `immediate` | Same surface — **priority queue** (`this.hsm.immediate.abort()`, …; evolves from v1 `postNow`) |
| `defer(ms)` | Returns the same surface, timer-delayed (`this.hsm.defer(100).retry()`; evolves from v1 `deferredPost`) |
| `port` | Outbound port |
| `unhandled()` | Explicit unhandled signal |
| `sleep(ms)` | Handler-local delay |
| `eventName` / `eventPayload` | In-dispatch introspection |
| `currentState` / `currentStateName` | Active state |
| `topState` / `topStateName` | Root state |
| `ctxTypeName` / `traceHeader` | Trace labels |
| `traceLevel` / `traceWriter` | Trace config |
| `dispatchErrorCallback` | Error hook |

There is **no new concept** for self-scheduling: a handler posts notifications
to itself through an **actor handle on self**, exactly the way ports
(`this.actor`) and clients do. The three members share one named type —
`SelfNotifications<C> = NotificationClient<ConfigNotifications<C>> &
NotificationClient<ConfigInternalNotifications<C>>` — and differ only in
queue/timing: `actor` → mailbox tail, `immediate` → priority queue (dispatched
before pending default jobs), `defer(ms)` → timer, then mailbox tail.

Like client handles, the self-handles are **generated plain objects** (§2.10):
`actor` and `immediate` are materialized once per root state class and shared;
`defer(ms)` allocates one small object per call to capture `ms` (timer path —
allocation is noise there).

The self-handle is **narrower** than the port's `actor` or a client handle: no
services (deadlock rule, §2.8) and no nested `hsm`/`ctx` accessors — it is
purely the notification surface.

#### `ActorHsm<C>` — `actor.hsm` on clients (reduced set)

A client must not reach dispatch-context machinery (`transition`, the self
notification handles `actor` / `immediate` / `defer`, `sleep`, `unhandled` are
meaningless or dangerous outside a handler). The public facade is **observability + queue control only**, widened
by handle tier:

| Member | `Actor` | `InternalActor` | `OwnerActor` |
| ------ | ------- | --------------- | ------------ |
| `sync()` — queue barrier | yes | yes | yes |
| `currentStateName` / `topStateName` | yes | yes | yes |
| `traceLevel` / `traceWriter` / `traceHeader` | yes | yes | yes |
| `currentState` / `topState` (class refs) | — | yes | yes |
| `restore(State, ctx)` — snapshot restore | — | — | yes |
| `dispatchErrorCallback` | — | — | yes |

`TestOwnerActor` adds `port` and `subscribe` **on the facade** (`actor.hsm.port`,
`actor.hsm.subscribe`) — test names no longer constrain `Config` either.

#### `Port` / `BasePort`

Ports keep the v1 `actor` binding; inbound notifications go through it
(`this.actor.onData(chunk)`) — nothing is bound flat onto the port instance, so
port base-class members (`setTimeout`, `random`, …) and `TestPort` members
(`record`, `advance`, `now`, …) never constrain `Config`.

#### Metadata — never protocol keys

`__ihsm`, `__topState`, `constructor`, `prototype`.

#### Retired v1 flat identifiers

`call`, `post`, `send`, and the flat `TopState` delegates (`transition`,
`unhandled`, `sleep`, `postNow`, `deferredPost`, `port`, trace accessors) are
deleted from the prototype surface; `postNow` / `deferredPost` become
`hsm.immediate` / `hsm.defer(ms)`. `ctx` and `hsm` keep their v1 names and
meanings.

### 2.8 Deadlock rule (normative)

The actor is a single mailbox with run-to-completion dispatch. **Awaiting a
service on your own machine from inside your own dispatch deadlocks**: the
enqueued service job is behind the very handler awaiting it.

Consequences, enforced in this order of preference (static > runtime > docs):

1. **Static:** `State` / `this` exposes **no service methods** (no
   `await this.fetchFrames()`). In-handler logic is a private method — no service
   dispatch from self.
2. **Static:** a port's `actor` binding exposes `internalNotifications` only.
   `RequestingPort` widens it with `internalServices` — opt-in; safe only from
   async I/O callbacks, never synchronously inside an outbound port method a
   handler is awaiting.
3. **Runtime (debug builds, Node only):** `AsyncLocalStorage` dispatch token; if
   any **service** invocation on machine M runs while M is dispatching, throw
   `SelfCallDeadlockError`. Browsers: documented rule only.
4. **Docs:** cross-actor cycles documented; optional `{ timeoutMs }` trailing
   options on service methods → `CallTimeoutError` (job not cancelled).

### 2.9 Runtime protocol collision guard

Compile-time `DisjointConfig<C>` catches key overlap across the four
protocol interfaces and `ReservedNames`. **Additionally, at actor construction**
(before the first dispatch), the runtime validates the auto-built `ProtocolIndex`
(§2.10) and throws `ProtocolCollisionError` if:

- the same string appears in more than one bucket;
- any key is in `ReservedNames` (`ctx`, `hsm`, lifecycle hooks — §2.7);
- any state class in the graph defines a **reserved symbol** as its own
  prototype member (e.g. a `ctx()` or `hsm()` method shadowing the `TopState`
  accessors) — lifecycle hooks implemented as hooks are exempt;
- a scanned handler name is not in exactly one `Config` bucket; or
- a `Config` key has no handler on the state graph.

The error message names the offending state class, the reserved symbol, and the
fix (rename the protocol method; reserved symbols are listed in §2.7).

This guards drift between `Config`, state classes, and JS-only consumers.

### 2.10 Binding — generated handles, auto `ProtocolIndex`, self-handle

**No manual key registry.** At construction, `buildProtocolIndex(topState)`:

1. Walks every state class in the hierarchy (same graph as `registerStateNames` /
   `lookup.ts`).
2. Collects every prototype method name minus `ReservedNames` (lifecycle hooks
   included).
3. Assigns each name to exactly one bucket (`services` | `notifications` |
   `internalServices` | `internalNotifications`) by correlating with the
   `Config` type carried on `TopState<Config>` — **compile-time**
   `AssertHandlersMatchConfig` is the source of truth; runtime stores the
   bucket map built when the machine is first wired (implementation may cache on
   the root state class after first `makeActor`).

**Client handles — materialized prototypes (no `Proxy`):**

```typescript
const kMachine = Symbol('ihsm.machine');

/** Own-property layer every generated method sees as `this`. */
interface HandleOwn extends ActorCore {
	[kMachine]: Machine;
}

/** Built once per (root state class, width); cached alongside the ProtocolIndex. */
function buildHandleProto(index: ProtocolIndex, width: Width): object {
	const proto: Record<string, Function> = Object.create(null);
	for (const [name, slot] of index.entries(width)) {
		proto[name] = slot.bucket === 'services' || slot.bucket === 'internalServices'
			? function (this: HandleOwn, ...args: unknown[]) { return this[kMachine].dispatchService(name, args); }
			: function (this: HandleOwn, ...args: unknown[]) { this[kMachine].dispatchNotification(name, args); };
	}
	return Object.freeze(proto);
}

/** Per actor instance — three own properties, methods inherited. */
function createActorHandle<C extends Config>(machine: Machine, width: Width): Actor<C> {
	const handle = Object.create(protoCache.get(machine.topState, width));
	Object.defineProperty(handle, kMachine, { value: machine }); // non-enumerable
	handle.ctx = machine.ctx;
	handle.hsm = machine.actorHsmFor(width);
	return handle;
}
```

Properties of this construction (normative):

- **Prototype shared** across every instance of the same machine class and
  width — per-instance cost is three own-property writes.
- **Per-call cost is a normal monomorphic property lookup + call** — no trap on
  the hot path.
- `console.log(actor)`, debugger autocomplete, `Object.keys(Object.getPrototypeOf(actor))`,
  and spread show the real protocol; nothing to fake with `ownKeys` traps.
- Names outside the width are absent — plain `undefined` on access, and the
  static types already exclude them.
- The prototype is frozen; the handle's own layer carries no protocol state.

**Handler instance:** `this.hsm` is the `HandlerHsm` facade; `actor` and
`immediate` are `SelfNotifications<C>` objects materialized the same way
(per root state class, default / priority queue); `defer(ms)` allocates a small
per-call object capturing `ms`. **Never** generate service methods on `this` or
`this.hsm`.

**Port:** nothing generated onto the port instance — inbound notifications go
through the v1 `this.actor` binding (an `InternalActor<C>` handle).

#### Transition resolution — pluggable, codegen-ready (normative)

v1 builds each transition routine (exit/entry chain for a `FromState=>ToState`
pair) lazily at runtime via `createTransition` and memoizes it in a per-machine
`_transitionCache: Map<string, Transition>`. v2 must put this behind a **seam**
so tooling can replace runtime computation entirely:

```typescript
interface TransitionResolver {
	resolve(src: StateClass, dest: StateClass): TransitionRoutine;
}
```

- **Default — `RuntimeTransitionResolver`:** today's behavior (compute on first
  use, cache per machine; implementation may share the cache per root state
  class, since routines depend only on the state graph).
- **Generated — `StaticTransitionResolver`:** accepts a **precomputed transition
  table** emitted by a build-time tool. The state graph is fully static (state
  classes + `@InitialState`), so a generator can enumerate every reachable
  `(src, dest)` pair and emit the exit/entry chains as data — no runtime path
  computation, no cache misses, no lazily allocated closures.
- The resolver is chosen per machine via `ActorOptions` (e.g.
  `{ transitions: connTransitionTable }`); the dispatch loop calls only
  `resolver.resolve(src, dest)` and is unaware which implementation answers.
- A generated table must fail construction (`TransitionTableError`) if its graph
  hash does not match the scanned state hierarchy — stale codegen must not
  silently misroute transitions.

This is the same philosophy as `buildProtocolIndex` (§2.10 step 3): runtime
derivation is the zero-config default; compile-time tooling can replace it
without touching user code or the dispatch loop.

### 2.11 Type machinery: deleted vs simplified

| v1 | v2 |
| -- | -- |
| `IsServiceMethod<M>` (heuristic) | **deleted** — `Config` field discriminates |
| `ServiceName`, `ServiceKeys`, `EventKeys`, `PostedEvent` | `keyof` on each `Config` field minus `ReservedNames` |
| `ServiceRequest<P, K>` (strip resolve/reject) | `Parameters<ConfigServices<C>[K]>` |
| `ServiceResponse<P, K>` (infer from resolve) | `Awaited<ReturnType<ConfigServices<C>[K]>>` |
| `ResolveCallback`, `RejectCallback` | **deleted** |
| `Dispatch<Public, Internal>` merge | four `Config` fields |
| `Disjoint<Public, Internal>` | `DisjointConfig<C>` + runtime `ProtocolCollisionError` |
| `MachineTypes<C, P, I, Port>` positional | `Config` named fields |
| `Actor.call` / `Actor.post` / `Port.send` | **deleted** — flat protocol methods on the handle |
| `asOwner`, `OwnerHandle` | **deleted** — `OwnerActor` / `makeInternalActor` owner path |
| `actor.services.*` namespace | **deleted** — flat user method names, generated per class/width |
| Flat `TopState` delegates (`transition`, `sleep`, `postNow`, `deferredPost`, `port`, trace) | **moved** behind `this.hsm` facade (§2.6) — `ctx` / `hsm` keep v1 names; `postNow`→`immediate`, `deferredPost`→`defer(ms)` |
| Exported `Hsm` client type | **deleted** — machinery behind `actor.hsm` / `this.hsm`; `HsmObject` stays internal |
| Manual `ihsmKeys` / `configKeys` | **deleted** — auto `buildProtocolIndex` |

Legacy untyped mode (`Protocol extends undefined` → free strings) is **dropped**
in 2.0. Untyped users stay on 1.x.

### 2.12 Testing surface

```typescript
import { makeTestActor, makeTestPort } from 'ihsm/testing';

// OwnerActor width — tests are owners; Config inferred from ConnTop
const actor = makeTestActor(ConnTop, ctx);
await actor.fetchFrames(frames);
actor.onData(chunk);
await actor.initialize();
const { port, subscribe } = actor.hsm;   // test machinery on the facade
// inside a handler: this.hsm.actor.close() — not on the client handle
```

- `makeTestActor(topState, ctx, port?, options?)` — `C = ConfigOf<typeof topState>`
  inferred; returns **`TestOwnerActor<C>`** = `OwnerActor<C>` whose `hsm` facade
  adds `subscribe` + `port` (§2.7). Optional type args only when narrowing a port
  mock type (`makeTestPort` pattern).
- `TestPort<T>` derived from `ConfigPort<T>` (`T` = root `TopState` subclass) plus
  testing APIs.
- Tests that only need `internalNotifications` may use `makeInternalActor`; full
  owner tests use `makeTestActor`.

---

## 3. Prompt plan

> **Conventions for every phase**
> Repo: `~/code/ihsm`, package `packages/ihsm`. Tests: mocha + chai under
> `src/spec/*.spec.ts`, run with `npm test`; coverage must stay **100%**
> (statements, branches, functions, lines) — this is asserted in CI.
> Lint: `npm run lint`. Build: `npm run build` (CJS + ESM + types).
> Do not introduce runtime npm dependencies (the package ships with zero).
> Every public symbol keeps the existing TSDoc style: `@category`, `@example`,
> `@remarks`, cross-links via `{@link ...}`.
>
> **Code-shape rules (enforced at review of every phase):**
>
> - **No small single-use helper routines.** Before finishing a phase,
>   double-check every private function you introduced: if it has exactly one
>   call site, **inline it** at that call site. A helper earns its existence
>   only with ≥2 call sites or a genuinely independent concern (e.g. a
>   `TransitionResolver` implementation); "extracting for readability" is not
>   a reason — use a comment instead.
> - **No inline type definitions.** Do not write anonymous object types,
>   mapped types, or conditional types inline in signatures, parameters,
>   return types, or other types' bodies. Define a **named type function**
>   (generic alias like `ConfigOf<T>`, `ServiceClient<S>`, `DisjointConfig<C>`)
>   and use it by name. Every exported signature must read as a composition of
>   named type functions — `@ts-expect-error` specs and TSDoc reference those
>   names, never structural blobs.

### Phase 0 — type-level scaffolding (no runtime change)

**Prompt:**

> In `packages/ihsm/src/index.ts`, add the v2 type layer alongside the v1 types
> (nothing removed yet):
> `Config` (all fields optional: `context`, `services`, `notifications`,
> `internalServices`, `internalNotifications`, `port`);
> `ServiceClient<S>` / `NotificationClient<N>` mapped types for the flat actor
> intersection (service methods `(...args) => Promise<…>`, notification methods
> `(...args) => void`);
> `ActorCore<C>`, `Actor<C>`, `InternalActor<C>`, `OwnerActor<C>`;
> `HandlerHsm<C>` / `ActorHsm<C>` facade types and `SelfNotifications<C>` —
> shared by `this.hsm.actor`, `this.hsm.immediate`, and `this.hsm.defer(ms)`;
> `ReservedNames` const tuple — `['ctx', 'hsm', 'onEntry', 'onExit', 'onError',
> 'onUnhandled']` (§2.7);
> `ServiceHandler` / `NotificationHandler` shape aliases;
> `AssertAsyncService<M>` — resolves to `M` only when `ReturnType<M>` extends
> `Promise<unknown>`, else a descriptive error type (used to constrain Config
> service fields);
> `ServiceArgs<S, K>`, `ServiceReply<S, K>`, `NotificationArgs<N, K>`;
> key filters using `ReservedNames`;
> `ConfigOf<T>`, `TopStateArg<C>` (§2.2);
> `DisjointConfig<C>` — compile-time pairwise disjointness across the four
> protocol fields + `ReservedNames`;
> `AssertHandlersMatchConfig<Config, TopStateClass>`.
> Add `src/spec/types-v2.spec.ts` with `@ts-expect-error` for: overlapping keys;
> reserved-word collisions (`ctx`, `hsm`, `onEntry` on `Config`); **allowed**
> `services.transition` / `services.sleep` / `notifications.now` (machinery is
> behind `hsm`);
> sync return type on
> a `services` member; args/reply
> inference for `Promise<Reply>` services including `Promise<void>`. One trivial
> runtime assertion so mocha counts the file.

**Acceptance:** `npm test` green, coverage unchanged, no public v1 type altered.

### Phase 1 — runtime: promise-settled services + collision guard

**Prompt:**

> In `src/internal/` teach dispatch a `kind: 'notification' | 'service'`
> discriminator on each job (set by which surface invoked it, not by heuristics).
> For `kind: 'service'`, invoke the handler with payload only, normalise sync/
> async return, settle the client promise. Add `ProtocolCollisionError`.
> Implement `buildProtocolIndex(topState)` (§2.10).
> Prototype-only handler lookup (§2.6). `HandlerHsm` facade with `actor` /
> `immediate` / `defer(ms)` self notification handles (default / priority /
> timer queue) on state instances — materialized plain objects per root state
> class, `defer(ms)` allocates per call (§2.10); flat `TopState` delegates
> removed (§2.6). Do not use `Proxy` anywhere.
> Extract transition resolution behind the `TransitionResolver` seam (§2.10):
> `RuntimeTransitionResolver` wraps the existing `createTransition` +
> `_transitionCache` path; dispatch loops call only `resolver.resolve(src, dest)`.
> Accept an optional resolver via `ActorOptions.transitions`; add
> `TransitionTableError` for graph-hash mismatch.
> Keep the v1 resolve/reject path working in this phase so existing specs stay
> green.
> Add `src/spec/services-promise.spec.ts`: resolved value; `Promise<void>`
> service; **sync handler return** on an async-typed service; thrown error →
> client rejection; `onError` recovery; transition-then-reply ordering; RTC —
> awaiting inside a service handler blocks subsequent notifications.
> Add `src/spec/protocol-collision.spec.ts`: runtime throw on duplicate keys;
> reserved symbol as a `Config` key; **a state class defining a reserved symbol
> (`ctx()` / `hsm()` method) throws `ProtocolCollisionError` at construction**,
> with the state class and symbol named in the message; lifecycle hooks
> implemented as hooks do not throw; handler/index mismatch.

**Acceptance:** all v1 specs still green; new specs green; 100% coverage.

### Phase 2 — `TopState<Config>`, factories, typed surfaces

**Prompt:**

> Replace public generics. `TopState<C extends Config = {}>` (single type
> parameter — do **not** shadow the `Config` interface name) derives context,
> four protocol interfaces, and port from `C` via `__ihsm`. Add `ConfigOf<T>`,
> `TopStateArg<C>`; rename extraction helpers to `ConfigContext<T>`, etc. (`T` =
> root state class).
> Implement **generated actor handles** (§2.10): `buildHandleProto(index, width)`
> cached per (root state class, width); instances are `Object.create(proto)`
> with own `ctx`, `hsm`, and a non-enumerable machine symbol — **no `Proxy`**.
> Factories take `TopStateArg<C>` — `makeActor(topState, …)` → `Actor<C>` with
> `C` inferred; `makeInternalActor` → `InternalActor<C>` or `OwnerActor<C>`
> (owner path); `makeHsm` alias. `this.ctx` / `this.hsm` unchanged from v1; remove flat
> `TopState` delegates (`transition`, `sleep`, `postNow`, `deferredPost`, `port`, trace) —
> they live on `this.hsm`. Build `ActorHsm` (reduced) per width.
> Add `src/spec/handler-dispatch.spec.ts`: `this.hsm.actor.close()` schedules;
> `this.hsm.immediate.abort()` dispatches before pending default-queue jobs;
> dispatch hits `prototype.close`; `await actor.transition()` works when
> `services.transition` is on `Config`; `actor.hsm.transition` does not exist
> (reduced facade); `services.ctx` is a compile error (`@ts-expect-error`) **and**
> a state class with a `ctx()` method fails to compile against `TopState` and
> throws at construction in JS. Export `ReservedNames` (§2.7) and reference it
> from the `TopState` TSDoc.
> Delete v1: positional `TopState` generics, `MachineTypes`, `IsServiceMethod`,
> all deleted symbols from §2.11, resolve/reject injection, `asOwner` / `OwnerHandle`,
> untyped string mode.
> Migrate every `src/spec/` file: split `Protocol` into `Config` fields; client
> code uses user method names only / `this.hsm.*` machinery. Rename
> `call.spec.ts` → `services.spec.ts`.

**Acceptance:** `rg 'ResolveCallback|IsServiceMethod|\.call\(|\.post\(|\.send\(' src/` finds only CHANGELOG/docs; `rg 'new Proxy' src/` finds nothing; all specs green; 100% coverage.

### Phase 3 — ports, `RequestingPort`, deadlock guard

**Prompt:**

> 1. `Port` binds nothing flat (no `send`, no notification methods on the port
>    instance): `BasePort.actor` is typed as the `InternalActor<C>` handle —
>    inbound is `this.actor.onData(…)`. Opt-in `RequestingPort` widens `actor`
>    with `internalServices` under the async-only client contract and safety
>    TSDoc from §2.8.
> 2. Debug-build `SelfCallDeadlockError` via `AsyncLocalStorage` when a service
>    surface targets the machine currently dispatching (Node only, dynamic import).
> 3. Optional `{ timeoutMs }` on service surface methods; `CallTimeoutError` on
>    expiry (job not cancelled — document).
> 4. Specs: `internal-services.spec.ts` (parent `await child.initialize()` on
>    `OwnerActor`; `@ts-expect-error` on `Actor` / `InternalActor` child);
>    `deadlock-guard.spec.ts`; `reserved-names.spec.ts` for `ctx`, `hsm`, hooks.

**Acceptance:** all specs green; 100% coverage; no unconditional `node:async_hooks` import.

### Phase 4 — testing surface

**Prompt:**

> Update `src/testing.ts`:
> `makeTestActor(topState, ctx, port?, options?)` — `C = ConfigOf<typeof topState>`
> inferred (no required `Config` type arg);
> `TestPort<T>` derived from `ConfigPort<T>` + virtual clock / mock APIs;
> `TestOwnerActor<C>` = `OwnerActor<C>` whose `hsm` facade adds `subscribe` +
> `port` (`actor.hsm.subscribe`, `actor.hsm.port` — §2.7, §2.12).
> Observer entries carry `kind: 'service' | 'notification'`.
> Specs: `testing.spec.ts`; `@ts-expect-error` when `makeActor` exposes internal
> keys or `internalServices`.

**Acceptance:** all specs green; 100% coverage; `ihsm/testing` subpath builds.

### Phase 5 — documentation

**Prompt:**

> Update all prose to the v2 model:
>
> 1. **New `examples/00-config/`** — tutorial 00: `Config`, four interfaces,
>    `Actor` / `InternalActor` / `OwnerActor`, generated client handles (§2.5),
>    the `hsm` facade (`this.hsm` full vs `actor.hsm` reduced), the self-handle
>    (`this.hsm.actor`), the **`ReservedNames` table verbatim** (§2.7) with the
>    failure behavior (compile error + `ProtocolCollisionError` at construction),
>    auto index, XState RTC lesson.
> 2. `reference/REFERENCE.md` — `Config`, handle widths, generated handles
>    (§2.5, §2.10), `HandlerHsm` / `ActorHsm` (§2.6–2.7), **reserved state
>    symbols section** (exhaustive list + misuse table from §2.7), deadlock,
>    `RequestingPort`.
> 3. `reference/TESTING.md` — `makeTestActor(ConnTop, ctx)` (`Config` inferred),
>    `TestPort<ConnTop>`.
> 4. Rewrite `04-protocol-typing`, `10-call-services` (rename if needed),
>    `13-async-handlers`, `14-nested-machines`, `15-complex-workflow`; sweep all
>    examples for deleted APIs.
> 5. `website/docs-src/` + typedoc categories: **Config**, **Services**,
>    **Notifications**, **Port**; remove dead entries.
> 6. `packages/ihsm/README.md` + root `README.md` — hero example uses `Config`,
>    `await actor.fetchFrames(…)`, `actor.open()`, `actor.ctx`, `actor.hsm.sync()`;
>    link to tutorial 00.
> 7. `CHANGELOG.md` `2.0.0` migration guide: split `Protocol` → `Config` fields;
>    flat machinery moved behind `this.hsm` (`this.transition(…)` →
>    `this.hsm.transition(…)`); `this.hsm.actor.<notification>()` replaces self-`post`; service
>    Config members must return `Promise<Reply>`.
>
> Cross-check: `rg -n 'resolve.*reject|ResolveCallback|\.call\(|\.post\(|port\.send' reference examples website src` returns nothing outside CHANGELOG.

**Acceptance:** docs build clean; `tsconfig.examples.json` compiles; tutorial 00 exists.

### Phase 6 — release readiness

**Prompt:**

> Bump to `2.0.0-rc.1`. Full matrix per `RELEASING.md`. Release summary:
> deleted symbols (`call`, `post`, `send`, `asOwner`, `ResolveCallback`, …);
> new symbols (`Config`, `makeActor`, `makeInternalActor`, `makeHsm`, `Actor`,
> `InternalActor`, `OwnerActor`, `ActorCore`, `HandlerHsm`, `ActorHsm`,
> `SelfNotifications`, `ServiceClient`,
> `NotificationClient`, `TestOwnerActor`, `buildProtocolIndex`,
> `ReservedNames`, `ProtocolCollisionError`,
> `RequestingPort`, `SelfCallDeadlockError`, `CallTimeoutError`, `ConfigOf`,
> `TopStateArg`, `ConfigContext`, `TransitionResolver`,
> `StaticTransitionResolver`, `TransitionTableError`,
> …).

**Acceptance:** clean matrix; `lib/**/*.d.ts` has no v1 protocol symbols except CHANGELOG pointers.

---

## 4. Out of scope / future

- **`Deferred` escape hatch** for settle-early-keep-working services — minor if needed.
- **Cross-actor cycle detection** — research; timeouts are the 2.0 answer.
- **`@ihsm/system` typed actor registry** (T9) — `OwnerActor` / `internalServices` prerequisite.
- **Codegen** to tighten `buildProtocolIndex` bucket assignment without runtime scan.
- **Transition-table generator** emitting `StaticTransitionResolver` tables
  (§2.10) — replaces the runtime transition cache with compile-time routines;
  the 2.0 deliverable is the resolver seam, the generator itself can follow.
- **Codemod** v1 → v2 — nice-to-have; `CHANGELOG.md` migration guide is the deliverable.

---

## 5. Design decisions log

| Decision | Rationale |
| -------- | --------- |
| Nominal `Config` fields over structural heuristic | Zero ambiguity; deletes `IsServiceMethod` machinery |
| `ConfigOf<T>` from `TopState` — no factory type args | Same ergonomics as v1 `MachineContext<T>`; `ConnTop` is the config point |
| **Generated handles, no `Proxy`** — methods materialized per (class, width) | Protocol is immutable after construction, so trapping buys nothing; plain objects give monomorphic call sites and full debugger/console/`Object.keys` visibility |
| Single `hsm` machinery facade; `ctx` / `hsm` only reserved words | Frees `transition`, `sleep`, `now`, … as user protocol names; generalizes v1 `this.hsm` (§2.6) |
| `actor.hsm` is a **reduced** facade (sync, introspection, trace) | Clients must not reach dispatch-context machinery (`transition`, self-handles, …) |
| Self-scheduling reuses the **actor handle** concept (`this.hsm.actor` / `immediate` / `defer(ms)`) | No outbox/inbox vocabulary — one `SelfNotifications<C>` surface, queue choice by member; avoids flat `this.open()` clash |
| No exported `Hsm` client type | `HsmObject` is implementation-only |
| `Actor` / `InternalActor` / `OwnerActor` tiers | Public vs internal notifications vs internal services |
| Auto `buildProtocolIndex` — no manual key lists | Scan state graph at construction |
| Service client methods return `Promise` only | Forces `await`; fixes XState-class RTC footgun |
| Prototype-only dispatch (`lookup.ts`) | Handler execution independent of client handle generation |
| `ReservedNames` = `ctx`, `hsm`, lifecycle hooks | Tiny fixed list, documented verbatim; adding facade members is non-breaking |
| Reserved symbol in a state class / on `Config` **fails** | Compile error where TS can see it; unconditional `ProtocolCollisionError` at construction for JS consumers (§2.7, §2.9) |
| No service methods on `this` / `this.hsm` | Static deadlock rule |
| `RequestingPort` opt-in for `internalServices` | Transitive self-service through sync port methods is the sneaky deadlock variant |
| `TransitionResolver` seam; runtime cache is the default impl | Tools can emit compile-time transition tables (`StaticTransitionResolver`) without touching dispatch or user code (§2.10) |
| ALS guard debug-only, Node only | Zero production/browser cost |
| Drop untyped string mode in 2.0 | Doubles every surface for no new users |
