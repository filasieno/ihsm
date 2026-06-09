# postNow()

## Problem

During a handler you sometimes need **internal** follow-up events (inventory lock, payment capture, cleanup) to run **before** other work — including normal `post` calls from the same handler or the next dispatched job. That pattern models **extended transitions**: several steps that belong to one logical turn.

## Solution

**`postNow(event, …args)`** enqueues on the **hi-priority** queue. After the current handler and its transitions finish, the runtime drains all hi-priority jobs before normal posts from that handler or the next external `post`.

Only available **inside** handlers (`this.postNow`). The client uses ordinary `post`.

## UML statechart

```plantuml
@startuml
left to right direction
state CheckoutTop {
  [*] --> Draft
  Draft : confirm / postNow(lock); postNow(capture); post(cancel)
  Draft --> Confirmed : confirm
}
@enduml
```

Internal `lockInventory` and `capturePayment` are not separate states — they are hi-priority events orchestrating the extended `confirm` transition.

## Protocol

```typescript
export interface CheckoutProtocol {
	confirm(): void;
	lockInventory(): void;
	capturePayment(): void;
	cancel(): void;
}
```

---

## Example · Extended transition with guaranteed order

### Handler (state machine)

`confirm` schedules a normal `cancel` (deferred side effect) plus critical steps via `postNow`:

```typescript
confirm(): void {
	this.ctx.steps.push('confirm-start');
	this.post('cancel');                  // normal — runs after postNow steps
	this.postNow('lockInventory');          // hi-priority
	this.postNow('capturePayment');         // hi-priority
	this.ctx.steps.push('confirm-end');
	this.transition(Confirmed);
}
```

`postNow` handlers run **after** `confirm-end` is recorded but **before** `cancel` — still within the same overall `confirm` dispatch cycle.

### Client (caller)

```typescript
const sm = createCheckout();
await sm.sync();

sm.post('confirm');
await sm.sync();
await sm.sync(); // drain postNow follow-ups

expect(sm.ctx.steps).to.deep.equal([
	'confirm-start',
	'confirm-end',
	'lock',
	'capture',
	'cancel',
]);
expect(sm.ctx.committed).equals(true);
```

| Step | What happens |
| ---- | ------------ |
| 1 | `#confirm` handler body runs through `confirm-end` |
| 2 | Transition to `Confirmed` (if any exit/entry/`then`) |
| 3 | Hi-priority `#lockInventory`, `#capturePayment` |
| 4 | Normal `#cancel` from the same handler |

Compare with [Post & sync](../08-post-and-sync/README.md): plain `this.post` from a handler is FIFO **after** the handler returns — `postNow` cuts ahead of those normal posts.

---

Use **`postNow`** to run internal protocol handlers in the same dispatch turn — for example choice pseudo states after entry ([Complex workflow](../15-complex-workflow/README.md)) or extended transitions like this tutorial.

---

## Reading the trace

With `TraceLevel.VERBOSE_DEBUG` and a custom `TraceWriter`, ihsm logs each dispatch step. Trace line format is covered in [Tracing](../02-tracing/README.md).

On the [documentation page](https://filasieno.github.io/ihsm/reference), use the embedded playground to dispatch events and inspect the **Trace** panel. Or run `npm run test:examples` headlessly.

**What to notice:** `#lockInventory` and `#capturePayment` appear after `#confirm` completes its handler body but before `#cancel`.

## Verify

```shell
npm run test:examples -- --grep 'Tutorial 17'
```
