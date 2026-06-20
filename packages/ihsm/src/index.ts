/**
 * ihsm — hierarchical state machines for TypeScript.
 *
 * Curated public runtime surface; protocol types live in {@link ./types}.
 */
export {
	TraceLevel,
	asError,
	quoteUnknown,
	quoteError,
	getInitialState,
	hasInitialState,
	getTransitionKey,
	defineStateName,
	getStateName,
	Port,
	RequestingPort,
	TopState,
	HsmError,
	RuntimeError,
	TransitionError,
	EventHandlerError,
	UnhandledEventError,
	InitialStateError,
	FatalError,
	InitializationError,
	FatalErrorState,
	InitialState,
	registerStateNames,
	ProtocolCollisionError,
	ReservedNames,
	buildProtocolIndex,
	CallTimeoutError,
	SelfCallDeadlockError,
	TransitionTableError,
	planTransitionClasses,
	executeTransitionRoutine,
	createTransitionTracer,
	transitionTraceLines,
	RuntimeTransitionResolver,
	isRequestingPort,
	isServiceCallOptions,
	splitServiceArgs,
	serviceCallWithTimeout,
	currentTraceAnchor,
	defaultTraceWriter,
	defaultInitialize,
	defaultDispatchErrorCallback,
	makeActor,
	asParentActor,
	makeChildActor,
	kHandlerMachine,
	kParentLink,
	configureRunSeed,
	getRunSeed,
	getRunNamespace,
	mintActorIdentity,
} from './internal/runtime';
export { createConsoleInstrumentation } from './internal/console-instrumentation';
export { registerCollector, clearCollectors, getCollectorCount } from './internal/instrumentation';
export type * from './types';
export type { ConsoleInstrumentationOptions } from './internal/console-instrumentation';
export type { Any, DispatchErrorCallback, Disposable, EventObserver, MachinePortInput, IPort, Properties, RandomService, TimerService, DomainPortOf, PortServices, ResultWithSubscription, StateClass, StateEvents, TraceWriter, TracedMessage } from './internal/types';
