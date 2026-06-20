/** Instrumentation helpers — non-throwing observer guard and task metadata (CORE-B). */

import type { CauseRef, DispatchError, EnqueueInfo, Instrumentation, LogRecord, MacrostepBegin, MacrostepEnd, MicrostepBegin, MicrostepEnd, NotificationQueue, OutboundCallBegin, OutboundCallEnd, PortCallBegin, PortCallEnd, SpawnInfo, TransitionTracer } from './types';
import type { Task } from './types';

export const kTaskMeta = Symbol('ihsm.taskMeta');

export interface TaskMeta {
	readonly event?: string;
	readonly queue?: NotificationQueue;
	readonly internal?: boolean;
	readonly triggerKind?: MacrostepBegin['triggerKind'];
	cause?: CauseRef;
	/** For deferred/timer enqueues — the scheduled delay, surfaced on the timer span link. */
	readonly delayMs?: number;
	/** Microstep correlation, stamped at task begin so begin/end pair correctly across nested priority drains. */
	seq?: number;
	/** Leaf state captured at task begin — pairs with `seq` for a correct `transitioned` at task end. */
	fromState?: string;
}

export type InstrumentedTask = Task & { [kTaskMeta]?: TaskMeta };

export function setTaskMeta(task: Task, meta: TaskMeta): void {
	(task as InstrumentedTask)[kTaskMeta] = meta;
}

export function getTaskMeta(task: Task): TaskMeta | undefined {
	return (task as InstrumentedTask)[kTaskMeta];
}

export function invokeInstrumentation(fn: () => void): void {
	try {
		fn();
	} catch {
		/* observer must never escape */
	}
}

export function notifyActorCreated(instrumentation: Instrumentation | undefined, id: MacrostepBegin['actor']): void {
	if (instrumentation?.onActorCreated === undefined) return;
	invokeInstrumentation(() => instrumentation.onActorCreated!(id));
}

export function notifyMacrostepBegin(instrumentation: Instrumentation | undefined, info: MacrostepBegin): void {
	if (instrumentation?.onMacrostepBegin === undefined) return;
	invokeInstrumentation(() => instrumentation.onMacrostepBegin!(info));
}

export function notifyMacrostepEnd(instrumentation: Instrumentation | undefined, info: MacrostepEnd): void {
	if (instrumentation?.onMacrostepEnd === undefined) return;
	invokeInstrumentation(() => instrumentation.onMacrostepEnd!(info));
}

export function notifyActorSpawned(instrumentation: Instrumentation | undefined, info: SpawnInfo): void {
	if (instrumentation?.onActorSpawned === undefined) return;
	invokeInstrumentation(() => instrumentation.onActorSpawned!(info));
}

export function notifyMicrostepBegin(instrumentation: Instrumentation | undefined, info: MicrostepBegin): void {
	if (instrumentation?.onMicrostepBegin === undefined) return;
	invokeInstrumentation(() => instrumentation.onMicrostepBegin!(info));
}

export function notifyMicrostepEnd(instrumentation: Instrumentation | undefined, info: MicrostepEnd): void {
	if (instrumentation?.onMicrostepEnd === undefined) return;
	invokeInstrumentation(() => instrumentation.onMicrostepEnd!(info));
}

export function notifyEnqueue(instrumentation: Instrumentation | undefined, info: EnqueueInfo): void {
	if (instrumentation?.onEnqueue === undefined) return;
	invokeInstrumentation(() => instrumentation.onEnqueue!(info));
}

export function notifyPortCallBegin(instrumentation: Instrumentation | undefined, info: PortCallBegin): void {
	if (instrumentation?.onPortCallBegin === undefined) return;
	invokeInstrumentation(() => instrumentation.onPortCallBegin!(info));
}

export function notifyPortCallEnd(instrumentation: Instrumentation | undefined, info: PortCallEnd): void {
	if (instrumentation?.onPortCallEnd === undefined) return;
	invokeInstrumentation(() => instrumentation.onPortCallEnd!(info));
}

export function notifyOutboundCallBegin(instrumentation: Instrumentation | undefined, info: OutboundCallBegin): void {
	if (instrumentation?.onOutboundCallBegin === undefined) return;
	invokeInstrumentation(() => instrumentation.onOutboundCallBegin!(info));
}

export function notifyOutboundCallEnd(instrumentation: Instrumentation | undefined, info: OutboundCallEnd): void {
	if (instrumentation?.onOutboundCallEnd === undefined) return;
	invokeInstrumentation(() => instrumentation.onOutboundCallEnd!(info));
}

export function notifyError(instrumentation: Instrumentation | undefined, info: DispatchError): void {
	if (instrumentation?.onError === undefined) return;
	invokeInstrumentation(() => instrumentation.onError!(info));
}

export function notifyLog(instrumentation: Instrumentation | undefined, record: LogRecord): void {
	if (instrumentation?.onLog === undefined) return;
	invokeInstrumentation(() => instrumentation.onLog!(record));
}

//#region global collector registry (cross-cutting tracing — CORE-B)

/**
 * Tracing is a **globally enforced protocol**, not a per-actor parameter: a process registers one or
 * more collectors once, and every actor created afterwards reports to them automatically — actor
 * construction and handler code stay free of any tracing argument.
 *
 * Actors snapshot the active instrumentation at spawn: a collector registered before an actor is
 * created observes it, the dispatch-context/ALS cost is only paid by actors spawned while a collector
 * is active, and later register/unregister calls do not retroactively change already-spawned actors.
 * A parent and the children it spawns while the same set is registered share one collector instance,
 * which is what makes cross-actor span links work.
 */
const collectors: Instrumentation[] = [];
let aggregator: Instrumentation | undefined;

/** Invoke `call` against every collector in order, each isolated so one throw never starves the rest. */
function each(list: Instrumentation[], call: (c: Instrumentation) => void): void {
	for (const c of list) invokeInstrumentation(() => call(c));
}

function buildTransitionFanout(list: Instrumentation[]): TransitionTracer | undefined {
	const tracers: TransitionTracer[] = list.map(c => c.transition).filter((t): t is TransitionTracer => t !== undefined);
	if (tracers.length === 0) return undefined;
	const run = (call: (t: TransitionTracer) => void): void => {
		for (const t of tracers) invokeInstrumentation(() => call(t));
	};
	return {
		traceTransitionStart: (from, to) => run(t => t.traceTransitionStart?.(from, to)),
		traceInitializeStart: state => run(t => t.traceInitializeStart?.(state)),
		traceInitializeDone: final => run(t => t.traceInitializeDone?.(final)),
		traceHookStart: (state, hook) => run(t => t.traceHookStart?.(state, hook)),
		traceHookDone: (state, hook) => run(t => t.traceHookDone?.(state, hook)),
		traceHookSkipped: (state, hook) => run(t => t.traceHookSkipped?.(state, hook)),
		traceHookError: (state, hook, cause) => run(t => t.traceHookError?.(state, hook, cause)),
		traceTransitionDone: final => run(t => t.traceTransitionDone?.(final)),
	};
}

/** Compose N collectors into one `Instrumentation` that fans every callback out to each, in order. */
function buildAggregator(list: Instrumentation[]): Instrumentation {
	const agg: Instrumentation = {
		onActorCreated: id => each(list, c => c.onActorCreated?.(id)),
		onActorSpawned: info => each(list, c => c.onActorSpawned?.(info)),
		onActorDisposed: id => each(list, c => c.onActorDisposed?.(id)),
		onMacrostepBegin: info => each(list, c => c.onMacrostepBegin?.(info)),
		onMacrostepEnd: info => each(list, c => c.onMacrostepEnd?.(info)),
		onMicrostepBegin: info => each(list, c => c.onMicrostepBegin?.(info)),
		onMicrostepEnd: info => each(list, c => c.onMicrostepEnd?.(info)),
		onPortCallBegin: info => each(list, c => c.onPortCallBegin?.(info)),
		onPortCallEnd: info => each(list, c => c.onPortCallEnd?.(info)),
		onOutboundCallBegin: info => each(list, c => c.onOutboundCallBegin?.(info)),
		onOutboundCallEnd: info => each(list, c => c.onOutboundCallEnd?.(info)),
		onEnqueue: info => each(list, c => c.onEnqueue?.(info)),
		onError: info => each(list, c => c.onError?.(info)),
		onLog: record => each(list, c => c.onLog?.(record)),
	};
	const transition = buildTransitionFanout(list);
	if (transition !== undefined) agg.transition = transition;
	return agg;
}

function rebuildAggregator(): void {
	aggregator = collectors.length === 0 ? undefined : collectors.length === 1 ? collectors[0] : buildAggregator(collectors.slice());
}

/**
 * Register a tracing collector globally. Every actor spawned while it is registered reports to it.
 * Returns an idempotent unregister function. Multiple collectors fan out in registration order.
 */
export function registerCollector(collector: Instrumentation): () => void {
	collectors.push(collector);
	rebuildAggregator();
	let removed = false;
	return (): void => {
		if (removed) return;
		removed = true;
		const i: number = collectors.indexOf(collector);
		if (i >= 0) collectors.splice(i, 1);
		rebuildAggregator();
	};
}

/** Remove every registered collector (primarily for test isolation). */
export function clearCollectors(): void {
	collectors.length = 0;
	aggregator = undefined;
}

/** The composed instrumentation an actor adopts at spawn — `undefined` when no collector is registered. */
export function getActiveInstrumentation(): Instrumentation | undefined {
	return aggregator;
}

/** Number of currently-registered collectors (diagnostics/tests). */
export function getCollectorCount(): number {
	return collectors.length;
}

//#endregion
