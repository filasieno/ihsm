import type { Span } from "@opentelemetry/api";

const activeUserSpanStack: Span[] = [];

export function pushActiveUserSpan(span: Span): void {
  activeUserSpanStack.push(span);
}

export function popActiveUserSpan(span: Span): void {
  const i = activeUserSpanStack.lastIndexOf(span);
  if (i >= 0) activeUserSpanStack.splice(i, 1);
}

export function currentActiveUserSpan(): Span | undefined {
  return activeUserSpanStack[activeUserSpanStack.length - 1];
}

