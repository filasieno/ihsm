# 2. REQUIREMENTS (goals)

This document states **only the goals**. No design, no mechanism. Scope of this revision is
**traces and logs**; metrics are explicitly deferred.

## R0 — The defining requirement: one trace per full dispatch

**One OTEL trace must represent one complete dispatch — from the external stimulus that woke the
actor until the actor is stable again (mailbox empty, no transition pending).** Every internal
microstep the stimulus causes — run-to-completion turns, transitions, `onExit`/`onEntry` actions,
self-posted events, awaited port I/O — must appear as spans **within that single trace**, in
causal/temporal order. This is the whole point: *watch the machine move through its states, end
to end, as one artifact.*

## R1 — Full observability of the actor

- The trace must make the **state path** explicit: which state the machine started in, every
  transition taken, every entry/exit action run, and the stable state it ended in.
- For each microstep: which **event** drove it, which **handler** ran (and on which state class,
  including delegation to an ancestor), whether it **transitioned**, and its **outcome**.
- Failures must be first-class: the failing span carries the exception and an ihsm error
  classification; the trace is retained.

## R2 — Per-instance identity, queryable in Grafana

- Each actor **instance** must carry a stable identity that appears on every span and log it
  produces, so an operator can retrieve **all traces and all logs for that single actor
  instance** with one query in Grafana (Tempo/Loki).
- That identity must be a **UUID derived from a well-defined seed**, so that under Deterministic
  Simulation Testing the *same* run produces the *same* UUIDs (reproducible, assertable). Child
  actors derive deterministic UUIDs from their parent + spawn position.
- The logical **actor name** (machine type) must also be present, as a separate low-cardinality
  dimension for aggregation across instances.

## R3 — Correct asynchronous behaviour

- A microstep may suspend on `await` (async handler / hook / port call). The enclosing trace and
  its spans must remain correct across these suspensions — the dispatch trace stays open until
  the machine is actually stable, and child spans nest correctly across awaits.
- This must hold in **both** environments, including the browser where there is no
  `AsyncLocalStorage`.

## R4 — Use the full OTEL trace feature set, structurally

The design must deliberately employ, where each is the right tool:

- **Spans** with `SpanKind`, status, and timing for the macrostep, microsteps, transitions,
  hooks, handlers, services, and port I/O.
- **Span links** for causality that is *not* strict containment, made **bidirectional**
  (caller↔callee) so every actor settles in its own trace yet the choreography stays navigable in
  both directions (which handler caused which later turn; actor messaging; cross-process calls).
- **Span events** for the few point-in-time facts that do not deserve a span (the state in which a
  handler was resolved, an unhandled event, an exception, and handler trace notes).
- **W3C context propagation** across process/worker boundaries, carried alongside the
  caller-minted link context so the sender and the receiving actor's macrostep are joined by
  bidirectional links (and a backend *may* optionally stitch them).
- **Resource** describing the emitting process/agent; **instrumentation scope** identifying the
  ihsm tracers.

## R5 — Logs that are trace-correlated and structured

- Every log record carries the active `trace_id`/`span_id` (one click from log to span) and the
  same structured actor/state/event attributes used on spans (so logs are filterable by the same
  keys, including the per-instance UUID).
- ihsm exposes a **severity-typed logger** on the handler context —
  `this.hsm.log.trace/debug/info/warn/error/fatal(message, attributes?)` — whose methods map
  one-to-one to OTEL log **SeverityNumber** ranges. Explicit user logs are emitted on intent
  (not gated by `TraceLevel`); runtime-derived lines remain `TraceLevel`-gated.
- The **trace header is a structured frame stack** (not a single string), so domain frames become
  attributes/body without re-parsing; the human string is still available as the log *body*.
- Structure lives in attributes, never in parsed text.

## R6 — Determinism preserving (non-negotiable)

- Instrumentation is a **pure observer**. It must never change mailbox ordering, RTC boundaries,
  timer scheduling, randomness, or any value the actor computes. An actor run with telemetry on
  must be bit-identical in its transitions and outputs to the same run with telemetry off.
- An exporter or callback error must never escape into a handler or alter control flow.

## R7 — Attach via supported seams, never by patching

- The integration must bind only to a **supported, documented** observability surface. No
  patching of `HsmObject.prototype`, no re-defining of state/port prototype methods, no hot-path
  reflection. Where the current surface is insufficient (it is — see doc 1 §1.1.2), the gap is
  closed by a **minimal, additive, backward-compatible core change**, not a workaround.

## R8 — Isomorphic, with distinct deployment postures

- The same authoring API and the same trace/log schema work in Node (server) and in the browser
  (extension host, web worker, page), differing only in exporters, resource detection, and
  defaults.
- **Server is the production observability target** (continuous, collector-shipped, bounded cost,
  `PRODUCTION` default). **The browser build is a development/debug aid** (high-density `DEBUG`
  default, console + local-collector export) — *not* a production browser-telemetry pipeline, and
  excluded from shipped production browser bundles by default.

## R10 — 100% default sampling (traces and logs)

- **Trace sampling** MUST default to **100%** in every deployment posture (server and browser).
  The SDK default is `ParentBased(AlwaysOn)` (equivalently: always-on root sampler with ratio
  `1.0`). Head sampling below 100% is **opt-in only** via explicit configuration — never the
  default.
- **Log emission** MUST default to **100%**: when a `LoggerProvider` is active, every log record
  the bridge produces is exported. No log sampler may drop records by default. (Runtime-derived
  lines remain gated by `TraceLevel`; that is verbosity control, not sampling.)
- Downstream collector tail-sampling may exist as an operator choice; it does not change the SDK
  default of full fidelity.

## R9 — Bounded cost and verbosity control

- At `TraceLevel.PRODUCTION` with no provider attached, cost is zero. With a provider attached,
  the **structural** trace (macrostep → microsteps → transitions) is always available; the only
  level-gated span event (`ihsm.note`, handler trace notes) scales with `TraceLevel`. Cost is
  bounded by verbosity (`TraceLevel`), not by default head sampling (R10).
- Attribute cardinality is disciplined: high-cardinality identity (the instance UUID, sequence
  numbers) lives on spans/logs; it must not later leak into metric label sets when metrics are
  added.

## Non-goals (this revision)

- **Metrics** — deferred. The seam design (doc 5) must not preclude adding them later.
- Auto-instrumenting arbitrary handler-internal libraries (DB, fetch, fs) — stock OTEL
  instrumentations cover those.
- Shipping a collector/backend; we target any OTLP endpoint.
- Changing ihsm *semantics*. Proposed core changes add observation points only.
