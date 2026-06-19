# 3. PROPOSED ARCHITECTURE

This document is the structural overview. The **trace/log design** is doc 4; the **callback
redesign and core changes** are doc 5. Scope: traces and logs.

---

## 3.1 A new package: `@ihsm/otel`

A workspace sibling of `@ihsm/core` and `@ihsm/tools`. Peer-depends on `ihsm`,
`@opentelemetry/api`, and `@opentelemetry/api-logs`. No hard dependency on a specific exporter —
SDK wiring lives behind environment subpaths so the same logic runs on **server** (production
telemetry) and in the **browser** (development/debug). The shared core is isomorphic; each
environment subpath supplies only the SDK edges and its default posture (§3.5).

```
@ihsm/otel
├── src/
│   ├── index.ts            # public API: instrumentActor, OtelProvider, SemConv, author helpers
│   ├── provider.ts         # SDK lifecycle: TracerProvider + LoggerProvider (no MeterProvider yet)
│   ├── resource.ts         # process/agent resource assembly (see doc 4 §4.4)
│   ├── instrument.ts       # instrumentActor(): binds the (redesigned) observation seam to OTEL
│   ├── macrostep.ts        # the per-macrostep root span + microstep child spans (doc 4 §4.2)
│   ├── transition.ts       # transition + onEntry/onExit hook spans (from TransitionTracer)
│   ├── logs.ts             # LogRecord→OTEL Logs bridge: severity→SeverityNumber, frames→ihsm.domain.path (doc 4 §4.10)
│   ├── propagation.ts      # W3C inject/extract + caller-minted SpanContext IdGenerator (doc 4 §4.7)
│   ├── identity.ts         # deterministic actor UUID derivation (doc 4 §4.5) — consumer side
│   ├── semconv.ts          # frozen ihsm.* attribute-key constants
│   └── env/
│       ├── node.ts         # SERVER/production: OTLP/HTTP(+gRPC), AsyncLocalStorage, OS/process resource, PRODUCTION default
│       └── browser.ts      # BROWSER/dev-debug: OTLP/HTTP via fetch + sendBeacon + optional console, StackContextManager, DEBUG default
└── package.json            # exports: "." (isomorphic core) · "./node" (server) · "./browser" (dev/debug)
```

> No `metrics.ts` in this revision. `provider.ts` is structured so a `MeterProvider` and an
> instrument suite can be added behind the same `OtelProvider` later without touching callers.

---

## 3.2 The single integration point

An author instruments an actor with one call. Nothing is patched; everything is reversible.

```typescript
// ── Server (production telemetry) ───────────────────────────────────────────
import { createProvider } from "@ihsm/otel/node";
import { instrumentActor, otelActorOptions } from "@ihsm/otel";

const provider = createProvider();                       // PRODUCTION posture (§3.5.1)
provider.init(provider.resolveConfig({ enabled: true, serviceName: "cbserver" }));

const actor = ihsm.makeActor(CBServerTop, ctx, new CBServerPort(), otelActorOptions(provider));
// or, for an already-created actor:
const detach = instrumentActor(actor, { provider });
detach.dispose();   // removes the observation seam, no residue
await provider.shutdown();

// ── Browser (development/debug) ─────────────────────────────────────────────
import { createProvider } from "@ihsm/otel/browser";
// DEBUG verbosity, 100% sampling, console + (optional) local OTLP collector:
const dev = createProvider();
dev.init(dev.resolveConfig({ enabled: import.meta.env.DEV, serviceName: "cb-web", console: true }));
const actor = ihsm.makeActor(AppTop, ctx, new AppPort(), otelActorOptions(dev));
```

Same `instrumentActor`/`otelActorOptions` API in both; only the imported `createProvider` and its
defaults change. In a shipped production browser bundle, leave the browser provider out entirely
(or `enabled: false`) → the seam is a no-op and the code tree-shakes away.

`instrumentActor` binds the **redesigned observation seam** (doc 5) to OTEL objects:

| Bound seam | Produces |
|------------|----------|
| macrostep begin/end | the **root span** of the trace (opens on stimulus, closes at stability) |
| microstep begin/end | one **child span per RTC turn**, opened/closed around the (possibly async) turn |
| transition + hooks | transition span and per-state `onEntry`/`onExit` child spans |
| enqueue (with cause) | **span links** between a turn and the turns it spawns |
| error | span status `ERROR` + `recordException` |
| structured log record | an OTLP **log** correlated to the active span |

It returns a `Disposable` that detaches all of the above.

`otelActorOptions(provider)` is sugar that pre-wires the same seam through `makeActor`'s
`ActorOptions`, for the common "instrument from birth" case (and so the macrostep boundary is
observed for the very first `initialize` cascade).

---

## 3.3 Layering

```
        ┌──────────────────────────── actor author ─────────────────────────────┐
        │  makeActor(Top, ctx, port, otelActorOptions(provider))                  │
        │  handlers optionally call span()/event()/setAttr() (no-op when inactive)│
        └───────────────────────────────────┬─────────────────────────────────────┘
                                             │ observes (supported seam — doc 5)
   ┌──────────────────┬─────────────────┬────┴────────────┬───────────────────────┐
   │ macrostep/micro  │ transition+hooks │ enqueue→links   │ error · structured log │
   │ boundary observer│  observer        │  observer       │  observer              │
   └────────┬─────────┴────────┬─────────┴───────┬─────────┴───────────┬───────────┘
            ▼                   ▼                 ▼                     ▼
        Tracer (root + child spans)        (span links)            Logger (logs)
            └──────────── OTEL Context (AsyncLocalStorage on node / explicit on browser) ─────┘
                                          │ OTLP exporter (env subpath)
                                          ▼
                                   Collector → Tempo / Loki  (queried in Grafana by actor UUID)
```

Key property: **the trace topology is decided by the observation seam, not by where spans happen
to be created.** Because the seam reports macrostep and microstep boundaries explicitly, the root
span can span the entire cascade regardless of async suspension — this is what makes R0 and R3
achievable without prototype patching.

---

## 3.4 Provider lifecycle

`OtelProvider` (isomorphic interface; `createProvider()` per environment) owns:

- `init(config)` / `isActive()` / `flush()` / `shutdown()` — SDK start/stop (lifted from the
  mmkit prototype, generalized; **no** `MeterProvider`).
- `resolveConfig(overrides)` — merge defaults → `OTEL_*` env → `IHSM_OTEL_*` env → code overrides.
  **Defaults include 100% trace sampling** (`ParentBased(AlwaysOn)`) and **no log sampling** (R10).
- `getLogger(name, attrs)` — the trace-correlated OTLP logger.
- `tracer(scope)` — tracers resolved from the provider's *own* `TracerProvider` (never the global
  `trace.getTracer`), preserving the one correct, load-bearing idea from the prototype.
- `probeCollector(...)` — readiness probe (kept).

---

## 3.5 Two deployment targets, one schema

The span/log **schema is identical** in both environments (same attributes, same UUIDs, same
trace shape — doc 4), so a trace looks the same wherever it was produced. What differs is the
**intended posture** and the SDK edges.

### 3.5.1 Posture — server is production, browser is development/debug

| | `@ihsm/otel/node` — **server** | `@ihsm/otel/browser` — **browser** |
|--|--------------------------------|-------------------------------------|
| **Purpose** | The **production observability target**: continuous telemetry from long-running services, shipped to a collector and queried in Grafana. | A **development/debug aid**: understand and troubleshoot actor behavior while building a browser app. **Not** intended as a production browser-telemetry pipeline. |
| **Default verbosity** | `TraceLevel.PRODUCTION` (structural spans only; detail events off) — bounded cost. | `TraceLevel.DEBUG` (rich span events + frame-level logs) — density over cost, because sessions are short and developer-driven. |
| **Default sampling** | **100% (always-on)** — `ParentBased(AlwaysOn)`; every trace exported by default. | **100% (always-on)** — same default; a developer wants every trace for the flow under inspection. |
| **Default exporters** | OTLP to a collector (batched). | OTLP to a **local/dev collector** *and* an optional **console/diagnostic** exporter so traces and logs are visible in DevTools without any backend. |
| **Lifecycle** | Process-scoped; flush on shutdown signals. | Page-scoped; flush on page hide; trivially toggled per dev session via `IHSM_OTEL_*` / a runtime flag. |
| **When off** | The default in prod-prod: no provider attached → zero cost. | Disabled in shipped/production browser bundles by default; enabled explicitly for debugging. |

The browser bridge is deliberately scoped to the **inner development loop** — it is the
high-density "watch the machine think" tool, not a fleet-telemetry channel. Keep it out of
production browser builds (tree-shakeable: importing only `@ihsm/otel` with no
`@ihsm/otel/browser` provider yields a no-op seam).

### 3.5.2 Wiring differences (the SDK edges)

| Concern | `@ihsm/otel/node` | `@ihsm/otel/browser` |
|---------|-------------------|----------------------|
| Trace exporter | OTLP/HTTP-proto (gRPC opt-in), batched | OTLP/HTTP-json via `fetch`; `navigator.sendBeacon` for the final flush; optional `ConsoleSpanExporter` for DevTools |
| Log exporter | OTLP/HTTP-proto | OTLP/HTTP-json; optional console logger |
| Context manager | `AsyncLocalStorageContextManager` (restores context across `await`) | `StackContextManager` (sync only) — async correctness comes from the seam, not the context manager (doc 4 §4.6) |
| Resource detection | `service.*`, `process.*`, `os.*`, `host.*`, container/k8s when present | `service.*`, `browser.*`, `user_agent.original`, `ihsm.host.kind = "browser"` |
| Flush triggers | `SIGTERM`/`SIGINT`/`beforeExit` → `forceFlush` + `shutdown` | `visibilitychange→hidden` / `pagehide` → beacon flush |
| Constraints | none notable | CORS-enabled collector; smaller batches; no gRPC |

The browser's lack of `AsyncLocalStorage` is the only architecturally interesting difference, and
doc 4 §4.6 shows why the macrostep-seam design makes it a non-issue: the root and current spans
are resolved from a per-actor record keyed by macrostep id, not from ambient async context. So the
browser build loses nothing in **trace fidelity** — it differs only in posture and transport.

---

## 3.6 What the architecture deliberately defers

- **Metrics.** Out of scope; the provider and seam are forward-compatible.
- **Sub-100% sampling.** The SDK defaults to 100% for traces and logs (R10). Operators may
  configure head or tail sampling explicitly; that is never the default posture.
- **Backend dashboards.** Doc 4 §4.10 gives the Grafana query shapes; provisioning is out of
  scope.
