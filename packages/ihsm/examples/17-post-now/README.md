# Hi-priority notifications (`hsm.immediate`)

## Problem

Sometimes a handler must run **follow-up protocol steps before** normal-priority notifications scheduled in the same turn — extended transitions, pseudo-states, inventory locks.

## Solution

**`this.hsm.immediate.event()`** enqueues on the **hi-priority** queue. After the current handler and its transitions finish, the runtime drains all hi-priority jobs before normal `hsm.actor` notifications from that handler.

Only available **inside** handlers. Clients use ordinary generated notification methods.

## UML statechart

```plantuml
@startuml
left to right direction
state OrderTop {
  [*] --> Draft
  Draft : confirm / immediate.lock(); immediate.capture(); actor.cancel()
  Draft --> Confirmed : confirm
}
@enduml
```

## Handler

`confirm` schedules a normal `cancel` (deferred side effect) plus critical steps via `immediate`:

```typescript
confirm(): void {
  this.ctx.steps.push('confirm-start');
  this.hsm.actor.cancel();           // normal — runs after immediate steps
  this.hsm.immediate.lockInventory();
  this.hsm.immediate.capturePayment();
  this.ctx.steps.push('confirm-end');
  this.hsm.transition(Confirmed);
}
```

`immediate` handlers run **after** `confirm-end` is recorded but **before** `cancel`.

## Client

```typescript
sm.confirm();
await sm.hsm.sync(); // through confirm + transition
await sm.hsm.sync(); // drain immediate follow-ups
```

Compare with [Notifications & sync](../08-post-and-sync/README.md): plain `this.hsm.actor` from a handler is FIFO **after** the handler returns — `immediate` cuts ahead of those normal notifications.

Use **`hsm.immediate`** for internal orchestration in the same dispatch turn — see also [Complex workflow](../15-complex-workflow/README.md).

## Verify

```shell
npm run test:examples -- --grep 'Tutorial 17'
```
