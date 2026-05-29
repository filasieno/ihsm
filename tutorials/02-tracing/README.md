# Tutorial 02: Tracing

## Problem

You need visibility into dispatch and transitions in development, without paying that cost in production — and you need a **shared vocabulary** to read traces in every other tutorial.

## Solution

Set **`HsmTraceLevel`** on the factory and inject a custom **`HsmTraceWriter`**. Use **`VERBOSE_DEBUG`** while learning; switch to **`PRODUCTION`** in hot paths.

## UML statechart

```plantuml
@startuml
left to right direction
state PingTop {
  [*] --> Ready
  Ready : ping / pings++, traceWriter.write(...)
}
@enduml
```

Tracing is orthogonal to state structure — same chart with observability layered on.

## Walkthrough

Shared collector (used in all tutorial tests) lives in `tutorials/_shared/trace.ts`:

```typescript
export class CollectingTraceWriter implements HsmTraceWriter {
	readonly lines: string[] = [];
	write(hsm: { traceHeader: string; currentStateName: string }, msg: unknown): void {
		if (typeof msg === 'string') {
			this.lines.push(`${hsm.traceHeader}${hsm.currentStateName}: ${msg}`);
		}
	}
}
```

Wire **`VERBOSE_DEBUG`** and the writer on the factory:

```typescript
export function createTracedPing(writer: CollectingTraceWriter) {
	return pingFactory.create({ pings: 0 }, true, HsmTraceLevel.VERBOSE_DEBUG, writer);
}
```

Handlers can emit domain logs:

```typescript
ping(): void {
	this.ctx.pings += 1;
	this.traceWriter.write(this, `ping count is now ${this.ctx.pings}`);
}
```

### Trace line format

Each line is **`domain|…|StateName: message`**:

| Part | Meaning |
| ---- | ------- |
| `initialize\|` | Init descent through `@HsmInitialState` chain |
| `#eventName\|` | One mailbox dispatch for that event |
| `lookup\|` | VERBOSE: find handler on prototype chain |
| `execute\|` | Handler body running |
| `transition from A to B\|` | LCA exit/entry walk |
| `StateName:` | Active leaf when the line was written |
| `done:` / `failure:` | Domain frame popped — success or error |

| Level | Value | Dispatch implementation | Typical use |
| ----- | ----- | ----------------------- | ----------- |
| `PRODUCTION` | 0 | No trace overhead | Production |
| `DEBUG` | 1 | Boundaries only | Dev default |
| `VERBOSE_DEBUG` | 2 | Lookup, cache, skipped hooks | Tutorials, deep debugging |

## Reading the trace

ihsm logs every dispatch step when `HsmTraceLevel.VERBOSE_DEBUG` is set and a custom `HsmTraceWriter` collects lines.

Each line is **`domain|…|StateName: message`**. Domains nest as the runtime descends: `initialize` → `#eventName` → `execute` → `transition from X to Y`.

```trace
{{TRACE}}
```

**What to notice:** This tutorial **is** the trace primer. Lines mirror `ConsoleTraceWriter` format. Handlers may call `this.traceWriter.write(...)` for domain logs. Compare `DEBUG` (boundaries only) vs `VERBOSE_DEBUG` (cache hits, skipped onEntry, etc.).

Regenerate samples after code changes: `npm run traces:generate` (colored output appears on the docs site).

## Run the test

```shell
npm run test:tutorials -- --grep 'Tutorial 02'
```

## What you learned

- Trace level selects how much the runtime logs per dispatch.
- `CollectingTraceWriter` captures lines for tests and docs.
- Every later tutorial includes a trace section — read dispatch flow there first.

Next: [Tutorial 03 — Context](../03-context/README.md)
