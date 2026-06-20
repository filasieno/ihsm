# 6. Test artifacts — canonical trace and log shape

This document is the **authoritative shape** for OTEL conformance tests in `@ihsm/otel`.
Tests capture a flat **`OtelSignal[]`** (every observation in order), run a **processor** to
build the final **trace and log views**, then assert quality against doc 4.

Grafana Tempo/Loki are production query targets (doc 4 §4.11); tests do **not** depend on a live
backend. The processed views mirror what an operator sees in Grafana Explore.

---

## 6.1 Pipeline

```
ihsm actor run
    → Instrumentation callbacks (+ optional OTLP in-memory exporter)
    → OtelSignal[]           (append-only, monotonic `at` timestamp)
    → processSignals()       (deterministic reducer)
    → ProcessedTelemetry     { traces, logs }
    → assert* helpers        (conformance vs doc 4)
```

---

## 6.2 `OtelSignal` — the raw list

Every signal is one discriminated object. **`at`** is milliseconds since collector creation
(wall clock in tests; monotonic and ordered).

### 6.2.1 ihsm seam signals (Phase 1 — from `Instrumentation`)

| `kind` | Payload | When |
|--------|---------|------|
| `actor.created` | `actor: ActorIdentity` | `spawnActor` / `makeChildActor` |
| `actor.disposed` | `actor: ActorIdentity` | dispose (Phase 2) |
| `macrostep.begin` | `MacrostepBegin` fields | actor idle → first task of cascade |
| `macrostep.end` | `MacrostepEnd` fields | mailbox drained after cascade |
| `microstep.begin` | `MicrostepBegin` fields | before handler runs |
| `microstep.end` | `MicrostepEnd` fields | after handler + transition settle |
| `enqueue` | `EnqueueInfo` fields | task pushed to mailbox |
| `dispatch.error` | `DispatchError` + `actorUuid` | `dispatchErrorCallback` path |
| `log` | `LogRecord` + `actorUuid`, optional `macrostepId` | `onLog` / `this.hsm.log.*` (Phase 2) |

### 6.2.2 OTLP bridge signals (Phase 1+ — from `@ihsm/otel` span/logger bridge)

| `kind` | Payload | When |
|--------|---------|------|
| `span.start` | `traceId`, `spanId`, `parentSpanId?`, `name`, `kind?`, `attributes` | OTEL `startSpan` |
| `span.end` | `traceId`, `spanId`, `status`, `attributes?` | OTEL `span.end()` |
| `span.event` | `traceId`, `spanId`, `name`, `attributes?` | OTEL span event |
| `span.link` | `traceId`, `spanId`, `linkedTraceId`, `linkedSpanId`, `attributes?` | OTEL span link |

Attribute values in signals: `string | number | boolean | string[]` only (JSON-safe).

---

## 6.3 `ProcessedTelemetry` — the final form tests assert on

### 6.3.1 `ProcessedTrace` (Tempo trace view)

One **macrostep = one trace**. Mirrors Grafana Tempo trace detail:

```typescript
interface ProcessedTrace {
  /** OTEL trace id (hex) when bridge ran; else macrostep id for seam-only tests */
  traceId: string;
  /** Root span name — `<ActorName>.<handler>` (e.g. `Order.submit`) */
  rootSpanName: string;
  /** Tier-1 + macrostep Tier-2 attrs on the root span */
  rootAttributes: Record<string, AttributeValue>;
  /** Wall duration ms (end − start of root), when timestamps available */
  durationMs?: number;
  /** Flat span list, parent-linked */
  spans: ProcessedSpan[];
}
```

```typescript
interface ProcessedSpan {
  spanId: string;
  parentSpanId?: string;
  name: string;                    // e.g. ihsm.step, ihsm.macrostep
  otelKind?: 'INTERNAL' | 'SERVER' | 'CLIENT' | string;
  status: 'ok' | 'error' | 'unset';
  startAt: number;                 // ms offset from collector t0
  endAt?: number;
  attributes: Record<string, AttributeValue>;
  events: ProcessedSpanEvent[];
  links: ProcessedSpanLink[];
}
```

**Required tree shape** (doc 4 §4.2) for a normal dispatch with one transition:

```
{ActorName}.{trigger}                        ← root, one per trace (e.g. Order.submit)
├── ihsm.step {event}                        ← one per microstep, ordered by span start time
│   └── ihsm.transition {from}→{to}         ← optional, under step
│       ├── ihsm.exit {state}               ← optional hooks
│       └── ihsm.entry {state}
```

> **No emitted step sequence.** Sibling `execute ...` spans are ordered by their OTEL start
> timestamp — the order is already implicit in `startTimeUnixNano`, so no `ihsm.step.seq`
> attribute is emitted. (An internal `seq` is still used only to correlate `microstep.begin`
> with its `microstep.end` and to wire intra-macrostep cause links; it never reaches the wire.)

Processor rules:

1. **`macrostep.begin` + `macrostep.end`** with the same `id` → one `ProcessedTrace`.
2. **`microstep.begin/end`** with matching `macrostepId` (paired in run-to-completion order) →
   one `execute ...` span; parent is the macrostep root for that `macrostepId`.
3. **`span.start/end`** from the bridge merge by `traceId`/`spanId`; seam-only tests synthesize
   spans from microstep/macrostep signals when no `span.*` signals exist.
4. **`span.link`** attaches to the source span's `links[]` (bidirectional checks in tests).
5. Root span **`status`** = `error` iff `macrostep.end.outcome === 'error'` or root `span.end`
   status is ERROR.

### 6.3.2 `ProcessedLog` (Loki log line view)

Mirrors Grafana Loki — structured labels + body, correlated by trace:

```typescript
interface ProcessedLog {
  at: number;
  severity: 'TRACE' | 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL';
  body: string;
  traceId?: string;
  spanId?: string;
  /** Flattened labels — LogQL keys from doc 4 §4.11 */
  labels: {
    ihsm_actor_uuid?: string;
    ihsm_actor_name?: string;
    ihsm_macrostep_id?: string;
    ihsm_domain_path?: string;   // joined or JSON array string
    service_name?: string;
    [key: string]: string | undefined;
  };
  attributes: Record<string, AttributeValue>;
}
```

Every log must carry **`ihsm.actor.uuid`** when emitted from an instrumented actor (R2/R5).

### 6.3.3 Authoritative Grafana Tempo wire envelope

The `ProcessedTrace` above is a test-facing reduction. The **authoritative on-the-wire shape** is
the OTLP trace as Grafana Tempo returns it from `GET /api/traces/{id}` — captured live from the dev
stack via the Grafana MCP and reproduced here so the bridge (Phase 2) emits the identical envelope.
ihsm replaces the legacy prototype field names (`actor.*`) with the `ihsm.*` namespace and the
`<ActorName>.<handler>` root / `execute ...` span tree:

```jsonc
{
  "trace": {
    "traceId": "1bd1b2a55d2b3023c19f690ebdbaf242",
    "services": [
      {
        "serviceName": "cbserver",
        "resource": {                              // OTEL Resource — set once per process
          "service.name": "cbserver",
          "service.namespace": "ihsm",
          "service.instance.id": "<actor-or-process uuid>",
          "telemetry.sdk.language": "nodejs",
          "telemetry.sdk.name": "opentelemetry"
        },
        "scopes": [
          {
            "name": "ihsm",                         // instrumentation scope (doc 4 §4.9)
            "spans": [
              {
                "spanId": "1e6be72d571375fa",
                "name": "RootSupervisor.start",     // root: one per macrostep (<ActorName>.<handler>)
                "kind": "SPAN_KIND_SERVER",
                "startTimeUnixNano": "1781814444132000000",
                "endTimeUnixNano":   "1781814444134284882",
                "durationMs": 2.284882,
                "attributes": {
                  "ihsm.actor.uuid": "…", "ihsm.actor.name": "RootSupervisor",
                  "ihsm.state": "Booting", "ihsm.macrostep.id": "…:1",
                  "ihsm.trigger": "start", "ihsm.trigger.kind": "external",
                  "ihsm.state.start": "Booting", "ihsm.state.end": "Ready",
                  "ihsm.steps": 3, "ihsm.transitioned": true, "ihsm.outcome": "ok"
                },
                "status": { "code": "STATUS_CODE_OK", "message": "" }
              },
              {
                "spanId": "57866a8c3734489e",
                "name": "ihsm.step start",          // child step; parentSpanId = root
                "parentSpanId": "1e6be72d571375fa",
                "kind": "SPAN_KIND_INTERNAL",
                "startTimeUnixNano": "1781814444133000000",
                "endTimeUnixNano":   "1781814444133359752",
                "durationMs": 0.359752,
                "attributes": {
                  "ihsm.actor.uuid": "…", "ihsm.actor.name": "RootSupervisor",
                  "ihsm.state": "Booting", "ihsm.event": "start", "ihsm.macrostep.id": "…:1"
                },
                "status": { "code": "STATUS_CODE_OK", "message": "" }
              }
              // … further ihsm.step / ihsm.transition / ihsm.entry / ihsm.exit spans,
              //    plus cross-actor spans linked by span.link (doc 4 §4.7)
            ]
          }
        ]
      }
    ]
  }
}
```

Conformance facts the processor preserves and tests assert, mirroring this envelope:

- spans are grouped under **`services[].resource`** (process-level identity) then **`scopes[].name`**
  (`"ihsm"`); per-actor identity lives in **span attributes** (`ihsm.actor.*`), not the resource,
  because one process hosts many actors;
- `kind` is `SPAN_KIND_SERVER` for the macrostep root and `SPAN_KIND_INTERNAL` for steps/hooks
  (doc 4 §4.3); cross-actor await spans are `SPAN_KIND_CLIENT`;
- `parentSpanId` is **absent on the root** and present on every child;
- ordering is by `startTimeUnixNano` only — there is **no `ihsm.step.seq`**;
- `status.code ∈ { STATUS_CODE_OK, STATUS_CODE_ERROR, STATUS_CODE_UNSET }`.

### 6.3.4 Authoritative Grafana Loki wire envelope

Logs are queried in Grafana Explore (Loki). The authoritative shape is an OTLP LogRecord exported
to Loki: **stream labels** (low-cardinality, indexed) carry the service/severity, while
**structured metadata** carries the high-cardinality trace correlation (`trace_id`, `span_id`,
per-instance `ihsm_actor_uuid`) so a log links straight to its Tempo span:

```jsonc
{
  "stream": {                          // indexed stream labels (low cardinality)
    "service_name": "cbserver",
    "service_namespace": "ihsm",
    "detected_level": "info",
    "scope_name": "ihsm"
  },
  "values": [
    [
      "1781814444133000000",           // ns timestamp
      "frame accepted",                // body (LogRecord.body)
      {                                // structured metadata (per-line, high cardinality)
        "trace_id": "1bd1b2a55d2b3023c19f690ebdbaf242",
        "span_id": "57866a8c3734489e",
        "severity_text": "INFO",
        "severity_number": "9",
        "ihsm_actor_uuid": "…",
        "ihsm_actor_name": "RootSupervisor",
        "ihsm_macrostep_id": "…:1",
        "ihsm_domain_path": "Ready/onSocketData/doParseFrame",
        "frame.seq": "42"              // user attributes from this.hsm.log.info(msg, attrs)
      }
    ]
  ]
}
```

`ProcessedLog.labels` flattens the stream labels; `ProcessedLog.traceId`/`spanId` and the
`ihsm_*` keys come from structured metadata. `assertLogCorrelatesToTrace` checks the `trace_id`
resolves to a `ProcessedTrace` in the same run.

---

## 6.4 Required attributes on processed spans (conformance)

Tests call `assertSpanConforms(span, role)` against doc 4 §4.4.2.

**Tier 1 — every span:**

- `ihsm.actor.uuid`
- `ihsm.actor.name`
- `ihsm.state`

**Tier 2 — by role:**

| Role | Required keys |
|------|----------------|
| macrostep root | `ihsm.macrostep.id`, `ihsm.trigger`, `ihsm.trigger.kind`, `ihsm.state.start`, `ihsm.state.end`, `ihsm.steps`, `ihsm.transitioned`, `ihsm.outcome` |
| step | `ihsm.event`, `ihsm.macrostep.id` |
| transition | `ihsm.transition.from`, `ihsm.transition.to` |
| exit / entry | `ihsm.hook.kind`, `ihsm.hook.state` |

Seam-only Phase 1 tests map `MacrostepBegin`/`MicrostepEnd` fields to these keys in the
processor until the full `@ihsm/otel` bridge stamps OTEL attributes.

---

## 6.5 Quality assertions (what tests check)

| Assert | Requirement |
|--------|-------------|
| `assertOneTracePerExternalStimulus` | one `macrostep.end` per external `notify`/`call` while idle |
| `assertMacrostepShape` | `ihsm.steps` on root === count of `execute ...` children; trigger/outcome match |
| `assertStepsOrderedByStartTime` | sibling `execute ...` spans are non-decreasing in `startAt` (ordering is implicit; no emitted sequence) |
| `assertTier1OnEverySpan` | Tier 1 keys present on every span |
| `assertDeterministicUuid` | same `runSeed` + topology → same `ihsm.actor.uuid` (R2/R6) |
| `assertNoInstrumentationSideEffects` | transitions/outputs identical with instrumentation on vs off (R6) |
| `assertLogCorrelatesToTrace` | log `traceId`/`ihsm_macrostep_id` matches a processed trace (Phase 2) |

> **Observing stability deterministically.** A macrostep closes at the runtime's queue-drain
> point, which lands one microtask *after* `hsm.sync()` resolves. Tests therefore call
> `await settle(collector)` — it advances macrotasks until a full tick passes with no new signal,
> the deterministic proxy for "actor reached stability". Only then is the closing `macrostep.end`
> (and the boundary reset that separates the next external stimulus into its own trace) observable.

---

## 6.6 Example: single `ping` macrostep (seam-only)

**Signals (abbreviated):**

```json
[
  { "kind": "actor.created", "actor": { "uuid": "…", "name": "Ping", "path": "Ping", "kind": "test" } },
  { "kind": "macrostep.begin", "id": "…:1", "trigger": "ping", "triggerKind": "external", "startState": "Ready" },
  { "kind": "microstep.begin", "macrostepId": "…:1", "event": "ping", "fromState": "Ready" },
  { "kind": "microstep.end", "macrostepId": "…:1", "toState": "Ready", "transitioned": false, "outcome": "ok" },
  { "kind": "macrostep.end", "id": "…:1", "endState": "Ready", "steps": 1, "transitioned": false, "outcome": "ok" }
]
```

**Processed trace (conceptual — Tempo tree):**

```
Trace …:1
└─ Ping.ping                    [ihsm.outcome=ok, ihsm.steps=1]
   └─ ihsm.step ping            [ihsm.event=ping, ihsm.state=Ready]   (order by start time)
```

---

## 6.7 Module map

| Module | Role |
|--------|------|
| `@ihsm/otel/testing` → `createIhsmSignalCollector()` | append `OtelSignal` from `Instrumentation` |
| `@ihsm/otel/testing` → `settle(collector)` | await true actor quiescence before asserting |
| `@ihsm/otel/testing` → `processSignals(signals)` | `ProcessedTelemetry` |
| `@ihsm/otel/testing` → `assertTier1OnEverySpan`, `assertMacrostepShape`, `assertStepsOrderedByStartTime`, `assertOneTracePerExternalStimulus`, `findTracesByTrigger` | conformance helpers |

Implementation: `packages/otel/src/testing/`.
