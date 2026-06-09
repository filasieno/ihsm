# ihsm — Roadmap & improvement backlog

**Source:** evaluation from [conceptbase-cc mmkit](https://gitlab.com/fabioandrea/conceptbase-cc) — a VS Code extension with five coordinated ihsm actors, 66+ headless tests, async install pipelines, fault injection, and multi-actor shutdown.

**Date:** 2026-06-07

---

## Executive summary

**Overall rating: 4.3 / 5**

ihsm’s core bet — **class hierarchy + Protocol + serialized mailbox** — scales to a non-trivial production-shaped application without conditional spaghetti. The library is strongest for **single-actor domain machines** with typed events and testable async workflows.

Friction appears at **multi-actor system boundaries**, **test orchestration**, and **observability**. Consumers like mmkit currently reimplement an actor registry, polling `sync()` loops, structured trace parsing, and operational fault handling on top of the runtime.

| Dimension | Score | Notes |
| --------- | ----- | ----- |
| Modeling expressiveness | **5** | Install substates, mode switching, shutdown cascade map cleanly to state classes |
| Type safety (single actor) | **5** | `Protocol` types `post()` / handler signatures at compile time |
| Async / extended transitions | **4.5** | `postNow` chains in `onEntry` drive multi-step async flows reliably |
| Multi-actor coordination | **3** | No built-in registry; cross-actor `post` loses typing |
| Testability | **4** | `sync()` + sim ports work; multi-actor tests need custom polling helpers |
| Observability | **3.5** | `TraceWriter` emits strings; consumers parse with regex for structured logs |
| Error / recovery model | **3.5** | `FatalErrorState` is a hard stop; recoverable operational faults are ad hoc |
| Documentation | **4.5** | Reference manual is thorough on `postNow`, LCA, `sync()` caveats |
| Supply chain / footprint | **5** | Zero runtime dependencies; embeddable in VS Code / Nix |

**Highest-ROI next work:** `@ihsm/system`, `waitForState` / `syncSystem`, structured `TraceEvent`s, `@ihsm/test`.

---

## What works well (validated by mmkit)

### 1. `postNow` as extended-transition primitive

Multi-step logical transitions (install pipeline, TCP connect + ENROLL, panel render) use:

```
onEntry → postNow('step') → async handler → transition(NextState)
```

This is idiomatic, readable, and avoids promise chains outside the machine.

### 2. Parent-state shared behavior

Parent `onEntry` / `onExit` hooks run with the parent state as the active prototype when that
state is entered during init or a transition — use them for shared setup/teardown without
`TargetState.prototype._checkInvariant.call(this)` workarounds.

### 3. Orthogonal regions without framework magic

Multiple `makeHsm` instances coordinated by a root actor (`PluginCoordinator`) match tutorial 14. Each mailbox stays serialized; shutdown via `childShutdownAck` + watchdog is straightforward.

### 4. Protocol-as-vocabulary

Event-storming tables map 1:1 to TypeScript methods. Renaming an event fails at compile time on direct `hsm.post` call sites.

### 5. Runtime quality bar

100% runtime test coverage and zero npm dependencies are real differentiators for embedded / extension contexts.

---

## Friction observed in real use

### Multi-actor layer missing

mmkit built `ActorRegistry` with stringly-typed routing:

```typescript
post(id: string, event: string, ...payload: unknown[]): void {
  (hsm.post as (name: string, ...args: unknown[]) => void)(event, ...payload);
}
```

Compile-time safety is lost at system boundaries.

### `sync()` does not scale to actor systems

Tests need custom polling (`settleHsm`, `waitForHsmState`) that call `sync()` on one actor **and** `syncAll()` on peers until a stable leaf state is reached. One `sync()` per actor is insufficient for integration tests.

### Async teardown races

Patterns like `Stopping.onEntry → postNow('beginStop') → async tearDown` require manual idempotence when `shutdownForce` arrives mid-flight. Not unique to ihsm, but no library helpers guide or guard this.

### Trace API is string-oriented

Consumers reverse-engineer ihsm log lines with regex (`transition from X to Y`, `begin event dispatch of #event`) to produce structured OTEL output. Fragile if trace format changes.

### Coarse `TraceLevel`

Only `PRODUCTION` / `DEBUG` / `VERBOSE_DEBUG`. Apps with six OTEL severities must map externally (e.g. mmkit maps `info` and `warn` to the same ihsm level).

### `call()` underused in practice

mmkit models all request/response as `postNow` + async handler + follow-up event instead of `call()`. Both work; the library should document when to prefer each.

### `FatalErrorState` vs operational faults

mmkit explicitly avoids `FatalErrorState` on port faults — tests assert `currentStateName !== 'FatalErrorState'`. Domain faults route to `managerReportFault` instead of hierarchical `onError` recovery. Suggests need for a first-class **recoverable fault** pattern distinct from fatal machine death.

### Parent stubs for unhandled events

Parent composites need empty handler stubs (e.g. `managerReportIdle(): void {}` on `CoordinatorTop`) because events bubble on the prototype chain. Boilerplate that could be declarative.

### `sync()` + `FatalErrorState` semantics

Default `dispatchErrorCallback` logs and throws to the callback, but `sync()` still resolves after entering `FatalErrorState`. Tests must manually check state; an opt-in “reject sync on fatal” mode would match test expectations.

---

## Improvement backlog

Priority legend: **P0** = high impact for system-style consumers · **P1** = ergonomics · **P2** = power features · **P3** = ecosystem

---

### P0 — System layer & testing

- [ ] **`@ihsm/system` — typed actor registry**
  - `registerActor(id, hsm)`, `getActor(id)`, `postTo<Id, Event>(...)`
  - Optional union `SystemProtocol` for cross-actor events
  - Restore compile-time safety at system boundaries
  - Reference consumer: mmkit `ActorRegistry`

- [ ] **`waitForState(hsm, predicate | stateName, { timeout, interval })`**
  - Official replacement for ad-hoc `settleHsm` / `waitForHsmState` polling loops
  - Returns final state or throws `WaitForStateTimeoutError`

- [ ] **`syncAll(...hsms)` and `syncSystem(registry)`**
  - Document and ship as first-class utilities
  - Multi-actor tests are the norm for coordinator patterns

- [ ] **Structured trace events**
  - `TraceWriter.write(event: TraceEvent)` where `TraceEvent` is:
    ```typescript
    type TraceEvent =
      | { kind: 'transition'; from: string; to: string; durationMs?: number }
      | { kind: 'dispatch'; event: string; payload: unknown[]; state: string }
      | { kind: 'handler'; phase: 'begin' | 'end'; event: string }
      | { kind: 'error'; error: Error; event?: string; state?: string };
    ```
  - Keep string formatter as default adapter for console / backward compatibility
  - Enables OTEL exporters without regex parsing

- [ ] **`@ihsm/test` package**
  - `assertNotFatal(hsm)`
  - `CollectingTraceWriter` (structured + raw)
  - `createTestHsm(Top, ctx, sim?)` harness
  - Fake timers integration with `deferredPost`
  - Extract patterns from mmkit `test/faults/`

---

### P1 — Ergonomics & error model

- [ ] **Event bubbling / ignore policy on `TopState`**
  - e.g. `@IgnoredEvents(['managerReportIdle'])` or `protected ignoreUnhandled: (keyof Protocol)[]`
  - Reduce empty stub handlers on parent composites

- [ ] **`sync({ rejectOnFatal: true })` or `makeHsm` option `syncRejectsOnFatal`**
  - `await hsm.sync()` rejects when machine enters `FatalErrorState`
  - Matches how integration tests already assert failure

- [ ] **Recoverable fault helper**
  - `this.fault(info)` → `onFault` hook without entering `FatalErrorState`
  - Or documented `Faulted` composite sibling pattern + reference implementation
  - Distinguish **operational fault** (report, stay alive) from **fatal** (machine dead)

- [ ] **Finer trace levels or pluggable severity**
  - Align with OTEL (`trace`, `debug`, `info`, `warn`, `error`) or numeric level per `TraceEvent`
  - `hsm.traceLevel` remains coarse filter; writer receives fine-grained level

- [ ] **`sync({ drainHiPriority: true })`**
  - Single `sync()` drains `postNow` follow-ups without documented “call sync twice” footgun
  - Update reference §4 with new default behavior if changed

- [ ] **`call()` vs async event cookbook**
  - When to use `await hsm.call('load')` vs `postNow('load')` + async handler
  - mmkit uses only the latter; document trade-offs (multi-step vs single response)

---

### P2 — Introspection & persistence

- [ ] **Statechart introspection from `registerStateNames`**
  - `listStates(topState): string[]`
  - `describeProtocol(Top): { events, services }`
  - Export PlantUML from class hierarchy (keeps design docs in sync with code)

- [ ] **Snapshot / restore helpers**
  - `hsm.snapshot(): { stateClass, ctx }` + `hsm.restore(snapshot)`
  - Typed context round-trip for extension deactivate/reactivate, crash recovery

- [ ] **Guard / transition metadata (optional)**
  - `@Transition({ from, to, guard })` for static analysis without losing class model
  - Low priority — guards as ordinary TypeScript `if` work fine today

- [ ] **DevTools / trace timeline**
  - Consume structured `TraceEvent`s
  - Per-actor timeline view (actor id from consumer, not ihsm core)

---

### P3 — Ecosystem (multipackage roadmap)

Aligns with [`packages/README.md`](packages/README.md) Phase 2.

- [ ] **`@ihsm/core`** — thin re-export of `ihsm` (workspace package)
- [ ] **`@ihsm/react`** — `useActorState(hsm)`, `useActorTrace(hsm)` for panel-style UIs
- [ ] **VS Code extension** — live state visualizer from structured trace + introspection API
- [ ] **Comparison guide** — ihsm vs XState for multi-actor backends (`call()` + class hierarchy vs snapshot actors)

---

## What not to change

| Keep as-is | Reason |
| ---------- | ------ |
| Class-as-state model | mmkit proves it scales; don’t sacrifice for JSON chart editors |
| Single mailbox per instance | Serialization prevented shutdown races in mmkit |
| Zero **runtime** dependencies | Put system/test tooling in optional `@ihsm/*` packages |
| `postNow` hi-priority FIFO semantics | Install/connect chains depend on drain order |
| LCA transition + cached paths | Hot-path performance for frequent transitions |

---

## Reference: mmkit actor inventory

| Actor | States (summary) | ihsm features used |
| ----- | ---------------- | ------------------ |
| `plugin.coordinator` | Inactive, Bootstrapping, Active, SwitchingMode, ShuttingDown | Multi-actor bootstrap, mode switch, shutdown watchdog |
| `config` | Inactive, Loading, Ready, ShuttingDown | `postNow` async load chain |
| `server.manager` | Disabled, Idle, Starting, Installing*, Running, Stopping, ShuttingDown | Deep hierarchy, `deferredPost` watchdog, `onExit` teardown |
| `client.manager` | Disabled, Idle, Connecting, Connected, Disconnecting, ShuttingDown | Async connect + ENROLL chain |
| `panel.interaction` | Disabled, Active, ShuttingDown | Sensor/actuator via ports, re-render on snapshot |

mmkit test baseline (2026-06-07): **66 passing**, actor coverage ~**92%** statements / **81%** branches.

---

## Suggested implementation order

| Sprint | Focus | Exit |
| ------ | ----- | ---- |
| S1 | `@ihsm/test`, structured `TraceEvent`, `syncAll` | mmkit can drop local test helpers |
| S2 | `@ihsm/system` typed registry, `waitForState` | mmkit `ActorRegistry` becomes thin wrapper |
| S3 | `rejectOnFatal`, recoverable fault pattern | Document mmkit fault model as reference app |
| S4 | Introspection + PlantUML export | DESIGN.md codegen from actors |

---

## Related links

- mmkit design: `conceptbase-cc/components/mmkit/docs/DESIGN.md`
- mmkit status: `conceptbase-cc/components/mmkit/docs/STATUS.md`
- ihsm reference: [`packages/ihsm/reference/REFERENCE.md`](packages/ihsm/reference/REFERENCE.md)
- Multipackage plan: [`packages/README.md`](packages/README.md)

---

*Update this file when closing items or after the next production consumer evaluation.*
