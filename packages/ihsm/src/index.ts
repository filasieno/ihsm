/**
 * ihsm — hierarchical state machines for TypeScript.
 *
 * Runtime values from {@link ./internal/runtime}; protocol types from {@link ./types}.
 */
export * from './internal/runtime';
export type * from './types';
export type { Any, DispatchErrorCallback, Disposable, EventObserver, MachinePortInput, IPort, Properties, RandomService, TimerService, DomainPortOf, PortServices, ResultWithSubscription, StateClass, StateEvents, TraceWriter, TracedMessage } from './internal/types';
