# Restore

## Problem

After restart or loading from a database, you must resume at a specific mode with specific data — without replaying every event.

## Solution

1. **Suspend** — read `currentState` + `ctx`, serialize to JSON (DB row or file).
2. **Resume** — `makeTestActor(…, { initialize: false })` on a **new** instance, then `sm.hsm.restore(stateClass, ctx)`.

`restore` sets active state and context **without** running `onEntry` or `onExit`.

## UML statechart

```plantuml
@startuml
left to right direction
skinparam ranksep 25
state SessionTop {
  [*] --> Anonymous
  Anonymous --> Authenticated : login (normal transition)
  Authenticated : navigate(page) / lastPage := page
}
note right of Authenticated
  suspend → JSON { stateName, ctx }
  resume → restore(Authenticated, ctx)
end note
@enduml
```

`suspend` / `resume` are **meta-operations** (not Protocol events) — persistence boundaries.

States and a name registry (classes cannot be JSON-serialized):

```typescript
export const SESSION_STATES = {
	Anonymous,
	Authenticated,
} as const;

export type SessionStateName = keyof typeof SESSION_STATES;

export interface PersistedSession {
	stateName: SessionStateName;
	ctx: SessionCtx;
}
```

### 1. Run a live session

```typescript
const live = createSession('user-42');
await live.hsm.sync(); // onEntry: Anonymous

live.hsm.restore(Authenticated, {
	userId: 'user-42',
	lastPage: 'settings',
	entryLog: [...live.ctx.entryLog],
});
live.notify.navigate('billing');
await live.hsm.sync();
```

### 2. Suspend to disk / DB

Serialize **state name + ctx** — not the class reference:

```typescript
export function suspendSession(sm: TestActor<SessionConfig>): string {
	return JSON.stringify({
		stateName: stateNameOf(sm),
		ctx: { ...sm.ctx, entryLog: [...sm.ctx.entryLog] },
	} satisfies PersistedSession);
}
```

### 3. New process — instantiate and restore

Skip initialization (`initialize: false`), then jump to the saved leaf:

```typescript
export function resumeSession(json: string) {
	const { stateName, ctx } = JSON.parse(json) as PersistedSession;
	const sm = makeTestActor(SessionTop, { userId: '', lastPage: '', entryLog: [] }, new Port(), {
		initialize: false,
	});
	(sm.hsm as ChildHsm<SessionConfig>).restore(SESSION_STATES[stateName], ctx);
	return sm;
}
```

### 4. Continue from the snapshot

```typescript
afterRestart.notify.navigate('profile');
await afterRestart.hsm.sync();
```

`entryLog` shows the difference: init recorded `Anonymous` once; restore did **not** append `Authenticated`.

## Reading the trace

With `TraceLevel.VERBOSE_DEBUG` and a custom `TraceWriter`, ihsm logs each dispatch step. Trace line format is covered in [Tracing](../02-tracing/README.md).

Each line is **`domain|…|StateName: message`**. Domains nest as the runtime descends: `initialize` → `#eventName` → `execute` → `transition from X to Y`.

On the [documentation page](https://filasieno.github.io/ihsm/reference), use the embedded playground to dispatch events and inspect the **Trace** panel. Or run `npm run test:examples` headlessly.

**What to notice:** `restore()` does **not** emit trace — it is a meta-operation. After rehydration, `#navigate` behaves like any normal event dispatch.

## Verify

```shell
npm run test:examples -- --grep 'Tutorial 11'
```

