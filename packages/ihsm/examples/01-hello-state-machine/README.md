# Hello state machine

## Problem

Model each mode as a **state class**. Events are methods; crossing a mode boundary calls `this.hsm.transition(NextState)`.

## Solution

One `Config` bag declares context + protocol buckets. `makeActor` returns a handle with **`notify`**, **`notifyNow`**, and **`call`**. Machinery (`transition`, `sync`, `currentState`) lives on `door.hsm`.

## UML statechart

```plantuml
@startuml
left to right direction
state DoorTop {
  [*] --> Closed
  Closed -down-> Open : open / openCount++
  Open -up-> Closed : close
}
@enduml
```

## Config

```typescript
interface DoorConfig {
  context: DoorCtx;
  notifications: {
    open(): void;
    close(): void;
  };
}

export class DoorTop extends TopState<DoorConfig> {}
```

Mark the **initial state** with `@InitialState`. After `makeActor` + `await door.hsm.sync()`, the runtime descends here.

```typescript
@InitialState
class Closed extends DoorTop {
  open(): void {
    this.ctx.openCount += 1;
    this.hsm.transition(Open);
  }
}

class Open extends DoorTop {
  close(): void {
    this.hsm.transition(Closed);
  }
}
```

## Client

```typescript
import { makeActor, Port } from 'ihsm';

const door = makeActor(DoorTop, { openCount: 0 }, new Port());
await door.hsm.sync();

door.notify.open();                    // fire-and-forget notification
await door.hsm.sync();          // handler + transition finished

door.notify.close();
await door.hsm.sync();

door.notify.open();
door.notify.close();
await door.hsm.sync();

console.log(door.hsm.currentStateName); // 'Closed'
// openCount is on ctx — use makeTestActor in tests, or inspect via a call service in production
```

| Side | Call | Blocks? |
| ---- | ---- | ------- |
| Client | `door.notify.open()` | No — returns immediately |
| Client | `await door.hsm.sync()` | Yes — drains enqueued work |

See [Notifications & sync](../08-post-and-sync/README.md) for batching and handler chaining.

## Verify

```shell
npm run test:examples -- --grep 'Tutorial 01'
```
