# Protocol Typing

## Problem

String event names and untyped payloads fail at runtime after refactors — `'setTargt'` compiles until the first `post` in production.

## Solution

Declare a **`Protocol` interface**. TypeScript checks `post('setTarget', celsius)` against method names and parameter types.

Other HSM libraries use runtime strings or untyped event objects; they **cannot**
tie `post()` / `call()` argument lists and Promise return types to the same
method signatures your state classes implement. ihsm does — see the reference
manual:
[Advanced: Protocol typing and compile-time safety](../../docs/REFERENCE.md#advanced-protocol-typing-and-compile-time-safety).

## UML statechart

```plantuml
@startuml
left to right direction
state ThermostatTop {
  [*] --> Idle
  Idle : setTarget(celsius) / ctx.celsius := celsius
}
@enduml
```

Typing is compile-time; at runtime this is an internal transition in `Idle`.

The protocol is the machine’s **event vocabulary**:

```typescript
export interface ThermostatProtocol {
	setTarget(celsius: number): void;
	readTarget(): number;
}
```

Generics wire context and protocol through the hierarchy:

```typescript
export class ThermostatTop extends TopState<ThermostatCtx, ThermostatProtocol>
	implements ThermostatProtocol {
	setTarget(celsius: number): void {
		this.ctx.celsius = celsius; // ← payload type enforced at post()
	}
}
```

The factory is typed end-to-end:

```typescript
const t = makeHsm(ThermostatTop, { celsius: 18 });

t.post('setTarget', 22);   // ✓
// t.post('setTargt', 22); // ✗ compile error: unknown event
// t.post('setTarget', 'hot'); // ✗ compile error: string ≠ number
```

## Reading the trace

With `TraceLevel.VERBOSE_DEBUG` and a custom `TraceWriter`, ihsm logs each dispatch step. Trace line format is covered in [Tracing](../02-tracing/README.md).

Each line is **`domain|…|StateName: message`**. Domains nest as the runtime descends: `initialize` → `#eventName` → `execute` → `transition from X to Y`.

On the [documentation page](https://filasieno.github.io/ihsm/tutorials/04-protocol-typing), use the embedded playground to dispatch events and inspect the **Trace** panel. Or run `npm run test:tutorials` headlessly.

**What to notice:** Same internal pattern as context: `#setTarget` handler completes without a transition block.

## Verify

```shell
npm run test:tutorials -- --grep 'Tutorial 04'
```

