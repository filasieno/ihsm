/**
 * Browser/dev entry point — the development/debug observability target.
 *
 * `startOtelBrowser(config)` wires a `WebTracerProvider` + `LoggerProvider` with OTLP/HTTP-JSON
 * exporters and a `StackContextManager`, then **registers the ihsm collector globally** — the
 * **same** call shape and cross-cutting posture as `@ihsm/otel/node`. The span/log schema is
 * byte-identical to the server (same `ihsm.*` attributes, same deterministic actor UUIDs, same
 * macrostep→trace topology); only the SDK edges and the default posture differ: this build is the
 * high-density "watch the machine think" tool for the inner development loop, not a fleet-telemetry
 * channel.
 *
 * Async trace fidelity does **not** depend on the (synchronous) `StackContextManager`: the bridge
 * resolves the root/current span from its own per-actor macrostep record, never from ambient async
 * context (spec doc 4 §4.6). So the browser build loses nothing in trace shape — it differs only in
 * posture and transport.
 *
 * @example
 * ```ts
 * import { makeActor, Port } from 'ihsm';
 * import { startOtelBrowser } from '@ihsm/otel/browser';
 *
 * const otel = startOtelBrowser({ serviceName: 'cb-web', console: true }); // collector registered globally
 * const actor = makeActor(Top, ctx, new Port(), { initialize: true }); // no tracing wiring needed
 * // … drive the actor; traces/logs appear in DevTools and (if reachable) the local collector …
 * await otel.shutdown(); // unregisters the collector; flush also fires automatically on page hide
 * ```
 */

import { context as otelContext } from "@opentelemetry/api";
import type { Tracer } from "@opentelemetry/api";
import { logs } from "@opentelemetry/api-logs";
import type { Logger } from "@opentelemetry/api-logs";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import {
  defaultResource,
  resourceFromAttributes,
} from "@opentelemetry/resources";
import {
  BatchLogRecordProcessor,
  ConsoleLogRecordExporter,
  LoggerProvider,
  SimpleLogRecordProcessor,
} from "@opentelemetry/sdk-logs";
import type { LogRecordProcessor } from "@opentelemetry/sdk-logs";
import {
  AlwaysOnSampler,
  BatchSpanProcessor,
  ConsoleSpanExporter,
  ParentBasedSampler,
  SimpleSpanProcessor,
  StackContextManager,
  WebTracerProvider,
} from "@opentelemetry/sdk-trace-web";
import type { Sampler, SpanProcessor } from "@opentelemetry/sdk-trace-web";
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
  ATTR_TELEMETRY_SDK_LANGUAGE,
  ATTR_USER_AGENT_ORIGINAL,
} from "@opentelemetry/semantic-conventions";
import {
  ATTR_BROWSER_BRANDS,
  ATTR_BROWSER_LANGUAGE,
  ATTR_BROWSER_MOBILE,
  ATTR_BROWSER_PLATFORM,
} from "@opentelemetry/semantic-conventions/incubating";
import { registerCollector } from "ihsm";
import type { Instrumentation } from "ihsm/types";

import { createOtelInstrumentation } from "../bridge";
import { OverridableIdGenerator } from "../idgen";
import { IHSM_OTEL_VERSION } from "../index";
import { ATTR, SCOPE_RUNTIME } from "../semconv";

export interface StartOtelBrowserConfig {
  /** `service.name` resource attribute — identifies the app in every backend. */
  readonly serviceName: string;
  /** `service.version` resource attribute. */
  readonly serviceVersion?: string;
  /** OTLP/HTTP base endpoint (no path). Default `http://localhost:4318`. A CORS-enabled collector is required. */
  readonly endpoint?: string;
  /** Override the full traces URL (otherwise `${endpoint}/v1/traces`). */
  readonly tracesUrl?: string;
  /** Override the full logs URL (otherwise `${endpoint}/v1/logs`). */
  readonly logsUrl?: string;
  /** Extra OTLP headers (e.g. auth). */
  readonly headers?: Record<string, string>;
  /** Also export spans/logs to the console (DevTools-style visibility, no backend needed). Default `true` (dev posture). */
  readonly console?: boolean;
  /** Use simple (synchronous) processors instead of batched — handy for tests/short flows. Default `false`. */
  readonly useSimpleProcessors?: boolean;
  /** Trace sampler. Default `ParentBased(AlwaysOn)` — 100% (spec R10); a developer wants every trace. */
  readonly sampler?: Sampler;
  /** Emit a derived INFO/WARN log per macrostep so logs appear without the structured channel. Default `true`. */
  readonly lifecycleLogs?: boolean;
  /** `wall` (default) or `virtual` (DST). */
  readonly clock?: "wall" | "virtual";
  /** Additional resource attributes. */
  readonly resourceAttributes?: Record<string, string | number | boolean>;
  /** Register the providers globally (so stock browser instrumentation correlates). Default `true`. */
  readonly registerGlobal?: boolean;
  /** Flush on `visibilitychange→hidden` / `pagehide` so a page navigation never drops the last batch. Default `true`. */
  readonly flushOnPageHide?: boolean;
}

export interface IhsmOtelBrowser {
  readonly instrumentation: Instrumentation;
  readonly tracer: Tracer;
  readonly logger: Logger;
  readonly tracerProvider: WebTracerProvider;
  readonly loggerProvider: LoggerProvider;
  /** Unregister this collector from the global registry (idempotent; also called by `shutdown`). */
  unregister(): void;
  /** Flush all pending spans and logs (await before reading them in a backend). */
  forceFlush(): Promise<void>;
  /** Flush, tear down the SDK, unregister the collector, and remove the page-hide listeners. */
  shutdown(): Promise<void>;
}

interface BrowserNavigator {
  readonly userAgent?: string;
  readonly language?: string;
  readonly userAgentData?: {
    readonly platform?: string;
    readonly mobile?: boolean;
    readonly brands?: ReadonlyArray<{
      readonly brand: string;
      readonly version: string;
    }>;
  };
}

interface PageHideTarget {
  addEventListener?(type: string, listener: () => void): void;
  removeEventListener?(type: string, listener: () => void): void;
}

function getNavigator(): BrowserNavigator | undefined {
  return (globalThis as { navigator?: BrowserNavigator }).navigator;
}

function getDocument(): PageHideTarget | undefined {
  return (globalThis as { document?: PageHideTarget }).document;
}

function getWindow(): PageHideTarget {
  return globalThis as unknown as PageHideTarget;
}

function baseEndpoint(config: StartOtelBrowserConfig): string {
  return (config.endpoint ?? "http://localhost:4318").replace(/\/+$/, "");
}

/** Resource attributes describing the browser environment (best-effort; missing globals are skipped). */
function browserResourceAttributes(): Record<
  string,
  string | number | boolean | string[]
> {
  const attrs: Record<string, string | number | boolean | string[]> = {};
  const nav = getNavigator();
  if (nav === undefined) return attrs;
  if (typeof nav.userAgent === "string")
    attrs[ATTR_USER_AGENT_ORIGINAL] = nav.userAgent;
  if (typeof nav.language === "string")
    attrs[ATTR_BROWSER_LANGUAGE] = nav.language;
  const data = nav.userAgentData;
  if (data !== undefined) {
    if (typeof data.platform === "string")
      attrs[ATTR_BROWSER_PLATFORM] = data.platform;
    if (typeof data.mobile === "boolean")
      attrs[ATTR_BROWSER_MOBILE] = data.mobile;
    if (Array.isArray(data.brands))
      attrs[ATTR_BROWSER_BRANDS] = data.brands.map(
        (b) => `${b.brand} ${b.version}`,
      );
  }
  return attrs;
}

/** Start the browser OTEL SDK and return a ready-to-use ihsm instrumentation bundle. */
export function startOtelBrowser(
  config: StartOtelBrowserConfig,
): IhsmOtelBrowser {
  const endpoint: string = baseEndpoint(config);
  const headers: Record<string, string> | undefined = config.headers;
  const useSimple: boolean = config.useSimpleProcessors ?? false;
  const registerGlobal: boolean = config.registerGlobal ?? true;
  const useConsole: boolean = config.console ?? true;
  const flushOnPageHide: boolean = config.flushOnPageHide ?? true;

  const resource = defaultResource().merge(
    resourceFromAttributes({
      [ATTR_SERVICE_NAME]: config.serviceName,
      [ATTR_SERVICE_VERSION]: config.serviceVersion ?? "0.0.0",
      [ATTR_TELEMETRY_SDK_LANGUAGE]: "webjs",
      [ATTR.otelVersion]: IHSM_OTEL_VERSION,
      [ATTR.hostKind]: "browser",
      ...browserResourceAttributes(),
      ...config.resourceAttributes,
    }),
  );

  const traceExporter = new OTLPTraceExporter({
    url: config.tracesUrl ?? `${endpoint}/v1/traces`,
    headers,
  });
  const spanProcessors: SpanProcessor[] = [
    useSimple
      ? new SimpleSpanProcessor(traceExporter)
      : new BatchSpanProcessor(traceExporter),
  ];
  if (useConsole)
    spanProcessors.push(new SimpleSpanProcessor(new ConsoleSpanExporter()));

  const sampler: Sampler =
    config.sampler ?? new ParentBasedSampler({ root: new AlwaysOnSampler() });
  // Synchronous override slot for caller-minted cross-actor root contexts (§5.6) — bridge's own provider.
  const idGenerator = new OverridableIdGenerator();
  const tracerProvider = new WebTracerProvider({
    resource,
    sampler,
    spanProcessors,
    idGenerator,
  });

  const logExporter = new OTLPLogExporter({
    url: config.logsUrl ?? `${endpoint}/v1/logs`,
    headers,
  });
  const logProcessors: LogRecordProcessor[] = [
    useSimple
      ? new SimpleLogRecordProcessor(logExporter)
      : new BatchLogRecordProcessor(logExporter),
  ];
  if (useConsole)
    logProcessors.push(
      new SimpleLogRecordProcessor(new ConsoleLogRecordExporter()),
    );
  const loggerProvider = new LoggerProvider({
    resource,
    processors: logProcessors,
  });

  if (registerGlobal) {
    // Installs the StackContextManager + W3C propagator (sync only — async correctness comes
    // from the bridge's per-actor record, not the context manager; spec doc 4 §4.6).
    tracerProvider.register({ contextManager: new StackContextManager() });
    logs.setGlobalLoggerProvider(loggerProvider);
  }

  const tracer: Tracer = tracerProvider.getTracer(
    SCOPE_RUNTIME,
    IHSM_OTEL_VERSION,
  );
  const logger: Logger = loggerProvider.getLogger(
    SCOPE_RUNTIME,
    IHSM_OTEL_VERSION,
  );

  const instrumentation: Instrumentation = createOtelInstrumentation({
    tracer,
    logger,
    clock: config.clock,
    lifecycleLogs: config.lifecycleLogs,
    idGenerator,
  });

  // Register globally so tracing is enforced as a protocol, not threaded through actor options.
  const unregister = registerCollector(instrumentation);

  let pageHideListener: (() => void) | undefined;
  if (flushOnPageHide) {
    // Page-scoped lifecycle: a browser tab can vanish without a clean shutdown, so flush the
    // last batch when the page becomes hidden or is being unloaded.
    pageHideListener = (): void => {
      void tracerProvider.forceFlush();
      void loggerProvider.forceFlush();
    };
    getWindow().addEventListener?.("pagehide", pageHideListener);
    getDocument()?.addEventListener?.("visibilitychange", pageHideListener);
  }

  const removePageHideListener = (): void => {
    if (pageHideListener === undefined) return;
    getWindow().removeEventListener?.("pagehide", pageHideListener);
    getDocument()?.removeEventListener?.("visibilitychange", pageHideListener);
    pageHideListener = undefined;
  };

  return {
    instrumentation,
    tracer,
    logger,
    tracerProvider,
    loggerProvider,
    unregister,
    async forceFlush(): Promise<void> {
      await tracerProvider.forceFlush();
      await loggerProvider.forceFlush();
    },
    async shutdown(): Promise<void> {
      unregister();
      removePageHideListener();
      await tracerProvider.shutdown();
      await loggerProvider.shutdown();
      otelContext.disable();
    },
  };
}
