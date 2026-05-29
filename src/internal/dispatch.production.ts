import { HsmTopState, HsmEventHandlerError, HsmEventHandlerName, HsmEventHandlerPayload, HsmFatalErrorState, HsmInitializationError, HsmFatalError, HsmStateClass, HsmTransitionError, HsmUnhandledEventError } from '../';

import { DoneCallback, HsmWithTracing, Task, Transition } from './defs.private';
import { getInitialState, getTransitionKey, hasInitialState, asError } from './utils';

class ProductionTransition<Context, Protocol extends {} | undefined, EventName extends keyof Protocol> implements Transition<Context, Protocol> {
	constructor(
		private exitList: Array<HsmStateClass<Context, Protocol>>,
		private entryList: Array<HsmStateClass<Context, Protocol>>,
		private finalState?: HsmStateClass<Context, Protocol>
	) {}

	async execute<EventName extends keyof Protocol>(hsm: HsmWithTracing<Context, Protocol>, srcState: HsmStateClass<Context, Protocol>, dstState: HsmStateClass<Context, Protocol>): Promise<void> {
		// Execute exit
		for (const state of this.exitList) {
			try {
				const res = state.prototype.onExit.call(hsm._instance);
				if (res) {
					await res;
				}
			} catch (cause) {
				throw new HsmTransitionError(hsm, asError(cause), state.name, 'onExit', srcState.name, dstState.name);
			}
		}

		// Execute entry
		for (const state of this.entryList) {
			try {
				const res = state.prototype.onEntry.call(hsm._instance);
				if (res) {
					await res;
				}
			} catch (cause) {
				throw new HsmTransitionError(hsm, asError(cause), state.name, 'onEntry', srcState.name, dstState.name);
			}
		}

		if (this.finalState) {
			hsm.currentState = this.finalState;
		}
	}
}

function createTransition<Context, Protocol extends {} | undefined, EventName extends keyof Protocol>(srcState: HsmStateClass<Context, Protocol>, destState: HsmStateClass<Context, Protocol>): Transition<Context, Protocol> {
	const src: HsmStateClass<Context, Protocol> = srcState;
	let dst: HsmStateClass<Context, Protocol> = destState;
	let srcPath: HsmStateClass<Context, Protocol>[] = [];
	const end: HsmStateClass<Context, Protocol> = HsmTopState;
	const srcIndex: Map<HsmStateClass<Context, Protocol>, number> = new Map();
	let dstPath: HsmStateClass<Context, Protocol>[] = [];
	let cur: HsmStateClass<Context, Protocol> = src;
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

	return new ProductionTransition<Context, Protocol, EventName>(srcPath, dstPath, finalState);
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
				hsm.currentState = HsmFatalErrorState;
				throw transitionError;
			}
		} finally {
			hsm._transitionState = undefined;
		}
	}
}

async function doError<Context, Protocol extends {} | undefined, EventName extends keyof Protocol>(hsm: HsmWithTracing<Context, Protocol>, err: Error): Promise<void> {
	hsm._transitionState = undefined; // clear next state
	const messageHandler = hsm.currentState.prototype.onError;
	try {
		const result = messageHandler.call(hsm._instance, new HsmEventHandlerError(hsm, err));
		if (result) {
			await result;
		}
		await doTransition(hsm);
	} catch (recoveryErr) {
		if (recoveryErr instanceof HsmTransitionError) {
			throw new HsmFatalError(hsm, recoveryErr);
		}
		const err = asError(recoveryErr);
		hsm.transition(HsmFatalErrorState);
		try {
			await doTransition(hsm);
		} catch (_transitionError) {
			throw new HsmFatalError(hsm, err);
		}
		throw new HsmFatalError(hsm, err);
	}
}

async function doUnhandledEvent<Context, Protocol extends {} | undefined, EventName extends keyof Protocol>(hsm: HsmWithTracing<Context, Protocol>, error: HsmUnhandledEventError<Context, Protocol, EventName>): Promise<void> {
	try {
		const result = hsm.currentState.prototype.onUnhandled.call(hsm._instance, error);
		if (result) {
			await result;
		}
		await doTransition(hsm);
	} catch (recoveryErr) {
		if (recoveryErr instanceof HsmTransitionError) {
			hsm.currentState = HsmFatalErrorState;
			throw recoveryErr;
		}
		await doError(hsm, asError(recoveryErr));
	}
}

async function executeInit<Context, Protocol extends {} | undefined, EventName extends keyof Protocol>(hsm: HsmWithTracing<Context, Protocol>): Promise<void> {
	let currState: HsmStateClass<Context, Protocol> = hsm.topState;
	try {
		while (true) {
			const proto = currState.prototype;
			if (proto.hasOwnProperty('onEntry')) {
				proto.onEntry.call(hsm._instance);
			}
			if (hasInitialState(currState)) {
				currState = getInitialState(currState);
			} else break;
		}
		hsm.currentState = currState;
	} catch (cause) {
		hsm.currentState = HsmFatalErrorState;
		throw new HsmInitializationError(hsm, currState, asError(cause));
	}
}

async function dispatchEvent<Context, Protocol extends {} | undefined, EventName extends keyof Protocol>(hsm: HsmWithTracing<Context, Protocol>, eventName: HsmEventHandlerName<Protocol, EventName>, ...eventPayload: HsmEventHandlerPayload<Protocol, EventName>): Promise<void> {
	hsm._currentEventName = String(eventName);
	hsm._currentEventPayload = eventPayload;
	try {
		const eventHandler = hsm.currentState.prototype[eventName];
		if (!eventHandler) {
			await doUnhandledEvent(hsm, new HsmUnhandledEventError(hsm));
			return;
		}
		try {
			const result = eventHandler.call(hsm._instance, ...eventPayload);
			if (result) await result;
			await doTransition(hsm);
		} catch (recoveryErr) {
			if (recoveryErr instanceof HsmUnhandledEventError) {
				await doUnhandledEvent(hsm, recoveryErr);
			} else if (recoveryErr instanceof HsmTransitionError) {
				throw recoveryErr;
			} else {
				await doError(hsm, asError(recoveryErr));
			}
		}
	} finally {
		hsm._currentEventName = undefined;
		hsm._currentEventPayload = undefined;
		hsm._transitionState = undefined;
	}
}

// ---------------------------------------------------------------------------------------------------------------------
// Export: _createInitTask, _createEventDispatchTask
// ---------------------------------------------------------------------------------------------------------------------

/** @internal */
export function createInitTask<DispatchContext, DispatchProtocol extends {} | undefined>(hsm: HsmWithTracing<DispatchContext, DispatchProtocol>): Task {
	return (done: DoneCallback): void => {
		executeInit(hsm)
			.catch((err: unknown) => hsm.dispatchErrorCallback(hsm, asError(err)))
			.finally(() => done());
	};
}

/** @internal */
export function createEventDispatchTask<DispatchContext, DispatchProtocol extends {} | undefined, EventName extends keyof DispatchProtocol>(hsm: HsmWithTracing<DispatchContext, DispatchProtocol>, eventName: HsmEventHandlerName<DispatchProtocol, EventName>, ...eventPayload: HsmEventHandlerPayload<DispatchProtocol, EventName>): Task {
	return (done: DoneCallback): void => {
		dispatchEvent(hsm, eventName, ...eventPayload)
			.catch((err: unknown) => hsm.dispatchErrorCallback(hsm, asError(err)))
			.finally(() => done());
	};
}
