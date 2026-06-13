# ihsm Embodiments & Faceted Actor API

> Authoritative design for the actor surface. The runtime and the type lattice
> in `internal/types.ts` / `internal/runtime.ts` must conform to this document.
> When tests reveal a needed change, update this doc first, then the code.

## 1. Why facets

An ihsm actor is not a plain object: every protocol call is a **queued,
run-to-completion message**, not a synchronous method invocation. The previous
"flat" surface (`actor.doThing()`) hid that fact — a fire-and-forget
notification and a request/response service looked identical at the call site,
and the only signal was whether the return type happened to be a `Promise`.

The faceted surface puts the **interaction mode** back into the API while
keeping the typed, autocompletable protocol names:

| Facet | Delivery | Queue | Returns | Caller intent |
|-------|----------|-------|---------|---------------|
| `actor.notify.x(..)` | fire-and-forget notification | default (FIFO) | `void` | "deliver this, don't wait" |
| `actor.notifyNow.x(..)` | fire-and-forget notification | priority (jumps ahead) | `void` | "deliver this before queued work" |
| `actor.call.y(..)` | request / response service | default (FIFO) | `Promise<R>` | "ask and await the reply" |
| `actor.hsm.*` | control / introspection plane | — | — | lifecycle, tracing, state |

Delivery mode is **chosen by the facet at the call site**, not inferred from the
handler's shape. The handler is just a method; whether the message is queued
fire-and-forget, jumps the queue, or is awaited is the caller's declaration.

Rules that fall out of this model:

- **`call` is never visible inside a handler.** A handler awaiting a service on
  its own machine deadlocks (the machine is busy running that handler). Omitting
  `call` from the handler embodiment makes the deadlock *unwriteable* — a
  compile-time guarantee that supersedes the runtime `SelfCallDeadlockError`.
- **`hsm.transition` is only visible inside a handler.** External callers must
  not force state changes; transitions are the machine's response to messages.
- **Internal protocol is hidden by embodiment.** `internalServices` /
  `internalNotifications` appear only on inbound/child/test embodiments, never
  on the external (`makeActor`) surface.

## 2. Facet contents

Each facet is an object whose keys are protocol members, projected from the
`ActorConfig` buckets and filtered by embodiment:

- `notify` / `notifyNow` ⊆ `notifications` ∪ `internalNotifications`
- `call` ⊆ `services` ∪ `internalServices`

A given protocol name lives in exactly one bucket (`DisjointActorConfig`
enforces this), so a name appears under exactly one facet.

## 3. Embodiments

An **embodiment** is a typed view over the same underlying machine. The runtime
exposes one shared set of facet objects; embodiments differ **only at the type
level** (which keys / members are visible). This is the same type-gating already
used across the `*Hsm` lattice.

| Embodiment | Origin | `notify` / `notifyNow` | `call` | `hsm` adds |
|------------|--------|------------------------|--------|------------|
| **external** | `makeActor(...)` | public notifications | public services | `sync`, `currentStateName`, `topStateName`, trace |
| **handler** | `this` inside a state | public **+ internal** notifications (self) | **absent** | `ctx`, `transition`, `unhandled`, `port`, `currentState`, `topState` |
| **inbound** | `port.actor` (plain `Port`) | public + internal notifications | public services | `currentState`, `topState` |
| **child** | `makeChildActor(...)` / `RequestingPort` | public + internal notifications | public **+ internal** services | `restore`, `dispatchErrorCallback`, `parent` link |
| **test** | `makeTestActor(...)` | public + internal notifications | public + internal services | `port`, `subscribe`, `ctx`, verbose trace default |

Notes:

- **external** is the production black box: only the public protocol, no
  internal members, no `transition`, no `restore`.
- **handler** is self-directed: `this.notify.x()` / `this.notifyNow.x()` post to
  *this* machine. There is no `this.call` — cross-actor calls go through a
  *different* actor handle (a child/parent), which is a different embodiment and
  therefore safe.
- **inbound** is the actor as driven through its own `Port` (no internal
  services callable — only inbound notifications and public services).
- **child** adds internal services to `call` and a `parent` back-reference.
- **test** is the widest surface for deterministic simulation testing.

### Parent

A child holds a `parent` link (`ParentActor`: `{ top, <internal machine link> }`).
Messaging the parent uses the parent's own actor handle (an inbound/child
embodiment of the parent's `ActorConfig`), so the same facet rules apply upward.

## 4. Type lattice mapping

Facets are defined once and composed onto the base nodes; embodiments are
intersections/projections (no new synonyms):

```
NotifyFacet<N>  = { [K in keyof N]: (...args) => void }
CallFacet<S>    = { [K in keyof S]: (...args, opts?) => Promise<R> }

ActorHsm        — base control plane (sync, names, trace)
  TestActorHsm  = ActorHsm & { currentState, topState }
  OwnerActorHsm = TestActorHsm & { restore, dispatchErrorCallback }
HandlerHsm      — handler control plane (+ ctx, transition, unhandled, port)

ExternalActor = parent? & { notify, notifyNow, call(public), hsm: ActorHsm }
InboundActor  = parent? & { notify(+internal), notifyNow(+internal), call(public), hsm: TestActorHsm }
ChildActor    = InboundActor & { call(+internal), hsm: OwnerActorHsm }
TestActor     = ChildActor & { hsm: + port + subscribe, ctx }
```

The runtime builds the full facet objects once (cached frozen protos keyed by
top state); each embodiment is the same object narrowed by its actor type.
Because narrowing is type-only, the negative type-tests in
`src/spec/embodiments.spec.ts` are load-bearing: they prove `call` is absent on
the handler, internal members are absent on external, and `transition` is
handler-only.

## 5. Migration

The pre-facet flat methods (`actor.doThing()` directly on the handle) and the
handler aliases `this.actor` / `this.immediate` are retained as `@deprecated`
compatibility shims so existing call sites keep working, and are slated for
removal. New code must use:

- `actor.notify.x()` / `actor.notifyNow.x()` instead of flat notification calls
- `actor.call.y()` instead of flat service calls
- `this.notify.x()` / `this.notifyNow.x()` instead of `this.actor.x()` /
  `this.immediate.x()`
