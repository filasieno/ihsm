# Proposal: tighten ihsm compile-time types

**Status:** in progress — **T2, T5, T6 implemented** (2026-06-08), plus **P1 packaging** (test code split to the `ihsm/testing` subpath) · **Date:** 2026-06-08  
**Scope:** `packages/ihsm/src/index.ts`, `src/testing.ts`, `src/internal/lookup.ts` and closely related public type aliases — no runtime behaviour changes unless noted.

This document proposes incremental type-system hardening for ihsm. It follows analysis of the current `Protocol` / `Dispatch` / `StateClass` model, `makeActor` disjointness, and dispatch lookup semantics. Goals:

1. Make the type system **honest** about what the runtime does (inheritance, mailbox, public/internal split).
2. Catch more mistakes at **compile time** without forcing boilerplate on authors.
3. Prefer **non-breaking** or **opt-in** changes; flag breaking items explicitly.

Related: [`TODO.md`](TODO.md) (system/test ergonomics), [`packages/ihsm/reference/REFERENCE.md`](packages/ihsm/reference/REFERENCE.md) § Advanced protocol typing.

---

## Executive summary

| # | Proposal | Impact | Breaking? |
|---|----------|--------|-----------|
| T1 | Replace `...disjointGuard` rest param with generic constraint | Cleaner `makeActor` / `makeTestActor` API | No |
| T2 ✅ | Split `EventKeys` / `ServiceKeys` on `post` vs `call` | Typos and wrong mailbox primitive caught earlier | No |
| T3 | Document `Partial<HandlersOf<P>>` on state prototypes | Types match inheritance; no “implement all on Top” | No |
| T4 | Optional `implements Protocol` → `satisfies HandlersOf<P>` helper | Opt-in exhaustiveness without class boilerplate | No |
| T5 ✅ | Structural `Actor` wrapper instead of `as unknown as` cast | Public-only surface enforced by construction | Unlikely |
| T6 ✅ | Unify handler lookup across dispatch modes | Runtime/docs alignment (see R1) | No* |
| T7 | Brand `Dispatch<P, I>` vs plain `Protocol` | Prevents accidental protocol widening | Minor |
| T8 | Lint / types for prototype methods vs class fields | Handlers must live on `.prototype` | Doc + optional lint |
| T9 | `@ihsm/system` typed registry (cross-actor) | System boundary typing (separate package) | N/A |

\* T6 is a runtime consistency fix; typing unchanged unless we expose lookup rules in types.

**Suggested order:** T1 → T2 → T3 (docs + types) → T5 → T7 → T9.

**Shipped so far (2026-06-08):** **T2** (event/service key split), **T5** (structural `Actor`
facade), **T6** (unified handler lookup), and **P1** (packaging — test utilities moved to the
`ihsm/testing` subpath; see below). Remaining proposals (T1, T3, T4, T7, T8, T9) are unstarted.

---

## Current model (baseline)

### Single source of truth

`Protocol` (or `Dispatch<Public, Internal>`) is the vocabulary for:

- Client `post` / `call` / `deferredPost`
- Handler method signatures on state classes
- Error correlation (`RuntimeError.eventName`, `eventPayload`)

`Context` and `Protocol` flow through `makeHsm`, `TopState`, `Hsm`, and the error hierarchy.

### What types require today

```typescript
export type StateClass<Context, Protocol> = Function & {
  prototype: State<Context, Protocol> & StateEvents<Context, Protocol>;
};
```

`StateClass` requires **runtime machinery** (`transition`, `post`, lifecycle hooks) on the prototype — **not** `Protocol` handler methods.

`makeHsm(topState: StateClass<Context, Protocol>, …)` infers `Protocol` from `TopState<Ctx, P>` on the class, not from “this class defines every key of `P`”.

### Public / internal split

```typescript
type Dispatch<Protocol, InternalProtocol> =
  {} extends InternalProtocol ? Protocol
  : Protocol extends undefined ? undefined
  : Protocol & InternalProtocol;

type Disjoint<Public, Internal> =
  Extract<keyof Public, keyof Internal> extends never ? true
  : ['ihsm: public and internal protocols must not share keys', Extract<keyof Public, keyof Internal>];
```

`makeActor` / `makeTestActor` use a **phantom rest parameter** when `Disjoint` is not `true`:

```typescript
...disjointGuard: Disjoint<Public, Internal> extends true ? [] : [error: Disjoint<Public, Internal>]
```

### Runtime dispatch (relevant to typing claims)

**Production / DEBUG** (`dispatch.production.ts`, `dispatch.debug.ts`):

```typescript
const eventHandler = hsm.currentState.prototype[eventName];
```

**VERBOSE_DEBUG** (`dispatch.trace.ts`): walks the **constructor** chain with `hasOwnProperty` per state, stops at `TopState`.

For normal `class` hierarchies these agree. Docs state dispatch “walks the prototype chain”; production does not use the same algorithm as verbose trace.

### Optional `implements Protocol`

Documented as **opt-in** exhaustiveness on a state class (usually root). Not required for client typing — `TopState<Ctx, Protocol>` already binds `post` / `call`.

---

## Gaps the type system allows today

| Gap | Example | Runtime outcome |
|-----|---------|-----------------|
| Root omits protocol methods | `class Top extends TopState<Ctx, P> {}` | `post('start')` type-checks; `onUnhandled` at runtime |
| `post` on a service key | `hsm.post('getBalance')` | May infer `never` payload or weak error — inconsistent |
| `call` on a void event | `hsm.call('open')` | Weak inference; confusing errors |
| Overlapping Public ∩ Internal | Without `makeActor` disjoint gate | `Dispatch` intersection; ambiguous merged signatures |
| `makeActor` return | `as unknown as Actor<Context, Public>` | Cast erases structural guarantee of public-only API |
| Handler as class field | `handler = () => {}` | Not on prototype → never dispatched |
| Cross-actor `post` | mmkit `ActorRegistry` | `string` events; compile-time safety lost |

---

## T1 — Disjointness without phantom rest parameter

### Problem

The `...disjointGuard` parameter is a well-known TypeScript workaround. It works but pollutes the public signature and confuses readers (“why instantiate just for a guard?”).

### Proposal

Constrain `Internal` on the generic parameter list; remove the rest parameter.

```typescript
/** Keys that must not appear on both Public and Internal. */
type OverlappingKeys<Public, Internal> = Extract<keyof Public, keyof Internal>;

/** Use as: Internal extends DisjointFrom<Public, Internal> */
type DisjointFrom<Public, Internal> =
  OverlappingKeys<Public, Internal> extends never
    ? Internal
    : never;

export function makeActor<
  Context,
  Public extends {} | undefined,
  Internal extends DisjointFrom<Public, Internal> = {},
  P extends Port<Context, Internal> | undefined = undefined,
>(
  topState: StateClass<Context, Dispatch<Public, Internal>>,
  ctx: Context,
  // …unchanged optional args…
  makePort?: PortProvider<Context, Internal, P>,
): Actor<Context, Public>;
```

Equivalent constraint form (sometimes clearer errors):

```typescript
Internal extends Record<OverlappingKeys<Public, Internal>, never> = {}
```

Keep exporting `Disjoint<Public, Internal>` as a **named alias** for docs and `@ts-expect-error` tests:

```typescript
export type Disjoint<Public, Internal> =
  OverlappingKeys<Public, Internal> extends never ? true
  : ['ihsm: public and internal protocols must not share keys', OverlappingKeys<Public, Internal>];
```

### Acceptance

- `examples/testing-01-deferred-timers/tutorial.spec.ts` compile-time checks still fail on colliding protocol keys.
- No runtime or call-site argument changes.
- CHANGELOG: “API surface unchanged; implementation detail of disjoint check”.

---

## T2 — Split event keys and service keys

### Problem

`post` and `call` both use `keyof Protocol` (with `PostedEvent` / `ServiceName` filters). `ServiceName` does not verify the resolve/reject shape; `EventPayload` returns `never` for services on `post`, but errors can be opaque.

### Proposal

Add conditional types and thread them through `Base`, `Hsm`, and `State`:

```typescript
type IsServiceMethod<M> =
  M extends (resolve: (result: infer _R) => void, reject: (error: infer _E) => void, ...args: infer _P) => any
    ? true
    : false;

type ServiceKeys<P extends {}> = {
  [K in keyof P]: IsServiceMethod<P[K]> extends true ? K : never;
}[keyof P];

type EventKeys<P extends {}> = Exclude<
  keyof P,
  ServiceKeys<P> | keyof State<any, any>
>;

// post / deferredPost / postNow
post<E extends EventKeys<Protocol>>(
  eventName: E,
  ...eventPayload: EventPayload<Protocol, E>
): void;

// call
call<E extends ServiceKeys<Protocol>>(
  eventName: E,
  ...eventPayload: ServiceRequest<Protocol, E>
): Promise<ServiceResponse<Protocol, E>>;
```

For `Protocol extends undefined` (legacy), keep `string` / `any[]` escape hatch unchanged.

### Acceptance

- `post('getBalance')` → compile error when `getBalance` is service-shaped.
- `call('open')` → compile error when `open` is void event-shaped.
- Existing examples and spec still type-check.
- REFERENCE §11 updated: events vs services keyed separately.

### Edge cases

| Case | Rule |
|------|------|
| Method with optional resolve/reject | Not a service unless first two params match `ResolveCallback` / `RejectCallback` exactly |
| `Protocol` with only events | `ServiceKeys` = `never`; `call` accepts no literals |
| Reserved `State` keys | Remain excluded from both |

### Status — ✅ Implemented (2026-06-08)

`IsServiceMethod`, `ServiceKeys`, and `EventKeys` are exported from `src/index.ts`. `PostedEvent`
now excludes `ServiceKeys` and `ServiceName` excludes `EventKeys`, so `post`ing a service or
`call`ing a void event is a compile error. Verified by `@ts-expect-error` checks in
`examples/testing-02-network-fetch/tutorial.spec.ts` (`post('body')` and `call('fetch', …)` both
fail to compile); all 136 unit + 86 example tests pass.

---

## T3 — Honest handler coverage (`Partial<HandlersOf<P>>`)

### Problem

Authors may believe the root must `implements Protocol` or define every method. Types do not require handlers anywhere; inheritance is the runtime mechanism.

### Proposal

**Do not** require all keys on `TopState`. Instead, document and export:

```typescript
type HandlerMethod<M> =
  M extends (...args: infer A) => infer R ? (...args: A) => R : never;

type HandlersOf<P extends {}> = {
  [K in keyof P]: HandlerMethod<P[K]>;
};

/** Every state prototype may implement any subset; omitted keys inherit from ancestors. */
type StateHandlers<P extends {}> = Partial<HandlersOf<P>>;
```

Optional tightening on `StateClass` (non-breaking if `Partial`):

```typescript
export type StateClass<Context, Protocol extends {} | undefined> =
  Function & {
    prototype: State<Context, Protocol> &
      StateEvents<Context, Protocol> &
      (Protocol extends {} ? StateHandlers<Protocol> : {});
  };
```

This adds **no new requirements** (partial is optional keys) but makes the inheritance model explicit in hover docs.

### Authoring guidance (document, not enforce)

| Pattern | When |
|---------|------|
| Handler on leaf | Phase-specific behaviour |
| Handler on LCA | Shared behaviour for a subtree |
| Handler on root | Queries and always-valid commands only |
| `implements Protocol` on root | Opt-in: “I declare every key on this class” |

---

## T4 — Opt-in exhaustiveness without `implements Protocol`

### Problem

`implements Protocol` on a class that only defines a subset forces empty stubs on the same class or splits protocol across inheritance awkwardly.

### Proposal

Export a **type-level assertion** for tests or a dedicated `handlers.ts`:

```typescript
/** Compile-time check that `T` implements all handlers (usually the root state class). */
type AssertHandlers<P extends {}, T extends HandlersOf<P>> = T;

// Usage at bottom of machine.ts (erased at compile, no runtime):
type _check = AssertHandlers<MyProtocol, typeof MyTop>;
```

For a single root class that should own every handler:

```typescript
type _rootExhaustive = AssertHandlers<MyProtocol, InstanceType<typeof MyTop>>;
```

Alternative: `satisfies` on a const object of bound functions — only if we document a non-class pattern (out of scope for core ihsm).

### Acceptance

- REFERENCE §10: recommend `AssertHandlers` over mandatory `implements Protocol`.
- CHANGELOG: `implements Protocol` remains valid; not deprecated.

---

## T5 — Structural public-only `Actor` (remove double cast)

### Problem

```typescript
const hsm = instantiate(...);
return hsm as unknown as Actor<Context, Public>;
```

The cast proves nothing structurally; a regression could expose internal `post` at runtime while types say `Public`.

### Proposal

Return a **narrow facade** from `makeActor`:

```typescript
function narrowToActor<Context, Public extends {} | undefined>(
  hsm: Hsm<Context, Dispatch<Public, any>>,
): Actor<Context, Public> {
  return {
    get ctx() { return hsm.ctx; },
    post: hsm.post.bind(hsm) as Base<Context, Public>['post'],
    deferredPost: hsm.deferredPost.bind(hsm) as Base<Context, Public>['deferredPost'],
    call: hsm.call.bind(hsm) as Hsm<Context, Public>['call'],
    sync: hsm.sync.bind(hsm),
    restore: hsm.restore.bind(hsm) as Hsm<Context, Public>['restore'],
    // Properties: traceLevel, currentStateName, … as needed for Actor surface
  };
}
```

`makeTestActor` continues to return full `Hsm<Context, Dispatch<…>> & { port }` (or the live instance).

### Tradeoffs

| Pro | Con |
|-----|-----|
| Public API cannot accidentally widen | Extra object or Proxy; identity `hsm === actor` false |
| Tests can assert internal events not on `actor` | Handlers still use full instance via `this.hsm` |

**Mitigation:** document that `makeActor` returns a facade; `makeTestActor` returns the real actor for white-box tests.

### Breaking risk

Low if facade implements the same `Actor` interface. Code that relied on `makeActor` return being identical to internal `HsmObject` would break — grep consumers before shipping.

### Status — ✅ Implemented (2026-06-08)

`makeActor` now builds its return value through `narrowToActor` (in `src/index.ts`), a getter/bound-
method facade exposing only the public `Actor` surface, replacing the `as unknown as Actor` cast.
`makeTestActor` (in `src/testing.ts`) still returns the full `Hsm & { port }` for white-box tests.
The existing `@ts-expect-error` against calling an internal method on an `Actor` in testing-02
confirms the narrowed surface; all tests pass.

---

## T6 — Unify handler lookup (runtime, enables honest docs)

### Problem

VERBOSE_DEBUG uses constructor-chain + `hasOwnProperty`; PRODUCTION/DEBUG use `currentState.prototype[eventName]`. Behaviour diverges in edge cases; REFERENCE claims one model.

### Proposal

Extract shared lookup in `internal/lookup.ts`:

```typescript
function lookupEventHandler<Context, Protocol>(
  hsm: HsmWithTracing<Context, Protocol>,
  eventName: keyof Protocol & string,
): ((...args: unknown[]) => unknown) | undefined;
```

Use in all three dispatch modules. Prefer **constructor-chain + own property** (verbose semantics) as canonical — matches “which state class owns this handler” for tracing.

### Typing follow-up

If we ever expose “defining state” in traces, align names with `getStateName(state)` from lookup walk.

### Status — ✅ Implemented (2026-06-08)

`internal/lookup.ts` now exports the canonical `lookupEventHandler` — constructor-chain walk +
own-property check, stopping at (and including) `TopState` so resolution never falls through to
runtime methods on `State.prototype` / `Object.prototype`. `dispatch.production.ts` and
`dispatch.debug.ts` both call it; `dispatch.trace.ts` narrates the identical algorithm. Production,
debug, and verbose now resolve handlers identically; `internal/lookup.ts` reports 100% coverage and
all tests pass.

---

## T7 — Brand merged dispatch protocol

### Problem

`Dispatch<Public, Internal>` is structurally `Public & Internal`. Easy to pass `Hsm<C, Dispatch<P,I>>` where `Actor<C, P>` or `InboundPoster<C, I>` was intended.

### Proposal

```typescript
declare const DispatchBrand: unique symbol;
type Dispatch<Public extends {} | undefined, Internal extends {}> =
  {} extends Internal ? Public
  : Public extends undefined ? undefined
  : (Public & Internal) & { readonly [DispatchBrand]?: true };
```

Narrow at boundaries:

```typescript
type AsDispatch<P, I> = Dispatch<P, I>;
type PublicFromDispatch<D> = D extends Dispatch<infer P, infer _I> ? P : never; // needs paired inference — may require two type params always
```

**Simpler variant:** brand only on `InboundPoster` and `TestActor` merged handle, not on `Dispatch` alias itself — less churn.

### Breaking risk

**Minor** — code that manually intersects protocols may need explicit `as Dispatch<P,I>`.

---

## T8 — Prototype methods only (documentation + lint)

### Problem

Dispatch calls `state.prototype[method].call(instance, …)`. Class **fields** (`tick = () => {}`) are instance properties; they are not found.

### Proposal

1. REFERENCE § Advanced typing: “Handlers must be prototype methods (`method(): void` or `method() {}` in class body).”
2. Optional ESLint rule (future `@ihsm/eslint` or docs recipe): flag `PropertyDefinition` with call signature in classes extending `TopState`.
3. No change to `StateClass` typing (cannot detect fields vs methods reliably in all TS versions).

---

## T9 — System boundary typing (`@ihsm/system`)

Cross-actor posting is the largest real-world type hole (mmkit `ActorRegistry`). Out of core `ihsm` but listed for completeness.

### Sketch

```typescript
interface SystemSpec {
  plugin: PluginProtocol;
  config: ConfigProtocol;
}

type ActorId = keyof SystemSpec;

interface ActorRegistry<S extends Record<string, {}>> {
  register<K extends ActorId>(id: K, actor: Hsm<any, S[K]>): void;
  post<K extends ActorId, E extends EventKeys<S[K]>>(
    id: K,
    event: E,
    ...payload: EventPayload<S[K], E>
  ): void;
}
```

Ship in `@ihsm/system` per [`TODO.md`](TODO.md) P0.

---

## P1 — Packaging: keep test utilities out of the production runtime

### Problem

The deterministic-testing surface (`makeTestActor`, `@mock` / `makeTestPort`, `ManualClockPort`,
`TestPort`, `DefaultTestPort`, `Stubbed` / `Mock`) was defined in `src/index.ts`, so it shipped in
the same module clients import in production. That bloats the runtime for code that is only ever used
in tests, and a tree-shaker cannot reliably drop it once a single consumer touches the module.

The initial idea was two **separate packages**: `@ihsm/core` (republish `ihsm`) and `@ihsm/test`
(the test helpers). Investigating how other libraries handle this — and the dependency problems it
creates — argued against it.

### What other projects do

| Library | Test helpers | Mechanism |
|---------|--------------|-----------|
| RxJS | `TestScheduler` (virtual clock) | **subpath** `rxjs/testing` |
| Apollo Client | `MockedProvider`, mock links | **subpath** `@apollo/client/testing` |
| Angular | `TestBed`, fakes | **subpath** `@angular/core/testing` |
| React | `act`, test utils | **subpath** `react-dom/test-utils` |

The dominant pattern is a **subpath export within the same package**, not a second npm package.

### Why not separate `@ihsm/core` + `@ihsm/test` packages

- **Tight coupling to internals.** The test helpers need `makeHsm`, `Dispatch`, `Port`, `BasePort`,
  `ActorOptions`, and the default trace/init constants. A separate `@ihsm/test` package would either
  re-export half of core's internals or reach across a package boundary into private symbols.
- **Dual-package hazard.** Two packages that both pull in `ihsm` types can produce **two copies** of
  the same `class`/`instanceof` identity (ESM + CJS, or version skew), so `port instanceof BasePort`
  and `TopState` marker checks break in subtle ways.
- **Version lockstep.** `@ihsm/test` would have to pin `@ihsm/core` to an exact version and be
  released in lockstep — friction with no upside for a 0.x library.

### Decision — `ihsm` + `ihsm/testing` subpath (single package)

- Core runtime stays importable from **`ihsm`**.
- All test-only code moves to **`src/testing.ts`**, exported as the **`ihsm/testing`** subpath. It
  `export *`s the core API too, so a spec can import everything from `ihsm/testing` alone.
- `package.json` declares both subpaths under `exports` (ESM + CJS `types`/`default`) and keeps
  `"sideEffects": false`, so a production bundle that imports only `ihsm` never pulls in the
  mock/clock code.
- `@ihsm/core` / `@ihsm/test` as distinct npm packages are **dropped**; the subpath gives the same
  separation (and the same import ergonomics) without a second dependency or the dual-package hazard.

### Status — ✅ Implemented (2026-06-08)

`src/testing.ts` created; the `TestActor` type, `TestPort` / `DefaultTestPort`, `ManualClockPort`,
`@mock` / `makeTestPort` / `Stubbed` / `Mock`, and `makeTestActor` were moved out of `src/index.ts`.
`makeTestActor` now builds via the public `makeHsm`. `package.json` exposes `./testing`; the five
`testing-NN` examples import from `../../src/testing`. Typecheck, 136 unit + 86 example tests, eslint
(0 warnings), and prettier all pass.

---

## R1 — Runtime rules types should not contradict

| Rule | Type implication |
|------|------------------|
| Dispatch inherits via class prototype chain | `Partial<HandlersOf<P>>` per state; no full `P` on root |
| `onEntry` / `onExit` are own-property only | Do not type them as inherited hooks |
| Services use resolve/reject injection | `call` only on `ServiceKeys` |
| Public/internal vocabularies disjoint | `DisjointFrom` constraint on `makeActor` |
| Reserved `State` names not in protocol | Keep `PostedEvent` collision with `keyof State` |

---

## Migration and versioning

| Change | Semver |
|--------|--------|
| T1, T2, T3, T4, T6, T8 | **Minor** (stricter compile, no runtime) |
| T5 facade return | **Minor** if interface identical; **Major** if identity/ref equality documented |
| T7 branding | **Minor** with escape hatch cast |

Recommend **one minor release** bundling T1+T2+T3 with CHANGELOG “TypeScript: stricter post/call and disjoint constraint”.

---

## Test plan

1. **Type tests** — extend `examples/testing-01-deferred-timers/tutorial.spec.ts` pattern:
   - `@ts-expect-error` for `post` on service, `call` on event (T2)
   - `@ts-expect-error` for overlapping Public/Internal without rest param (T1)
2. **Existing** — `npm test` / Nix check unchanged.
3. **T5** — if facade: assert `makeActor` return does not have internal keys in type tests; runtime test that `post('onData')` on public actor throws or is absent on object.

---

## Out of scope (this proposal)

- JSON statecharts / codegen from types
- `@Transition` metadata guards (TODO P2)
- Changing `FatalErrorState` / fault typing
- `sync()` reject-on-fatal (ergonomics, not protocol typing)
- Empty parent handler stubs / `@IgnoredEvents` (runtime ergonomics — see TODO P1)

---

## Open questions

1. ~~**T6 canonical lookup:** constructor-chain + `hasOwnProperty` vs single `prototype[event]`~~ — **Resolved:** canonical constructor-chain + own-property lookup adopted (stops at `TopState`); all hierarchy examples pass.
2. ~~**T5 facade:** acceptable to break `actor === internalHsm` identity?~~ — **Resolved:** yes; `makeActor` returns a facade, `makeTestActor` returns the real instance for white-box tests.
3. **T2 strictness:** reject protocols where a method is ambiguous (e.g. first param optional resolve)? — Current rule: only an **exact** `(resolve, reject, …)` shape counts as a service; ambiguous methods fall to the event side.
4. **T3 `Partial` on `StateClass`:** worth the noisier error messages on wrong handler signatures?

---

## References

- [`packages/ihsm/src/index.ts`](packages/ihsm/src/index.ts) — `Disjoint`, `Dispatch`, `StateClass`, `IsServiceMethod` / `ServiceKeys` / `EventKeys` (T2), `narrowToActor` (T5), factories
- [`packages/ihsm/src/testing.ts`](packages/ihsm/src/testing.ts) — `ihsm/testing` entry point: `makeTestActor`, `@mock` / `makeTestPort`, `ManualClockPort`, `TestPort` (P1)
- [`packages/ihsm/src/internal/lookup.ts`](packages/ihsm/src/internal/lookup.ts) — canonical `lookupEventHandler` shared by all dispatch modes (T6)
- [`packages/ihsm/src/internal/dispatch.production.ts`](packages/ihsm/src/internal/dispatch.production.ts) — production dispatch
- [`packages/ihsm/src/internal/dispatch.trace.ts`](packages/ihsm/src/internal/dispatch.trace.ts) — verbose lookup walk
- [`packages/ihsm/examples/testing-01-deferred-timers/tutorial.spec.ts`](packages/ihsm/examples/testing-01-deferred-timers/tutorial.spec.ts) — disjoint compile tests
- [`packages/ihsm/examples/testing-02-network-fetch/tutorial.spec.ts`](packages/ihsm/examples/testing-02-network-fetch/tutorial.spec.ts) — T2 `post`/`call` compile tests

---

*Update status when items are accepted, implemented, or rejected.*
