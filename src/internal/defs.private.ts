import { HsmEventHandlerName, HsmEventHandlerPayload, Hsm, HsmStateClass, HsmState } from '../';

/** @internal */
export interface Instance<Context, Protocol extends {} | undefined> {
	ctx: Context;
	hsm: HsmWithTracing<Context, Protocol>;
}

/** @internal */
export interface Transition<Context, Protocol extends {} | undefined> {
	execute(hsm: HsmWithTracing<Context, Protocol>, srcState: HsmStateClass<Context, Protocol>, dstState: HsmStateClass<Context, Protocol>): Promise<void>;
}

/** @internal */
export type DoneCallback = () => void;

/** @internal */
export type Task = (done: DoneCallback) => void;

/** @internal */
export interface HsmWithTracing<Context, Protocol extends {} | undefined> extends Hsm<Context, Protocol>, HsmState<Context, Protocol> {
	_transitionCache: Map<string, Transition<Context, Protocol>>;
	_createInitTask: <DispatchContext, DispatchProtocol extends {} | undefined>(hsm: HsmWithTracing<DispatchContext, DispatchProtocol>) => Task;
	_createEventDispatchTask: <DispatchContext, DispatchProtocol extends {} | undefined, EventName extends keyof DispatchProtocol>(hsm: HsmWithTracing<DispatchContext, DispatchProtocol>, eventName: HsmEventHandlerName<DispatchProtocol, EventName>, ...eventPayload: HsmEventHandlerPayload<DispatchProtocol, EventName>) => Task;
	_instance: Instance<Context, Protocol>;
	_transitionState?: HsmStateClass<Context, Protocol>;
	_currentEventName?: string;
	_currentEventPayload?: any[];
	currentState: HsmStateClass<Context, Protocol>;

	_tracePush(domain: string, msg: string): void;
	_tracePopDone(msg: string): void;
	_tracePopError(msg: string): void;
	_traceWrite(msg: any): void;
}
