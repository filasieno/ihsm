# ihsm public surface inventory

Goal: minimize **runtime** symbols (values emitted in JS). Type-only exports are erased by TypeScript and listed separately.

## Layout (2026-06 refactor)

| Area | Path | Notes |
|------|------|-------|
| Public values | `src/index.ts`, `src/testing.ts` | Classes, factories, errors, ports |
| Public types | `src/types.ts` → `ihsm/types` | **Zero runtime** (`export {}` in JS); re-exports `internal/actor-types` + helpers |
| Runtime | `src/internal/*` | Consolidated runtime (`runtime.ts`, `types.ts`) |
| Legacy | **removed** | `legacy.types.ts`, `post`/`call`/`postNow`/`deferredPost`/`sleep` on `HsmObject` |

Generated from `packages/ihsm` sources (src, examples, test). Usage counts are approximate identifier matches.

## Runtime values (classes, functions, enums, const)

| Symbol | Kind | Usages | Essential | Why | Trim candidate |
|--------|------|--------|-----------|-----|----------------|
| `AssertAsyncService` | const | 3 | review | Public API export — verify consumers before removal. | medium |
| `BasePort` | class | 24 | yes | Public API export — verify consumers before removal. | keep |
| `CallTimeoutError` | class | 15 | review | Public API export — verify consumers before removal. | medium |
| `EventHandlerError` | class | 18 | review | Public API export — verify consumers before removal. | medium |
| `FatalError` | class | 16 | review | Public API export — verify consumers before removal. | medium |
| `FatalErrorState` | class | 57 | yes | Terminal error sink state. | keep |
| `HsmError` | class | 2 | review | Public API export — verify consumers before removal. | high |
| `InitialState` | class | 140 | yes | Decorator marking composite initial substate. | keep |
| `InitialStateError` | class | 5 | review | Public API export — verify consumers before removal. | medium |
| `InitializationError` | class | 10 | review | Public API export — verify consumers before removal. | medium |
| `Port` | class | 140 | yes | Default production port (timers, random). | keep |
| `PreloadError` | class | 12 | review | Public API export — verify consumers before removal. | medium |
| `ProtocolCollisionError` | class | 26 | yes | Public API export — verify consumers before removal. | keep |
| `RequestingPort` | class | 5 | review | Public API export — verify consumers before removal. | medium |
| `ReservedNames` | const | 10 | review | Runtime list of reserved protocol keys. | medium |
| `RuntimeError` | class | 14 | review | Public API export — verify consumers before removal. | medium |
| `RuntimeTransitionResolver` | class | 5 | review | Default LCA transition path resolver. | medium |
| `SelfCallDeadlockError` | class | 13 | review | Public API export — verify consumers before removal. | medium |
| `TestPort` | class | 161 | yes | Public API export — verify consumers before removal. | keep |
| `TopState` | class | 177 | yes | Abstract root state class; handlers extend it. | keep |
| `TraceLevel` | enum | 126 | yes | Controls dispatch tracing verbosity. | keep |
| `TransitionError` | class | 40 | yes | Public API export — verify consumers before removal. | keep |
| `TransitionTableError` | class | 6 | review | Public API export — verify consumers before removal. | medium |
| `UnhandledEventError` | class | 40 | yes | Public API export — verify consumers before removal. | keep |
| `buildProtocolIndex` | fn/const | 14 | review | Runtime protocol index from state graph — used by machine. | medium |
| `createHsmTransitionTrace` | fn/const | 8 | review | Oracle/tests — verbose transition trace adapter. | medium |
| `defaultDispatchErrorCallback` | const | 5 | review | Public API export — verify consumers before removal. | medium |
| `defineStateName` | fn/const | 8 | yes | Stable display names for minified bundles. | keep |
| `executeTransitionRoutine` | fn/const | 11 | review | Shared transition executor for runtime and tools. | medium |
| `getStateName` | fn/const | 58 | yes | Read registered display name for a state class. | keep |
| `makeActor` | fn/const | 39 | yes | Factory — public black-box actor with generated protocol methods. | keep |
| `makeInternalActor` | fn/const | 7 | yes | Factory — adds internalNotifications for port/supervisor wiring. | keep |
| `makeOwnerActor` | fn/const | 143 | yes | Factory — adds internalServices for parent/child composition. | keep |
| `makeTestActor` | fn/const | 58 | yes | Public API export — verify consumers before removal. | keep |
| `makeTestPort` | fn/const | 44 | yes | Public API export — verify consumers before removal. | keep |
| `mock` | fn/const | 81 | yes | Public API export — verify consumers before removal. | keep |
| `planTransitionClasses` | fn/const | 15 | review | LCA path planner — runtime and generated tables. | medium |
| `registerStateNames` | fn/const | 58 | yes | Bulk defineStateName from module exports. | keep |
| `transitionTraceLines` | fn/const | 6 | review | Test helper filtering canonical trace lines. | medium |

## Type-only exports (erased at compile time)

| Symbol | Usages | Essential | Why | Trim candidate |
|--------|--------|-----------|-----|----------------|
| `Actor` | 12 | yes | Compile-time helper for ActorConfig / protocol typing. | keep |
| `ActorConfig` | 151 | yes | Single config bag: context + protocol buckets + port. | keep |
| `ActorConfigContext` | 43 | yes | Compile-time helper for ActorConfig / protocol typing. | keep |
| `ActorConfigInternalNotifications` | 17 | yes | Compile-time helper for ActorConfig / protocol typing. | keep |
| `ActorConfigInternalServices` | 11 | yes | Compile-time helper for ActorConfig / protocol typing. | keep |
| `ActorConfigMethodKeys` | 2 | review | Compile-time helper for ActorConfig / protocol typing. | medium |
| `ActorConfigNotifications` | 39 | yes | Compile-time helper for ActorConfig / protocol typing. | keep |
| `ActorConfigOf` | 7 | review | Compile-time helper for ActorConfig / protocol typing. | medium |
| `ActorConfigPort` | 15 | yes | Compile-time helper for ActorConfig / protocol typing. | keep |
| `ActorConfigServices` | 18 | yes | Compile-time helper for ActorConfig / protocol typing. | keep |
| `ActorCore` | 1 | review | Compile-time helper for ActorConfig / protocol typing. | high |
| `ActorHsm` | 7 | yes | Compile-time helper for ActorConfig / protocol typing. | keep |
| `ActorOptions` | 11 | review | Compile-time helper for ActorConfig / protocol typing. | medium |
| `Any` | 22 | yes | Compile-time helper for ActorConfig / protocol typing. | keep |
| `DisjointActorConfig` | 20 | yes | Compile-time helper for ActorConfig / protocol typing. | keep |
| `DispatchErrorCallback` | 14 | yes | Compile-time helper for ActorConfig / protocol typing. | keep |
| `Disposable` | 43 | yes | Compile-time helper for ActorConfig / protocol typing. | keep |
| `EventObserver` | 8 | review | Compile-time helper for ActorConfig / protocol typing. | medium |
| `FilterReservedKeys` | 1 | review | Compile-time helper for ActorConfig / protocol typing. | high |
| `HandleWidth` | 17 | yes | Compile-time helper for ActorConfig / protocol typing. | keep |
| `HandlerHsm` | 12 | yes | Compile-time helper for ActorConfig / protocol typing. | keep |
| `InternalActor` | 14 | yes | Compile-time helper for ActorConfig / protocol typing. | keep |
| `InternalActorHsm` | 4 | review | Compile-time helper for ActorConfig / protocol typing. | medium |
| `MachineContext` | 1 | review | Compile-time helper for ActorConfig / protocol typing. | high |
| `MachineInternal` | 1 | review | Compile-time helper for ActorConfig / protocol typing. | high |
| `MachinePort` | 1 | review | Compile-time helper for ActorConfig / protocol typing. | high |
| `MachinePortInput` | 0 | review | Compile-time helper for ActorConfig / protocol typing. | high |
| `MachinePublic` | 0 | review | Compile-time helper for ActorConfig / protocol typing. | high |
| `Mock` | 9 | review | Compile-time helper for ActorConfig / protocol typing. | medium |
| `NotificationArgs` | 1 | review | Compile-time helper for ActorConfig / protocol typing. | high |
| `NotificationClient` | 4 | yes | Compile-time helper for ActorConfig / protocol typing. | keep |
| `NotificationHandler` | 1 | review | Compile-time helper for ActorConfig / protocol typing. | high |
| `OwnerActor` | 65 | yes | Compile-time helper for ActorConfig / protocol typing. | keep |
| `OwnerActorHsm` | 8 | yes | Compile-time helper for ActorConfig / protocol typing. | keep |
| `PlannedTransition` | 7 | review | Compile-time helper for ActorConfig / protocol typing. | medium |
| `PortHandle` | 18 | yes | Compile-time helper for ActorConfig / protocol typing. | keep |
| `ProductionPort` | 9 | review | Compile-time helper for ActorConfig / protocol typing. | medium |
| `Properties` | 23 | yes | Compile-time helper for ActorConfig / protocol typing. | keep |
| `ProtocolBucket` | 5 | review | Compile-time helper for ActorConfig / protocol typing. | medium |
| `ProtocolIndex` | 17 | yes | Compile-time helper for ActorConfig / protocol typing. | keep |
| `ProtocolSlot` | 9 | review | Compile-time helper for ActorConfig / protocol typing. | medium |
| `RandomService` | 12 | review | Compile-time helper for ActorConfig / protocol typing. | medium |
| `ReservedName` | 9 | review | Compile-time helper for ActorConfig / protocol typing. | medium |
| `ResultWithSubscription` | 29 | yes | Compile-time helper for ActorConfig / protocol typing. | keep |
| `SelfNotifications` | 11 | review | Compile-time helper for ActorConfig / protocol typing. | medium |
| `ServiceArgs` | 3 | review | Compile-time helper for ActorConfig / protocol typing. | medium |
| `ServiceCallOptions` | 5 | review | Compile-time helper for ActorConfig / protocol typing. | medium |
| `ServiceClient` | 3 | yes | Compile-time helper for ActorConfig / protocol typing. | keep |
| `ServiceHandler` | 1 | review | Compile-time helper for ActorConfig / protocol typing. | high |
| `ServiceReply` | 6 | review | Compile-time helper for ActorConfig / protocol typing. | medium |
| `StateClass` | 153 | yes | Compile-time helper for ActorConfig / protocol typing. | keep |
| `StateEvents` | 16 | yes | Compile-time helper for ActorConfig / protocol typing. | keep |
| `TestActor` | 10 | review | Compile-time helper for ActorConfig / protocol typing. | medium |
| `TestActorHsm` | 1 | review | Compile-time helper for ActorConfig / protocol typing. | high |
| `TestOwnerActorHsm` | 4 | review | Compile-time helper for ActorConfig / protocol typing. | medium |
| `TimerHandle` | 13 | review | Compile-time helper for ActorConfig / protocol typing. | medium |
| `TopStateArg` | 20 | yes | Compile-time helper for ActorConfig / protocol typing. | keep |
| `TraceWriter` | 46 | yes | Compile-time helper for ActorConfig / protocol typing. | keep |
| `TracedMessage` | 5 | review | Compile-time helper for ActorConfig / protocol typing. | medium |
| `TransitionResolver` | 16 | yes | Compile-time helper for ActorConfig / protocol typing. | keep |
| `TransitionRoutineExecuteOptions` | 4 | review | Compile-time helper for ActorConfig / protocol typing. | medium |
| `TransitionRoutinePlan` | 4 | review | Compile-time helper for ActorConfig / protocol typing. | medium |
| `TransitionRoutineStyle` | 5 | review | Compile-time helper for ActorConfig / protocol typing. | medium |
| `TransitionRoutineTrace` | 6 | review | Compile-time helper for ActorConfig / protocol typing. | medium |
| `TransitionTraceHost` | 4 | review | Compile-time helper for ActorConfig / protocol typing. | medium |

## Internal layout (post-refactor)

| Path | Role |
|------|------|
| `internal/runtime.ts` | `Machine` / `HsmObject` — actor runtime, facades, dispatch, ports |
| `internal/hsm.ts` | HsmObject — task queue, sync, transition state, tracing |
| `internal/factories.ts` | makeActor / makeInternalActor / makeOwnerActor |
| `internal/actor-dispatch.ts` | Service/notification dispatch with transition resolver |
| `internal/actor-types.ts` | ActorConfig + handle types (type-only) |
| `internal/dispatch.{production,debug,trace}.ts` | Notification handler execution + init |
| `internal/transition-routines.ts` | LCA exit/entry execution |
| `internal/protocol-index.ts` | Manifest → runtime protocol map |
| `internal/handles.ts` | Generated actor method surfaces |
| `internal/legacy.types.ts` | **removed** — was v1 post/call typing |

## Recommended trim order (runtime symbols)

1. **Stop exporting** transition oracle helpers (`createHsmTransitionTrace`, `planTransitionClasses`, `executeTransitionRoutine`, `transitionTraceLines`) — move to `@ihsm/tools` or test-only entry.

2. **Stop exporting** `buildProtocolIndex`, `RuntimeTransitionResolver`, `TransitionResolver` — keep internal unless custom transition tables are a public feature.

3. **Collapse** `makeActor` / `makeInternalActor` / `makeOwnerActor` into one factory + options if width distinction can be inferred from port type.

4. **Merge** error classes sharing `HsmError` shape where catch-by-name is not required.

5. **Drop** `getStateName` from public API if only used in tests/docs — keep on `Properties.currentStateName` at runtime.

6. **Types**: keep a single `types.ts` re-export barrel; never emit runtime for type-only symbols.

