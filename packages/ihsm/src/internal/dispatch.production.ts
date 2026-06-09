import { TopState, EventHandlerError, PostedEvent, EventPayload, FatalErrorState, InitializationError, FatalError, StateClass, TransitionError, UnhandledEventError } from '../';

import { DoneCallback, HsmWithTracing, Task, Transition } from './defs.private';
import { lookupEventHandler } from './lookup';
import { getInitialState, getTransitionKey, hasInitialState, asError, getStateName, adoptStateBeforeOnEntry } from './utils';

class ProductionTransition<Context, Protocol extends {} | undefined> implements Transition<Context, Protocol> {
	constructor(
		private exitList: Array<StateClass<Context, Protocol>>,
		private entryList: Array<StateClass<Context, Protocol>>,
		private finalState?: StateClass<Context, Protocol>
	) {}

	async execute(hsm: HsmWithTracing<Context, Protocol>, srcState: StateClass<Context, Protocol>, dstState: StateClass<Context, Protocol>): Promise<void> {
		// Execute exit
		for (const state of this.exitList) {
			try {
				const res = state.prototype.onExit.call(hsm._instance);
				if (res) {
					await res;
				}
			} catch (cause) {
				throw new TransitionError(hsm, asError(cause), getStateName(state), 'onExit', getStateName(srcState), getStateName(dstState));
			}
		}

		// Execute entry
		for (const state of this.entryList) {
			try {
				adoptStateBeforeOnEntry(hsm, state);
				const res = state.prototype.onEntry.call(hsm._instance);
				if (res) {
					await res;
				}
			} catch (cause) {
				throw new TransitionError(hsm, asError(cause), getStateName(state), 'onEntry', getStateName(srcState), getStateName(dstState));
			}
		}

		if (this.finalState) {
			hsm.currentState = this.finalState;
		}
	}
}

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

	return new ProductionTransition<Context, Protocol>(srcPath, dstPath, finalState);
}

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

async function completePendingTransitions<Context, Protocol extends {} | undefined>(hsm: HsmWithTracing<Context, Protocol>, onComplete: () => void): Promise<void> {
	await doTransition(hsm);
	onComplete();
}

async function doError<Context, Protocol extends {} | undefined>(hsm: HsmWithTracing<Context, Protocol>, err: Error, onComplete: () => void): Promise<void> {
	hsm._transitionState = undefined; // clear next state
	const messageHandler = hsm.currentState.prototype.onError;
	try {
		const result = messageHandler.call(hsm._instance, new EventHandlerError(hsm, err));
		if (result) {
			await result;
		}
		await completePendingTransitions(hsm, onComplete);
	} catch (recoveryErr) {
		if (recoveryErr instanceof TransitionError) {
			throw new FatalError(hsm, recoveryErr);
		}
		const err = asError(recoveryErr);
		hsm.transition(FatalErrorState);
		await completePendingTransitions(hsm, onComplete);
		throw new FatalError(hsm, err);
	}
}

async function doUnhandledEvent<Context, Protocol extends {} | undefined, EventName extends keyof Protocol>(hsm: HsmWithTracing<Context, Protocol>, error: UnhandledEventError<Context, Protocol, EventName>, onComplete: () => void): Promise<void> {
	try {
		const result = hsm.currentState.prototype.onUnhandled.call(hsm._instance, error);
		if (result) {
			await result;
		}
		await completePendingTransitions(hsm, onComplete);
	} catch (recoveryErr) {
		if (recoveryErr instanceof TransitionError) {
			hsm.currentState = FatalErrorState;
			throw recoveryErr;
		}
		await doError(hsm, asError(recoveryErr), onComplete);
	}
}

async function executeInit<Context, Protocol extends {} | undefined>(hsm: HsmWithTracing<Context, Protocol>): Promise<void> {
	let currState: StateClass<Context, Protocol> = hsm.topState;
	try {
		while (true) {
			adoptStateBeforeOnEntry(hsm, currState);
			const proto = currState.prototype;
			if (proto.hasOwnProperty('onEntry')) {
				proto.onEntry.call(hsm._instance);
			}
			if (hasInitialState(currState)) {
				currState = getInitialState(currState);
			} else break;
		}
	} catch (cause) {
		if (cause instanceof TransitionError) {
			throw cause;
		}
		hsm.currentState = FatalErrorState;
		throw new InitializationError(hsm, currState, asError(cause));
	}
}

function finishEventDispatch<Context, Protocol extends {} | undefined>(hsm: HsmWithTracing<Context, Protocol>): void {
	hsm._currentEventName = undefined;
	hsm._currentEventPayload = undefined;
}

async function dispatchEvent<Context, Protocol extends {} | undefined, EventName extends keyof Protocol>(hsm: HsmWithTracing<Context, Protocol>, eventName: PostedEvent<Protocol, EventName>, ...eventPayload: EventPayload<Protocol, EventName>): Promise<void> {
	hsm._currentEventName = String(eventName);
	hsm._currentEventPayload = eventPayload;
	try {
		const eventHandler = lookupEventHandler(hsm, eventName);
		if (!eventHandler) {
			await doUnhandledEvent(hsm, new UnhandledEventError(hsm), () => finishEventDispatch(hsm));
			return;
		}
		try {
			const result = eventHandler.call(hsm._instance, ...eventPayload);
			if (result) await result;
			await completePendingTransitions(hsm, () => finishEventDispatch(hsm));
		} catch (recoveryErr) {
			if (recoveryErr instanceof UnhandledEventError) {
				await doUnhandledEvent(hsm, recoveryErr, () => finishEventDispatch(hsm));
			} else if (recoveryErr instanceof TransitionError) {
				finishEventDispatch(hsm);
				throw recoveryErr;
			} else {
				await doError(hsm, asError(recoveryErr), () => finishEventDispatch(hsm));
			}
		}
	} catch (err) {
		finishEventDispatch(hsm);
		throw err;
	}
}

// ---------------------------------------------------------------------------------------------------------------------
// Export: _createInitTask, _createEventDispatchTask
// ---------------------------------------------------------------------------------------------------------------------

/** @internal */
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

/** @internal */
export function createEventDispatchTask<DispatchContext, DispatchProtocol extends {} | undefined, EventName extends keyof DispatchProtocol>(hsm: HsmWithTracing<DispatchContext, DispatchProtocol>, eventName: PostedEvent<DispatchProtocol, EventName>, ...eventPayload: EventPayload<DispatchProtocol, EventName>): Task {
	return (done: DoneCallback): void => {
		dispatchEvent(hsm, eventName, ...eventPayload)
			.catch((err: unknown) => hsm.dispatchErrorCallback(hsm, asError(err)))
			.finally(() => done());
	};
}
