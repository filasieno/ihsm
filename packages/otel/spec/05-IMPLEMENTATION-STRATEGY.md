# 5. Implementation strategy — redesigning the `ihsm` observation callbacks

Doc 4 specifies *what* the telemetry must look like. This document specifies *how* to make
`ihsm` able to produce it: a **redesign of the tracing/log callback surface** and the **minimal,
additive core changes** that the macrostep model and the deterministic UUID require, plus a
phased delivery plan and the consumer-side mapping in `@ihsm/otel`.

The guiding constraint (R6/R7): every change is an **observation point** or **identity**, never a
change to scheduling, ordering, or computed values. No prototype patching anywhere.

---

## 5.1 Why the current callbacks are insufficient

From doc 1 §1.1.2, the four existing seams cannot, between them, express a macrostep:

| Existing seam | What it gives | What it lacks for doc 4 |
|---------------|---------------|-------------------------|
| `subscribe`/`EventObserver` | fires once per dispatch, **at enqueue** | not the *execution* start/end; no idle→busy (macrostep) boundary; no cause |
| `TransitionTracer` | structured transition + hook lifecycle | only transitions; nothing about the turn or the cascade |
| `dispatchErrorCallback` | error notification | no error *phase*/*class* classification |
| `TraceWriter` | string lines with a `Properties` snapshot | string-shaped; structure must be re-parsed; gated off at PRODUCTION |
| (none) | — | **macrostep begin/end**, **microstep begin/end**, **enqueue causality**, **stable actor identity** |

So the redesign introduces **one cohesive `Instrumentation` interface** that supersedes the ad-hoc
combination, and adds **deterministic actor identity** to the runtime. The legacy seams remain for
back-compat and console debugging.

---

## 5.2 The redesigned callback surface (core)

A single optional observer, passed through `ActorOptions` and inherited by children. All methods
optional; all are pure observers wrapped by the runtime in a non-throwing guard.

```typescript
// ihsm core — new public types

export interface ActorIdentity {
  readonly uuid: string;        // deterministic UUIDv5 over path (§4.5) — the Grafana key
  readonly name: string;        // machine type, e.g. "CBConnection"
  readonly path: string;        // "CBServer/CBConnection[3]/reader"
  readonly kind: EmbodimentKind;// root | inbound | child | test
  readonly parentUuid?: string;
}

export type TriggerKind = "external" | "call" | "self" | "actor" | "timer" | "init";
export type DispatchPhase =
  | "lookup" | "handler" | "transition" | "onEntry" | "onExit" | "unhandled" | "initialize";

export interface MacrostepBegin { id: string; actor: ActorIdentity; trigger: string;
  triggerKind: TriggerKind; startState: string; cause?: CauseRef; }
export interface MacrostepEnd   { id: string; endState: string; steps: number;
  transitioned: boolean; outcome: "ok" | "error"; }

export interface MicrostepBegin { macrostepId: string; seq: number; event: string;
  bucket: ProtocolBucket; queue: NotificationQueue; fromState: string;
  handlerState?: string; cause?: CauseRef; }
export interface MicrostepEnd   { macrostepId: string; seq: number; toState: string;
  transitioned: boolean; async: boolean; outcome: "ok" | "error"; }

export interface EnqueueInfo { event: string; queue: NotificationQueue; delayMs?: number;
  byStepSeq?: number; targetUuid?: string;
  cause: CauseRef; /* the task.cause the runtime stamped; the bridge may fill cause.carrier here */ }

export interface CauseRef { actorUuid: string; macrostepId?: string; stepSeq?: number;
  kind: "cause" | "timer" | "message" | "spawn" | "wire"; carrier?: Record<string,string>; }

export interface DispatchError { phase: DispatchPhase; errorClass: string; error: Error;
  recovered: boolean; }

export interface TraceFrame { name: string;
  kind: "event"|"handler"|"transition"|"onEntry"|"onExit"|"port"|"service"|"initialize"; }

export type LogAttributes = Record<string, string | number | boolean>;

export interface LogRecord {
  severity: "trace"|"debug"|"info"|"warn"|"error"|"fatal"; // → OTEL SeverityNumber (doc 4 §4.10.1)
  body: string;
  attributes?: LogAttributes;             // user-supplied extras (Tier-1 added by the bridge)
  frames: readonly TraceFrame[];          // structured domain stack → ihsm.domain.path
  error?: Error;                          // set for log.error / log.fatal
  source: "user" | "runtime";             // this.hsm.log.* vs gated runtime trace lines
}

// severity-typed logger surfaced on the handler context as `this.hsm.log`:
export interface ActorLogger {
  trace(message: string, attributes?: LogAttributes): void;
  debug(message: string, attributes?: LogAttributes): void;
  info (message: string, attributes?: LogAttributes): void;
  warn (message: string, attributes?: LogAttributes): void;
  error(message: string | Error, attributes?: LogAttributes): void;
  fatal(message: string | Error, attributes?: LogAttributes): void;
}

export interface Instrumentation<C extends ActorConfig = ActorConfig> {
  onActorCreated?(id: ActorIdentity): void;
  onActorDisposed?(id: ActorIdentity): void;
  onMacrostepBegin?(info: MacrostepBegin): void;
  onMacrostepEnd?(info: MacrostepEnd): void;
  onMicrostepBegin?(info: MicrostepBegin): void;
  onMicrostepEnd?(info: MicrostepEnd): void;
  onEnqueue?(info: EnqueueInfo): void;
  onError?(info: DispatchError): void;
  onLog?(record: LogRecord): void;          // structured log channel (Phase 2)
  transition?: TransitionTracer;            // reuse the existing structured transition hooks
}

// threaded in options, inherited by makeChildActor:
export interface ActorOptions<C> { /* …existing… */ instrumentation?: Instrumentation<C>; }
```

This is the contract `@ihsm/otel` binds to. It expresses **exactly** the doc-4 model:
macrostep/microstep boundaries (R0/R1), enqueue causality for links (§4.7), error classification
(§4.9), and a structured log channel (§4.10) — without any string parsing or patching.

---

## 5.3 Where each hook is raised in the runtime

Grounded in the current `packages/ihsm/src/internal/runtime.ts`:

| Hook | Insertion point | Mechanics |
|------|-----------------|-----------|
| `onActorCreated` | `spawnActor` (and `makeChildActor`) after identity is minted (§5.4) | once per actor |
| **macrostep begin** | the mailbox **drain loop**, when a task is dequeued while the actor was idle (queues were empty and nothing running) | set `currentMacrostep = { id, seq:0 }`; raise `onMacrostepBegin` |
| **microstep begin** | immediately before the runtime runs a dequeued `Task` (the existing `task(done)` invocation) | raise `onMicrostepBegin` with `seq`, `event`, `fromState=currentStateName` |
| **microstep end** | inside the task's `done` continuation (after the awaited handler+transition settle) | raise `onMicrostepEnd` with `toState`, `transitioned`, `async`, `outcome` |
| **macrostep end** | after `done`, when default+priority queues are empty | raise `onMacrostepEnd`; clear `currentMacrostep` → actor idle |
| `onEnqueue` | inside `dispatchNotification` / `dispatchService` / timer `defer` enqueue | copy the current `dispatchContext` token (`{actorUuid, macrostepId, stepSeq}`) onto the new `Task` as `task.cause` (§5.6.3 — covers both self-posts and cross-actor sends); raise `onEnqueue` with `byStepSeq` |
| `transition.*` | already produced by `executeTransitionRoutine` via `createTransitionTracer` | route the configured `instrumentation.transition` into the routine's `tracer` option instead of (or alongside) the console tracer |
| `onError` | the `dispatchErrorCallback` path; classify `phase` from the active domain and `errorClass` from the thrown ihsm error type | raise before the existing rethrow; does not change recovery |
| `onLog` (user) | `this.hsm.log.*` calls (CORE-F) | emit a `LogRecord{ source:"user" }` with the chosen `severity`, `frames` = live trace-frame stack, user `attributes`; **not** `TraceLevel`-gated |
| `onLog` (runtime) | `_traceWrite` when `msg` is a string (Phase 2) | `LogRecord{ source:"runtime" }`; derive `severity` from domain/level; `TraceLevel`-gated; existing `TraceWriter` still called |

State the runtime must track (tiny, per-actor, already mostly present): `currentMacrostep?: {id,
seq}`, an idle flag (derivable from queue sizes + running flag), and a per-actor macrostep
counter for ids. `async` is known because the runtime already distinguishes a `Promise`-returning
handler/hook (it awaits it).

### 5.3.1 Trigger-kind and cause derivation

- `triggerKind`: `timer` if the dequeued task came from the timer queue; `init` during the
  bootstrap descent; `call` if the dispatched slot bucket is `services`; otherwise `external`
  when enqueued from an external handle while idle, or `self` when the macrostep id was inherited
  from a running step. `actor` when a `CauseRef` with `kind:"message"` was attached by the sender.
- `cause`: read uniformly from `task.cause`, which the runtime stamps at enqueue from the ambient
  `dispatchContext` token (§5.6.3). For `timer`/`defer` the token captured when the timer was armed
  is used; for a cross-actor `notify`/`call` it is the sending actor's running step. The runtime
  attributes the cause itself — no caller-side envelope helper and no user-API change.

---

## 5.4 Deterministic actor identity (core)

Implements §4.5. Additive, no behavioural effect.

- Add a process/run config `runSeed: string` (DST harness sets it; production generates one and
  records it). Compute `runNamespace = uuidv5(IHSM_NAMESPACE, runSeed)` once.
- At `spawnActor`: `path = actorName` (from `topStateName` minus `Top`, or an explicit
  `ActorName`); `uuid = uuidv5(runNamespace, path)`.
- At `makeChildActor`: the parent assigns a deterministic `spawnIndex` per child *kind*;
  `path = parent.path + "/" + childName + "[" + spawnIndex + "]"`; `uuid = uuidv5(runNamespace,
  path)`; `parentUuid = parent.uuid`.
- Expose read-only on `Properties` / `Hsm`: `actorUuid`, `actorName`, `actorPath`. This retires
  the reflection-based naming from the mmkit prototype.

UUIDv5-over-path (not a seeded RNG draw) guarantees **position independence**: the UUID depends
only on `(runSeed, tree position)`, so replays match and unrelated `random()` calls cannot shift
it. `randomUUID()` from the seeded `RandomService` remains available for payload ids but is *not*
used for actor identity.

---

## 5.5 Consumer mapping in `@ihsm/otel`

`instrumentActor(actor, { provider })` installs an `Instrumentation` that maintains a per-actor
**macrostep record** `{ rootSpan, currentStepSpan, macrostepId, seq, links }` and maps callbacks
to OTEL:

| Callback | OTEL action |
|----------|-------------|
| `onActorCreated` | cache `ActorIdentity`; pre-build the Tier-1 attribute bag (`ihsm.actor.uuid/name`) |
| `onMacrostepBegin` | start `ihsm.macrostep` as a **new trace root** adopting the caller-minted `SpanContext` from `cause.carrier` (custom `IdGenerator`, §5.6); add a `caused_by` link to the caller span; set Tier-2 macrostep attrs; store as `rootSpan` |
| (caller side) port I/O | open an `ihsm.port` span under the current step **in the caller's own trace** (never a new trace); end it when the port call resolves (§4.7.2) |
| (caller side) awaited cross-actor `call` | open an `ihsm.await` span (`CLIENT`) under the current step; end it when the reply resolves (§4.7.3). The mint + `causes` link + `cause.carrier` are written in `onEnqueue` (below), so the `ihsm.await` span is just the timing/back-link target |
| `onMicrostepBegin` | start `ihsm.step` as child of `rootSpan` (parent resolved from the record, **not** ambient context → browser-correct, §4.6); link to `cause` step if present; add the `ihsm.handler.found` event with `state = handlerState` **before** the turn executes (§4.8); `context.with(setSpan(step))` for interop |
| `transition.*` | start `ihsm.transition` under the current step; `ihsm.exit`/`ihsm.entry` per hook (`traceHookSkipped` is ignored — skipped default hooks are not eventized) |
| `onEnqueue` | **Self-post** (same actor): remember `(event→stepSeq)` so the future step links back with `ihsm.link.kind=cause`. **Cross-actor / spawn** (`cause.kind ∈ {message, spawn, wire}`): mint the callee root id pair, write `cause.carrier = {mint*, caller*}` onto the delivered cause (§5.6.1 step 2), and add the `causes` forward link to the enqueuing step (or to the `ihsm.await` span for an awaited call). No per-enqueue span event |
| `onMicrostepEnd` | set step status/attrs (`transitioned`, `async`); `step.end()` |
| `onError` | `StatusCode.ERROR` + `recordException` on innermost open span and `rootSpan`; set `ihsm.error.kind/phase/recovered` |
| `onMacrostepEnd` | set `ihsm.state.end`, `ihsm.steps`, `ihsm.transitioned`, `ihsm.outcome`; `rootSpan.end()`; clear record |
| `onLog` | `logger.emit({ severityNumber: map(record.severity), body: record.body, attributes: Tier-1 + macrostep.id + step.seq + ihsm.domain.path(frames) + record.attributes, context: active })`; attach `exception.*` when `record.error` is set |
| `onActorDisposed` | flush per-actor caches |

Because parenthood is taken from the record, **async suspensions never detach a child span** —
the platform context manager is only used to light up third-party instrumentation (R3, §4.6).

**Provider defaults (R10).** `createProvider().resolveConfig()` must wire **`ParentBased(AlwaysOn)`**
as the default trace sampler (100%) and must **not** attach a log sampler. Sub-100% sampling is
opt-in via explicit config/env only.

---

## 5.6 Cross-actor cause threading + bidirectional links (caller-minted context)

Every actor macrostep is its own trace; callers and callees are joined by **bidirectional** links
(doc 4 §4.7). The forward link (caller → callee) is the hard part, because at the moment A sends to
B, **B's macrostep root span does not exist yet** — so A has nothing to point a link at. The fix is
that A *mints* the id B's root will use, points the link there, and B later *adopts* that exact id.

There are **three distinct sub-problems**, and they do **not** all get solved the same way. State
this clearly, because it is the part most likely to be implemented wrong:

| # | Sub-problem | Mechanism | Why |
|---|-------------|-----------|-----|
| (a) | **Mint** B's root id | pure function of `(runSeed, callerMacrostepId, enqueueSeq)` | deterministic (R6); no shared state at all |
| (b) | **Pass** the minted id (+ A's back-ref) to B | **parameter** — carried as data on the enqueued `Task`, surfaced as `MacrostepBegin.cause.carrier` | preferred; possible here, so we use it |
| (c) | **Adopt** the minted id onto B's actual OTEL span | **synchronous slot** read by a custom `IdGenerator` | *only* because the OTEL SDK gives no parameter for this (see 5.6.2) |

> Decision the user asked for, in one line: **passing the context is done by parameter (b),
> because it is possible; the only "global" is the tiny synchronous id slot (c), and only because
> the OTEL `IdGenerator` API physically has no other entry point.**

### 5.6.1 Step by step — one `notify` A→B (the awaited `call` case is identical plus an `ihsm.await` span)

1. **(runtime, CORE-B) attribute the cause.** When A's handler runs `B.notify.x()`, the call is
   synchronous inside A's currently-executing microstep. The runtime reads the **current dispatch
   token** (the existing `dispatchContext` ALS, extended to `{ machine, macrostepId, stepSeq }`)
   and attaches a `CauseRef{ actorUuid:A.uuid, macrostepId, stepSeq, kind:"message" }` **onto the
   `Task` object it pushes onto B's mailbox**. From here the cause is plain data on a parameter —
   no globals (detailed in 5.6.3).
2. **(bridge, A side) mint + forward-link.** `@ihsm/otel`'s `onEnqueue` for A sees the new
   enqueue. It computes the deterministic id pair `mint = idgen(runSeed, A.macrostepId, seq)`,
   adds a link `{ context: mint, attributes: { "ihsm.link.kind":"causes", "ihsm.peer.uuid":B } }`
   to A's current `ihsm.step`, and writes **both** ids into the
   carrier: `cause.carrier = { mintTraceId, mintSpanId, callerTraceId, callerSpanId }`. (In-process
   it could instead re-derive A's span from its own records; writing them is simplest and is what
   cross-process needs anyway.)
3. **(runtime) deliver.** B dequeues the `Task`; the runtime raises `onMacrostepBegin` with
   `cause = { …, carrier }` — a normal parameter, nothing ambient.
4. **(bridge, B side) adopt + back-link.** B's `onMacrostepBegin`:
   1. `idGen.nextOverride = { traceId: carrier.mintTraceId, spanId: carrier.mintSpanId }`
   2. `const root = tracer.startSpan("ihsm.macrostep …", { root: true })`  ← synchronous; the SDK
      calls `idGen.generateTraceId()`/`generateSpanId()` **in this same tick**, which return the
      override, then the bridge clears the slot.
   3. `root.addLink({ context: { traceId: carrier.callerTraceId, spanId: carrier.callerSpanId },
      attributes: { "ihsm.link.kind":"caused_by", "ihsm.peer.uuid":A } })`.

   Now A's `causes` link and B's `caused_by` link point at each other's real spans — fully
   bidirectional — and B's trace id/span id were known to A before B ran.

### 5.6.2 Why (c) cannot be a parameter, and why the slot is nevertheless safe

OTEL-JS's `IdGenerator` interface is `{ generateTraceId(): string; generateSpanId(): string }` —
**no context or options argument**. `tracer.startSpan()` offers no "use this id" field either. So
there is *no* parameter path to force a span's own id; a tiny shared slot on the generator is the
only public-API mechanism. It is safe because the set→start→clear sequence in 5.6.1 step 4 is
**fully synchronous with no `await` between the assignment and `startSpan`**, and JS is
single-threaded — nothing can interleave and consume the wrong override. (Constructing the SDK
`Span` directly with a chosen id is the alternative; rejected — it reaches into non-public SDK
internals.) The slot lives on the bridge's *own* `TracerProvider`, never the global one.

### 5.6.3 (#2) The cause-attribution seam, with an example

**Problem.** B's `dispatchNotification` (runtime.ts:1837) currently has no idea who called it — the
user-facing `B.notify.x(args)` signature has no room for a cause, and we will **not** pollute it.

**Mechanism (CORE-B).** Reuse the existing ambient dispatch token. ihsm already wraps each running
task in `dispatchContext` (`AsyncLocalStorage<{machine}>`, runtime.ts:739/1582) for deadlock
detection. Extend the token to `{ machine, macrostepId, stepSeq }`, and in `recordObserverEvent` /
`dispatchNotification` / `dispatchService`, read the *current* token and copy it onto the created
`Task` as `task.cause`. The callee's `onMacrostepBegin` reports `task.cause`. (Today this token is
created lazily and only off-`PRODUCTION`; CORE-B must keep it active whenever `instrumentation` is
attached, independent of `TraceLevel`.) On Node the token follows the handler across `await`
(ALS); the browser dev build runs the synchronous path (a
handler's `notify` call executes inside its microstep) and falls back to "no cause" only for the
rare post-`await` cross-actor send — acceptable for a debug aid.

**Example.** A `CBConnection`'s reader, mid-step, parses a frame and notifies the parser actor:

```ts
// inside CBConnection.Reading.onData(...) — this is CBConnection's microstep, stepSeq=2
this.frames.notify.onFrame(frame);     // user code, unchanged
```

What the runtime does, with no change to the call site:

```
dispatchContext token at this instant = { machine: CBConnection, macrostepId: "M7", stepSeq: 2 }
→ frames.dispatchNotification("onFrame", [frame], "default")
    task.cause = { actorUuid: CBConnection.uuid, macrostepId: "M7", stepSeq: 2, kind: "message" }
    push task onto frames' mailbox
…later, frames drains M-frames:
→ onMacrostepBegin({ id:"M_frames", cause: task.cause })   // the parser learns it was caused by CBConnection M7/step2
```

The bridge then resolves `CBConnection`'s step-2 span from its own per-actor record and draws the
bidirectional links. **No user API changed; no new global; the cause rides the Task as data.**

### 5.6.4 (#3) `replyAtStable`, with an example

**Problem.** A service `call` resolves its reply the instant the service handler returns
(`createServiceTask(…, resolve, reject)`, runtime.ts:1832–1834) — i.e. at the end of *that one
microstep*. If the handler posted follow-ups, B keeps draining after the reply, so A's `ihsm.await`
span (`[call → reply]`) is **shorter** than B's full macrostep trace. Usually fine (the link still
connects them), but sometimes you want the await span to equal the callee trace exactly (doc 4
§4.7.3).

**Mechanism (CORE-G, opt-in).** Mark a service `replyAtStable`. Instead of handing `resolve`
straight to the service task, the runtime **parks** it and calls it at **macrostep end** (the same
idle point that raises `onMacrostepEnd`). No ordering/RTC change — only the moment the already-
computed reply value is delivered moves later. Off by default.

**Example.**

```ts
// default: reply fires when sendRequest returns
await conn.call.sendRequest(req);
//        └─ resolves here ─┐
//  conn keeps writing + awaiting ack in follow-up microsteps (in conn's own trace)
//  A.ihsm.await = [call → sendRequest returns]  (shorter than conn's macrostep)

@service({ replyAtStable: true })           // opt-in
async sendRequest(req) { /* … posts follow-ups … */ return ack; }
//  now A.call.sendRequest resolves only when conn is fully stable
//  A.ihsm.await = [call → conn macrostep end]  ≡ conn's whole trace (identical size)
```

So `replyAtStable` trades caller latency (A waits for B's full cascade) for an await span whose
duration is identical to the callee trace — exactly the §4.7.3 guarantee, made explicit and
opt-in rather than imposed on every service.

### 5.6.5 Spawn and cross-process (same model)

- **Spawn**: the spawn port method runs inside A's step span; the runtime attributes the child's
  first (`initialize`) macrostep cause to that step (5.6.3), and the child `initialize` adopts the
  minted context and back-links to the parent `ihsm.port` span. `CauseRef.kind = "spawn"`.
- **Cross-process**: identical, but the carrier travels in the wire envelope and `WireSession`
  also injects W3C `traceparent`/`tracestate` (lifted from mmkit) so a backend *may* optionally
  stitch; the default rendering is two linked traces. `CauseRef.kind = "wire"`.

---

## 5.7 Phased delivery

**Phase 0 — works on `ihsm` 0.1.1 today (no core change).** Approximate macrosteps from existing
seams: `subscribe` marks dispatch starts; the top-level `#event` push/pop in `TraceWriter`'s
`traceHeader` (at `TraceLevel.DEBUG`) approximates microstep boundaries; `TransitionTracer` +
`dispatchErrorCallback` fill transitions/errors; actor identity falls back to reflection +
`randomUUID`. **Limitations:** requires DEBUG level, boundaries are heuristic, UUIDs are not
replay-stable. Ships value immediately; clearly labelled provisional.

**Phase 1 — the target (CORE: §5.2 `Instrumentation` + §5.4 identity).** Real macrostep/microstep
boundaries, deterministic replay-stable UUIDs, enqueue causality, error classification. Delivers
all of doc 4 §§4.1–4.9 and the Grafana queries in §4.11. `@ihsm/otel` drops every Phase-0
heuristic.

**Phase 2 — polish.** Structured `onLog` channel + severity-typed `this.hsm.log.*` logger and the
structured `traceFrames` header (CORE-D/E/F, §4.10) so logs no longer ride the string
`TraceWriter`; live attach of `instrumentation.transition` on a running actor; baggage promotion
allow-list; SchemaURL stamping.

**Later (separate revision) — metrics.** The `Instrumentation` boundaries already provide every
count and duration a metrics layer needs (dispatch/transition/error counts, macrostep/step/port
durations, mailbox depth via queue introspection). No further core change is anticipated.

---

## 5.8 Determinism & test plan

- **D-test (R6).** Run a representative machine through a fixed event script twice — telemetry
  off, and on with an in-memory exporter — and assert the transition trace and all `ctx` outputs
  are byte-identical. The `Instrumentation` guard must swallow any callback/exporter throw.
- **UUID-stability test (R2).** Run the same DST scenario twice with the same `runSeed`; assert
  identical `ihsm.actor.uuid` on every span. Run with a different seed; assert no collisions.
- **Macrostep-shape test (R0/R1).** Drive one external event that cascades N self-posts; assert
  exactly one trace, one `ihsm.macrostep` root, N `ihsm.step` children with correct `seq`, correct
  `cause` links, and `state.start`/`state.end` matching the machine.
- **Async test (R3).** A handler that awaits a port call; assert the step span brackets the await
  and the macrostep root ends only at stability — verified under the browser `StackContextManager`
  as well as Node `AsyncLocalStorage`.
- **Link test.** Two actors over a mock channel; assert the callee macrostep is a **separate
  trace** with a `caused_by` link to the caller, and the caller span carries the reciprocal
  `causes` link to the callee root (bidirectional, both for awaited `call` — with an `ihsm.await`
  span — and for fire-and-forget `notify`). With the same `runSeed`, assert the minted callee
  trace/span ids are reproducible.

---

## 5.9 Summary of required core changes

| Id | Change | Size | Enables |
|----|--------|------|---------|
| CORE-A | Deterministic actor identity (`uuid`/`name`/`path`) + `runSeed` config; expose on `Properties` | small | R2 (Grafana per-instance), retires reflection naming |
| CORE-B | `Instrumentation` hook in `ActorOptions` with macrostep/microstep/enqueue/error callbacks; track idle/busy + current macrostep id/seq; extend `dispatchContext` token to `{machine, macrostepId, stepSeq}` and copy it onto each enqueued `Task` as `task.cause` (§5.6.3) | medium | R0/R1/R3/R7 + cross-actor cause attribution, no patching |
| CORE-C | Route `Instrumentation.transition` into `executeTransitionRoutine`'s tracer; allow live attach | small | structured transition/hook spans |
| CORE-D | Structured `onLog` channel carrying a `LogRecord` (severity, body, frames, attributes, error, source) | small | R5 logs without string coupling |
| CORE-E | Structured trace header: add `Properties.traceFrames: readonly TraceFrame[]`; keep `traceHeader` string as a derived getter | small | R5 domain frames as data (`ihsm.domain.path`), no re-parsing |
| CORE-F | Severity-typed handler logger `this.hsm.log.{trace,debug,info,warn,error,fatal}` that emits `LogRecord{source:"user"}` to `onLog` (and to `TraceWriter` for console); ungated by `TraceLevel` | small | R5 OTEL-aligned logging API |
| CORE-G | `@service({ replyAtStable: true })` option: park the service `resolve` and fire it at macrostep end instead of handler return (§5.6.4) — opt-in, off by default | small | identical-size `ihsm.await` span (doc 4 §4.7.3) |

All seven are additive and backward compatible: an actor created without `instrumentation` behaves
exactly as today, `traceHeader` keeps its string shape, `this.hsm.log.*` degrades to the existing
`TraceWriter`/console when no provider is attached, and `replyAtStable` is off by default.

The bidirectional-link machinery (§5.6) needs **no further core change** beyond CORE-B's
`task.cause` attribution: the deterministic id minting, the custom `IdGenerator` + synchronous
override slot, and the `ihsm.await` span all live in `@ihsm/otel`, driven entirely by the
`onEnqueue`/`onMacrostepBegin` callbacks and the `cause.carrier` data CORE-B already delivers. The
runtime stays OTEL-ignorant — it forwards an opaque `CauseRef`, nothing more.
