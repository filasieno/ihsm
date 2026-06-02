import { TopState, EventHandlerError, PostedEvent, EventPayload, FatalError, FatalErrorState, InitializationError, StateClass, TransitionError, UnhandledEventError } from '../';

import { DoneCallback, HsmWithTracing, Task, Transition } from './defs.private';
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
class DebugTransition<Context, Protocol extends {} | undefined> implements Transition<Context, Protocol> {
	constructor(
		private exitList: Array<StateClass<Context, Protocol>>,
		private entryList: Array<StateClass<Context, Protocol>>,
		private finalState?: StateClass<Context, Protocol>
	) {}

	async execute(hsm: HsmWithTracing<Context, Protocol>, srcState: StateClass<Context, Protocol>, dstState: StateClass<Context, Protocol>): Promise<void> {
		hsm._tracePush(`transition from ${getStateName(srcState)} to ${getStateName(dstState)}`, `started transition from ${getStateName(srcState)} to ${getStateName(dstState)} `);

		for (const state of this.exitList) {
			const statePrototype = state.prototype;
			const stateName = getStateName(state);
			if (Object.prototype.hasOwnProperty.call(statePrototype, 'onExit')) {
				try {
					const res = statePrototype.onExit.call(hsm._instance);
					if (res) {
						await res;
					}
				} catch (cause) {
					hsm._tracePopError(`${stateName}.onExit() has thrown ${quoteUnknown(cause)}`);
					throw new TransitionError(hsm, asError(cause), stateName, 'onExit', getStateName(srcState), getStateName(dstState));
				}
			}
		}

		for (const state of this.entryList) {
			const statePrototype = state.prototype;
			const stateName = getStateName(state);
			if (Object.prototype.hasOwnProperty.call(statePrototype, 'onEntry')) {
				try {
					const res = statePrototype.onEntry.call(hsm._instance);
					if (res) {
						await res;
					}
				} catch (cause) {
					hsm._tracePopError(`${stateName}.onEntry() has thrown ${quoteUnknown(cause)}`);
					throw new TransitionError(hsm, asError(cause), stateName, 'onEntry', getStateName(srcState), getStateName(dstState));
				}
			}
		}
		if (this.finalState) {
			hsm._tracePopDone(`final state is ${getStateName(this.finalState)}`);
			hsm.currentState = this.finalState;
		}
	}
}

/** @internal */
function createTransition<Context, Protocol extends {} | undefined>(srcState: StateClass<Context, Protocol>, destState: StateClass<Context, Protocol>): Transition<Context, Protocol> {
	const src: StateClass<Context, Protocol> = srcState;
	let dst: StateClass<Context, Protocol> = destState;
	let srcPath: StateClass<Context, Protocol>[] = [];
	const end: StateClass<Context, Protocol> = TopState;
	const srcIndex: Map<StateClass<Context, Protocol>, number> = new Map();
	let dstPath: StateClass<Context, Protocol>[] = [];
	let cur: StateClass<Context, Protocol> = src;
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

	let finalState: StateClass<Context, Protocol> | undefined;
	if (dstPath.length !== 0) {
		finalState = dstPath[dstPath.length - 1];
	} else if (srcPath.length !== 0) {
		finalState = Object.getPrototypeOf(srcPath[srcPath.length - 1]);
	} else {
		finalState = undefined;
	}

	srcPath = srcPath.filter(value => !value.hasOwnProperty('onExit'));
	dstPath = dstPath.filter(value => !value.hasOwnProperty('onEntry'));

	return new DebugTransition<Context, Protocol>(srcPath, dstPath, finalState);
}

/** @internal */
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
				hsm.currentState = FatalErrorState;
				throw transitionError;
			}
		} finally {
			hsm._transitionState = undefined;
		}
	}
}

/** @internal */
async function doError<Context, Protocol extends {} | undefined>(hsm: HsmWithTracing<Context, Protocol>, err: Error, onComplete: () => void): Promise<void> {
	hsm._transitionState = undefined;
	hsm._tracePush(`error recovery`, `started error recovery`);
	try {
		hsm._tracePush('execute', 'started #onError handler execution');
		const result = hsm.currentState.prototype.onError.call(hsm._instance, new EventHandlerError(hsm, err));
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
			throw new FatalError(hsm, recoveryErr);
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
async function doUnhandledEvent<Context, Protocol extends {} | undefined, EventName extends keyof Protocol>(hsm: HsmWithTracing<Context, Protocol>, error: UnhandledEventError<Context, Protocol, EventName>, onComplete: () => void): Promise<void> {
	hsm._tracePush('unhandled recovery', `started unhandled event recovery`);
	try {
		hsm._tracePush('execute', 'started #onUnhandled handler execution');
		const result = hsm.currentState.prototype.onUnhandled.call(hsm._instance, error);
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
				}
				if (hasInitialState(currState)) {
					currState = getInitialState(currState);
				} else {
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
		const eventHandler = hsm.currentState.prototype[eventName];

		if (!eventHandler) {
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
