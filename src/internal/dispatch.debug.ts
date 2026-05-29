import { HsmTopState, HsmEventHandlerError, HsmEventHandlerName, HsmEventHandlerPayload, HsmFatalError, HsmFatalErrorState, HsmInitializationError, HsmStateClass, HsmTransitionError, HsmUnhandledEventError } from '../';

import { DoneCallback, HsmWithTracing, Task, Transition } from './defs.private';
import { getInitialState, getTransitionKey, hasInitialState, quoteError } from './utils';

/** @internal */
// eslint-disable-next-line valid-jsdoc
class DebugTransition<Context, Protocol extends {} | undefined, EventName extends keyof Protocol> implements Transition<Context, Protocol> {
	constructor(private exitList: Array<HsmStateClass<Context, Protocol>>, private entryList: Array<HsmStateClass<Context, Protocol>>, private finalState?: HsmStateClass<Context, Protocol>) {}

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
				} catch (cause) {
					hsm._tracePopError(`${stateName}.onExit() has thrown ${quoteError(cause)}`);
					throw new HsmTransitionError(hsm, cause, stateName, 'onExit', srcState.name, dstState.name);
				}
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
				} catch (cause) {
					hsm._tracePopError(`${stateName}.onEntry() has thrown ${quoteError(cause)}`);
					throw new HsmTransitionError(hsm, cause, stateName, 'onEntry', srcState.name, dstState.name);
				}
			}
		}
		if (this.finalState) {
			hsm._tracePopDone(`final state is ${this.finalState.name}`);
			hsm.currentState = this.finalState;
		}
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
	let dstPath: HsmStateClass<Context, Context>[] = [];
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

	let finalState: HsmStateClass<Context, Protocol> | undefined;
	if (dstPath.length !== 0) {
		finalState = dstPath[dstPath.length - 1];
	} else if (srcPath.length !== 0) {
		finalState = Object.getPrototypeOf(srcPath[srcPath.length - 1]);
	} else {
		finalState = undefined;
	}

	srcPath = srcPath.filter(value => !value.hasOwnProperty('onExit'));
	dstPath = dstPath.filter(value => !value.hasOwnProperty('onEntry'));

	return new DebugTransition<Context, Protocol, EventName>(srcPath, dstPath, finalState);
}

/** @internal */
// eslint-disable-next-line valid-jsdoc
async function doTransition<Context, Protocol extends {} | undefined>(hsm: HsmWithTracing<Context, Protocol>): Promise<void> {
	if (hsm._transitionState) {
		try {
			const srcState = hsm.currentState;
			const destState = hsm._transitionState;
			const transitionKey = getTransitionKey(srcState, destState);
			let tr: Transition<Context, Protocol> | undefined = hsm._transitionCache.get(transitionKey);
			if (!tr) {
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
	}
}

/** @internal */
// eslint-disable-next-line valid-jsdoc
async function doError<Context, Protocol extends {} | undefined, EventName extends keyof Protocol>(hsm: HsmWithTracing<Context, Protocol>, err: Error): Promise<void> {
	hsm._transitionState = undefined; // clear next state
	hsm._tracePush(`error recovery`, `started error recovery`);
	try {
		hsm._tracePush('execute', 'started #onError handler execution');
		const result = hsm.currentState.prototype.onError.call(hsm._instance, new HsmEventHandlerError(hsm, err));
		if (result) {
			await result;
		}
		hsm._tracePopDone('error handler execution successful');
		await doTransition(hsm);
	} catch (err) {
		hsm._tracePopError(`error handler execution failure: ${quoteError(err)}`);
		if (err instanceof HsmTransitionError) {
			hsm._tracePopError(`error recovery failure: ${quoteError(err)}`);
			throw new HsmFatalError(hsm, err);
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
async function doUnhandledEvent<Context, Protocol extends {} | undefined, EventName extends keyof Protocol>(hsm: HsmWithTracing<Context, Protocol>, error: HsmUnhandledEventError<Context, Protocol, EventName>): Promise<void> {
	hsm._tracePush('unhandled recovery', `started unhandled event recovery`);
	try {
		hsm._tracePush('execute', 'started #onUnhandled handler execution');
		const result = hsm.currentState.prototype.onUnhandled.call(hsm._instance, error);
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
async function executeInit<Context, Protocol extends {} | undefined, EventName extends keyof Protocol>(hsm: HsmWithTracing<Context, Protocol>): Promise<void> {
	hsm._traceWrite('begin initialization');
	try {
		let currState: HsmStateClass<Context, Protocol> = hsm.topState;
		hsm._tracePush(`initialize`, `started initialization from ${hsm.topState.name}`);
		try {
			while (true) {
				if (Object.prototype.hasOwnProperty.call(currState.prototype, 'onEntry')) {
					currState.prototype['onEntry'].call(hsm._instance);
				}
				if (hasInitialState(currState)) {
					currState = getInitialState(currState);
				} else {
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
		const eventHandler = hsm.currentState.prototype[eventName];

		// If an event handler was not found then doUnhandledEventWithTracing
		if (!eventHandler) {
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

export function createInitTask<DispatchContext, DispatchProtocol extends {} | undefined>(hsm: HsmWithTracing<DispatchContext, DispatchProtocol>): Task {
	return (done: DoneCallback): void => {
		executeInit(hsm)
			.catch((err: Error) => hsm.dispatchErrorCallback(hsm, err))
			.finally(() => done());
	};
}

export function createEventDispatchTask<DispatchContext, DispatchProtocol extends {} | undefined, EventName extends keyof DispatchProtocol>(hsm: HsmWithTracing<DispatchContext, DispatchProtocol>, eventName: HsmEventHandlerName<DispatchProtocol, EventName>, ...eventPayload: HsmEventHandlerPayload<DispatchProtocol, EventName>): Task {
	return (done: DoneCallback): void => {
		dispatchEvent(hsm, eventName, ...eventPayload)
			.catch((err: Error) => hsm.dispatchErrorCallback(hsm, err))
			.finally(() => done());
	};
}
