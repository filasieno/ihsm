# Error Recovery

## Problem

Handlers throw; events arrive in the wrong state. Uncaught errors leave the actor in an undefined condition.

## Solution

Override **`onError`** (handler threw) and **`onUnhandled`** (no handler). Recover by logging, updating ctx, or transitioning.

## UML statechart

```plantuml
@startuml
left to right direction
state WorkerTop {
  [*] --> Working
  Working : risky / throw → onError → stay
  Working : unknown / unhandled → onUnhandled → stay
}
@enduml
```

Recovery keeps the machine in `Working` when hooks swallow the failure.

`risky` simulates a fault; `unknown` triggers unhandled:

```typescript
export class WorkerTop extends TopState<WorkerCtx, WorkerProtocol> implements WorkerProtocol {
	risky(): void {
		throw new Error('simulated failure');
	}
	unknown(): void {
		this.unhandled(); // ← routes to onUnhandled
	}
}
```

`Working` recovers without leaving:

```typescript
@InitialState
export class Working extends WorkerTop {
	onError<EventName extends keyof WorkerProtocol>(
		_error: EventHandlerError<WorkerCtx, WorkerProtocol, EventName>
	): void {
		this.ctx.recovered += 1; // ← swallow, stay in Working
		this.ctx.failures += 1;
	}

	onUnhandled<EventName extends keyof WorkerProtocol>(
		_error: UnhandledEventError<WorkerCtx, WorkerProtocol, EventName>
	): void {
		this.ctx.failures += 1;
	}
}
```

```typescript
worker.post('risky');
await worker.sync();
// still Working, recovered === 1
```

## Reading the trace

With `TraceLevel.VERBOSE_DEBUG` and a custom `TraceWriter`, ihsm logs each dispatch step. Trace line format is covered in [Tracing](../02-tracing/README.md).

Each line is **`domain|…|StateName: message`**. Domains nest as the runtime descends: `initialize` → `#eventName` → `execute` → `transition from X to Y`.

On the [documentation page](https://filasieno.github.io/ihsm/reference), use the embedded playground to dispatch events and inspect the **Trace** panel. Or run `npm run test:examples` headlessly.

**What to notice:** `#risky` throws → `error recovery` domain → `onError` → machine stays in `Working` when recovery succeeds.

## Verify

```shell
npm run test:examples -- --grep 'Tutorial 12'
```

