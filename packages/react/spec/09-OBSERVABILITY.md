# 9. OBSERVABILITY (hot / warm / cold components & tracing)

`@ihsm/otel` already traces the actor side: every Intent that wakes the InteractionActor produces a
**macrostep trace** (otel doc 4 §4.2). This document adds the **React side** of the picture — what a
gesture costs from keystroke to pixels — and defines the **hot / warm / cold** classification that
keeps that telemetry bounded. It satisfies R18 and is, like the browser OTEL posture (otel doc 3
§3.5), primarily a **development/debug** aid: a no-op when no collector is registered (tracing is a
cross-cutting concern installed globally via `registerCollector`, never per actor), tree-shaken from
production browser bundles.

---

## 9.1 Component temperature — the definitions

Every Surface render falls into one of three bands by **how often its selected VM slice changes**.
The band is a property of the *selector*, so it is computed, not declared, and the Binding tags each
render with it.

| Band | Re-renders at… | Which components | Budget | Traced as |
|------|----------------|------------------|--------|-----------|
| **Hot** | **input frequency** — per keystroke-commit, per focus/selection move | the **active** `Field`/cell, the focused row, the live selection overlay | strictly **O(1)** nodes per gesture; must never block typing | **aggregated** — a counter on the commit span, not one span each (§9.4) |
| **Warm** | **reconcile frequency** — per `onAck`/`onReject`/`onServerPatch`/`onDiagnostics`, transient spawn, expand/collapse, sort | the touched `Row`/`CellVM`, `OptimisticBoundary`, the `NodeView` body around an add/remove, status bar | **O(changed nodes)** — structural sharing bounds it (R12) | one `ihsm.react.render` span event per changed component |
| **Cold** | **mount only** — structural mount/unmount | `InteractionProvider`, headers, static chrome, column/corner shells | renders once; any re-render after mount is a **defect** | a one-time `ihsm.react.mount` event; later renders flagged `ihsm.react.cold_rerender` (a warning) |

The bands are exactly the three rates the architecture already separates: hot = the §3.6 draft path,
warm = the §5.4 reconciliation path, cold = the §3.4 wiring. Classifying renders this way turns
"is my UI fast?" into a query (§9.5): *a hot edit must touch O(1) warm/cold nodes; any cold
re-render or any hot edit that fans out to many rows is a regression.*

> **Why temperature drives tracing, not just naming.** A naive "span per render" floods the trace on
> every keystroke (hot renders dominate by 100×). So hot renders are **counted** into the enclosing
> commit span; warm/cold renders — which are rarer and where bugs hide (an edit that re-renders the
> whole list, a cold node re-rendering) — get **individual** span events. This keeps the trace's
> cardinality on the *interesting* axis.

---

## 9.2 The gesture → macrostep → commit span chain

A single user gesture produces a chain that spans three owners. The Binding stitches them into the
**same trace** the actor already opens (otel doc 4), so one trace answers "what did pressing Tab
do, end to end".

```
Grid.commitField                                    ← ROOT (actor opens it; named <ActorName>.<handler>; otel doc 4 §4.2)
│   ihsm.trigger=commitField, ihsm.trigger.kind=external
├── ihsm.react.dispatch #commitField                ← React → actor edge (Binding)
│       ihsm.react.component=Field, ihsm.react.gesture=keydown:Tab,
│       ihsm.react.dom_event=keydown, ihsm.react.coord={rowId,field}
├── ihsm.step #commitField                          ← actor RTC turn(s) … project() … publish(vm)
│   └── ihsm.transition / ihsm.port …               (unchanged actor spans)
└── ihsm.react.commit                               ← React commit phase that consumed the new VM
        ihsm.react.vm_rev=7, ihsm.react.renders.warm=1, ihsm.react.renders.hot=1,
        ihsm.react.renders.cold=0, ihsm.react.duration_ms, ihsm.react.committed=true
        └── ihsm.react.render (event) component=Row[abc] band=warm reason=slice-changed
```

- **`ihsm.react.dispatch`** wraps `useIntent().x(...)`: it records the originating component, the DOM
  event that triggered it (from the §5.0 normalization), and the focus/cell coordinate — so a trace
  shows *which widget and which keypress* started the macrostep. It carries the forward link to the
  macrostep root (it **is** the trigger).
- **`ihsm.react.commit`** is opened when `useSyncExternalStore` notifies React of the new VM and
  closed in a `useLayoutEffect` after the commit, so its duration is the **real render+paint-prep
  time** for that publish. It is **linked** (not nested) to the macrostep whose `publish` produced
  the VM, via `vm.rev` / `ihsm.macrostep.id` — because React's commit is asynchronous to the actor
  turn, the link model (otel doc 4 §4.7) is the right join, not parent/child.
- Between them sit the unchanged **actor** spans (`ihsm.step`, `ihsm.transition`, `ihsm.port`).

The result: **one trace = one gesture's full cost**, with the actor's logic and React's render cost
side by side and attributable.

---

## 9.3 Attributes (the `ihsm.react.*` namespace)

Added to `semconv.ts` alongside the runtime keys (otel doc 4 §4.4), versioned under the
`@ihsm/react` instrumentation scope.

| Span / event | Key | Type | Meaning |
|--------------|-----|------|---------|
| dispatch | `ihsm.react.component` | string | the Surface component that dispatched (`Field`, `Command`, …) |
| dispatch | `ihsm.react.gesture` | string | normalized gesture (`keydown:Tab`, `dblclick`, `drag:resize`) |
| dispatch | `ihsm.react.dom_event` | string | the raw DOM event type (`keydown`/`pointerup`/…) |
| dispatch | `ihsm.react.coord` | string | `{rowId}:{field}` the gesture targeted (low cardinality template + attrs) |
| commit | `ihsm.react.vm_rev` | int | `vm.rev` consumed by this commit (join to the macrostep) |
| commit | `ihsm.react.renders.{hot,warm,cold}` | int | per-band render counts — the core perf signal |
| commit | `ihsm.react.duration_ms` | double | commit phase wall time |
| commit | `ihsm.react.committed` | bool | did React actually commit (vs bail out / be interrupted by a concurrent render) |
| render (event) | `ihsm.react.band` | string | `hot`\|`warm`\|`cold` |
| render (event) | `ihsm.react.reason` | string | `slice-changed`\|`mount`\|`parent`\|`cold_rerender` |

Hot renders are **not** individual events: they increment `ihsm.react.renders.hot` on the commit
span. Tier-1 actor attributes (`ihsm.actor.uuid`, `ihsm.actor.name`, `ihsm.state`) are inherited from
the macrostep so React spans are queryable by the **same** per-instance key as everything else.

---

## 9.4 Levels, sampling & cost

Mirrors the OTEL posture (otel doc 3 §3.5, doc 4 §4.8) — structure is cheap, detail is gated.

| Posture | `ihsm.react.dispatch` / `commit` spans | per-render `ihsm.react.render` events | hot-render counters |
|---------|----------------------------------------|---------------------------------------|---------------------|
| **browser DEBUG** (default dev) | on | on (warm/cold) | on |
| **PRODUCTION** (if ever enabled) | on (cheap skeleton) | off | counters only |
| **no provider** | no-op, tree-shaken | — | — |

Cost controls: (1) hot renders are aggregated, never one-span-each; (2) the per-render event is
DEBUG-gated like `ihsm.note`; (3) the Binding samples *commit* spans with the macrostep's
`ParentBased(AlwaysOn)` decision, so a sampled-out trace emits no React spans either. In a shipped
production browser build with no `@ihsm/otel/browser` provider, the entire chain compiles to a no-op.

---

## 9.5 What the trace buys (Grafana queries)

| Question | TraceQL (Tempo) |
|----------|-----------------|
| Full cost of one gesture | open the trace for `{ name="ihsm.react.dispatch" && .ihsm.react.gesture="keydown:Tab" }` |
| Hot edits that fanned out (a perf bug) | `{ name="ihsm.react.commit" && .ihsm.react.renders.warm > 5 }` (a single-cell edit should be ~1) |
| **Cold re-renders** (should never happen) | `{ span.ihsm.react.reason = "cold_rerender" }` |
| Slow commits | `{ name="ihsm.react.commit" && .ihsm.react.duration_ms > 16 }` (dropped frame) |
| Gesture → actor outcome | one trace shows `ihsm.react.dispatch` → `ihsm.step` (`ihsm.handler.verdict`) → `ihsm.react.commit` |
| Per-instance React history | `{ .ihsm.actor.uuid = "7f3c…" && name =~ "ihsm.react.*" }` |

Because the React spans share the macrostep's `trace_id` and the actor's `ihsm.actor.uuid`, the
otel view (state transitions, ports) and the React view (render fan-out, commit time) compose into
one timeline — the "watch the machine think" tool extended all the way to the DOM.

---

## 9.6 Error-tolerance & lifecycle traces (R21/R22)

Two generic-design events get first-class telemetry:

- **Capability negotiation** is traced **once** at boot: the `initialize` macrostep (doc 5 §5.7)
  carries `ihsm.react.capabilities` (the granted set) as a span attribute, so a trace tells you which
  protocol surface was active. Re-negotiation on reconnect (`lifecycle/resynced`) emits a new such
  span linked to the previous one.
- **Accepted-invalid (quarantined) values are WARN-traced**, not errors — they are expected in a DMI
  (R22). When a commit lands in `state:'invalid'`, the actor emits `this.hsm.log.warn("quarantined
  field", { nodeId, field, code })` (otel doc 4 §4.10 → `WARN`) and an `ihsm.note` span event on the
  macrostep. A *server* `ops/reject` remains an `ERROR` path. This keeps the WARN stream as the audit
  of "dirty-but-accepted" data and reserves ERROR for real refusals.

| Question | Query |
|----------|-------|
| Which fields are currently quarantined-invalid | LogQL `{ihsm_actor_uuid="…"} | json | severity="WARN" | code != ""` |
| What capabilities did this session negotiate | TraceQL `{ .ihsm.trigger="initialize" }` (root span name is `<ActorName>.initialize`) → `ihsm.react.capabilities` |
| Did any reject (hard failure) occur | `{ .ihsm.outcome="error" && .ihsm.error.phase="handler" }` |

The temperature counters (§9.3) make the *cost* of error tolerance visible too: an `invalid` cell is
still a **warm** render (one squiggle), never a cold cascade.

## 9.7 Devtools integration

The `@ihsm/react/devtools` panel (doc 8 §8.6) reads the **same** `ihsm.react.*` stream: it overlays
each rendered node with its band, flashes warm renders, and **red-flags cold re-renders** live — so
a perf regression is visible while editing, not just in a backend. Devtools, the fuzzer, and the
OTEL export consume the identical instrumented commit, so "what you profiled in dev" equals "what
Tempo shows in CI".
