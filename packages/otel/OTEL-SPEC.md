# OTEL-SPEC — OpenTelemetry integration for `ihsm`

Status: Draft 2 · Target runtime: `ihsm` 0.1.1 (+ proposed additive core hooks) · Scope of this
revision: **traces and logs only** (metrics deferred to a later revision).

This specification is split into focused documents under [`./spec`](./spec). Read in order:

| # | Document | Contents |
|---|----------|----------|
| 1 | [`spec/01-AS-IS.md`](./spec/01-AS-IS.md) | What exists today — the native `ihsm` observability seams and the `mmkit` prototype, with an honest assessment of why neither is sufficient. |
| 2 | [`spec/02-REQUIREMENTS.md`](./spec/02-REQUIREMENTS.md) | The goals only. The central requirement: **one trace = one complete dispatch, from external stimulus until the machine is stable.** |
| 3 | [`spec/03-PROPOSED-ARCHITECTURE.md`](./spec/03-PROPOSED-ARCHITECTURE.md) | The `@ihsm/otel` package, its layering, the single `instrumentActor` seam, and server-vs-browser wiring. |
| 4 | [`spec/04-TRACE-AND-LOG-DESIGN.md`](./spec/04-TRACE-AND-LOG-DESIGN.md) | **The core.** Macrostep/microstep trace model, the deterministic actor UUID, resource vs span attributes (clarified and minimized), async handling, span links, span events, status, and the log model — designed to use the full OTEL feature set and to be queried per-actor-instance in Grafana. |
| 5 | [`spec/05-IMPLEMENTATION-STRATEGY.md`](./spec/05-IMPLEMENTATION-STRATEGY.md) | The redesign of the `ihsm` tracing/log callbacks and the minimal additive core changes required, phased for delivery. |
| 6 | [`spec/06-TEST-ARTIFACTS.md`](./spec/06-TEST-ARTIFACTS.md) | **Test contract.** `OtelSignal[]` capture, processor output shape (Grafana-like traces/logs), and conformance assertions. |

## The one idea to keep in mind

> A statechart reacts to an external event by running a **macrostep**: a cascade of internal
> microsteps (run-to-completion turns, transitions, entry/exit actions, self-posted events) that
> continues until the machine reaches a **stable** configuration with an empty mailbox.
>
> **One macrostep is one OTEL trace.** Every microstep, transition, hook, handler, and port call
> within it is a span in that single trace. This is what makes "watch the machine move through
> its states, end to end" a first-class, queryable artifact.

Metrics are intentionally out of scope for this revision; the seams in doc 5 are designed so a
metrics layer can be added later without further core changes.
