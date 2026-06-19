# 1. AS-IS — `ihsm` seams and the `mmkit` prototype

This document records what exists today, so the requirements (doc 2) and design (doc 4) can be
read against a precise baseline. Two things exist: (a) the **native observability surface of
`ihsm` 0.1.1**, and (b) a **working-but-fragile OTEL prototype in `mmkit`**.

---

## 1.1 `ihsm` 0.1.1 — the native observability surface

`ihsm` already exposes hooks that let an observer watch a machine without touching its internals.
All are exported from `ihsm` / `ihsm/types`.

| Seam | Shape | Fires / yields | Notes |
|------|-------|----------------|-------|
| `TraceLevel` | enum `PRODUCTION=0`, `DEBUG=1`, `VERBOSE_DEBUG=2` | — | Selects the dispatch implementation. At `PRODUCTION` the runtime emits **no** `_trace*` calls at all. |
| `TraceWriter.write(hsm, msg)` | interface; set via `ActorOptions.traceWriter` or live `hsm.traceWriter` | Every runtime trace line during dispatch, plus handler `traceWriter.write(this, msg)` | `msg` is a **string** (human line) or an arbitrary object (e.g. an `Error`). Designed for console debugging, not structured export. |
| `Properties` snapshot | `currentState(Name)`, `topState(Name)`, `ctxTypeName`, `traceHeader`, `eventName`, `eventPayload`, `traceLevel` | Readable inside `write()` and from handlers | The `traceHeader` is the live **domain stack** string, e.g. `#ping\|execute\|`. |
| `hsm.subscribe(observer)` → `Disposable` | `EventObserver = (msg:{event,payload}) => void` | **Once per dispatched service/notification**, at *enqueue* time (`recordObserverEvent` inside `dispatchService` / `dispatchNotification`) | The closest thing to a "a dispatch is starting" signal — but it fires at enqueue, not at execution start/end. |
| `TransitionTracer` | `traceTransitionStart`, `traceHookDone`, `traceHookSkipped`, `traceHookError`, `traceTransitionDone` | Around the LCA exit/entry walk of a transition | Structured (not string). Currently wired internally for the debug/verbose dispatch styles via `createTransitionTracer`. |
| `dispatchErrorCallback(hsm, err)` | injected via `ActorOptions` | On any dispatch failure (handler throw, transition error, unhandled) | Default writes a line then rethrows. |
| `buildProtocolIndex(top)` | `ProtocolIndex { slots: Map<name,{bucket,name}> }` | On demand | Enumerates every protocol member and its bucket (`services` / `notifications` / `internalNotifications`). |
| `kHandlerMachine` (symbol) | `symbol` on handler instances | — | Lets you reach the owning machine from a state/port instance. Internal-ish; acceptable only at install time. |

### 1.1.1 The run-to-completion (RTC) execution model — why it matters here

- The machine owns a **serialized mailbox**. One task runs to completion before the next starts.
- A handler may itself enqueue work: `this.notify.x()` / `this.notifyNow.x()` (priority queue) /
  `this.hsm.port.defer(ms)` (timer queue). These do **not** run inline; they are appended and run
  as *later* tasks in the same drain.
- A transition runs `onExit` (leaf→LCA) then `onEntry` (LCA→leaf); any of those hooks may post
  further events.
- Handlers and hooks may be **async** (`await` a port call); the runtime awaits them before the
  next task — so a single turn can suspend on I/O while still being one RTC unit.

The consequence: reacting to one external event is generally **not one turn** — it is a *cascade*
of turns (a statechart **macrostep**) that ends only when the mailbox drains and the machine is
**stable**. Nothing in the current API marks the start or end of that cascade.

### 1.1.2 What the native surface does *not* give us

1. **No macrostep boundary.** There is no "actor went busy" / "actor returned to idle" signal.
   `subscribe` fires per enqueue; `TransitionTracer` fires per transition. Neither delimits the
   *cascade* that a single external event triggers.
2. **No execution-time microstep boundary.** `subscribe` fires at enqueue, not when the task is
   actually picked up and run (and finished). You cannot, from the public API, bracket "this turn
   started / this turn ended" — which is exactly where a span must open and close.
3. **No stable actor identity.** There is no `actorName` / `actorId` / instance UUID on the
   machine. Names must be reconstructed by reflection over the prototype chain.
4. **`TraceWriter` is string-first, and there is no severity-typed logger.** It is built for
   human-readable console output; the structured facts (event, state, transition endpoints) are
   *formatted into* the string, not passed as data. The `traceHeader` is likewise a single
   **string** (the domain stack `#ping|execute|`), so its frames must be re-parsed. Handlers have
   no `log.info()/.debug()/…` surface that maps to OTEL severities — everything is one untyped
   `traceWriter.write(this, msg)`. Driving structured spans/logs from this means string coupling.
5. **No causal link between an enqueue and the turn it later produces.** When a handler posts
   `this.notify.y()`, nothing records "y was caused by the handler for x" for later correlation.

These five gaps are the substance of the core-change proposal in doc 5.

---

## 1.2 The `mmkit` prototype (`mmkit/packages/base/src/otel/`)

A real, shipping integration. Useful parts and fragile parts, separated honestly.

### 1.2.1 What it does well (keep)

| Area | File | Assessment |
|------|------|------------|
| SDK lifecycle (init / flush / shutdown / probe) | `internal.ts`, `collector.ts` | Solid. `NodeTracerProvider` + `LoggerProvider`, OTLP/HTTP exporters, batch vs sync export switch, collector readiness probe. |
| **Logs** | `internal.ts` | Good and directly reusable. OTLP logs API, severity mapping, every record emitted with `context.active()` so it carries the active `trace_id`/`span_id`. |
| **Cross-process trace propagation** | `internal.ts`, `lsp-protocol` | Good. W3C `traceparent`/`tracestate` injected into LSP/admin message params, extracted on receive, with fail-open root creation (`TraceContext.fromMeta`). |
| Resolves its own tracer from its own provider | `internal.ts` (`tracerFor`) | Correct and load-bearing — avoids a foreign global provider swallowing spans in the VS Code extension host. |

### 1.2.2 Why it is "not good enough"

1. **It monkey-patches private runtime internals.** `patchDispatchFromMachine()` walks
   `Object.getPrototypeOf` twice to reach `HsmObject.prototype` and overwrites `enqueueTask` /
   `unshiftHiPriorityTask` to carry trace context across the queue. This couples to ihsm's
   *internal* task shape; an ihsm refactor silently breaks tracing or perturbs scheduling.
2. **It re-defines state/port prototype methods** (`wrapPrototypeMethod`, `@TraceState`,
   `@TracePort`, `@TraceRoutine`) and must defend against double-bundling with name-based
   `TopState` detection. Wrapping methods on shared prototypes risks changing `this`/arity and —
   if a wrapper throws — **dispatch ordering**, threatening determinism.
3. **Its trace unit is wrong for the goal.** Spans are anchored per *turn* (`actor.dispatch`
   lazily created on first handler run), with cross-turn causality left implicit in the patched
   context capture. There is **no macrostep** — no single trace that follows one external event
   through the whole state cascade to stability. This is the central thing this spec changes.
4. **Reflection-based actor naming** (`inferActorNameFromPrototype`, union-find path compression)
   is a workaround for the missing core identity, and it fails for anonymous/minified classes.
5. **No per-instance identity for querying.** You cannot ask a backend "show me every trace for
   *this* actor instance" — there is no stable instance id on the telemetry.
6. **Low information density and string-coupling.** Span names like `actor.state.enter X.Y` with
   few attributes; structured facts are recovered from `TraceWriter` strings.
7. **It lives in `mmkit`, not `ihsm`.** Every ihsm user would re-implement it.

### 1.2.3 Net

The SDK plumbing, the log bridge, and the wire propagation are worth lifting almost verbatim.
The **span model** (per-turn, patch-anchored, reflection-named) must be discarded and replaced
with a macrostep-oriented model built on *supported* seams — which requires the small additive
core hooks in doc 5.
