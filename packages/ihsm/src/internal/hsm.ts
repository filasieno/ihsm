import { Disposable, DispatchErrorCallback, EventObserver, PostedEvent, EventPayload, ServiceResponse, ServiceName, ServiceRequest, StateClass, TraceLevel, TraceWriter, UnhandledEventError } from '../';
import { HsmWithTracing, Instance, Task, Transition } from './defs.private';
import { createEventDispatchTask as createEventDispatchVerboseDebug, createInitTask as createInitVerboseDebug } from './dispatch.trace';
import { createEventDispatchTask as createEventDispatchDebug, createInitTask as createInitTaskDebug } from './dispatch.debug';
import { createEventDispatchTask as createEventDispatchProduction, createInitTask as createInitTaskProduction } from './dispatch.production';
import { getStateName } from './utils';

function mapInitTaskFactory(traceLevel: TraceLevel): <DispatchContext, DispatchProtocol extends {} | undefined>(hsm: HsmWithTracing<DispatchContext, DispatchProtocol>) => Task {
	switch (traceLevel) {
		case TraceLevel.PRODUCTION:
			return createInitTaskProduction;
		case TraceLevel.DEBUG:
			return createInitTaskDebug;
		case TraceLevel.VERBOSE_DEBUG:
			return createInitVerboseDebug;
	}
}

function mapEventDispatchTaskFactory(traceLevel: TraceLevel): <DispatchContext, DispatchProtocol extends {} | undefined, EventName extends keyof DispatchProtocol>(hsm: HsmWithTracing<DispatchContext, DispatchProtocol>, eventName: PostedEvent<DispatchProtocol, EventName>, ...eventPayload: EventPayload<DispatchProtocol, EventName>) => Task {
	switch (traceLevel) {
		case TraceLevel.PRODUCTION:
			return createEventDispatchProduction;
		case TraceLevel.DEBUG:
			return createEventDispatchDebug;
		case TraceLevel.VERBOSE_DEBUG:
			return createEventDispatchVerboseDebug;
	}
}

/** @internal */
// prettier-ignore
export class HsmObject<Context, Protocol extends {} | undefined> implements HsmWithTracing<Context, Protocol> {

	public topState: StateClass<Context, Protocol>;
	public topStateName: string;
	public readonly ctxTypeName: string;
	public traceWriter: TraceWriter;

	public _instance: Instance<Context, Protocol>;
	public _transitionCache: Map<string, Transition<Context, Protocol>> = new Map();
	public _jobs: Task[];
	public _hiPriorityJobs: Task[];
	private _isRunning = false;
	public _transitionState?: StateClass<Context, Protocol>;

	public _currentEventName?: string;
	public _currentEventPayload?: any[];
	private _observers?: Set<EventObserver>;
	public dispatchErrorCallback: DispatchErrorCallback<Context, Protocol>;
	private _traceLevel: TraceLevel;
	private _traceDomainStack: string[];
	public _createInitTask: <DispatchContext, DispatchProtocol extends {} | undefined>(hsm: HsmWithTracing<DispatchContext, DispatchProtocol>) => Task;
	public _createEventDispatchTask: <DispatchContext, DispatchProtocol extends {} | undefined, EventName extends keyof DispatchProtocol>(hsm: HsmWithTracing<DispatchContext, DispatchProtocol>, eventName: PostedEvent<DispatchProtocol, EventName>, ...eventPayload: EventPayload<DispatchProtocol, EventName>) => Task;

	constructor(
		TopState: StateClass<Context, Protocol>,
		instance: Instance<Context, Protocol>,
		traceWriter: TraceWriter,
		traceLevel: TraceLevel,
		dispatchErrorCallback: DispatchErrorCallback<Context, Protocol>,
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
		this._hiPriorityJobs = [];
		this._isRunning = false;


		this.topState = TopState;
		this.topStateName = getStateName(TopState);
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

	/** Outbound boundary supplied to (or defaulted by) the factory (see {@link makeHsm}); never `undefined` at runtime. */
	get port(): unknown {
		return this._instance.portRef;
	}
	 
	get eventName(): string { return this._currentEventName!; }
	 
	get eventPayload(): any[] { return this._currentEventPayload!; }
	get currentStateName(): string { return getStateName(Object.getPrototypeOf(this._instance).constructor); }
	get currentState(): StateClass<Context, Protocol> { return Object.getPrototypeOf(this._instance).constructor; }
	set currentState(newState: StateClass<Context, Protocol>) { Object.setPrototypeOf(this._instance, newState.prototype); }
	post<EventName extends keyof Protocol>(eventName: PostedEvent<Protocol, EventName>, ...eventPayload: EventPayload<Protocol, EventName>): void { this._notifyObservers(eventName as any, eventPayload); this.pushTask(this._createEventDispatchTask(this, eventName, ...eventPayload)); }
	postNow<EventName extends keyof Protocol>(eventName: PostedEvent<Protocol, EventName>, ...eventPayload: EventPayload<Protocol, EventName>): void { this._notifyObservers(eventName as any, eventPayload); this.pushHiPriorityTask(this._createEventDispatchTask(this, eventName, ...eventPayload)); }

	/** Register a test-only observer; returns a Disposable that removes it. See {@link TestActor.subscribe}. */
	subscribe(observer: EventObserver): Disposable {
		if (this._observers === undefined) this._observers = new Set();
		this._observers.add(observer);
		return {
			dispose: (): void => {
				this._observers?.delete(observer);
			},
		};
	}

	private _notifyObservers(eventName: string | number | symbol, eventPayload: any[]): void {
		if (this._observers === undefined || this._observers.size === 0) return;
		const message = { event: String(eventName), payload: [...eventPayload] };
		for (const observer of this._observers) observer(message);
	}
	deferredPost<EventName extends keyof Protocol>(millis: number, eventName: PostedEvent<Protocol, EventName>, ...eventPayload: EventPayload<Protocol, EventName>): void {
		const enqueue = (): void => { this.pushTask(this._createEventDispatchTask(this, eventName, ...eventPayload)); };
		// Use the port's timer service when available (Port / TestPort always provide setTimeout);
		// fall back to global setTimeout for bare BasePort subclasses that omit it.
		const port = this._instance.portRef as { setTimeout?: (callback: () => void, millis?: number) => unknown } | undefined;
		if (port !== undefined && typeof port.setTimeout === 'function') {
			port.setTimeout(enqueue, millis);
		} else {
			setTimeout(enqueue, Math.max(0, millis));
		}
	}
	transition(nextState: StateClass<Context, Protocol>): void { this._transitionState = nextState; }
	unhandled(): never { throw new UnhandledEventError(this); }
	sleep(millis: number): Promise<void> { return new Promise(resolve => setTimeout(() => resolve(), millis)); }

	get traceLevel(): TraceLevel {
		return this._traceLevel;
	}

	set traceLevel(traceLevel: TraceLevel) {
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
		this.enqueueTask(t, this._jobs);
	}

	public pushHiPriorityTask(t: (done: () => void) => void): void {
		this.enqueueTask(t, this._hiPriorityJobs);
	}

	public unshiftHiPriorityTask(t: (done: () => void) => void): void {
		this._hiPriorityJobs.unshift(t);
		if (this._isRunning) return;
		this._isRunning = true;
		this.dequeue();
	}

	private enqueueTask(t: Task, queue: Task[]): void {
		queue.push(t);
		if (this._isRunning) return;
		this._isRunning = true;
		this.dequeue();
	}

	public restore(state: StateClass<Context, Protocol>, ctx: Context): void {
		this.currentState = state;
		this.ctx = ctx;
	}

	private dequeue(): void {
		if (this._hiPriorityJobs.length == 0 && this._jobs.length == 0) {
			this._isRunning = false;
			return;
		}
		const task = this._hiPriorityJobs.length > 0 ? this._hiPriorityJobs.shift()! : this._jobs.shift()!;
		this.exec(task);
	}

	private exec(task: Task): void {
		setTimeout(() => this.runTask(task).then(() => this.dequeue()), 0);
	}

	private runTask(task: Task): Promise<void> {
		return new Promise<void>(resolve => {
			task(() => {
				this.drainHiPriority().then(resolve);
			});
		});
	}

	private drainHiPriority(): Promise<void> {
		if (this._hiPriorityJobs.length === 0) {
			return Promise.resolve();
		}
		const task = this._hiPriorityJobs.shift()!;
		return this.runTask(task).then(() => this.drainHiPriority());
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

	call<EventName extends keyof Protocol>(eventName: ServiceName<Protocol, EventName>, ...eventPayload: ServiceRequest<Protocol, EventName>): Promise<ServiceResponse<Protocol, EventName>> {
		this._notifyObservers(eventName as any, eventPayload as any[]);
		return new Promise<ServiceResponse<Protocol, EventName>>((resolve: (result: ServiceResponse<Protocol, EventName>) => void, reject: (error: Error) => void) => {
			const taskFactory: (hsm: any, name: ServiceName<Protocol, EventName>, ...payload: any[]) => Task = this._createEventDispatchTask as any;
			this.pushTask(taskFactory(this, eventName, ...[resolve, reject, ...eventPayload]));
		});
	}

}
