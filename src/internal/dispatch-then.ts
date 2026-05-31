import { HsmFatalErrorState, HsmStateClass, HsmThenDepthError, HsmTransitionError } from '../';
import { DoneCallback, HsmWithTracing } from './defs.private';
import { asError } from './utils';

/** @internal */
export const MAX_THEN_STEPS = 32;

/** @internal */
export function stateHasThen<Context, Protocol extends {} | undefined>(state: HsmStateClass<Context, Protocol>): boolean {
	return Object.prototype.hasOwnProperty.call(state.prototype, 'then');
}

/** @internal */
export interface ThenTrace {
	start(stateName: string): void;
	done(stateName: string): void;
	error(stateName: string, cause: unknown): void;
	depthExceeded(): void;
}

/** @internal */
async function runOneThenStep<Context, Protocol extends {} | undefined>(hsm: HsmWithTracing<Context, Protocol>, doTransition: (hsm: HsmWithTracing<Context, Protocol>) => Promise<void>, trace: ThenTrace | undefined, step: number): Promise<boolean> {
	await doTransition(hsm);
	if (!stateHasThen(hsm.currentState)) {
		return false;
	}
	if (step >= MAX_THEN_STEPS) {
		trace?.depthExceeded();
		hsm.currentState = HsmFatalErrorState;
		throw new HsmThenDepthError(hsm);
	}
	const state = hsm.currentState;
	const stateName = state.name;
	trace?.start(stateName);
	try {
		const res = state.prototype.then.call(hsm._instance);
		if (res) {
			await res;
		}
		trace?.done(stateName);
	} catch (cause) {
		trace?.error(stateName, cause);
		hsm.currentState = HsmFatalErrorState;
		throw new HsmTransitionError(hsm, asError(cause), stateName, 'then', stateName, stateName);
	}
	return hsm._transitionState !== undefined;
}

/**
 * Schedule one {@link HsmTopState.then} step on the front of the hi-priority dispatch queue.
 * Further steps are queued iteratively (not recursively on the call stack).
 * @internal
 */
export function scheduleThenStep<Context, Protocol extends {} | undefined>(hsm: HsmWithTracing<Context, Protocol>, doTransition: (hsm: HsmWithTracing<Context, Protocol>) => Promise<void>, trace: ThenTrace | undefined, step: number, onComplete: () => void): void {
	hsm.unshiftHiPriorityTask((done: DoneCallback): void => {
		runOneThenStep(hsm, doTransition, trace, step)
			.then((continueChain: boolean) => {
				if (continueChain) {
					scheduleThenStep(hsm, doTransition, trace, step + 1, onComplete);
				} else {
					onComplete();
				}
			})
			.catch((err: unknown) => {
				onComplete();
				hsm.dispatchErrorCallback(hsm, asError(err));
			})
			.finally(done);
	});
}
