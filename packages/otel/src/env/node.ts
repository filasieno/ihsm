/**
 * Node/server entry point — the production observability target.
 *
 * `startOtelNode(config)` wires a `TracerProvider` + `LoggerProvider` with OTLP/HTTP exporters and
 * an `AsyncLocalStorage` context manager, then **registers the ihsm collector globally**. Tracing is
 * a cross-cutting concern: actor and handler code take no tracing argument — every actor created
 * after this call is observed automatically. Integrating ihsm with OpenTelemetry is a single call.
 *
 * @example
 * ```ts
 * import { makeActor, Port } from 'ihsm';
 * import { startOtelNode } from '@ihsm/otel/node';
 *
 * const otel = startOtelNode({ serviceName: 'demo' }); // → http://localhost:4318, collector registered
 * const actor = makeActor(Top, ctx, new Port(), { initialize: true }); // no tracing wiring needed
 * // … drive the actor …
 * await otel.shutdown(); // flushes, tears down the SDK, and unregisters the collector
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
  NodeTracerProvider,
  ParentBasedSampler,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-node";
import type { Sampler, SpanProcessor } from "@opentelemetry/sdk-trace-node";
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
  ATTR_TELEMETRY_SDK_LANGUAGE,
} from "@opentelemetry/semantic-conventions";
import { registerCollector } from "ihsm";
import type { Instrumentation } from "ihsm/types";

import { createOtelInstrumentation } from "../bridge";
import { OverridableIdGenerator } from "../idgen";
import { IHSM_OTEL_VERSION } from "../index";
import { ATTR, SCOPE_RUNTIME } from "../semconv";

export interface StartOtelNodeConfig {
  /** `service.name` resource attribute — identifies the service in every backend. */
  readonly serviceName: string;
  /** `service.version` resource attribute. */
  readonly serviceVersion?: string;
  /** OTLP/HTTP base endpoint (no path). Default `OTEL_EXPORTER_OTLP_ENDPOINT` or `http://localhost:4318`. */
  readonly endpoint?: string;
  /** Override the full traces URL (otherwise `${endpoint}/v1/traces`). */
  readonly tracesUrl?: string;
  /** Override the full logs URL (otherwise `${endpoint}/v1/logs`). */
  readonly logsUrl?: string;
  /** Extra OTLP headers (e.g. auth). */
  readonly headers?: Record<string, string>;
  /** Also export spans/logs to the console (DevTools-style visibility). Default `false`. */
  readonly console?: boolean;
  /** Use simple (synchronous) processors instead of batched — handy for short scripts/tests. Default `false`. */
  readonly useSimpleProcessors?: boolean;
  /** Trace sampler. Default `ParentBased(AlwaysOn)` — 100% (spec R10). */
  readonly sampler?: Sampler;
  /** Emit a derived INFO/WARN log per macrostep so logs appear without the structured channel. Default `true`. */
  readonly lifecycleLogs?: boolean;
  /** `wall` (default) or `virtual` (DST). */
  readonly clock?: "wall" | "virtual";
  /** Additional resource attributes. */
  readonly resourceAttributes?: Record<string, string | number | boolean>;
  /** Register the providers globally (so stock instrumentation correlates). Default `true`. */
  readonly registerGlobal?: boolean;
}

export interface IhsmOtelNode {
  readonly instrumentation: Instrumentation;
  readonly tracer: Tracer;
  readonly logger: Logger;
  readonly tracerProvider: NodeTracerProvider;
  readonly loggerProvider: LoggerProvider;
  /** Unregister this collector from the global registry (idempotent; also called by `shutdown`). */
  unregister(): void;
  /** Flush all pending spans and logs (await before reading them in a backend). */
  forceFlush(): Promise<void>;
  /** Flush, tear down the SDK, and unregister the collector. */
  shutdown(): Promise<void>;
}

function baseEndpoint(config: StartOtelNodeConfig): string {
  const fromEnv: string | undefined =
    typeof process !== "undefined"
      ? process.env.OTEL_EXPORTER_OTLP_ENDPOINT
      : undefined;
  return (config.endpoint ?? fromEnv ?? "http://localhost:4318").replace(
    /\/+$/,
    "",
  );
}

/** Start the Node OTEL SDK and return a ready-to-use ihsm instrumentation bundle. */
export function startOtelNode(config: StartOtelNodeConfig): IhsmOtelNode {
  const endpoint: string = baseEndpoint(config);
  const headers: Record<string, string> | undefined = config.headers;
  const useSimple: boolean = config.useSimpleProcessors ?? false;
  const registerGlobal: boolean = config.registerGlobal ?? true;

  const resource = defaultResource().merge(
    resourceFromAttributes({
      [ATTR_SERVICE_NAME]: config.serviceName,
      [ATTR_SERVICE_VERSION]: config.serviceVersion ?? "0.0.0",
      [ATTR_TELEMETRY_SDK_LANGUAGE]: "nodejs",
      [ATTR.otelVersion]: IHSM_OTEL_VERSION,
      [ATTR.hostKind]: "server",
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
  if (config.console === true)
    spanProcessors.push(new SimpleSpanProcessor(new ConsoleSpanExporter()));

  const sampler: Sampler =
    config.sampler ?? new ParentBasedSampler({ root: new AlwaysOnSampler() });
  // Custom id generator with a synchronous override slot so cross-actor sends can mint the callee's
  // macrostep root context for bidirectional links (§5.6). Lives on the bridge's own provider only.
  const idGenerator = new OverridableIdGenerator();
  const tracerProvider = new NodeTracerProvider({
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
  if (config.console === true)
    logProcessors.push(
      new SimpleLogRecordProcessor(new ConsoleLogRecordExporter()),
    );
  const loggerProvider = new LoggerProvider({
    resource,
    processors: logProcessors,
  });

  if (registerGlobal) {
    tracerProvider.register();
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
      await tracerProvider.shutdown();
      await loggerProvider.shutdown();
      otelContext.disable();
    },
  };
}
