import { HsmTopState, HsmEventHandlerError, HsmEventHandlerName, HsmEventHandlerPayload, HsmFatalErrorState, HsmInitializationError, HsmFatalError, HsmRuntimeError, HsmStateClass, HsmTransitionError, HsmUnhandledEventError } from '../';

import { DoneCallback, HsmWithTracing, Task, Transition } from './defs.private';
import { getInitialState, getTransitionKey, hasInitialState, quoteError } from './utils';

/** @internal */
// eslint-disable-next-line valid-jsdoc
class TraceTransition<Context, Protocol extends {} | undefined, EventName extends keyof Protocol> implements Transition<Context, Protocol> {
	constructor(private exitList: Array<HsmStateClass<Context, Protocol>>, private entryList: Array<HsmStateClass<Context, Protocol>>) {}

	async execute<EventName extends keyof Protocol>(hsm: HsmWithTracing<Context, Protocol>, srcState: HsmStateClass<Context, Protocol>, dstState: HsmStateClass<Context, Protocol>): Promise<void> {
		hsm._tracePush(`transition from ${srcState.name} to ${dstState.name}`, `started transition from ${srcState.name} to ${dstState.name} `);

		// Execute exit
		for (const state of this.exitList) {
			const statePrototype = state.prototype;
			const stateName = state.name;
			if (Object.prototype.hasOwnProperty.call(statePrototype, 'onExit')) {
				try {
					const res = statePrototype.onExit.call(hsm._instance);
					if (res) {
						await res;
					}
					hsm._traceWrite(`${stateName}.onExit() done`);
				} catch (cause) {
					hsm._tracePopError(`${stateName}.onExit() has thrown ${quoteError(cause)}`);
					throw new HsmTransitionError(hsm, cause, stateName, 'onExit', srcState.name, dstState.name);
				}
			} else {
				hsm._traceWrite(`${stateName}.onExit() skipped: default empty implementation`);
			}
		}

		// Execute entry
		for (const state of this.entryList) {
			const statePrototype = state.prototype;
			const stateName = state.name;
			if (Object.prototype.hasOwnProperty.call(statePrototype, 'onEntry')) {
				try {
					const res = statePrototype.onEntry.call(hsm._instance);
					if (res) {
						await res;
					}
					hsm._traceWrite(`${stateName}.onEntry() done`);
				} catch (cause) {
					hsm._tracePopError(`${stateName}.onEntry() has thrown ${quoteError(cause)}`);
					throw new HsmTransitionError(hsm, cause, state.name, 'onEntry', srcState.name, dstState.name);
				}
			} else {
				hsm._traceWrite(`${stateName}.onEntry() skipped: default empty implementation`);
			}
		}
		let newState;
		if (this.entryList.length !== 0) {
			newState = this.entryList[this.entryList.length - 1];
		} else if (this.exitList.length !== 0) {
			newState = Object.getPrototypeOf(this.exitList[this.exitList.length - 1]);
		} else {
			newState = hsm.currentState;
		}
		hsm._tracePopDone(`final state is ${newState.name}`);
		hsm.currentState = newState;
		return; // Empty transition lists
	}
}

/** @internal */
// eslint-disable-next-line valid-jsdoc
function createTransition<Context, Protocol extends {} | undefined, EventName extends keyof Protocol>(srcState: HsmStateClass<Context, Protocol>, destState: HsmStateClass<Context, Protocol>): Transition<Context, Protocol> {
	const src: HsmStateClass<Context, Protocol> = srcState;
	let dst: HsmStateClass<Context, Protocol> = destState;
	let srcPath: HsmStateClass<Context, Protocol>[] = [];
	const end: HsmStateClass<Context, Protocol> = HsmTopState;
	const srcIndex: Map<HsmStateClass<Context, Protocol>, number> = new Map();
	const dstPath: HsmStateClass<Context, Context>[] = [];
	let cur: HsmStateClass<Context, Context> = src;
	let i = 0;

	while (cur !== end) {
		srcPath.push(cur);
		srcIndex.set(cur, i);
		cur = Object.getPrototypeOf(cur);
		++i;
	}
	cur = dst;

	while (cur !== end) {
		const i = srcIndex.get(cur);
		if (i !== undefined) {
			srcPath = srcPath.slice(0, i);
			break;
		}
		dstPath.unshift(cur);
		cur = Object.getPrototypeOf(cur);
	}

	while (hasInitialState(dst)) {
		dst = getInitialState(dst);
		dstPath.push(dst);
	}

	return new TraceTransition<Context, Protocol, EventName>(srcPath, dstPath);
}

/** @internal */
// eslint-disable-next-line valid-jsdoc
async function doTransition<Context, Protocol extends {} | undefined>(hsm: HsmWithTracing<Context, Protocol>): Promise<void> {
	if (hsm._transitionState) {
		try {
			const srcState = hsm.currentState;
			const destState = hsm._transitionState;
			hsm._traceWrite(`requested transition from ${srcState.name} to ${destState.name} `);
			const transitionKey = getTransitionKey(srcState, destState);
			let tr: Transition<Context, Protocol> | undefined = hsm._transitionCache.get(transitionKey);
			if (tr) {
				hsm._traceWrite(`transition cache hit for ${srcState.name} to ${destState.name} `);
			} else {
				hsm._traceWrite(`transition cache miss for ${srcState.name} to ${destState.name} `);
				tr = createTransition(srcState, destState);
				hsm._transitionCache.set(transitionKey, tr);
			}
			try {
				await tr.execute(hsm, srcState, destState);
			} catch (transitionError) {
				hsm.currentState = HsmFatalErrorState;
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
// eslint-disable-next-line valid-jsdoc
function lookupErrorHandler<Context, Protocol extends {} | undefined, EventName extends keyof Protocol>(hsm: HsmWithTracing<Context, Protocol>): (error: HsmRuntimeError<Context, Protocol, EventName>) => Promise<void> | void {
	hsm._tracePush(`lookup`, `started lookup of #onError event handler`);
	let state = hsm.currentState;
	while (state != HsmTopState) {
		const prototype = state.prototype;
		if (Object.prototype.hasOwnProperty.call(prototype, 'onError')) {
			hsm._tracePopDone(`found in state ${prototype.constructor.name}`);
			return prototype['onError'];
		} else {
			hsm._traceWrite(`not found in state ${prototype.constructor.name}`);
			state = Object.getPrototypeOf(state);
		}
	}
	hsm._tracePopDone(`found in state ${HsmTopState.name}`);
	return HsmTopState.prototype.onError;
}

/** @internal */
// eslint-disable-next-line valid-jsdoc
async function doError<Context, Protocol extends {} | undefined, EventName extends keyof Protocol>(hsm: HsmWithTracing<Context, Protocol>, err: Error): Promise<void> {
	hsm._transitionState = undefined; // clear next state
	hsm._tracePush(`error recovery`, `started error recovery`);
	const messageHandler = lookupErrorHandler(hsm);
	try {
		hsm._tracePush('execute', 'started #onError handler execution');
		const result = messageHandler.call(hsm._instance, new HsmEventHandlerError(hsm, err));
		if (result) {
			await result;
		}
		hsm._tracePopDone('error handler execution successful');
		await doTransition(hsm);
	} catch (err) {
		hsm._tracePopError(`error handler execution failure: ${quoteError(err)}`);
		if (err instanceof HsmTransitionError) {
			hsm._tracePopError(`error recovery failure: ${quoteError(err)}`);
			throw err;
		} else {
			hsm.transition(HsmFatalErrorState);
			try {
				await doTransition(hsm);
				hsm._tracePopError(`error recovery failure: ${quoteError(err)}`);
			} catch (transitionError) {
				hsm._tracePopError(`error recovery failure: ${quoteError(err)}`);
				throw new HsmFatalError(hsm, err);
			}
		}
		throw new HsmFatalError(hsm, err);
	}
	hsm._tracePopDone('error recovery successful');
}

/** @internal */
// eslint-disable-next-line valid-jsdoc
function lookupUnhandled<Context, Protocol extends {} | undefined, EventName extends keyof Protocol>(hsm: HsmWithTracing<Context, Protocol>): (error: HsmUnhandledEventError<Context, Protocol, EventName>) => Promise<void> | void {
	let state = hsm.currentState;
	hsm._tracePush(`lookup`, `started lookup of #onUnhandled event handler`);
	while (true) {
		const prototype = state.prototype;
		if (Object.prototype.hasOwnProperty.call(prototype, 'onUnhandled')) {
			hsm._tracePopDone(`found in state ${prototype.constructor.name}`);
			return prototype.onUnhandled;
		} else {
			hsm._traceWrite(`not found in state ${prototype.constructor.name}`);
			state = Object.getPrototypeOf(state);
			if (state == HsmTopState) {
				hsm._tracePopDone(`found in state ${prototype.constructor.name}`);
				return prototype.onUnhandled;
			}
		}
	}
}

/** @internal */
// eslint-disable-next-line valid-jsdoc
async function doUnhandledEvent<Context, Protocol extends {} | undefined, EventName extends keyof Protocol>(hsm: HsmWithTracing<Context, Protocol>, error: HsmUnhandledEventError<Context, Protocol, EventName>): Promise<void> {
	hsm._tracePush('unhandled recovery', `started unhandled event recovery`);
	const messageHandler = lookupUnhandled(hsm);
	try {
		hsm._tracePush('execute', 'started #onUnhandled handler execution');
		const result = messageHandler.call(hsm._instance, error);
		if (result) {
			await result;
		}
		hsm._tracePopDone('unhandled handler execution successful');
		await doTransition(hsm);
		hsm._tracePopDone('unhandled event recovery successful');
	} catch (err) {
		hsm._tracePopError(`unhandled event recovery failure: ${quoteError(err)}`);

		// No recovery is possible if a transition error has occurred
		if (err instanceof HsmTransitionError) {
			hsm.currentState = HsmFatalErrorState;
			hsm._tracePopError(`unhandled event recovery failure: ${quoteError(err)}`);
			throw err;
		}

		// Try to recover the error
		try {
			await doError(hsm, err);
			hsm._tracePopDone('unhandled event recovery successful');
		} catch (err) {
			hsm._tracePopError(`unhandled event recovery failure: ${quoteError(err)}`);
			throw err;
		}
	}
}

/** @internal */
// eslint-disable-next-line valid-jsdoc
function lookupEventHandler<Context, Protocol extends {} | undefined, EventName extends keyof Protocol>(hsm: HsmWithTracing<Context, Protocol>, eventName: HsmEventHandlerName<Protocol, EventName>): ((...args: HsmEventHandlerPayload<Protocol, EventName>) => Promise<void> | void) | undefined {
	let state = hsm.currentState;
	hsm._tracePush(`lookup`, `started lookup of #${eventName} event handler`);
	while (true) {
		const prototype = state.prototype;
		if (Object.prototype.hasOwnProperty.call(prototype, eventName)) {
			hsm._tracePopDone(`#${eventName} found in state ${prototype.constructor.name}`);
			return prototype[eventName];
		} else {
			hsm._traceWrite(`not found in state ${prototype.constructor.name}`);
			if (state == HsmTopState) break;
			state = Object.getPrototypeOf(state);
		}
	}
	hsm._tracePopError(`not found in state ${hsm.currentStateName}`);
	return undefined;
}

/** @internal */
// eslint-disable-next-line valid-jsdoc
async function executeInit<Context, Protocol extends {} | undefined, EventName extends keyof Protocol>(hsm: HsmWithTracing<Context, Protocol>): Promise<void> {
	hsm._traceWrite('begin initialization');
	try {
		let currState: HsmStateClass<Context, Protocol> = hsm.topState;
		hsm._tracePush(`initialize`, `started initialization from ${hsm.topState.name}`);
		try {
			while (true) {
				if (Object.prototype.hasOwnProperty.call(currState.prototype, 'onEntry')) {
					currState.prototype['onEntry'].call(hsm._instance);
					hsm._traceWrite(`${currState.name}.onEntry() done`);
				} else {
					hsm._traceWrite(`skip ${currState.name}.onEntry(): default empty implementation`);
				}

				if (hasInitialState(currState)) {
					const newInitialState = getInitialState(currState);
					hsm._traceWrite(`${currState.name} initial state is ${newInitialState.name}`);
					currState = newInitialState;
				} else {
					hsm._traceWrite(`${currState.name} has no initial state; final state is ${currState.name}`);
					break;
				}
			}
			hsm._tracePopDone(`final state is ${currState.name}`);
			hsm.currentState = currState;
		} catch (cause) {
			hsm._tracePopError(`initialization failed from top state '${hsm.topState.name}' as ${currState.name}.onEntry() handler has raised ${quoteError(cause)}; final state is ${HsmFatalErrorState.name}`);
			hsm.currentState = HsmFatalErrorState;
			throw new HsmInitializationError(hsm, currState, cause);
		}
	} finally {
		hsm._traceWrite('end initialization');
	}
}

/** @internal */
// eslint-disable-next-line valid-jsdoc
async function dispatchEvent<Context, Protocol extends {} | undefined, EventName extends keyof Protocol>(hsm: HsmWithTracing<Context, Protocol>, eventName: HsmEventHandlerName<Protocol, EventName>, ...eventPayload: HsmEventHandlerPayload<Protocol, EventName>): Promise<void> {
	hsm._traceWrite(`begin event dispatch of #${eventName}`);
	hsm._tracePush(`#${eventName}`, `started event dispatch`);
	hsm._currentEventName = eventName as string;
	hsm._currentEventPayload = eventPayload;
	try {
		const eventHandler = lookupEventHandler(hsm, eventName);

		// If an event handler was not found then doUnhandledEventWithTracing
		if (!eventHandler) {
			hsm._traceWrite(`event #${eventName} is unhandled in state ${hsm.currentStateName}`);
			try {
				await doUnhandledEvent(hsm, new HsmUnhandledEventError(hsm));
				hsm._tracePopDone('event dispatch successful');
				return;
			} catch (err) {
				hsm._tracePopError(`event dispatch failed: ${quoteError(err)}`);
				throw err;
			}
		}

		try {
			// If a event handler was not found the call it
			hsm._tracePush('execute', 'started event handler execution');
			const result = eventHandler.call(hsm._instance, ...eventPayload);
			if (result) {
				await result;
			}
			hsm._tracePopDone('event handler execution successful');
			await doTransition(hsm);
			hsm._tracePopDone(`event dispatch successful`);
		} catch (err) {
			hsm._tracePopError(err);
			if (err instanceof HsmUnhandledEventError) {
				hsm._traceWrite(`event #${eventName} is unhandled in state ${hsm.currentStateName}`);
				try {
					await doUnhandledEvent(hsm, err);
					hsm._tracePopDone('event dispatch successful');
					return;
				} catch (err) {
					hsm._tracePopError(`event dispatch failed: ${quoteError(err)}`);
					throw err;
				}
			} else if (err instanceof HsmTransitionError) {
				hsm._tracePopError(`event dispatch failed: ${quoteError(err)}`);
				throw err;
			} else {
				try {
					await doError(hsm, err);
					hsm._tracePopDone('event dispatch successful');
				} catch (err) {
					hsm._tracePopError(`event dispatch failed: ${quoteError(err)}`);
					throw err;
				}
			}
		}
	} finally {
		hsm._traceWrite(`end event dispatch`);
		hsm._currentEventName = undefined;
		hsm._currentEventPayload = undefined;
		hsm._transitionState = undefined;
	}
}

// ---------------------------------------------------------------------------------------------------------------------
// Export: _createInitTask, _createEventDispatchTask
// ---------------------------------------------------------------------------------------------------------------------

/** @internal */
// eslint-disable-next-line valid-jsdoc
export function createInitTask<DispatchContext, DispatchProtocol extends {} | undefined>(hsm: HsmWithTracing<DispatchContext, DispatchProtocol>): Task {
	return (done: DoneCallback): void => {
		executeInit(hsm)
			.catch((err: Error) => hsm.dispatchErrorCallback(hsm, err))
			.finally(() => done());
	};
}

/** @internal */
// eslint-disable-next-line valid-jsdoc
export function createEventDispatchTask<DispatchContext, DispatchProtocol extends {} | undefined, EventName extends keyof DispatchProtocol>(hsm: HsmWithTracing<DispatchContext, DispatchProtocol>, eventName: HsmEventHandlerName<DispatchProtocol, EventName>, ...eventPayload: HsmEventHandlerPayload<DispatchProtocol, EventName>): Task {
	return (done: DoneCallback): void => {
		dispatchEvent(hsm, eventName, ...eventPayload)
			.catch((err: Error) => hsm.dispatchErrorCallback(hsm, err))
			.finally(() => done());
	};
}
