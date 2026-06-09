import { TopState, EventHandlerError, PostedEvent, EventPayload, FatalErrorState, InitializationError, FatalError, StateClass, TransitionError, UnhandledEventError } from '../';

import { DoneCallback, HsmWithTracing, Task, Transition } from './defs.private';
import { lookupEventHandler } from './lookup';
import { executeTransitionRoutine, planTransitionClasses } from './transition-routines';
import { getInitialState, getTransitionKey, hasInitialState, asError, getStateName } from './utils';

class ProductionTransition<Context, Protocol extends {} | undefined> implements Transition<Context, Protocol> {
	constructor(
		private plan: ReturnType<typeof planTransitionClasses<Context, Protocol>>,
		private srcState: StateClass<Context, Protocol>,
		private dstState: StateClass<Context, Protocol>,
	) {}

	async execute(hsm: HsmWithTracing<Context, Protocol>, srcState: StateClass<Context, Protocol>, dstState: StateClass<Context, Protocol>): Promise<void> {
		await executeTransitionRoutine(hsm, hsm._instance, this.plan, srcState, dstState, {
			style: 'production',
			setCurrentState: state => {
				hsm.currentState = state;
			},
		});
	}
}

function createTransition<Context, Protocol extends {} | undefined>(srcState: StateClass<Context, Protocol>, destState: StateClass<Context, Protocol>): Transition<Context, Protocol> {
	return new ProductionTransition(planTransitionClasses(srcState, destState), srcState, destState);
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
