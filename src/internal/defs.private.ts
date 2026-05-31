import { PostedEvent, EventPayload, Hsm, StateClass, State } from '../';

/** @internal */
export interface Instance<Context, Protocol extends {} | undefined> {
	ctx: Context;
	hsm: HsmWithTracing<Context, Protocol>;
}

/** @internal */
export interface Transition<Context, Protocol extends {} | undefined> {
	execute(hsm: HsmWithTracing<Context, Protocol>, srcState: StateClass<Context, Protocol>, dstState: StateClass<Context, Protocol>): Promise<void>;
}

/** @internal */
export type DoneCallback = () => void;

/** @internal */
export type Task = (done: DoneCallback) => void;

/** @internal */
export interface HsmWithTracing<Context, Protocol extends {} | undefined> extends Hsm<Context, Protocol>, State<Context, Protocol> {
	_transitionCache: Map<string, Transition<Context, Protocol>>;
	_createInitTask: <DispatchContext, DispatchProtocol extends {} | undefined>(hsm: HsmWithTracing<DispatchContext, DispatchProtocol>) => Task;
	_createEventDispatchTask: <DispatchContext, DispatchProtocol extends {} | undefined, EventName extends keyof DispatchProtocol>(hsm: HsmWithTracing<DispatchContext, DispatchProtocol>, eventName: PostedEvent<DispatchProtocol, EventName>, ...eventPayload: EventPayload<DispatchProtocol, EventName>) => Task;
	_instance: Instance<Context, Protocol>;
	_transitionState?: StateClass<Context, Protocol>;
	_currentEventName?: string;
	_currentEventPayload?: any[];
	currentState: StateClass<Context, Protocol>;

	_tracePush(domain: string, msg: string): void;
	_tracePopDone(msg: string): void;
	_tracePopError(msg: string): void;
	_traceWrite(msg: any): void;

	unshiftHiPriorityTask(t: Task): void;
	pushHiPriorityTask(t: Task): void;
}
