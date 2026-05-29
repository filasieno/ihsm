import { HsmDispatchErrorCallback, HsmEventHandlerName, HsmEventHandlerPayload, HsmServiceResponse, HsmServiceName, HsmServiceRequest, HsmStateClass, HsmTraceLevel, HsmTraceWriter, HsmUnhandledEventError } from '../';
import { HsmWithTracing, Instance, Task, Transition } from './defs.private';
import { createEventDispatchTask as createEventDispatchVerboseDebug, createInitTask as createInitVerboseDebug } from './dispatch.trace';
import { createEventDispatchTask as createEventDispatchDebug, createInitTask as createInitTaskDebug } from './dispatch.debug';
import { createEventDispatchTask as createEventDispatchProduction, createInitTask as createInitTaskProduction } from './dispatch.production';

function mapInitTaskFactory(traceLevel: HsmTraceLevel): <DispatchContext, DispatchProtocol extends {} | undefined>(hsm: HsmWithTracing<DispatchContext, DispatchProtocol>) => Task {
	switch (traceLevel) {
		case HsmTraceLevel.PRODUCTION:
			return createInitTaskProduction;
		case HsmTraceLevel.DEBUG:
			return createInitTaskDebug;
		case HsmTraceLevel.VERBOSE_DEBUG:
			return createInitVerboseDebug;
	}
}

function mapEventDispatchTaskFactory(traceLevel: HsmTraceLevel): <DispatchContext, DispatchProtocol extends {} | undefined, EventName extends keyof DispatchProtocol>(hsm: HsmWithTracing<DispatchContext, DispatchProtocol>, eventName: HsmEventHandlerName<DispatchProtocol, EventName>, ...eventPayload: HsmEventHandlerPayload<DispatchProtocol, EventName>) => Task {
	switch (traceLevel) {
		case HsmTraceLevel.PRODUCTION:
			return createEventDispatchProduction;
		case HsmTraceLevel.DEBUG:
			return createEventDispatchDebug;
		case HsmTraceLevel.VERBOSE_DEBUG:
			return createEventDispatchVerboseDebug;
	}
}

/** @internal */
// prettier-ignore
export class HsmObject<Context, Protocol extends {} | undefined> implements HsmWithTracing<Context, Protocol> {

	public topState: HsmStateClass<Context, Protocol>;
	public topStateName: string;
	public readonly ctxTypeName: string;
	public traceWriter: HsmTraceWriter;

	public _instance: Instance<Context, Protocol>;
	public _transitionCache: Map<string, Transition<Context, Protocol>> = new Map();
	public _jobs: Task[];
	private _isRunning = false;
	public _transitionState?: HsmStateClass<Context, Protocol>;

	public _currentEventName?: string;
	public _currentEventPayload?: any[];
	public dispatchErrorCallback: HsmDispatchErrorCallback<Context, Protocol>;
	private _traceLevel: HsmTraceLevel;
	private _traceDomainStack: string[];
	public _createInitTask: <DispatchContext, DispatchProtocol extends {} | undefined>(hsm: HsmWithTracing<DispatchContext, DispatchProtocol>) => Task;
	public _createEventDispatchTask: <DispatchContext, DispatchProtocol extends {} | undefined, EventName extends keyof DispatchProtocol>(hsm: HsmWithTracing<DispatchContext, DispatchProtocol>, eventName: HsmEventHandlerName<DispatchProtocol, EventName>, ...eventPayload: HsmEventHandlerPayload<DispatchProtocol, EventName>) => Task;

	constructor(
		TopState: HsmStateClass<Context, Protocol>,
		instance: Instance<Context, Protocol>,
		traceWriter: HsmTraceWriter,
		traceLevel: HsmTraceLevel,
		dispatchErrorCallback: HsmDispatchErrorCallback<Context, Protocol>,
		initialize: boolean
	) {
		this._instance = instance;
		this._transitionState = undefined;
		this._transitionCache = new Map();
		this._traceLevel = traceLevel;
		this._currentEventName = undefined;
		this._currentEventPayload = undefined;
		this._traceDomainStack = [];
		this._createInitTask = mapInitTaskFactory(traceLevel);
		this._createEventDispatchTask = mapEventDispatchTaskFactory(traceLevel);
		this._jobs = [];
		this._isRunning = false;


		this.topState = TopState;
		this.topStateName = TopState.name;
		this.ctxTypeName = Object.getPrototypeOf(instance.ctx).constructor.name;
		this.currentState = TopState;
		this.traceWriter = traceWriter;
		this.dispatchErrorCallback = dispatchErrorCallback;


		if (initialize) {
			this.pushTask(this._createInitTask(this));
		}
	}

	get ctx(): Context {
		return this._instance.ctx;
	}
	set ctx(ctx: Context){
		this._instance.ctx = ctx;
	}
	// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
	get eventName(): string { return this._currentEventName!; }
	// eslint-disable-next-line @typescript-eslint/no-explicit-any,@typescript-eslint/no-non-null-assertion
	get eventPayload(): any[] { return this._currentEventPayload!; }
	get currentStateName(): string { return Object.getPrototypeOf(this._instance).constructor.name; }
	get currentState(): HsmStateClass<Context, Protocol> { return Object.getPrototypeOf(this._instance).constructor; }
	set currentState(newState: HsmStateClass<Context, Protocol>) { Object.setPrototypeOf(this._instance, newState.prototype); }
	post<EventName extends keyof Protocol>(eventName: HsmEventHandlerName<Protocol, EventName>, ...eventPayload: HsmEventHandlerPayload<Protocol, EventName>): void { this.pushTask(this._createEventDispatchTask(this, eventName, ...eventPayload)); }
	deferredPost<EventName extends keyof Protocol>(millis: number, eventName: HsmEventHandlerName<Protocol, EventName>, ...eventPayload: HsmEventHandlerPayload<Protocol, EventName>): void {
		setTimeout(
			() => this.pushTask(this._createEventDispatchTask(this, eventName, ...eventPayload)),
			millis);
	}
	transition(nextState: HsmStateClass<Context, Protocol>): void { this._transitionState = nextState; }
	unhandled(): never { throw new HsmUnhandledEventError(this); }
	sleep(millis: number): Promise<void> { return new Promise(resolve => setTimeout(() => resolve(), millis)); }

	get traceLevel(): HsmTraceLevel {
		return this._traceLevel;
	}

	set traceLevel(traceLevel: HsmTraceLevel) {
		this._createInitTask = mapInitTaskFactory(traceLevel);
		this._createEventDispatchTask = mapEventDispatchTaskFactory(traceLevel);
		this._traceLevel = traceLevel;
	}

	sync(): Promise<void> {
		return new Promise(resolve => {
			this.pushTask((doneCallback: () => void): void => {
				resolve();
				doneCallback();
			});
		});
	}

	public pushTask(t: (done: () => void) => void): void {
		this._jobs.push(t);
		if (this._isRunning) return;
		this._isRunning = true;
		this.dequeue();
	}

	public restore(state: HsmStateClass<Context, Protocol>, ctx: Context): void {
		this.currentState = state;
		this.ctx = ctx;
	}

	private dequeue(): void {
		if (this._jobs.length == 0) {
			this._isRunning = false;
			return;
		}
		const task = this._jobs.shift();
		// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
		this.exec(task!);
	}

	private exec(task: Task): void {
		setTimeout(() => Promise.resolve()
			.then(() => new Promise<void>((resolve: () => void) => task(resolve)))
			.then(() => this.dequeue()), 0);
	}

	public _tracePush(d: string, msg: string): void {
		this._traceDomainStack.push(d);
		this.traceWriter.write(this, msg);
	}

	public _tracePopDone(msg: string): void {
		this.traceWriter.write(this, `done: ${msg}`);
		this._traceDomainStack.pop();
	}

	public _tracePopError(msg: string): void{
		this.traceWriter.write(this, `failure: ${msg}`);
		this._traceDomainStack.pop();
	}

	public _traceWrite(msg: any): void {
		this.traceWriter.write(this, msg)
	}

	get traceHeader(): string {
		return `${this._traceDomainStack.length === 0 ? '' : this._traceDomainStack.join('|') + '|'}`;
	}

	call<EventName extends keyof Protocol>(eventName: HsmServiceName<Protocol, EventName>, ...eventPayload: HsmServiceRequest<Protocol, EventName>): Promise<HsmServiceResponse<Protocol, EventName>> {
		return new Promise<HsmServiceResponse<Protocol, EventName>>((resolve: (result: HsmServiceResponse<Protocol, EventName>) => void, reject: (error: Error) => void) => {
			const taskFactory: (hsm: any, name: HsmServiceName<Protocol, EventName>, ...payload: any[]) => Task = this._createEventDispatchTask as any;
			this.pushTask(taskFactory(this, eventName, ...[resolve, reject, ...eventPayload]));
		});
	}

}
