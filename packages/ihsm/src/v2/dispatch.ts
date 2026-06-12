import {
	EventHandlerError,
	FatalError,
	FatalErrorState,
	TraceLevel,
	TransitionError,
	UnhandledEventError,
} from '../';
import { DoneCallback, HsmWithTracing, Task } from '../internal/defs.private';
import { lookupEventHandler } from '../internal/lookup';
import { asError } from '../internal/utils';

import { executePendingTransition, TransitionResolver } from './transition-resolver';

export type DispatchKind = 'notification' | 'service';

async function completePendingTransitions<Context, Protocol extends object>(
	host: HsmWithTracing<Context, Protocol>,
	resolver: TransitionResolver<Context, Protocol>,
	onComplete: () => void,
): Promise<void> {
	await executePendingTransition(host, resolver);
	onComplete();
}

async function doError<Context, Protocol extends object>(
	host: HsmWithTracing<Context, Protocol>,
	resolver: TransitionResolver<Context, Protocol>,
	err: Error,
	onComplete: () => void,
): Promise<void> {
	host._transitionState = undefined;
	const messageHandler = host.currentState.prototype.onError;
	try {
		const result = messageHandler.call(host._instance, new EventHandlerError(host, err));
		if (result) {
			await result;
		}
		await completePendingTransitions(host, resolver, onComplete);
	} catch (recoveryErr) {
		if (recoveryErr instanceof TransitionError) {
			throw new FatalError(host, recoveryErr);
		}
		const recoveryError = asError(recoveryErr);
		host.transition(FatalErrorState);
		await completePendingTransitions(host, resolver, onComplete);
		throw new FatalError(host, recoveryError);
	}
}

async function doUnhandledEvent<Context, Protocol extends object>(
	host: HsmWithTracing<Context, Protocol>,
	resolver: TransitionResolver<Context, Protocol>,
	error: UnhandledEventError<Context, Protocol, keyof Protocol & string>,
	onComplete: () => void,
): Promise<void> {
	try {
		const result = host.currentState.prototype.onUnhandled.call(host._instance, error);
		if (result) {
			await result;
		}
		await completePendingTransitions(host, resolver, onComplete);
	} catch (recoveryErr) {
		if (recoveryErr instanceof TransitionError) {
			host.currentState = FatalErrorState;
			throw recoveryErr;
		}
		await doError(host, resolver, asError(recoveryErr), onComplete);
	}
}

function finishEventDispatch<Context, Protocol extends object>(host: HsmWithTracing<Context, Protocol>): void {
	host._currentEventName = undefined;
	host._currentEventPayload = undefined;
}

async function invokeHandler<Context, Protocol extends object>(
	host: HsmWithTracing<Context, Protocol>,
	resolver: TransitionResolver<Context, Protocol>,
	name: string,
	args: readonly unknown[],
): Promise<unknown> {
	host._currentEventName = name;
	host._currentEventPayload = [...args];
	try {
		const eventHandler = lookupEventHandler(host, name);
		if (!eventHandler) {
			await doUnhandledEvent(host, resolver, new UnhandledEventError(host), () => finishEventDispatch(host));
			return undefined;
		}
		try {
			const result = eventHandler.call(host._instance, ...args);
			const settled = result instanceof Promise ? await result : result;
			await completePendingTransitions(host, resolver, () => finishEventDispatch(host));
			return settled;
		} catch (recoveryErr) {
			if (recoveryErr instanceof UnhandledEventError) {
				await doUnhandledEvent(host, resolver, recoveryErr, () => finishEventDispatch(host));
				return undefined;
			}
			if (recoveryErr instanceof TransitionError) {
				finishEventDispatch(host);
				throw recoveryErr;
			}
			const original = asError(recoveryErr);
			try {
				await doError(host, resolver, original, () => finishEventDispatch(host));
			} catch {
				// onError did not recover — client still rejects with the handler error
			}
			throw original;
		}
	} catch (err) {
		finishEventDispatch(host);
		throw err;
	}
}

export function createV2InitTask<Context, Protocol extends object>(
	host: HsmWithTracing<Context, Protocol>,
	resolver: TransitionResolver<Context, Protocol>,
): Task {
	if (host.traceLevel === TraceLevel.PRODUCTION) {
		return host._createInitTask(host);
	}
	return (done: DoneCallback): void => {
		host._createInitTask(host)(() => {
			executePendingTransition(host, resolver)
				.then(() => done())
				.catch((err: unknown) => {
					host.dispatchErrorCallback(host, asError(err));
					done();
				});
		});
	};
}

export function createV2ServiceTask<Context, Protocol extends object>(
	host: HsmWithTracing<Context, Protocol>,
	resolver: TransitionResolver<Context, Protocol>,
	name: string,
	args: readonly unknown[],
	resolve: (value: unknown) => void,
	reject: (error: Error) => void,
): Task {
	return (done: DoneCallback): void => {
		invokeHandler(host, resolver, name, args)
			.then(resolve)
			.catch((err: unknown) => {
				reject(asError(err));
			})
			.catch((err: unknown) => host.dispatchErrorCallback(host, asError(err)))
			.finally(() => done());
	};
}

export function createV2NotificationTask<Context, Protocol extends object>(
	host: HsmWithTracing<Context, Protocol>,
	_resolver: TransitionResolver<Context, Protocol>,
	name: string,
	args: readonly unknown[],
): Task {
	return (done: DoneCallback): void => {
		host._createEventDispatchTask(host, name as never, ...(args as never))(done);
	};
}
