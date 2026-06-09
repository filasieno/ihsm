import { TopState, EventHandlerError, PostedEvent, EventPayload, FatalErrorState, InitializationError, FatalError, RuntimeError, StateClass, TransitionError, UnhandledEventError } from '../';

import { DoneCallback, HsmWithTracing, Task, Transition } from './defs.private';
import { createHsmTransitionTrace, executeTransitionRoutine, planTransitionClasses } from './transition-routines';
import { asError, getInitialState, getTransitionKey, hasInitialState, quoteUnknown, getStateName } from './utils';

function finishEventDispatch<Context, Protocol extends {} | undefined>(hsm: HsmWithTracing<Context, Protocol>): void {
	hsm._traceWrite(`end event dispatch`);
	hsm._currentEventName = undefined;
	hsm._currentEventPayload = undefined;
}

async function completePendingTransitions<Context, Protocol extends {} | undefined>(hsm: HsmWithTracing<Context, Protocol>, onComplete: () => void): Promise<void> {
	await doTransition(hsm);
	onComplete();
}

/** @internal */
class TraceTransition<Context, Protocol extends {} | undefined> implements Transition<Context, Protocol> {
	constructor(private plan: ReturnType<typeof planTransitionClasses<Context, Protocol>>) {}

	async execute(hsm: HsmWithTracing<Context, Protocol>, srcState: StateClass<Context, Protocol>, dstState: StateClass<Context, Protocol>): Promise<void> {
		await executeTransitionRoutine(hsm, hsm._instance, this.plan, srcState, dstState, {
			style: 'verbose',
			trace: createHsmTransitionTrace(hsm),
			setCurrentState: state => {
				hsm.currentState = state;
			},
		});
	}
}

/** @internal */
function createTransition<Context, Protocol extends {} | undefined>(srcState: StateClass<Context, Protocol>, destState: StateClass<Context, Protocol>): Transition<Context, Protocol> {
	return new TraceTransition(planTransitionClasses(srcState, destState));
}

/** @internal */
async function doTransition<Context, Protocol extends {} | undefined>(hsm: HsmWithTracing<Context, Protocol>): Promise<void> {
	if (hsm._transitionState) {
		try {
			const srcState = hsm.currentState;
			const destState = hsm._transitionState;
			hsm._traceWrite(`requested transition from ${getStateName(srcState)} to ${getStateName(destState)} `);
			const transitionKey = getTransitionKey(srcState, destState);
			let tr: Transition<Context, Protocol> | undefined = hsm._transitionCache.get(transitionKey);
			if (tr) {
				hsm._traceWrite(`transition cache hit for ${getStateName(srcState)} to ${getStateName(destState)} `);
			} else {
				hsm._traceWrite(`transition cache miss for ${getStateName(srcState)} to ${getStateName(destState)} `);
				tr = createTransition(srcState, destState);
				hsm._transitionCache.set(transitionKey, tr);
			}
			try {
				await tr.execute(hsm, srcState, destState);
			} catch (transitionError) {
				hsm.currentState = FatalErrorState;
				throw transitionError;
			}
		} finally {
			hsm._transitionState = undefined;
		}
	} else {
		hsm._traceWrite('no transition requested');
	}
}

/** @internal */
function lookupErrorHandler<Context, Protocol extends {} | undefined, EventName extends keyof Protocol>(hsm: HsmWithTracing<Context, Protocol>): (error: RuntimeError<Context, Protocol, EventName>) => Promise<void> | void {
	hsm._tracePush(`lookup`, `started lookup of #onError event handler`);
	let state = hsm.currentState;
	while (state != TopState) {
		const prototype = state.prototype;
		if (Object.prototype.hasOwnProperty.call(prototype, 'onError')) {
			hsm._tracePopDone(`found in state ${getStateName(state)}`);
			return prototype['onError'];
		} else {
			hsm._traceWrite(`not found in state ${getStateName(state)}`);
			state = Object.getPrototypeOf(state);
		}
	}
	hsm._tracePopDone(`found in state ${getStateName(TopState)}`);
	return TopState.prototype.onError;
}

/** @internal */
async function doError<Context, Protocol extends {} | undefined>(hsm: HsmWithTracing<Context, Protocol>, err: Error, onComplete: () => void): Promise<void> {
	hsm._transitionState = undefined;
	hsm._tracePush(`error recovery`, `started error recovery`);
	const messageHandler = lookupErrorHandler(hsm);
	try {
		hsm._tracePush('execute', 'started #onError handler execution');
		const result = messageHandler.call(hsm._instance, new EventHandlerError(hsm, err));
		if (result) {
			await result;
		}
		hsm._tracePopDone('error handler execution successful');
		await completePendingTransitions(hsm, () => {
			hsm._tracePopDone('error recovery successful');
			onComplete();
		});
	} catch (recoveryErr) {
		hsm._tracePopError(`error handler execution failure: ${quoteUnknown(recoveryErr)}`);
		if (recoveryErr instanceof TransitionError) {
			hsm._tracePopError(`error recovery failure: ${quoteUnknown(recoveryErr)}`);
			throw recoveryErr;
		}
		const err = asError(recoveryErr);
		hsm.transition(FatalErrorState);
		await completePendingTransitions(hsm, () => {
			hsm._tracePopError(`error recovery failure: ${quoteUnknown(err)}`);
			onComplete();
		});
		throw new FatalError(hsm, err);
	}
}

/** @internal */
function lookupUnhandled<Context, Protocol extends {} | undefined, EventName extends keyof Protocol>(hsm: HsmWithTracing<Context, Protocol>): (error: UnhandledEventError<Context, Protocol, EventName>) => Promise<void> | void {
	let state = hsm.currentState;
	hsm._tracePush(`lookup`, `started lookup of #onUnhandled event handler`);
	while (true) {
		const prototype = state.prototype;
		if (Object.prototype.hasOwnProperty.call(prototype, 'onUnhandled')) {
			hsm._tracePopDone(`found in state ${getStateName(state)}`);
			return prototype.onUnhandled;
		} else {
			hsm._traceWrite(`not found in state ${getStateName(state)}`);
			state = Object.getPrototypeOf(state);
			if (state == TopState) {
				hsm._tracePopDone(`found in state ${getStateName(state)}`);
				return prototype.onUnhandled;
			}
		}
	}
}

/** @internal */
async function doUnhandledEvent<Context, Protocol extends {} | undefined, EventName extends keyof Protocol>(hsm: HsmWithTracing<Context, Protocol>, error: UnhandledEventError<Context, Protocol, EventName>, onComplete: () => void): Promise<void> {
	hsm._tracePush('unhandled recovery', `started unhandled event recovery`);
	const messageHandler = lookupUnhandled(hsm);
	try {
		hsm._tracePush('execute', 'started #onUnhandled handler execution');
		const result = messageHandler.call(hsm._instance, error);
		if (result) {
			await result;
		}
		hsm._tracePopDone('unhandled handler execution successful');
		await completePendingTransitions(hsm, () => {
			hsm._tracePopDone('unhandled event recovery successful');
			onComplete();
		});
	} catch (recoveryErr) {
		hsm._tracePopError(`unhandled event recovery failure: ${quoteUnknown(recoveryErr)}`);

		if (recoveryErr instanceof TransitionError) {
			hsm.currentState = FatalErrorState;
			hsm._tracePopError(`unhandled event recovery failure: ${quoteUnknown(recoveryErr)}`);
			throw recoveryErr;
		}

		try {
			await doError(hsm, asError(recoveryErr), () => {
				hsm._tracePopDone('unhandled event recovery successful');
				onComplete();
			});
		} catch (nestedErr) {
			hsm._tracePopError(`unhandled event recovery failure: ${quoteUnknown(nestedErr)}`);
			throw nestedErr;
		}
	}
}

/**
 * @internal
 *
 * Verbose-mode event-handler lookup. This narrates, step by step, the **same** canonical algorithm
 * implemented (without tracing) by `lookupEventHandler` in `./lookup` and shared by the production /
 * debug dispatchers (proposal T6): walk the constructor chain from `currentState` up to and
 * including {@link TopState}, returning the first state that owns `eventName`. Keep the two in sync.
 */
function lookupEventHandler<Context, Protocol extends {} | undefined, EventName extends keyof Protocol>(hsm: HsmWithTracing<Context, Protocol>, eventName: PostedEvent<Protocol, EventName>): ((...args: EventPayload<Protocol, EventName>) => Promise<void> | void) | undefined {
	const eventLabel = String(eventName);
	let state = hsm.currentState;
	hsm._tracePush(`lookup`, `started lookup of #${eventLabel} event handler`);
	while (true) {
		const prototype = state.prototype;
		if (Object.prototype.hasOwnProperty.call(prototype, eventName)) {
			hsm._tracePopDone(`#${eventLabel} found in state ${getStateName(state)}`);
			return prototype[eventName];
		} else {
			hsm._traceWrite(`not found in state ${getStateName(state)}`);
			if (state == TopState) break;
			state = Object.getPrototypeOf(state);
		}
	}
	hsm._tracePopError(`not found in state ${hsm.currentStateName}`);
	return undefined;
}

/** @internal */
async function executeInit<Context, Protocol extends {} | undefined>(hsm: HsmWithTracing<Context, Protocol>): Promise<void> {
	hsm._traceWrite('begin initialization');
	try {
		let currState: StateClass<Context, Protocol> = hsm.topState;
		hsm._tracePush(`initialize`, `started initialization from ${getStateName(hsm.topState)}`);
		try {
			while (true) {
				if (Object.prototype.hasOwnProperty.call(currState.prototype, 'onEntry')) {
					currState.prototype['onEntry'].call(hsm._instance);
					hsm._traceWrite(`${getStateName(currState)}.onEntry() done`);
				} else {
					hsm._traceWrite(`skip ${getStateName(currState)}.onEntry(): default empty implementation`);
				}

				if (hasInitialState(currState)) {
					const newInitialState = getInitialState(currState);
					hsm._traceWrite(`${getStateName(currState)} initial state is ${getStateName(newInitialState)}`);
					currState = newInitialState;
				} else {
					hsm._traceWrite(`${getStateName(currState)} has no initial state; final state is ${getStateName(currState)}`);
					break;
				}
			}
			hsm._tracePopDone(`final state is ${getStateName(currState)}`);
			hsm.currentState = currState;
		} catch (cause) {
			if (cause instanceof TransitionError) {
				throw cause;
			}
			hsm._tracePopError(`initialization failed from top state '${getStateName(hsm.topState)}' as ${getStateName(currState)}.onEntry() handler has raised ${quoteUnknown(cause)}; final state is ${getStateName(FatalErrorState)}`);
			hsm.currentState = FatalErrorState;
			throw new InitializationError(hsm, currState, asError(cause));
		}
	} finally {
		hsm._traceWrite('end initialization');
	}
}

/** @internal */
async function dispatchEvent<Context, Protocol extends {} | undefined, EventName extends keyof Protocol>(hsm: HsmWithTracing<Context, Protocol>, eventName: PostedEvent<Protocol, EventName>, ...eventPayload: EventPayload<Protocol, EventName>): Promise<void> {
	const eventLabel = String(eventName);
	hsm._traceWrite(`begin event dispatch of #${eventLabel}`);
	hsm._tracePush(`#${eventLabel}`, `started event dispatch`);
	hsm._currentEventName = eventLabel;
	hsm._currentEventPayload = eventPayload;
	try {
		const eventHandler = lookupEventHandler(hsm, eventName);

		if (!eventHandler) {
			hsm._traceWrite(`event #${eventLabel} is unhandled in state ${hsm.currentStateName}`);
			try {
				await doUnhandledEvent(hsm, new UnhandledEventError(hsm), () => {
					hsm._tracePopDone('event dispatch successful');
					finishEventDispatch(hsm);
				});
				return;
			} catch (recoveryErr) {
				hsm._tracePopError(`event dispatch failed: ${quoteUnknown(recoveryErr)}`);
				finishEventDispatch(hsm);
				throw recoveryErr;
			}
		}

		try {
			hsm._tracePush('execute', 'started event handler execution');
			const result = eventHandler.call(hsm._instance, ...eventPayload);
			if (result) {
				await result;
			}
			hsm._tracePopDone('event handler execution successful');
			await completePendingTransitions(hsm, () => {
				hsm._tracePopDone(`event dispatch successful`);
				finishEventDispatch(hsm);
			});
		} catch (recoveryErr) {
			hsm._tracePopError(quoteUnknown(recoveryErr));
			if (recoveryErr instanceof UnhandledEventError) {
				hsm._traceWrite(`event #${eventLabel} is unhandled in state ${hsm.currentStateName}`);
				try {
					await doUnhandledEvent(hsm, recoveryErr, () => {
						hsm._tracePopDone('event dispatch successful');
						finishEventDispatch(hsm);
					});
					return;
				} catch (nestedErr) {
					hsm._tracePopError(`event dispatch failed: ${quoteUnknown(nestedErr)}`);
					finishEventDispatch(hsm);
					throw nestedErr;
				}
			} else if (recoveryErr instanceof TransitionError) {
				hsm._tracePopError(`event dispatch failed: ${quoteUnknown(recoveryErr)}`);
				finishEventDispatch(hsm);
				throw recoveryErr;
			} else {
				try {
					await doError(hsm, asError(recoveryErr), () => {
						hsm._tracePopDone('event dispatch successful');
						finishEventDispatch(hsm);
					});
				} catch (nestedErr) {
					hsm._tracePopError(`event dispatch failed: ${quoteUnknown(nestedErr)}`);
					finishEventDispatch(hsm);
					throw nestedErr;
				}
			}
		}
	} catch (err) {
		finishEventDispatch(hsm);
		throw err;
	}
}

export function createInitTask<DispatchContext, DispatchProtocol extends {} | undefined>(hsm: HsmWithTracing<DispatchContext, DispatchProtocol>): Task {
	return (done: DoneCallback): void => {
		executeInit(hsm)
			.then(async () => {
				await doTransition(hsm);
				done();
			})
			.catch((err: unknown) => {
				hsm.dispatchErrorCallback(hsm, asError(err));
				done();
			});
	};
}

export function createEventDispatchTask<DispatchContext, DispatchProtocol extends {} | undefined, EventName extends keyof DispatchProtocol>(hsm: HsmWithTracing<DispatchContext, DispatchProtocol>, eventName: PostedEvent<DispatchProtocol, EventName>, ...eventPayload: EventPayload<DispatchProtocol, EventName>): Task {
	return (done: DoneCallback): void => {
		dispatchEvent(hsm, eventName, ...eventPayload)
			.catch((err: unknown) => hsm.dispatchErrorCallback(hsm, asError(err)))
			.finally(() => done());
	};
}
