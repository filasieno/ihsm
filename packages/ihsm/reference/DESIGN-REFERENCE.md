# ihsm Design Reference — Machine Embodiments

Target design (not yet applied to code). Glossary: [`GLOSSARY.md`](GLOSSARY.md).

One **`Machine`** instance. Each **embodiment** is a typed view for a usage context — not a
separate handle object, not a `Proxy`. Same runtime; different protocol roots and different
**`hsm` toolboxes**.

Pattern (every embodiment):

| Layer | Role |
| ----- | ---- |
| **Protocol root** | Flat dispatch methods this context may **call** — a **selection** of config protocol buckets (see below). |
| **`hsm`** | Toolbox for **working with** the machine in this context (sync, trace, transitions, port, …). |

### Protocol = bucket selection per embodiment

`ActorConfigOf<T>` declares four **protocol buckets** on `TopState<C>`:

| Bucket | Config key | Client shape |
| ------ | ---------- | ------------ |
| **notifications** | `notifications` | fire-and-forget on the shell |
| **services** | `services` | `await shell.*` |
| **internal notifications** | `internalNotifications` | fire-and-forget (wiring / composition) |
| **internal services** | `internalServices` | `await shell.*` (child / parent / test) |

Each **client** embodiment is **only** which buckets appear on its protocol root.
`protocolProto(T, kind)` materializes dispatch fns for that subset — nothing else at the protocol layer.

| Embodiment | Shell / surface | notifications | services | internal notifications | internal services |
| ---------- | --------------- | ------------- | -------- | ---------------------- | ----------------- |
| **Handler** | `this` in a state class | implement | implement | implement | implement |
| **Root** | `ExternalActor<T>` — `makeActor` return | ✓ | ✓ | | |
| **Inbound** | `InboundActor<T>` — `port.actor` on `Port<T>` | ✓ | ✓ | ✓ | |
| **Child** | `ChildActor<ChildT>` — `makeChildActor` / `RequestingPort.actor` | ✓ | ✓ | ✓ | ✓ |
| **Parent** | same as **Child** — `ctx.child` (`ChildActor<ChildT>`) | ✓ | ✓ | ✓ | ✓ |
| **Test** | `TestActor<T>` — `makeTestActor` (`ihsm/testing`) | ✓ | ✓ | ✓ | ✓ |

**Handler** implements all buckets via state methods — not a bucket client projection.

**Parent** is not a separate shell: parent calls use **child** bucket selection on `ChildActor<ChildT>`.
`ParentActor<T>` is only the parent-machine link for `makeChildActor`.

```typescript
type RootProtocol<T extends TopStateArg> =
	NotificationClient<ActorNotificationsOf<T>> &
	ServiceClient<ActorServicesOf<T>>;

type InboundProtocol<T extends TopStateArg> =
	RootProtocol<T> &
	NotificationClient<ActorInternalNotificationsOf<T>>;

type ChildProtocol<ChildT extends TopStateArg> =
	InboundProtocol<ChildT> &
	ServiceClient<ActorInternalServicesOf<ChildT>>;

// ExternalActor<T>   = RootProtocol<T>      & { hsm: ExternalHsm<T> } & …
// InboundActor<T>    = InboundProtocol<T>   & { hsm: InboundHsm<T> } & …
// ChildActor<ChildT> = ChildProtocol<ChildT> & { hsm: ChildHsm<ChildT> } & …
// TestActor<T>       = ChildProtocol<T>     & { hsm: TestHsm<T> } & …
```

Toolbox access (**ctx**, **port**, **transition**, …) is independent of bucket selection — see the
comparison table in §5.

### Factories (target API)

| Factory | When | Returns |
| ------- | ---- | ------- |
| **`makeActor(T, ctx, port?)`** | Spawn a **root** machine | `ExternalActor<T>` (`RootProtocol<T>`) |
| **`makeChildActor(parent, ChildT, childCtx, port?)`** | Parent composes a **child** inside a handler | `ChildActor<ChildT>` (`ChildProtocol<ChildT>`) |

Composition types: **`ParentActor<T>`** (parent link) and **`ChildActor<ChildT>`** (child handle).
There is no third factory and no `Owner*` naming in the target API.

---

## Type spine: `T` is the author's root class (e.g. `DoorTop`)

The library does **not** define a type for “the user's top state”. The author defines a concrete
class — `DoorTop`, `WalletTop`, … — that **extends** `TopState<DoorConfig>`. That class **is** `T`.

```typescript
// Author code — ihsm knows none of these names until import time
class DoorTop extends TopState<DoorConfig> { … }
class Open extends DoorTop { … }

// Inferred when you pass the class to a factory:
const door = makeActor(DoorTop, ctx, new Port<DoorTop>());
//                   ^^^^^^^  T = typeof DoorTop
// ExternalActor<typeof DoorTop>
```

| Symbol | Meaning |
| ------ | ------- |
| **`T`** | **`typeof DoorTop`** — the author's root **class**, not a library alias. Inferred from the value passed to `makeActor(DoorTop, …)` / `Port<DoorTop>`. |
| **`ActorConfigOf<T>`** | Config peeled from `T` (`DoorConfig`). **Internal** derivation. |
| **`ActorStateOf<T>`** | Any state **class** that **extends `T`** (`Open`, `Closed`, …). |

### Constraint on `T`

`T` must be a **class** that **extends** `TopState<C>` — e.g. `DoorTop`. The library expresses
that with **`TopStateArg`** (constructor for `TopState<C>` where `C` is already validated).

```typescript
// TopStateArg = abstract new () => TopState<C>;  C extends ValidatedActorConfig
class DoorTop extends TopState<DoorConfig> { … }  // typeof DoorTop extends TopStateArg

makeActor(DoorTop, ctx);  // T inferred as typeof DoorTop — no second validation
```

`ActorConfigOf<T>` already infers config from `T`:

```typescript
type ActorConfigOf<T> = T extends abstract new (...args: never[]) => TopState<infer C extends ActorConfig>
	? C
	: /* … */;
```

Every public API is **`ActorContextOf<T>`**, **`ExternalActor<T>`**, … with **`T` inferred** from
`makeActor(DoorTop, …)`. No factory re-runs config validation (see below).

### Config validation — once at `TopState<C>`

All **config** type checks happen in **one place**: when the author binds a config bag to the
machine root.

```typescript
interface DoorConfig {
	context: DoorCtx;
	services: { open(): Promise<void> };
	notifications: { closed(): void };
}

class DoorTop extends TopState<DoorConfig> { … }   // ← sole compile-time gate
class Open extends DoorTop { … }                   // inherits — no re-check
```

`TopState` requires a **validated** config:

```typescript
type ValidatedActorConfig<C extends ActorConfig> =
	DisjointActorConfig<C> extends true ? C : never;

interface TopState<C extends ValidatedActorConfig = ValidatedActorConfig> {
	readonly ctx: ActorContextOf<C>;
	readonly hsm: HandlerHsm</* T peeled at handler site */>;
}

type TopStateArg<C extends ValidatedActorConfig = ValidatedActorConfig> =
	abstract new (...args: never[]) => TopState<C>;
```

**Checked at `TopState<DoorConfig>` (once per machine):**

| Check | Failure surfaces as |
| ----- | ------------------- |
| Disjoint protocol keys across buckets | `class X extends TopState<BadConfig>` does not type-check |
| Protocol keys ∉ reserved names (`ctx`, `hsm`, …) | same |
| Structural `ActorConfig` shape | same |

**Not checked again** on `makeActor`, `makeChildActor`, `Port<T>`, embodiments, or extractors.
Those APIs **project** types from `T`; they do not re-apply `DisjointActorConfig`.

```typescript
// Today (redundant gate) — remove from factories:
makeActor(top: ValidatedTopStateArg<T>, …)

// Target — T already carries validated config via TopState:
makeActor<T extends TopStateArg>(top: T, ctx: ActorContextOf<T>, …): ExternalActor<T>
```

`ValidatedTopStateArg<T>` / `ValidatedActorTop<T>` are **dropped** — validation lives on
`TopState<C>`, not on factory parameters.

### Protocol vocabulary — from config buckets only

The full vocabulary lives on `TopState<DoorConfig>` as four buckets (table above). There is **no**
runtime graph scan, **no** `buildProtocolIndex`, and **no** protocol registry object.

| Today (remove) | Target |
| -------------- | ------ |
| `buildProtocolIndex` scans state prototypes at spawn | **Dropped** |
| `async` on handler → infer `services` bucket at runtime | Bucket from **config**, not handler shape |
| `ProtocolCollisionError` at spawn | **Compile-time** on `TopState` / state classes |
| `WeakMap` cache `indexByRoot` | **Dropped** |

**Compile-time:** `RootProtocol<T>`, `InboundProtocol<T>`, `ChildProtocol<ChildT>` (and embodiment
shell types) are the only protocol projections — each is a bucket subset for that embodiment.

**Runtime:** `protocolProto(T, kind)` — cached frozen prototype per `(T, kind)` where `kind` is
`root` \| `inbound` \| `child` \| `test`. Parent reuses the `child` proto on `ChildActor<ChildT>`.
Handler dispatch does not use a client proto.

```typescript
const shell = Object.create(protocolProto(DoorTop, 'root'));
```

**Dropped at runtime:** `buildProtocolIndex` and any helper that would register or store protocol
metadata on `Machine` at spawn.

| Check | How |
| ----- | --- |
| Disjoint keys across buckets | `ValidatedActorConfig` on `TopState<C>` |
| Reserved names as protocol keys | `DisjointActorConfig` |
| Handler on state uses reserved name (`ctx`, `hsm`, …) | State class must not declare protocol methods with reserved names (type-level / lint) |
| Handler signature matches bucket | e.g. service handlers return `Promise<…>` per `ActorServicesOf<T>` |

State classes **implement** the config vocabulary; they do not **define** it. Two states with an
`open` handler share one config key — no runtime dedup scan.

**`ProtocolCollisionError`:** removed from the spawn path — reserved-name and cross-bucket
violations are compile-time failures. (Tests that call `buildProtocolIndex` today migrate to type
fixtures or `@internal` compile-time helpers only.)

**Still compile-time (not “index build”):**

| Mechanism | Purpose |
| --------- | ------- |
| `ActorStateOf<T>` on `transition` | Nominal machine boundary |
| `RootProtocol` / `InboundProtocol` / `ChildProtocol` | Bucket selection per embodiment |

### Type extractors — all keyed on `T`

Every extractor keeps the **`Actor*` prefix** but takes the user's **`TopState` class `T`**
instead of bare `ActorConfig` (`C`). `ActorConfigOf<T>` is peeled inside the library; callers
never thread config through generics.

```typescript
// T = typeof DoorTop; config already validated on TopState<DoorConfig>

type ActorContextOf<T extends TopStateArg> = ActorConfigOf<T> extends { context: infer C } ? C : Any;
type ActorServicesOf<T extends TopStateArg> = ActorConfigOf<T> extends { services: infer S extends object } ? S : {};
type ActorNotificationsOf<T extends TopStateArg> = ActorConfigOf<T> extends { notifications: infer N extends object } ? N : {};
type ActorInternalServicesOf<T extends TopStateArg> = ActorConfigOf<T> extends { internalServices: infer S extends object } ? S : {};
type ActorInternalNotificationsOf<T extends TopStateArg> = ActorConfigOf<T> extends { internalNotifications: infer N extends object } ? N : {};
type ActorPortOf<T extends TopStateArg> = ActorConfigOf<T> extends { port: infer P } ? P : undefined;

type ActorPublicOf<T extends TopStateArg> = ActorServicesOf<T> & ActorNotificationsOf<T>;
type ActorInternalOf<T extends TopStateArg> = ActorInternalServicesOf<T> & ActorInternalNotificationsOf<T>;

type ActorStateOf<T extends TopStateArg> = abstract new (...args: never[]) => InstanceType<T>;
```

Extractors are **pure projections** of `ActorConfigOf<T>`. No `DisjointActorConfig` here.

### `ParentActor<T>` — parent link (any machine)

`ParentActor<T>` types a **parent machine** identified by the parent's root class `T`
(`typeof ParentTop`, `typeof DoorTop`, …) — **any** state machine, not a special handler alias.

```typescript
/** Typed parent-machine link. `T` = parent's root (typeof ParentTop). */
type ParentActor<T extends TopStateArg> = {
	readonly top: T;
};
```

Use on **context** fields when a machine holds a parent reference:

```typescript
interface ChildCtx {
	parent?: ParentActor<typeof ParentTop>;
	value: number;
}
```

### Optional `parent` on every actor shell

Every embodiment carries an optional back-link to its parent:

```typescript
type ActorParentField<ParentT extends TopStateArg = TopStateArg> = {
	readonly parent?: ParentActor<ParentT>;
};
```

| Embodiment | `parent` when set |
| ---------- | ------------------- |
| `ExternalActor<T>` | nested under another machine (rare) |
| `InboundActor<T>` | port wired under a parent |
| `ChildActor<ChildT>` | set by `makeChildActor(parent, …)` |
| Handler `this` | via `this.hsm` / machine link (not the same field on shell) |

`makeChildActor(parent: ParentActor<ParentT>, …)` sets **`child.parent = parent`** on the returned
`ChildActor<ChildT>`. The author still assigns the child to `ctx`:

```typescript
this.ctx.child = makeChildActor(parent, ChildTop, childCtx, port);
// child.parent === parent; ctx field typed ChildActor<typeof ChildTop>
```

Pass **`parent: ParentActor<ParentT>`** — in a parent handler, `this` is coerced via the active
machine (same `ParentT` as `typeof ParentTop`). Not limited to handler `this`; any
`ParentActor<T>` for the correct parent root `T` is valid.

| Today | Target |
| ----- | ------ |
| `ActorContextOf<C>` | `ActorContextOf<T>` |
| `ActorServicesOf<C>` | `ActorServicesOf<T>` |
| `ActorNotificationsOf<C>` | `ActorNotificationsOf<T>` |
| `ActorInternalServicesOf<C>` | `ActorInternalServicesOf<T>` |
| `ActorInternalNotificationsOf<C>` | `ActorInternalNotificationsOf<T>` |
| `ActorPortOf<C>` | `ActorPortOf<T>` |
| `MachinePublic<T>` | `ActorPublicOf<T>` |
| `MachineInternal<T>` | `ActorInternalOf<T>` |
| `MachineContext<T>` | `ActorContextOf<T>` |
| `MachinePort<T>` | `ActorPortOf<T>` |
| `StateClassOf<C>` | `ActorStateOf<T>` (extends `T`, not config-wide) |
| `ValidatedTopStateArg<T>` on factories | **removed** — `TopState<C extends ValidatedActorConfig>` is the gate |
| `Actor<C>`, `HandlerHsm<C>`, … | `ExternalActor<T>`, `HandlerHsm<T>`, … |

**What changes:** the **type parameter** (`C` → `T`), not the **`Actor*` names**.

`ActorConfig` remains the **structural shape** authors put on `TopState<DoorConfig>`. It is not a
public generic parameter on factories, embodiments, or extractors.

**Rules:**

- Public `ihsm/types` exports: `ActorServicesOf<T>`, `ActorContextOf<T>`, … — **`T` = author's class** (`typeof DoorTop`), never bare `ActorConfig`.
- `ActorConfigOf<T>` appears only as the internal peel inside extractor definitions — **no second validation**.
- `SelfNotifications<T>`, `ServiceClient<ActorServicesOf<T>>`, etc. — all derived from `T`.
- **`DisjointActorConfig` / `ValidatedActorConfig`** — author-facing at `TopState<C>` only; not on factories or embodiments.

**Why `T` not `ActorConfig` alone**

| Issue with `C` only | Fixed by anchoring on `T` |
| ------------------- | ------------------------- |
| Two machines can share the same config shape but different state graphs | `ExternalActor<typeof DoorTop>` ≠ `ExternalActor<typeof WindowTop>` |
| `Port<typeof DoorTop>` and `makeActor(DoorTop, …)` can drift | Same `T` on port, factories, embodiments |
| `transition(s)` accepts any `TopState<ActorConfigOf<T>>` constructor | `transition(s: ActorStateOf<T>)` — only classes that **extend `T`** |
| User mental model is the machine class, not a config interface | API reads `DoorTop` everywhere |

**`ActorStateOf<T>` — extends `T`, no subclass registry**

Defined above in extractors. You do **not** need to enumerate `Idle | Open | Closed` — any
constructor whose instances extend `InstanceType<T>` qualifies.

| Call | Accepted? |
| ---- | --------- |
| `this.hsm.transition(Open)` where `Open extends DoorTop` | yes — `typeof Open` extends `ActorStateOf<typeof DoorTop>` |
| `this.hsm.transition(DoorTop)` | yes — `T` itself |
| `this.hsm.transition(OtherTop)` where `OtherTop extends TopState<SameConfig>` but not `DoorTop` | no |
| `this.hsm.transition(OtherTop)` where `OtherTop` is another machine's root | no |

```typescript
transition(next: ActorStateOf<T>): void;
restore(state: ActorStateOf<T>, ctx: ActorContextOf<T>): void;
readonly currentState: ActorStateOf<T>;
readonly topState: T;   // handler hsm — always the user's root class
```

`StateClassOf<ActorConfigOf<T>>` (`abstract new () => TopState<ActorConfigOf<T>>`) is **too wide** — it
accepts any constructor for the same config, even another machine's root. Do not use it on
`transition` / `restore`.

---

## 1. Handler

**Embodiment:** inside a state handler — `this` (instance of a class extending `T`) +
`this.hsm` (`HandlerHsm<T>`).

### Protocol buckets (handler — implement, not client)

Handlers **implement** all buckets via state methods when dispatch runs. There is no service
**client** on `this` (self-call deadlocks). Self-post covers **notifications** only (public +
internal) via `hsm.actor` / `immediate` / `defer(ms)`.

| Bucket | Handler surface |
| ------ | --------------- |
| notifications | `this.*` when dispatched; self-post via `hsm.actor` / … |
| services | `this.*` when dispatched — no `await this.open()` client |
| internal notifications | same as notifications |
| internal services | `this.*` when dispatched — no client |

### Toolbox (`this.hsm`)

| Tool | Purpose |
| ---- | ------- |
| `ctx` | `ActorContextOf<T>` — same object as `this.ctx` |
| `port` | `ActorPortOf<T>` — outbound boundary |
| `transition(next)` | `next: ActorStateOf<T>` — any state class that **extends `T`** |
| `actor` / `immediate` / `defer(ms)` | Self-post notifications (`SelfNotifications<T>`) |
| `sync()` | Drain the job queue |
| `eventName` / `eventPayload` | Active dispatch |
| `currentState` / `currentStateName` | `ActorStateOf<T>` / string |
| `topState` / `topStateName` | `T` / string |
| `traceLevel` / `traceWriter` / `traceHeader` | Tracing |
| `dispatchErrorCallback` | Error routing |
| `unhandled()` | Explicit unhandled path |

Not on handler `hsm`: service clients, internal service clients.

---

## 2. Root (external)

**Embodiment:** outside caller — `makeActor(DoorTop, ctx, port?)` → `ExternalActor<T>`.

### Protocol buckets (root — `RootProtocol<T>`)

| notifications | services | internal notifications | internal services |
| ------------- | -------- | ---------------------- | ----------------- |
| ✓ `actor.*` | ✓ `await actor.*` | | |

`ExternalActor<T> = RootProtocol<T> & { hsm: ExternalHsm<T> }`. No `ctx`, `port`, or internal buckets
on the protocol root.

### Toolbox (`actor.hsm`)

| Tool | Purpose |
| ---- | ------- |
| `sync()` | Drain the job queue (tests, await completion) |
| `currentStateName` | Observe active state (name) |
| `topStateName` | Observe root state (name) — names `T` |
| `traceLevel` / `traceWriter` / `traceHeader` | Tracing |

Not on external `hsm`: `ctx`, `port`, `transition`, `restore`, `currentState` (class refs),
`dispatchErrorCallback`, internal protocol, handler-only self-post.

---

## 3. Inbound

**Embodiment:** port-bound caller — environment wiring the actor into the outside world. The port
implementation (timer, network, UI, test double) holds `port.actor` and posts **back into** the
machine.

**Obtained by:** `port.actor` on `Port<T>` — set **synchronously** when `makeActor(T, ctx, port)` returns,
always defined before the factory resolves. There is **no** separate inbound factory; supervisors and
tests use the same path (`makeActor(…, port)` then `port.actor`).

`T` is always the **same** root class passed to `makeActor` (`typeof ChildTop` in examples below).

### Protocol buckets (inbound — `InboundProtocol<T>`)

| notifications | services | internal notifications | internal services |
| ------------- | -------- | ---------------------- | ----------------- |
| ✓ `actor.*` | ✓ `await actor.*` | ✓ `actor.*` | |

`InboundActor<T> = InboundProtocol<T> & { hsm: InboundHsm<T> }`. Inbound may fire internal
notifications (e.g. `onReady`, `onClosed`) and call public services. Internal **services** are
excluded — parent/child bucket selection only.

Typical flow: port method returns `ResultWithSubscription`; the port keeps `port.actor` and calls
`port.actor.onClosed(...)` when the source closes.

```typescript
class ChildTop extends TopState<ChildConfig> { … }
const port = new Port<ChildTop>();
const child = makeActor(ChildTop, { value: 0 }, port);
await child.hsm.sync();

port.actor.onReady();           // internal notification — OK (no `!`)
await port.actor.ping();        // public service — OK
// port.actor.initialize(1)    // internal service — type error on InboundActor
```

### `port.actor` is mandatory

`Port<T>.actor` is **required**, not `| undefined`. Factories assign it **before return** inside
`spawnActor` (today's lazy bind becomes a synchronous contract).

```typescript
declare class Port<T extends TopStateArg> {
	readonly actor: InboundActor<T>;   // definite assignment — library sets before factory returns
}

declare class RequestingPort<T extends TopStateArg> extends Port<T> {
	readonly actor: ChildActor<T>;
}
```

**Author rule:** only use `port.actor` in port methods / callbacks **after** the factory that passed
`port` has returned (or inside those callbacks, which run later). Do not read `port.actor` from a
bare `new Port()` before `makeActor(…, port)` — that is a usage error; TypeScript may use definite
assignment on the field so callers never need `!`.

`MachinePortInput` (argument to factories) may still accept `BasePort` subclasses before bind; the
**bound** `Port<T>` surface exposed to port implementations always has `actor`.

### Toolbox (`inbound.hsm`)

| Tool | Purpose |
| ---- | ------- |
| `sync()` | Drain the job queue (port callback + test alignment) |
| `currentState` / `currentStateName` | Observe active state (`ActorStateOf<T>` / string) — supervisors, tests |
| `topState` / `topStateName` | Observe root (`T` / string) |
| `traceLevel` / `traceWriter` / `traceHeader` | Tracing |

Not on inbound `hsm`: `ctx`, `port`, `transition`, `restore`, `dispatchErrorCallback`,
handler-only self-post, internal **service** clients.

**Why `currentState` here but not on external:** inbound callers are wiring partners (ports,
supervisors, `TestPort`), not black-box API consumers. They need class refs for assertions and
restore-style test helpers without widening to the child embodiment.

### Maps from today

| Today | Target |
| ----- | ------ |
| `HandleWidth: 'internal'` | embodiment kind `inbound` |
| `InternalActor<C>` | `InboundActor<T>` |
| `InternalActorHsm<C>` / `TestActorHsm<C>` (minus child-only fields) | `InboundHsm<T>` |
| `makeInternalActor(…)` | **Dropped** — use `makeActor(…, port)` + `port.actor` |
| `port.actor` after `makeActor(…, new Port())` | `InboundActor<T>` |

---

## 4. Child (composition)

**Embodiment:** compositional child — a `ChildActor<ChildT>` handle obtained from a **`ParentActor`**
(parent handler) or from `RequestingPort` when internal services are needed.

Two types, two roles:

| Type | Parameter | Role |
| ---- | --------- | ---- |
| **`ParentActor<T>`** | **any** parent root `T` (`typeof ParentTop`, …) | Parent-machine link; `makeChildActor` first arg; optional `parent` on actors / `ctx` |
| **`ChildActor<ChildT>`** | child's `typeof ChildTop` | **Return** of `makeChildActor` — protocol shell on the child |

```typescript
type ParentActor<T extends TopStateArg> = {
	readonly top: T;
};
```

**Obtained by:**

| Path | When |
| ---- | ---- |
| `makeChildActor(parent, ChildT, …)` | `parent: ParentActor<ParentT>`; returns **`ChildActor<ChildT>`** with `parent` set; author assigns to `ctx`. |
| `port.actor` on `RequestingPort<ChildT>` | Same protocol as `ChildActor` (internal services). |

### `makeChildActor(parent, …)` — `ParentActor` first

Child composition is **not** a second top-level factory call. The parent is created with
`makeActor(ParentTop, ctx, port)`; the child is created **from inside** a parent handler:

```typescript
interface ParentCtx {
	child?: ChildActor<typeof ChildTop>;
	sum: number;
}

interface ChildCtx {
	parent?: ParentActor<typeof ParentTop>;
	value: number;
}

const parent = makeActor(ParentTop, { sum: 0 }, parentPort);
await parent.hsm.sync();

@InitialState
class ParentIdle extends ParentTop {
	async onEntry() {
		const parentRef = asParentActor(this);
		this.ctx.child = makeChildActor(
			parentRef,
			ChildTop,
			{ value: 0, parent: parentRef },
			new Port<ChildTop>(),
		);
		await this.ctx.child.hsm.sync();
	}

	async boot(seed: number): Promise<number> {
		const doubled = await this.ctx.child!.initialize(seed);
		this.ctx.sum = doubled;
		return doubled;
	}
}
```

**Signature (target):**

```typescript
type HandlerInstanceOf<T extends TopStateArg> = InstanceType<T>;

declare function asParentActor<ParentT extends TopStateArg>(
	parent: HandlerInstanceOf<ParentT>,
): ParentActor<ParentT>;

declare function makeChildActor<
	ParentT extends TopStateArg,
	ChildT extends TopStateArg,
>(
	parent: ParentActor<ParentT>,
	childTop: ChildT,
	childCtx: ActorContextOf<ChildT>,
	port?: MachinePortInput<ActorConfigOf<ChildT>>,
	options?: ActorOptions<ActorConfigOf<ChildT>>,
): ChildActor<ChildT> & { readonly parent: ParentActor<ParentT> };
```

**What the factory does (runtime):**

1. Resolve the parent `Machine<ParentT>` from `parent: ParentActor<ParentT>`.
2. Spawn the child `Machine<ChildT>` with embodiment kind `child` (`ChildActor` shell).
3. Bind `port` when given (`port.actor` mandatory before return).
4. Set **`child.parent = parent`** on the returned shell.
5. **Return** `ChildActor<ChildT>` — **does not** write parent `ctx`. The author assigns:

```typescript
this.ctx.child = makeChildActor(parent, ChildTop, childCtx, port);
// child.parent === parent; ctx.child typed ChildActor<typeof ChildTop>
```

**Call site rules:**

- First argument: **`ParentActor<ParentT>`** for the parent's root (`typeof ParentTop`).
- In a parent handler: `asParentActor(this)` (or equivalent) before `makeChildActor`.
- Return value: **`ChildActor<ChildT>`** with **`parent`** set — assign to `ctx` before use.

### Protocol buckets (child — `ChildProtocol<ChildT>`)

| notifications | services | internal notifications | internal services |
| ------------- | -------- | ---------------------- | ----------------- |
| ✓ `child.*` | ✓ `await child.*` | ✓ `child.*` | ✓ `await child.*` |

`ChildActor<ChildT> = ChildProtocol<ChildT> & { hsm: ChildHsm<ChildT> }` — all four buckets on the
child machine.

### Protocol buckets (parent — same as child)

The **parent** does not get a different protocol projection. Parent calls use the **child** bucket
selection on `ctx.child: ChildActor<ChildT>` (or `RequestingPort.actor` on the child machine).

```typescript
// In ParentTop handler, after this.ctx.child = makeChildActor(parentRef, …):
const doubled = await this.ctx.child.initialize(seed);
```

**`RequestingPort`:** `port.actor` is **`ChildActor<T>`** instead of `InboundActor<T>` — same
protocol as `makeChildActor` return.

```typescript
class ChildRequestPort extends RequestingPort<ChildTop> {}
const port = new ChildRequestPort();
makeActor(ChildTop, { value: 0 }, port);
await port.actor.initialize(4);   // internal service — ChildActor only
```

### Toolbox (`child.hsm` — `ChildHsm<ChildT>`)

| Tool | Purpose |
| ---- | ------- |
| `sync()` | Drain child queue after parent-driven calls |
| `currentState` / `currentStateName` | `ActorStateOf<ChildT>` / string |
| `topState` / `topStateName` | `ChildT` / string |
| `restore(state, ctx)` | Test / supervisor restore (`ActorStateOf<ChildT>`, `ActorContextOf<ChildT>`) |
| `dispatchErrorCallback` | Get/set error routing for child actor (tests) |
| `traceLevel` / `traceWriter` / `traceHeader` | Tracing |

Not on child `hsm`: `ctx`, `port`, `transition`, handler-only self-post.

Parent drives the child through **protocol** on `ChildActor`, not via `child.hsm.transition`.

### Legacy → Parent/Child (implementation migration)

| Legacy (remove) | Target |
| --------------- | ------ |
| `HandleWidth: 'owner'` | embodiment kind `child` |
| child handle type with internal services on root | `ChildActor<ChildT>` |
| child `hsm` toolbox | `ChildHsm<ChildT>` |
| parent handler `this` as spawn context | `asParentActor(this)` → `ParentActor<ParentT>` |
| second root factory + manual `ctx.child` wiring | `this.ctx.child = makeChildActor(asParentActor(this), …)` |
| `port.actor` on `RequestingPort` | `ChildActor<T>` |
| child field in parent context | `ChildActor<typeof ChildTop>` |

---

## 5. Test (`ihsm/testing`)

**Embodiment:** deterministic white-box testing — `makeTestActor(T, ctx, port?)` → `TestActor<T>`.

### Protocol buckets (test — `ChildProtocol<T>`)

Same four-bucket selection as **child** / **parent** — full internal surface for driving the
machine in tests.

| notifications | services | internal notifications | internal services |
| ------------- | -------- | ---------------------- | ----------------- |
| ✓ | ✓ | ✓ | ✓ |

`TestActor<T> = ChildProtocol<T> & { hsm: TestHsm<T> }`. Production bundles do not export
`makeTestActor`; tests import from `ihsm/testing` only.

### Toolbox (`test.hsm` — `TestHsm<T>`)

Extends **child** toolbox where useful (`sync`, `currentState`, `restore`, …) plus test-only
instrumentation (`port` access, subscription helpers, virtual clock on `TestPort`, …). Protocol
bucket selection is unchanged — only `hsm` widens.

```typescript
import { makeTestActor, TestPort } from 'ihsm/testing';

const port = new TestPort<DoorTop>();
const sm = makeTestActor(DoorTop, ctx, port);
await sm.hsm.sync();
await sm.open();                    // RootProtocol buckets on test shell = all four
port.send('onClosed');              // drive internal notifications
```

`protocolProto(T, 'test')` uses the same bucket set as `child`; `TestHsm<T>` is a separate cached
toolbox on the same `Machine<T>`.

---

## Embodiment comparison (buckets + toolbox)

| | Handler | Root | Inbound | Child | Parent | Test |
| --- | --- | --- | --- | --- | --- | --- |
| **Protocol: notifications** | implement + self-post | ✓ | ✓ | ✓ | ✓ (`ctx.child`) | ✓ |
| **Protocol: services** | implement | ✓ | ✓ | ✓ | ✓ | ✓ |
| **Protocol: internal notifications** | implement + self-post | | ✓ | ✓ | ✓ | ✓ |
| **Protocol: internal services** | implement | | | ✓ | ✓ | ✓ |
| **Toolbox: ctx** | `this.ctx` | — | — | — | — | — |
| **Toolbox: port** | `hsm.port` | — | — | — | — | test `hsm.port` |
| **`hsm.transition`** | yes | — | — | — | — | — |
| **`hsm.restore`** | — | — | — | yes | yes (`ctx.child.hsm`) | yes |
| **`hsm.currentState` (class)** | yes | — | yes | yes | yes | yes |
| **`hsm.dispatchErrorCallback`** | yes | — | — | yes | yes | yes |

---

## Current code gap

| Area | Today | Target |
| ---- | ----- | ------ |
| Type parameter | `Actor<C>`, `HandlerHsm<C>`, `ActorServicesOf<C>` | `ExternalActor<T>`, `HandlerHsm<T>`, `ActorServicesOf<T>`, … |
| External root | `actor.ctx` exposed | no `ctx` on external |
| External tools | partly on root | all on `actor.hsm` (`ExternalHsm<T>`) |
| Inbound | `InternalActor<C>`, `ctx` on root | `InboundActor<T>`, no `ctx` on root |
| Child | legacy child handle, `ctx` on root | `ChildActor<ChildT>` |
| Parent link | implicit (separate spawn) | `ParentActor<ParentT>`; `child.parent` from `makeChildActor` |
| Parent/child composition | two root spawns + manual ctx wiring | `makeActor(ParentTop, …)` + `makeChildActor(asParentActor(this), …)` |
| `transition` | `StateClassOf<C>` — any `TopState<C>` ctor | `ActorStateOf<T>` — ctor extending **`T`** only |
| Width leak | `HandleWidth` in runtime | kind `handler` \| `root` \| `inbound` \| `child` \| `test` |

---

## Type system proposal

Goal: one `Machine<T>`, embodiment views keyed by bucket selection + toolbox, three constraints:

| # | Requirement | What it rules out |
| - | ----------- | ----------------- |
| 1 | **Performance** | `Proxy`, per-call dynamic dispatch, multiple wrapper objects per embodiment, wide prototypes shared across unrelated machines, **runtime state-graph scan (`buildProtocolIndex`)** |
| 2 | **Clarity** | Generic `Actor<C>` that mixes embodiments, `ctx` on external completion, machinery on protocol root, `as unknown as` erasure at factory boundaries, **redundant `ValidatedTopStateArg` on every factory** |
| 3 | **Consistency** | Ad-hoc surfaces per factory, `HandleWidth` leaking to users, tools split unpredictably between root and `hsm`; config-only generics decoupled from user's `TopState` |

### Core idea: embodiment = `Protocol` + `Hsm`, keyed by `T`

Every embodiment is **exactly two typed namespaces** on the same `Machine<T>`:

```text
Embodiment<E, T> = E.Protocol<T>   // flat dispatch methods this caller may invoke
                 & { hsm: E.Hsm<T> }   // toolbox for this caller
```

`ActorConfigOf<T>` is used **inside** `E.Protocol` and `E.Hsm` to resolve `ActorServicesOf<T>`,
`ActorNotificationsOf<T>`, `ActorContextOf<T>`, `ActorPortOf<T>` — but **exported** types and
factories always show `T`.

Handler is the special case: protocol lives on **`this`** (`StateInstanceOf<T>`), not on a factory
return value; toolbox is **`this.hsm: HandlerHsm<T>`**.

### Embodiment kinds (`protocolProto` cache key)

| Kind | Protocol (bucket selection) | Shell | Obtained by |
| ---- | --------------------------- | ----- | ----------- |
| `handler` | implement all buckets | `this` | inside state handler |
| `root` | `RootProtocol<T>` | `ExternalActor<T>` | `makeActor(T, …)` |
| `inbound` | `InboundProtocol<T>` | `InboundActor<T>` | `port.actor` on `Port<T>` |
| `child` | `ChildProtocol<ChildT>` | `ChildActor<ChildT>` | `makeChildActor`, `RequestingPort.actor` |
| `test` | `ChildProtocol<T>` | `TestActor<T>` | `makeTestActor` (`ihsm/testing`) |

**Parent** uses the `child` proto on `ChildActor<ChildT>` — not a separate cache key.

`HandleWidth` maps to these kinds internally. Users pass **`T`** and a factory — never a width.

### Type names (compile-time clarity)

```typescript
// ihsm/types — illustrative; T is typeof DoorTop (inferred from the class you pass in)
// Config validated when author declared class DoorTop extends TopState<DoorConfig>

type ActorParentField<ParentT extends TopStateArg = TopStateArg> = {
	readonly parent?: ParentActor<ParentT>;
};

type ExternalActor<T extends TopStateArg> =
	RootProtocol<T> & ActorParentField & {
		readonly hsm: ExternalHsm<T>;
	};

type ExternalHsm<T extends TopStateArg> = {
	sync(): Promise<void>;
	readonly currentStateName: string;
	readonly topStateName: string;
	traceLevel: TraceLevel;
	traceWriter: TraceWriter;
	readonly traceHeader: string;
};

type HandlerHsm<T extends TopStateArg> = {
	readonly ctx: ActorContextOf<T>;
	readonly port: ActorPortOf<T>;
	transition(next: ActorStateOf<T>): void;
	readonly actor: SelfNotifications<T>;
	readonly immediate: SelfNotifications<T>;
	defer(ms: number): SelfNotifications<T>;
	sync(): Promise<void>;
	readonly currentState: ActorStateOf<T>;
	readonly topState: T;
	// … event/trace tools (see §1)
};

type InboundActor<T extends TopStateArg> =
	InboundProtocol<T> &
	ActorParentField & {
		readonly hsm: InboundHsm<T>;
	};

type InboundHsm<T extends TopStateArg> = {
	sync(): Promise<void>;
	readonly currentState: ActorStateOf<T>;
	readonly currentStateName: string;
	readonly topState: T;
	readonly topStateName: string;
	traceLevel: TraceLevel;
	traceWriter: TraceWriter;
	readonly traceHeader: string;
};

type ChildActor<ChildT extends TopStateArg> =
	ChildProtocol<ChildT> &
	ActorParentField & {
		readonly hsm: ChildHsm<ChildT>;
	};

type TestActor<T extends TopStateArg> =
	ChildProtocol<T> & {
		readonly hsm: TestHsm<T>;
	};

type ChildHsm<ChildT extends TopStateArg> = InboundHsm<ChildT> & {
	restore(state: ActorStateOf<ChildT>, ctx: ActorContextOf<ChildT>): void;
	dispatchErrorCallback: DispatchErrorCallback<ActorConfigOf<ChildT>>;
};

type ParentActor<T extends TopStateArg> = {
	readonly top: T;
};

declare function asParentActor<ParentT extends TopStateArg>(
	parent: HandlerInstanceOf<ParentT>,
): ParentActor<ParentT>;

declare function makeChildActor<
	ParentT extends TopStateArg,
	ChildT extends TopStateArg,
>(
	parent: ParentActor<ParentT>,
	childTop: ChildT,
	childCtx: ActorContextOf<ChildT>,
	port?: MachinePortInput<ActorConfigOf<ChildT>>,
	options?: ActorOptions<ActorConfigOf<ChildT>>,
): ChildActor<ChildT> & { readonly parent: ParentActor<ParentT> };

declare class Port<T extends TopStateArg> {
	readonly actor: InboundActor<T>;
}

declare class RequestingPort<T extends TopStateArg> extends Port<T> {
	readonly actor: ChildActor<T>;
}
```

**Rules:**

- **`T`** is the only type parameter on factories, ports, embodiments, and extractors users see.
- Authors declare `interface DoorConfig { … }` and `class DoorTop extends TopState<DoorConfig>`;
  invalid config fails **on the class**, not on `makeActor`.
- Factory signatures: `makeActor(top: T, …)` where `T extends TopStateArg` — **no** `ValidatedActorTop<T>`.
- `InboundActor<T>` / `ChildActor<ChildT>` have **no `ctx`** on root or `hsm`.
- `HandlerHsm<T>` is the only client-facing toolbox with `ctx` and `port`.
- `transition` / `restore` / `currentState` use **`ActorStateOf<T>`** (or `ChildT` on `ChildActor`).
- `makeActor(top, …)` → `ExternalActor<T>`; binds `port.actor` as `InboundActor<T>` (or `ChildActor<T>` on `RequestingPort`).
- `makeChildActor(parent: ParentActor<ParentT>, childTop, …)` → `ChildActor<ChildT>`; author assigns to `ctx`.
- `port.actor` on plain `Port<T>` → `InboundActor<T>`; on `RequestingPort<T>` → `ChildActor<T>`.

Completion example:

```typescript
class DoorTop extends TopState<DoorConfig> { … }
const a = makeActor(DoorTop, ctx, new Port<DoorTop>());
//            ^ ExternalActor<typeof DoorTop>
// a.open()   — RootProtocol<T> (notifications + services)
// a.hsm.sync()
// a.ctx      — compile error
// a.hsm.transition — compile error
```

Inside `DoorIdle extends DoorTop`:

```typescript
this.hsm.transition(Open);   // OK when Open extends DoorTop
this.hsm.transition(OtherTop); // error when OtherTop does not extend DoorTop
```

Inbound + parent (composition):

```typescript
const parent = makeActor(ParentTop, { sum: 0 }, new Port());
await parent.hsm.sync();
// ParentIdle.onEntry: this.ctx.child = makeChildActor(asParentActor(this), ChildTop, …)
await parent.boot(3);   // handler uses this.ctx.child.initialize internally
```

### Runtime shape (performance)

```text
Machine<T>                       // one instance per actor; holds ActorContextOf<T>
  ├─ handlerHsm: HandlerHsm<T>
  ├─ externalHsm: ExternalHsm<T>   // root toolbox
  ├─ inboundHsm: InboundHsm<T>
  ├─ childHsm: ChildHsm<T>
  └─ testHsm: TestHsm<T>            // ihsm/testing only

protocolProto(T, kind)           // kind: root | inbound | child | test; parent reuses child
```

Proto cache key is the user's **root constructor `T`**, not a bare config object (two machines with
identical config shapes get distinct protos).

**One outward shell per factory call** (external or child):

```typescript
const shell = Object.create(protocolProto(DoorTop, 'root'));
shell.hsm = machine.externalHsm();
linkMachine(shell, machine);
return shell as ExternalActor<typeof DoorTop>;
```

### Consistency rules (normative)

1. **Protocol root** = bucket selection only (`RootProtocol` / `InboundProtocol` / `ChildProtocol`).
   No `sync`, no `ctx` (except handler `this.ctx`), no `port`, no `transition` on the shell.
2. **`hsm`** = all non-dispatch tools for that embodiment. `sync` **always** on `hsm`.
3. **Self-post** = notifications only, under `hsm.actor` / `immediate` / `defer` (handler only).
4. **Services** = client surface only where the matrix allows; never on handler client (deadlock).
5. **Internal services** = child embodiment only (`ChildActor<ChildT>`, `RequestingPort.actor`).
6. **Internal notifications** = handler (dispatch) + inbound + child (post from port / child shell).
7. **Same six columns** for every embodiment in this doc.
8. **Same `T`** on `TopState`, `Port<T>`, factories, and embodiment types for one machine;
   **`ChildActor<ChildT>`** uses the child's root class; **`ParentActor<T>`** types any parent machine
   (`T` = parent's root); optional **`parent`** on every actor shell.

### Factory → embodiment mapping

| API | `T` / child | Return type |
| --- | ----------- | ----------- |
| `makeActor(top, ctx, port?)` | `top: T` | `ExternalActor<T>`; binds `port.actor` as `InboundActor<T>` (or `ChildActor<T>` on `RequestingPort`) |
| `makeChildActor(parent: ParentActor<ParentT>, childTop, childCtx, port?)` | `ParentT` + `ChildT` | `ChildActor<ChildT>` (author assigns to `ctx`) |
| `port.actor` on `Port<T>` | same `T` | `InboundActor<T>` (`InboundProtocol<T>`) |
| `port.actor` on `RequestingPort<T>` | same `T` | `ChildActor<T>` (`ChildProtocol<T>`) |
| state handler | `this` extends `InstanceType<T>` | `this.hsm: HandlerHsm<T>` |
| `makeTestActor(top, ctx, port?)` (`ihsm/testing`) | `top: T` | `TestActor<T>` (`ChildProtocol<T>`) |

### Migration from current code

| Today | Target |
| ----- | ------ |
| `Actor<C>`, `makeActor(…): Actor<C>` | `ExternalActor<T>`, `makeActor(top, …): ExternalActor<T>` |
| `ActorContextOf<C>`, `ActorServicesOf<C>`, … | same **`Actor*` names**, parameter **`T`** not `C` |
| `MachinePublic<T>` / `MachineInternal<T>` | `ActorPublicOf<T>` / `ActorInternalOf<T>` |
| `StateClassOf<C>` on `transition` | `ActorStateOf<T>` |
| `ValidatedTopStateArg<T>` on `makeActor` / `makeChildActor` | **removed** — `TopState<C extends ValidatedActorConfig>` |
| Root spawn | legacy root factory | `makeActor` → `ExternalActor<T>` |
| Child spawn | legacy child factory + manual ctx | `makeChildActor(parent, …)` → `ChildActor<ChildT>` |
| Child handle in parent ctx | legacy child handle type | `ChildActor<ChildT>` |
| `InternalActor<C>`, `makeInternalActor` | **Dropped** — `InboundActor<T>` via `port.actor` after `makeActor` |
| `createActorHandle(…, HandleWidth)` | `createEmbodimentShell(machine, kind)` keyed by `T` |
| `buildProtocolIndex` + spawn-time scan | **Dropped** — vocabulary from `ActorConfigOf<T>` + `protocolProto(T, kind)` |
| `ProtocolCollisionError` at spawn | compile-time / type errors on `TopState` + state classes |
| `ActorConfig` as public generic on APIs | `ActorConfig` structural only; **`T` everywhere** |

### Acceptance (design is “done” when)

- [ ] Invalid `DoorConfig` (overlapping buckets) errors on `class DoorTop extends TopState<DoorConfig>`, not on `makeActor`.
- [ ] `makeActor(DoorTop, …)` takes `top: T extends TopStateArg` with no `ValidatedTopStateArg` wrapper.
- [ ] `makeActor(DoorTop, …)` returns `ExternalActor<typeof DoorTop>`; `a.ctx` is a type error.
- [ ] `a.hsm` is `ExternalHsm<typeof DoorTop>` only.
- [ ] `this.hsm` is `HandlerHsm<T>` only (includes `transition`, `port`, …).
- [ ] `this.hsm.transition(Open)` type-checks only when `Open extends T`; no subclass registry required.
- [ ] `Port<DoorTop>` and `makeActor(DoorTop, …)` share the same `T`.
- [ ] Two machines with identical config but different `T` get distinct embodiment types.
- [ ] No `Proxy`; protocol protos keyed by `(T, kind)`; one `Machine` per actor.
- [ ] `makeActor(DoorTop, …)` infers `T` as `typeof DoorTop` — no library type named `UserTop`; author's class **is** `T`.
- [ ] `port.actor` on `Port<T>` is `InboundActor<T>`; internal notifications callable, internal services not.
- [ ] `port.actor` on `RequestingPort<T>` is `ChildActor<T>`; internal services callable.
- [ ] `Port<T>.actor` is required (`InboundActor<T>`); no `| undefined`, no `!` at call sites after factory bind.
- [ ] `makeChildActor(parent: ParentActor<ParentT>, …)` sets `child.parent`; does not mutate parent `ctx`.
- [ ] Author assigns: `this.ctx.child = makeChildActor(asParentActor(this), …)`.
- [ ] `TestActor<T>` = `ChildProtocol<T>` + `TestHsm<T>`; `makeTestActor` only in `ihsm/testing`.
- [ ] `protocolProto(T, kind)` keys: `root` \| `inbound` \| `child` \| `test`; parent uses `child`.
- [ ] Every actor shell (`ExternalActor`, `InboundActor`, `ChildActor`) has optional `parent?: ParentActor<…>`.
- [ ] `makeChildActor(parent: ParentActor<ParentT>, …)` sets `child.parent`; author assigns `ctx.child`.
- [ ] Context / config fields use `parent?: ParentActor<T>` for the **parent's** root `T`.
- [ ] `makeInternalActor` removed — inbound only via `port.actor` after `makeActor(…, port)`.
- [ ] No `OwnerActor`, `makeOwnerActor`, or `makeHsm` in public API — use `ParentActor` / `ChildActor` + `makeChildActor`.
- [ ] `ProtocolCollisionError` not thrown from factories (collisions are compile-time).

This keeps performance (plain objects, cached protos per `T`), clarity (`T` matches the user's
class, exact completion per embodiment), and consistency (`T` spine + protocol + `hsm` everywhere).

---

## Ergonomics evaluation

Subjective score against typical HSM author + port implementor workflows (target design as written).

### What reads well (8–9/10)

| Area | Why |
| ---- | --- |
| **`T` = `typeof DoorTop`** | One class name everywhere; no config generic on factories. Matches how authors think. |
| **Validate once on `TopState<DoorConfig>`** | Errors at the class definition, not scattered across APIs. |
| **Protocol from bucket selection** | `RootProtocol` / `InboundProtocol` / `ChildProtocol` per embodiment; `protocolProto(T, kind)`. |
| **`ParentActor<T>`** | Parent link for **any** machine root `T`; context fields + `makeChildActor` arg. |
| **Optional `parent` on actors** | Every shell exposes `parent?: ParentActor<…>`; child gets it from `makeChildActor`. |
| **Mandatory `port.actor`** | Port callbacks use `port.actor.onReady()` with no `!`; factory bind is synchronous before return. |
| **Protocol vs `hsm`** | Same pattern in every embodiment; matrix is scannable. |
| **`ActorStateOf<T>`** | No state registry; `transition(Open)` when `Open extends DoorTop` is natural. |

### Friction (6–7/10) — worth watching

| Area | Issue | Mitigation |
| ---- | ----- | ---------- |
| **`makeChildActor` only in handlers** | Cannot spawn child at module scope. | By design — composition tied to parent lifecycle (`onEntry`, …). |
| **Embodiment cardinality** | Handler + root + inbound + child/parent + test. | Bucket selection table; one example per kind. |
| **Pre-bind `new Port()`** | `actor` unset until factory returns. | Never read `port.actor` before `makeActor(…, port)` completes. |
| **Root observability** | State names only on root `hsm`. | Tests use `makeTestActor` or handler / `ctx.child.hsm`. |

### Suggested mental model

```text
1. class DoorTop extends TopState<DoorConfig>   — config validated here
2. makeActor(ParentTop, ctx, port)              — root / external API
3. this.ctx.child = makeChildActor(asParentActor(this), ChildTop, childCtx)   — sets child.parent
4. In handlers: this.hsm.transition(Open)
5. In port callbacks: port.actor.onClosed()
```

### Overall: **8 / 10**

Strong for typed machines with ports and parent/child. `ParentActor<T>` + optional `parent` on
every shell make the tree explicit.

**Factories:** `makeActor` + `makeChildActor(asParentActor(this), …)` only — no `makeInternalActor`, no `Owner*` APIs.
