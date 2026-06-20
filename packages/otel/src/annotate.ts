import { context as otelContext, SpanKind, trace } from "@opentelemetry/api";
import type { Context, SpanOptions, SpanContext } from "@opentelemetry/api";
import { currentTraceAnchor } from "ihsm";

import { resolveSpanContextForAnchor } from "./bridge";
import { popActiveUserSpan, pushActiveUserSpan } from "./user-anchor";

type Fn<T = unknown> = (...args: any[]) => T;
type DecoratorContextLike = {
  readonly kind?: string;
  readonly name?: string | symbol;
};

function activeParentContext(): Context {
  const anchor = currentTraceAnchor();
  if (anchor !== undefined) {
    const spanCtx = resolveSpanContextForAnchor(anchor);
    if (spanCtx !== undefined) {
      return trace.setSpan(
        otelContext.active(),
        trace.wrapSpanContext(spanCtx),
      );
    }
  }
  return otelContext.active();
}

export function getActiveSpanContext(): SpanContext | undefined {
  const anchor = currentTraceAnchor();
  if (anchor === undefined) return undefined;
  return resolveSpanContextForAnchor(anchor);
}

export function getActiveTraceId(): string | undefined {
  return getActiveSpanContext()?.traceId;
}

export function getActiveSpanId(): string | undefined {
  return getActiveSpanContext()?.spanId;
}

export function traceSpan<T>(
  name: string,
  fn: () => T,
  options?: SpanOptions,
): T {
  const tracer = trace.getTracer("@ihsm/otel/user");
  const span = tracer.startSpan(
    name,
    { kind: SpanKind.INTERNAL, ...options },
    activeParentContext(),
  );
  const runCtx = trace.setSpan(activeParentContext(), span);
  pushActiveUserSpan(span);
  try {
    const value = otelContext.with(runCtx, fn);
    span.end();
    return value;
  } catch (cause) {
    const err = cause instanceof Error ? cause : new Error(String(cause));
    span.recordException(err);
    span.end();
    throw cause;
  } finally {
    popActiveUserSpan(span);
  }
}

export async function traceSpanAsync<T>(
  name: string,
  fn: () => Promise<T>,
  options?: SpanOptions,
): Promise<T> {
  const tracer = trace.getTracer("@ihsm/otel/user");
  const span = tracer.startSpan(
    name,
    { kind: SpanKind.INTERNAL, ...options },
    activeParentContext(),
  );
  const runCtx = trace.setSpan(activeParentContext(), span);
  pushActiveUserSpan(span);
  try {
    const value = await otelContext.with(runCtx, fn);
    span.end();
    return value;
  } catch (cause) {
    const err = cause instanceof Error ? cause : new Error(String(cause));
    span.recordException(err);
    span.end();
    throw cause;
  } finally {
    popActiveUserSpan(span);
  }
}

function methodName(
  fallback: string | undefined,
  thisArg: unknown,
  key: string | symbol | undefined,
): string {
  if (fallback !== undefined) return fallback;
  const owner =
    (thisArg as { constructor?: { name?: string } }).constructor?.name ??
    "Unknown";
  if (key === undefined) return owner;
  return `${owner}.${String(key)}`;
}

function wrapSyncMethod(
  original: Fn,
  providedName: string | undefined,
  key: string | symbol | undefined,
): Fn {
  return function tracedMethod(this: unknown, ...args: unknown[]): unknown {
    const spanName = methodName(providedName, this, key);
    return traceSpan(spanName, () => original.apply(this, args));
  };
}

function wrapAsyncMethod(
  original: Fn,
  providedName: string | undefined,
  key: string | symbol | undefined,
): Fn {
  return function tracedAsyncMethod(this: unknown, ...args: unknown[]) {
    const spanName = methodName(providedName, this, key);
    return traceSpanAsync(spanName, () => Promise.resolve(original.apply(this, args)));
  };
}

function applyLegacyDecorator(
  wrap: (original: Fn, providedName: string | undefined, key: string | symbol) => Fn,
  providedName: string | undefined,
  target: object,
  key: string | symbol,
  descriptor: PropertyDescriptor,
): PropertyDescriptor {
  if (typeof descriptor.value !== "function") return descriptor;
  descriptor.value = wrap(descriptor.value, providedName, key);
  return descriptor;
}

function applyStage3Decorator(
  wrap: (
    original: Fn,
    providedName: string | undefined,
    key: string | symbol | undefined,
  ) => Fn,
  providedName: string | undefined,
  value: Fn,
  context: DecoratorContextLike,
): Fn {
  if (context.kind !== "method") return value;
  return wrap(value, providedName, context.name);
}

export function traced(name?: string) {
  return (...args: unknown[]): unknown => {
    if (args.length >= 2 && typeof args[1] === "object") {
      return applyStage3Decorator(
        wrapSyncMethod,
        name,
        args[0] as Fn,
        args[1] as DecoratorContextLike,
      );
    }
    if (args.length === 3) {
      return applyLegacyDecorator(
        wrapSyncMethod,
        name,
        args[0] as object,
        args[1] as string | symbol,
        args[2] as PropertyDescriptor,
      );
    }
    return args[0];
  };
}

export function tracedAsync(name?: string) {
  return (...args: unknown[]): unknown => {
    if (args.length >= 2 && typeof args[1] === "object") {
      return applyStage3Decorator(
        wrapAsyncMethod,
        name,
        args[0] as Fn,
        args[1] as DecoratorContextLike,
      );
    }
    if (args.length === 3) {
      return applyLegacyDecorator(
        wrapAsyncMethod,
        name,
        args[0] as object,
        args[1] as string | symbol,
        args[2] as PropertyDescriptor,
      );
    }
    return args[0];
  };
}

type TracedClassOptions = {
  readonly includeStatic?: boolean;
  readonly asyncOnly?: boolean;
};

function decorateMethods(
  target: object,
  options: TracedClassOptions | undefined,
): void {
  const names = Object.getOwnPropertyNames(target);
  for (const name of names) {
    if (name === "constructor") continue;
    const desc = Object.getOwnPropertyDescriptor(target, name);
    if (desc?.value === undefined || typeof desc.value !== "function") continue;
    if (options?.asyncOnly === true && desc.value.constructor.name !== "AsyncFunction") continue;
    const wrapped =
      desc.value.constructor.name === "AsyncFunction"
        ? wrapAsyncMethod(desc.value, undefined, name)
        : wrapSyncMethod(desc.value, undefined, name);
    Object.defineProperty(target, name, { ...desc, value: wrapped });
  }
}

export function tracedClass(options?: TracedClassOptions) {
  return <T extends { new (...args: any[]): any }>(ctor: T): T => {
    decorateMethods(ctor.prototype, options);
    if (options?.includeStatic === true) decorateMethods(ctor, options);
    return ctor;
  };
}

