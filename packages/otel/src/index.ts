/**
 * `@ihsm/otel` — OpenTelemetry traces and logs for ihsm actors.
 *
 * The isomorphic core ({@link createOtelInstrumentation}) maps the ihsm `Instrumentation` seam to
 * OTEL spans and logs using only `@opentelemetry/api` + `@opentelemetry/api-logs`. The environment
 * entry point `@ihsm/otel/node` adds the SDK edges (OTLP exporters, context manager) and a one-call
 * setup (`startOtelNode`). Deterministic test helpers live in `@ihsm/otel/testing`.
 */

export const IHSM_OTEL_VERSION = '0.1.0';

export { createOtelInstrumentation } from './bridge';
export type { OtelInstrumentationOptions } from './bridge';
export { getActiveSpanContext, getActiveTraceId, getActiveSpanId, traceSpan, traceSpanAsync, traced, tracedAsync, tracedClass } from './annotate';
export { ATTR, EVENT, SPAN, SCOPE_PORT, SCOPE_RUNTIME } from './semconv';
