# 4. Target trace and log design

This is the core of the specification. It defines the structure of **traces, spans, and logs**
for an ihsm actor, using the full OTEL feature set, with the explicit goal of *watching a machine
move through its states from one external stimulus to the next stable configuration* — as a
single, per-instance-queryable artifact.

Scope: traces and logs. Metrics are deferred (doc 2, non-goals).

---

## 4.1 The model: macrostep = trace, microstep = span

Borrowing statechart vocabulary, made precise for ihsm's serialized mailbox:

| Term | Definition | OTEL mapping |
|------|------------|--------------|
| **Microstep** | One run-to-completion turn: the runtime dequeues one event, runs its handler, and runs the resulting transition (`onExit`…`onEntry`). May be async (awaits I/O). May enqueue further events. | one `ihsm.step` span |
| **Macrostep** | The transitive closure of one *triggering* stimulus: the first microstep plus every microstep that the stimulus's cascade enqueues, run until the mailbox is **drained** and the actor is **stable** (no immediately-runnable task). | one **trace** (root span `ihsm.macrostep`) |
| **Stable** | After a microstep completes, the default and priority queues are empty. Tasks scheduled for the *future* (timers, `defer`) do **not** keep the macrostep open. | closes the root span |

So: **one external event → one macrostep → one trace.** A `tell` that triggers a parse that
posts a `frameReady` that drives three transitions is **one trace** with several `ihsm.step`
children — not several traces.

### 4.1.1 Macrostep ownership of enqueues (the precise rule)

Every enqueued task is tagged at enqueue time with the **id of the macrostep currently
executing**:

- Enqueue happens **while a microstep of macrostep M is running** (a handler/hook calls
  `this.notify.x()` / `notifyNow` / a synchronous `defer(0)`): the new task **belongs to M**. It
  becomes a later `ihsm.step` in M's trace.
- Enqueue happens **while the actor is idle** (an external caller invokes `actor.notify.x()` or
  `actor.call.x()` between macrosteps): it **starts a new macrostep** (new trace), linked to its
  cause if that cause is known (e.g. a sending actor — §4.7).
- A **future** task (a real timer / `defer(ms>0)`) fires later when the actor is idle: it starts
  a **new macrostep**, with a span **link** back to the macrostep that scheduled it (§4.7).

This rule is deterministic (it depends only on the event order, which DST already fixes) and is
implemented by the core hook in doc 5.

> Edge case — an external event delivered *during* an async gap of a running macrostep joins that
> macrostep (the actor is "busy"). This is rare, deterministic, and documented; if an embedding
> needs strict isolation it can quiesce the actor between requests.

---

## 4.2 The span tree

A macrostep produces this tree (children present according to `TraceLevel`, §4.8):

```
ihsm.macrostep #onSocketData                         ← ROOT — the whole cascade, one trace
│   actor.uuid, actor.name, trigger, state.start→state.end, steps, transitioned, outcome
├── ihsm.step #onSocketData            (seq 0)       ← microstep 1 (the trigger)
│   │   event, state, handler.state, verdict
│   ├── ihsm.port write                              ← awaited I/O the handler performed
│   └── ihsm.transition Reading → Parsing
│       ├── ihsm.exit  Reading
│       └── ihsm.entry Parsing
├── ihsm.step #doParseFrame            (seq 1)       ← microstep 2 (self-posted by seq 0)
│   └── …                                              └─ LINK ← caused-by seq 0
└── ihsm.step #onFrameReady            (seq 2)       ← microstep 3
    └── ihsm.transition Parsing → Reading
        ├── ihsm.exit  Parsing
        └── ihsm.entry Reading                       ← machine stable here → root ends
```

Span roles:

| Span | Represents | Kind |
|------|-----------|------|
| `ihsm.macrostep {trigger}` | the full dispatch until stability — **the trace root** | see §4.3 |
| `ihsm.step {event}` | one RTC turn (handler execution + its transition) | `INTERNAL` |
| `ihsm.transition {from}→{to}` | the LCA exit/entry walk | `INTERNAL` |
| `ihsm.exit {state}` / `ihsm.entry {state}` | one `onExit` / `onEntry` action | `INTERNAL` |
| `ihsm.port {method}` | a port I/O call a handler made — **always a span inside the caller's trace, never a new trace**; brackets the await when the port is awaited | `INTERNAL`, or `CLIENT` if it leaves the process |
| `ihsm.service {name}` | an awaited `call` the actor is *serving* | `INTERNAL`/`SERVER` (§4.3) |
| `ihsm.await {target}` | in the **caller**: the suspension while awaiting another **actor's** `call` — the cross-actor "await path" (§4.7) | `CLIENT` |

Names are **low-cardinality templates**; identity lives in attributes (§4.4–4.5), never the name.

---

## 4.3 Span kinds

The root span's kind encodes *what woke the actor*:

| Trigger of the macrostep | Root `SpanKind` | Why |
|--------------------------|-----------------|-----|
| Inbound **cross-process** request/notification | `SERVER` | the actor is serving a remote caller (its own trace, linked to the caller — §4.7) |
| Local **`call`** (awaited request/response, same process) | `SERVER` | request/response semantics |
| Local **`notify`** from embedding code or another in-process actor (fire-and-forget) | `INTERNAL` | no remote peer |
| **Timer / `defer`** firing | `INTERNAL` (link to scheduler) | self-scheduled |
| Initial `initialize` cascade at `makeActor` | `INTERNAL` | bootstrap |

The macrostep root is **always a new trace root**, never a child of the caller; callers and
callees are joined by bidirectional links (§4.7), not by nesting. A port call that performs
network/process I/O, and the caller-side `ihsm.await` span, are `CLIENT`. All other ihsm spans are
`INTERNAL`.

---

## 4.4 Resource vs span attributes (clarified)

A frequent confusion: **there is no such thing as a per-span "resource attribute".** OTEL splits
identity into two scopes:

- **`Resource`** — describes the **process/agent** emitting telemetry. Attached **once** to the
  provider and shared by **every** span, log (and future metric) in that process. It must be
  *constant for the process lifetime*. An actor instance is **not** resource-level (a process runs
  many actors), so actor identity is **never** on the Resource.
- **Span attributes** — describe **one span**. This is where per-actor, per-state, per-event,
  per-instance facts live — including the actor UUID.

### 4.4.1 Resource — the minimal, justified set

Required (all environments):

| Key | Example | Why required |
|-----|---------|--------------|
| `service.name` | `cbserver` | identifies the service in every backend; OTLP requires it |
| `service.version` | `0.0.2` | correlate behaviour with releases |
| `service.instance.id` | `7f3c…` (UUID, per process/tab) | distinguishes replicas/tabs of the same service |
| `telemetry.sdk.name` / `.language` / `.version` | `opentelemetry` / `nodejs`\|`webjs` / `1.x` | auto; `language` is the SDK-level server-vs-browser marker |
| `ihsm.version` | `0.1.1` | the runtime version — explains behaviour/attribute changes across upgrades |
| `ihsm.otel.version` | `0.2.0` | the instrumentation version |

Recommended (when known): `service.namespace` (e.g. `mmkit`), `deployment.environment.name`
(`dev`/`staging`/`prod`).

Server-only (cheap detectors): `host.name`, `process.pid`, `process.runtime.name`,
`process.runtime.version`, `os.type`. Add `container.id` / `k8s.*` / `cloud.*` **only** when a
detector finds them.

Browser-only: `browser.brands`, `browser.platform`, `browser.mobile`, `user_agent.original`, and
the ihsm-specific `ihsm.host.kind` (`extension-host` | `web-worker` | `page`).

> Everything else an operator might want to slice by — actor type, state, environment of a
> *handler*, request id — is a **span attribute** or **baggage**, not Resource.

### 4.4.2 Span attributes — required vs optional (the part to get right)

To answer "are they all required?": **no.** Only three keys are required on *every* span; the
rest are required only on the span type that owns them, and a third tier is optional/verbose.

**Tier 1 — required on every ihsm span** (the backbone; three keys):

| Key | Type | Source | Purpose |
|-----|------|--------|---------|
| `ihsm.actor.uuid` | string (UUID) | `hsm.actorUuid` (§4.5) | **the** per-instance query key — fetch all spans/traces/logs for one actor instance |
| `ihsm.actor.name` | string | `hsm.actorName` | machine type — aggregate across instances |
| `ihsm.state` | string | `currentStateName` at span start | the leaf state when the span opened |

That is enough to filter any span to one instance, one type, and know its state. Everything below
is *additive context*, not required for correlation.

**Tier 2 — required on the span that owns it:**

| Span | Key | Type | Meaning |
|------|-----|------|---------|
| macrostep | `ihsm.macrostep.id` | string | unique per macrostep; the join key between a trace and its logs |
| macrostep | `ihsm.trigger` | string | triggering event/service name |
| macrostep | `ihsm.trigger.kind` | string | `external`\|`call`\|`self`\|`actor`\|`timer`\|`init` |
| macrostep | `ihsm.state.start` / `ihsm.state.end` | string | leaf at trace start / at stability |
| macrostep | `ihsm.transitioned` | bool | did the cascade change state at all |
| macrostep | `ihsm.steps` | int | number of microsteps in the cascade |
| macrostep | `ihsm.outcome` | string | `ok` \| `error` |
| step | `ihsm.event` | string | the event/service this turn handled |
| step | `ihsm.step.seq` | int | 0-based order within the macrostep |
| transition | `ihsm.transition.from` / `.to` | string | endpoints |
| exit/entry | `ihsm.hook.kind` (`onExit`/`onEntry`), `ihsm.hook.state` | string | which action on which state |
| port | `ihsm.port.method` | string | the port method |
| service | `ihsm.service.name` | string | the service handled |
| await | `ihsm.peer.uuid` / `ihsm.peer.name` | string | the callee actor this await is suspended on (forward-link target — §4.7) |

**Tier 3 — optional, gated by `TraceLevel` ≥ DEBUG / opt-in:**

| Span | Key | Meaning |
|------|-----|---------|
| step | `ihsm.handler.state` | the ancestor state whose prototype actually supplied the handler (reveals **P**-verdict delegation) |
| step | `ihsm.handler.verdict` | `B`/`E`/`G`/`U`/`P` outcome — top triage attribute |
| step | `ihsm.event.queue` | `default`\|`priority`\|`timer` |
| step | `ihsm.event.argc` | argument count (never the values, §4.4.3) |
| step | `ihsm.async` | did the turn suspend on `await` |
| transition | `ihsm.transition.lca` | least-common-ancestor where the walk pivots |
| transition | `ihsm.transition.exit_depth` / `.entry_depth` | hook counts |
| transition | `ihsm.transition.cache` | `hit`\|`miss` of the compiled-transition cache |
| port | `ihsm.port.async` | returns a Promise |
| port | `ihsm.port.spawned.uuid` / `.name` | for child-spawn factories — links to the created child (§4.7) |
| service | `ihsm.service.timeout_ms` / `.timed_out` | for `ServiceCallOptions` timeouts |
| any | `ihsm.actor.path` | hierarchical path (e.g. `CBServer/CBConnection[3]/reader`) — human tree nav |
| any | `ihsm.clock` | `wall`\|`virtual` — flags DST runs where durations are not real time |

### 4.4.3 Payload policy

`eventPayload` values are **never** attached by default (PII/size). `ihsm.event.argc` (a count)
is the safe default. An opt-in `redact(event, payload) → attributes` hook lets an author surface
only the specific, safe fields they choose.

---

## 4.5 Deterministic actor identity (UUID from a seed)

R2 needs a stable per-instance UUID that is **identical across deterministic replays** and lets
Grafana collect everything for one instance. The design uses **content-addressed UUIDv5 over a
deterministic actor path** — *not* RNG draws (which would shift if earlier code consumed a
different number of randoms).

```
runNamespace = uuidv5(IHSM_NAMESPACE, runSeed)          // IHSM_NAMESPACE is a fixed constant UUID
actorPath(root)  = actorName                            // e.g. "CBServer"
actorPath(child) = actorPath(parent) + "/" + childName + "[" + spawnIndex + "]"
actorUuid        = uuidv5(runNamespace, actorPath)
```

- `runSeed` is supplied by the DST harness (deterministic) or randomly generated once per process
  (production). It is also recorded on the Resource as `ihsm.run.seed` (server) for traceability.
- `spawnIndex` is the 0-based order in which a parent spawned children of a given kind — already
  deterministic under DST.
- Therefore `actorUuid` is a pure function of `(runSeed, machine topology)`: **the same scenario
  replays to the same UUIDs**, and two different runs (different seeds) never collide.
- `actorName` and `actorPath` are derived deterministically too; both are exposed on `Properties`
  (doc 5 [CORE-2]).

Why UUIDv5-over-path beats a seeded RNG draw: it is *position-independent* — adding telemetry, or
an unrelated `random()` call elsewhere, cannot change an actor's UUID. It is also *meaningful*:
the path tells you where the actor sits in the tree.

**Grafana consequence (R2 satisfied):** every span and every log carries `ihsm.actor.uuid`, so
`{ .ihsm.actor.uuid = "…" }` in Tempo (and the same in Loki) returns the complete history of one
instance, across all its macrosteps, in or out of DST.

---

## 4.6 Asynchronous handling

A microstep may `await` (async handler/hook/port I/O). Three things must stay correct across the
suspension: the macrostep root stays open, the step span brackets the whole awaited turn, and
nested spans nest correctly — **in the browser too**, where there is no `AsyncLocalStorage`.

The design makes async correctness independent of the platform context manager:

1. **Boundaries come from the runtime, not from timing.** The redesigned seam (doc 5) calls
   `onMicrostepBegin` *before* the (possibly async) turn and `onMicrostepEnd` *after* its promise
   settles. `@ihsm/otel` opens the `ihsm.step` span on begin and ends it on end — so the span
   brackets the entire awaited turn by construction.
2. **Parent resolution is explicit.** Each actor keeps a small **macrostep record**
   `{ rootSpan, currentStepSpan, macrostepId }` keyed by the actor. Child spans (transition,
   hook, port) resolve their parent from this record — *not* from `context.active()`. So even if
   ambient context is lost across an `await` (browser `StackContextManager`), nesting is correct.
3. **Ambient context is still set for interop.** Around each span, `@ihsm/otel` does
   `context.with(setSpan(ctx, span), …)` so that *stock* instrumentation a handler triggers
   (e.g. a `fetch`) nests under the step. On Node, `AsyncLocalStorageContextManager` restores this
   across awaits; on the browser it covers the synchronous portion. ihsm's own spans never depend
   on it (point 2), so the browser is fully correct regardless.
4. **The macrostep root ends at stability, not at the first await.** Because the root closes on
   `onMacrostepEnd` (mailbox drained), an async cascade that suspends repeatedly still yields one
   root span whose duration is the real end-to-end settling time.

Because ihsm serializes the mailbox, there is never more than one in-flight microstep per actor,
so there is no intra-actor span interleaving to disambiguate.

---

## 4.7 Span links — separate traces, bidirectionally connected

**Every actor macrostep is its own trace.** There is *no* merged request/reply trace — not for
in-process calls, not across the wire. Traces stay bounded to one actor's settling (so a deep
supervisor→connection→reader chain never produces one giant trace), and actors are connected by
**bidirectional span links** instead of nesting. This is a deliberate departure from conventional
single-trace distributed tracing, chosen for trace-size hygiene and the actor invariant (R0).

### 4.7.1 Caller-minted callee context (enables forward links everywhere)

Strict parent/child still applies *within* one macrostep (step → its transition → hooks → port).
Across actors we use links — and to make those links **bidirectional** (caller→callee *and*
callee→caller) the **caller mints the callee's macrostep root `SpanContext` deterministically**
*before* sending, and threads it in the `CauseRef.carrier` (doc 5 §5.6). The recipient adopts
that exact context as its macrostep root. Both sides therefore know each other's span context and
each records a link to the other:

- sender span → `ihsm.link.kind = causes`, `ihsm.peer.uuid`, `ihsm.peer.name`
- callee root → `ihsm.link.kind = caused_by`, `ihsm.peer.uuid`, `ihsm.peer.name`

Determinism: the minted ids come from the seeded id stream keyed by `(callerMacrostepId,
enqueueSeq)`, so replays produce identical trace/span ids. Implementation cost: the minted context
is **passed by parameter** (on the enqueued task → `cause.carrier`), and adopted onto the callee
root span via a custom OTEL `IdGenerator` with a tiny **synchronous override slot** — the one piece
of non-trivial plumbing this model needs (mechanism and safety argument in doc 5 §5.6).

### 4.7.2 Ports are always internal to the caller (never a new trace)

A **port** is I/O internal to the calling handler. A port call **always** produces an
`ihsm.port {method}` span *inside the caller's own trace* — it **never** starts a new trace and
**never** becomes a cross-trace await. When the port is awaited, the `ihsm.port` span simply
brackets the suspension; it nests in the enclosing `ihsm.step` (which stays open across the await,
§4.6). If a port's work happens to *spawn or call another actor*, that other actor still settles
in its **own** trace, linked back to this `ihsm.port` span (the `spawn`/`causes` rows in §4.7.4) —
but the port span itself stays put in the caller.

### 4.7.3 The cross-actor await path (caller side)

When the caller **awaits another actor's** `call` (`await X.call.foo()`), the caller opens an
**`ihsm.await {target}`** span (`SpanKind.CLIENT`) that brackets the suspension — *this is the
traced cross-actor await path*. It:

- spans `[call → reply resolves]`;
- carries the forward link (`causes`) to the callee macrostep root, and is the target of the
  callee's backward link (`caused_by`) — full bidirectional navigation;
- nests inside the enclosing `ihsm.step` (which stays open across the await, §4.6).

When the caller does **not** await (`notify`, fire-and-forget), there is no `ihsm.await` span; the
forward link rides the enqueuing `ihsm.step` instead, and the callee links back to that step.

### 4.7.4 Span size when awaited

The `ihsm.await` span equals the callee's whole trace **iff the service replies at stability**.
By default the reply is sent when the service handler returns, so the await span is
`[call → reply]` and the callee's trailing drain (if any) lives in the callee's own linked trace.
A service may opt into **`replyAtStable`** to defer its reply until its macrostep settles, making
the await span identical in size to the callee trace — at the cost of making the caller wait for
the full cascade. Not the default; opt-in per service.

### 4.7.5 The other link relationships

| Relationship | Mechanism | Link attributes |
|--------------|-----------|------------------|
| Microstep → the later microstep it enqueued (same macrostep) | the later `ihsm.step` links back to the enqueuing step | `ihsm.link.kind=cause` |
| Macrostep → a future macrostep it scheduled via timer/`defer` | the timer-triggered macrostep links back to the scheduling macrostep | `ihsm.link.kind=timer`, `ihsm.defer.delay_ms` |
| Actor A `notify`s actor B (no await) | bidirectional: A's step ↔ B's macrostep root (caller-minted context, §4.7.1) | `causes` / `caused_by`, `ihsm.peer.uuid` |
| Parent **spawns** child | bidirectional: parent `ihsm.port` span ↔ child `initialize` macrostep root | `spawn` / `caused_by`, `ihsm.peer.uuid` |
| Actor A `await`s B's `call` | bidirectional: A's `ihsm.await` span ↔ B's macrostep root (§4.7.3) | `causes` / `caused_by`, `ihsm.peer.uuid` |
| Cross-**process** call/notify | same model over the wire envelope; W3C `traceparent`/`tracestate` also carried so a backend *may* optionally stitch | `causes` / `caused_by` (+ `traceparent`) |

The rule in one line: **every actor settles in its own trace; callers and callees are joined by
bidirectional links, and an awaited call additionally gets an `ihsm.await` span tracing the
suspension.**

---

## 4.8 Span events (point-in-time facts)

Events record sub-step moments without adding spans, keeping the tree shallow and the timeline
rich. The set is deliberately **minimal** — four events, no bookkeeping noise:

| Event | On span | Attributes | When | Level |
|-------|---------|-----------|------|-------|
| `ihsm.handler.found` | step | `state` (the state class that supplied the handler) | **before** the handler runs — marks resolution and the exact defining state (reveals **P**-verdict delegation when `state ≠ ihsm.state`) | always |
| `ihsm.unhandled` | step / macrostep | `event`, `state` | event reached `onUnhandled` (**U** verdict) | always |
| `exception` | failing span | `exception.type/message/stacktrace` | via `recordException` (§4.9) | always |
| `ihsm.note` | nearest open span | `message`, `ihsm.domain`, `ihsm.domain.path` (structured frame stack, §4.10.3) | a handler `this.hsm.log.*` / trace line attached to the timeline | DEBUG |

`ihsm.handler.found` is the single, canonical resolution marker (replacing a verbose lookup-walk):
one event per turn, emitted just before execution, carrying the state in which the handler was
located. Guard-rejection and invariant-assertion events are intentionally **not** emitted — guard
throws still surface through the error path (`exception` + `ihsm.error.kind`, §4.9). Causality
between an enqueue and the turn it spawns is carried by **span links** (§4.7), not by a per-enqueue
event; empty-swallow (**E**), skipped hooks, and live trace-level changes are not eventized.

The verbosity lever stays simple: **span count is structural (always on); the only level-gated
event is `ihsm.note`.** At `PRODUCTION` the macrostep/step/transition skeleton is still complete
(it comes from the structured seam, not from `TraceWriter` strings).

---

## 4.9 Status and exceptions

- Success: `StatusCode.OK` set explicitly on `ihsm.step`, `ihsm.transition`, `ihsm.service`, and
  the macrostep root.
- Failure: on the error seam, set `StatusCode.ERROR` on the innermost open span **and** the
  macrostep root, call `recordException(err)`, and add:
  - `ihsm.error.kind` — the ihsm error class (`UnhandledEventError`, `TransitionError`,
    `EventHandlerError`, `CallTimeoutError`, `SelfCallDeadlockError`, `InitializationError`, …).
  - `ihsm.error.phase` — `lookup` | `handler` | `transition` | `onEntry` | `onExit` |
    `unhandled` | `initialize`.
  - `ihsm.error.recovered` — whether `onError`/`onUnhandled` recovered or it rethrew.
- The macrostep `ihsm.outcome=error` mirrors the status for cheap filtering. Error traces are
  always retained at the SDK (100% default sampling, R10); a collector *may* apply additional
  tail-sampling policies downstream.

---

## 4.10 Logs

Logs use the OTEL **Logs** signal (not console), so they are span-correlated and OTLP-shipped.

### 4.10.1 The handler logger (`this.hsm.log.*`)

ihsm exposes a **severity-typed logger** on the handler context. Inside any handler/hook:

```ts
this.hsm.log.info("frame accepted", { "frame.seq": n, "frame.bytes": len });
this.hsm.log.debug("queue depth", { depth });
this.hsm.log.warn("dropping duplicate frame", { id });
this.hsm.log.error(err);                 // Error or string + optional attributes
```

Each method emits a **structured `LogRecord`** (doc 5 §5.2) — a body string plus typed attributes
— routed through the `onLog` seam to the OTEL Logs bridge. The bridge stamps the active OTEL
context (→ `trace_id`/`span_id`) and the Tier-1 attributes automatically, so a user only passes
what is *extra*. The method names map one-to-one to OTEL **SeverityNumber**:

| Method | OTEL Severity (Number) | Typical use |
|--------|------------------------|-------------|
| `log.trace` | `TRACE` (1) | per-frame / per-byte detail |
| `log.debug` | `DEBUG` (5) | queue depths, branch decisions |
| `log.info`  | `INFO` (9)  | state-meaningful events |
| `log.warn`  | `WARN` (13) | **E**-verdict swallow, back-pressure, retry |
| `log.error` | `ERROR` (17)| recovered failure, `dispatchErrorCallback` |
| `log.fatal` | `FATAL` (21)| `FatalError` / `InitializationError` |

**Explicit user logs fire on intent — they are *not* gated by `TraceLevel`** (an `info` is a
real event, not debug spew). They are still no-ops when no provider/`onLog` is attached, so cost
stays zero in plain production. Runtime-*derived* lines (below) remain `TraceLevel`-gated.

### 4.10.2 Record shape and sources

| Concern | Rule |
|---------|------|
| Correlation | Every record is emitted with the **active OTEL context**, so it carries `trace_id`/`span_id` — one click from a log line to its span, and vice-versa. |
| Required attributes | `ihsm.actor.uuid`, `ihsm.actor.name`, `ihsm.state`, `ihsm.event`, `ihsm.macrostep.id`, `ihsm.step.seq` — logs are filterable by the **same** keys as spans, including the per-instance UUID (R2/R5). |
| Structured header | The trace header is a **frame stack** (§4.10.3), promoted to `ihsm.domain.path` (string array) — no string re-parsing. |
| Body | The human string (`{domain.path joined}{currentStateName}: {message}`) — structure lives in attributes, never parsed from the body. |
| Severity | `this.hsm.log.*` sets it directly (table above). Runtime-derived lines map from intent + `TraceLevel`: VERBOSE frame lines → `TRACE`/`DEBUG`; DEBUG boundaries → `DEBUG`; state-enter/transition → `INFO`; **E**-verdict/back-pressure → `WARN`; `dispatchErrorCallback` → `ERROR`; `FatalError`/`InitializationError` → `FATAL`. |
| Sources | `this.hsm.log.*` (primary, structured), ihsm runtime trace lines (gated), and direct `provider.getLogger(name).info(...)` for non-actor code. |
| Inactivity | no-op when no provider/`onLog` is attached; runtime-derived lines additionally no-op at `TraceLevel.PRODUCTION`. |
| **Sampling** | **100% by default (R10)** — every record the bridge emits is exported; no log sampler drops records unless explicitly configured. |
| Browser | same Logs API; OTLP via fetch; flushed on `visibilitychange`. |

### 4.10.3 Structured trace header (frame stack)

The native `traceHeader` string (`#ping|execute|`) becomes a **structured stack** of frames so
the bridge never parses text:

```ts
interface TraceFrame { name: string; kind: "event" | "handler" | "transition"
  | "onEntry" | "onExit" | "port" | "service" | "initialize"; }
```

`Properties.traceFrames: readonly TraceFrame[]` is the live stack; `Properties.traceHeader: string`
remains as a derived getter (backward compatible). On every log/`ihsm.note`, the frame stack is
emitted as `ihsm.domain.path` (low-cardinality array) and the innermost frame as `ihsm.domain`
— giving the same "where in the dispatch am I" context that the string carried, but queryable.

---

## 4.11 Querying in Grafana (what this design buys)

| Question | TraceQL (Tempo) / LogQL (Loki) |
|----------|-------------------------------|
| Every trace for one actor instance | `{ .ihsm.actor.uuid = "7f3c…" }` |
| Every log for one actor instance | `{ihsm_actor_uuid="7f3c…"}` |
| All error macrosteps of a machine type | `{ .ihsm.actor.name = "CBConnection" && .ihsm.outcome = "error" }` |
| Where did anything transition into the fatal state | `{ .ihsm.transition.to = "FatalErrorState" }` |
| Slow settling: macrosteps over 50 ms with > 5 microsteps | `{ name = "ihsm.macrostep" && duration > 50ms && .ihsm.steps > 5 }` |
| One macrostep's logs | `{ihsm_macrostep_id="…"}` (or pivot from the trace's `trace_id`) |
| The actor sub-tree | filter by `ihsm.actor.path =~ "CBServer/CBConnection\\[3\\].*"` |

Trace↔log correlation works two ways: by shared `trace_id` (OTEL-native) **and** by
`ihsm.actor.uuid` / `ihsm.macrostep.id` (domain-native), so the views compose.

---

## 4.12 Other OTEL features used

- **Instrumentation scope**: tracers named `@ihsm/otel/runtime` (lifecycle/dispatch/transition)
  and `@ihsm/otel/port` (I/O), versioned — backends show which library produced a span.
- **Baggage** (W3C): cross-cutting dimensions set at the edge (`tenant`, `request.id`) propagate
  with context; an allow-list may *promote* selected baggage keys to span attributes (never
  automatically, to bound cardinality).
- **TraceState**: preserved/forwarded across the wire for vendor sampling decisions.
- **Resource & SchemaURL**: the resource (§4.4.1) is stamped with the OTEL semconv schema URL so
  backends interpret standard keys correctly; `ihsm.*` keys are documented in `semconv.ts`.
- **Trace sampling (R10)**: **`ParentBased(AlwaysOn)` by default** — 100% of root traces are
  sampled; child spans follow the parent decision so an inbound cross-process trace keeps the whole
  downstream macrostep. DST runs force always-on + `localOnly`. Sub-100% head sampling is opt-in
  only (explicit config), never the default.
- **Log sampling (R10)**: **none by default** — 100% of log records produced by the bridge are
  exported when the `LoggerProvider` is active (`TraceLevel` still gates runtime-derived lines).
- (**Exemplars** are deliberately left for the metrics revision; the trace IDs they will reference
  already exist on every span.)
