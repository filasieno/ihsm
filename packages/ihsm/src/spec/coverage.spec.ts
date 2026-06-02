import { expect } from 'chai';
import 'mocha';

import { State, TopState, TransitionError, UnhandledEventError, makeHsm, FatalErrorState, InitialState } from '../';
import { clearLastError, createTestDispatchErrorCallback, getLastError, TRACE_LEVELS, registerSpecStateNames } from './spec.utils';

interface Protocol {
	trigger(): void;
	boom(): void;
}

function transitionError(hsm: State<Record<string, never>, Protocol>, phase: 'onEntry' | 'onExit' = 'onEntry'): TransitionError<Record<string, never>, Protocol, 'trigger'> {
	const stateName = hsm.currentStateName;
	return new TransitionError(hsm, new Error('transition failed'), stateName, phase, stateName, 'Target');
}

class Top extends TopState<Record<string, never>, Protocol> implements Protocol {
	trigger(): void {}
	boom(): void {}
}

describe('hi-priority queue when idle', () => {
	it('runs an unshifted task without a preceding main-queue job', async () => {
		const sm = makeHsm(Top, {}, false);
		let ran = false;
		const internal = sm as unknown as { unshiftHiPriorityTask: (task: (done: () => void) => void) => void };
		internal.unshiftHiPriorityTask(done => {
			ran = true;
			done();
		});
		await sm.sync();
		expect(ran).equals(true);
	});
});

class HandlerThrowsTransition extends Top {
	trigger(): void {
		throw transitionError(this);
	}
}

for (const traceLevel of TRACE_LEVELS) {
	describe(`handler throws TransitionError (traceLevel = ${traceLevel})`, () => {
		beforeEach(() => clearLastError());

		it('surfaces the transition error through dispatch', async () => {
			const sm = makeHsm(HandlerThrowsTransition, {}, true, traceLevel, undefined, createTestDispatchErrorCallback(true));
			await sm.sync();
			sm.post('trigger');
			await sm.sync();
			expect(getLastError()).instanceOf(TransitionError);
		});
	});
}

class OnErrorRethrowsTransition extends Top {
	trigger(): void {
		throw new Error('handler failed');
	}

	onError(): void {
		throw transitionError(this);
	}
}

for (const traceLevel of TRACE_LEVELS) {
	describe(`onError rethrows TransitionError (traceLevel = ${traceLevel})`, () => {
		beforeEach(() => clearLastError());

		it('does not recover', async () => {
			const sm = makeHsm(OnErrorRethrowsTransition, {}, true, traceLevel, undefined, createTestDispatchErrorCallback(true));
			await sm.sync();
			sm.post('trigger');
			await sm.sync();
			expect(getLastError()).satisfies((err: Error) => err instanceof TransitionError || err.name === 'FatalError');
		});
	});
}

class OnUnhandledRethrowsTransition extends Top {
	trigger(): void {
		this.unhandled();
	}

	onUnhandled<EventName extends keyof Protocol>(_error: UnhandledEventError<Record<string, never>, Protocol, EventName>): void {
		throw transitionError(this);
	}
}

for (const traceLevel of TRACE_LEVELS) {
	describe(`onUnhandled rethrows TransitionError (traceLevel = ${traceLevel})`, () => {
		beforeEach(() => clearLastError());

		it('moves to fatal state', async () => {
			const sm = makeHsm(OnUnhandledRethrowsTransition, {}, true, traceLevel, undefined, createTestDispatchErrorCallback(true));
			await sm.sync();
			sm.post('trigger');
			await sm.sync();
			expect(sm.currentState).equals(FatalErrorState);
		});
	});
}

class InitTransitionTop extends TopState<Record<string, never>, Protocol> {}

@InitialState
class InitOnEntryThrowsTransition extends InitTransitionTop {
	onEntry(): void {
		throw transitionError(this.hsm);
	}
}

void InitOnEntryThrowsTransition;

for (const traceLevel of TRACE_LEVELS) {
	describe(`init onEntry throws TransitionError (traceLevel = ${traceLevel})`, () => {
		beforeEach(() => clearLastError());

		it('rethrows the transition error', async () => {
			makeHsm(InitTransitionTop, {}, true, traceLevel, undefined, createTestDispatchErrorCallback(true));
			await new Promise(resolve => setTimeout(resolve, 50));
			expect(getLastError()).instanceOf(TransitionError);
		});
	});
}

class AsyncOnErrorRecovery extends Top {
	trigger(): void {
		throw new Error('handler failed');
	}

	async onError(): Promise<void> {
		await this.sleep(1);
	}
}

for (const traceLevel of TRACE_LEVELS) {
	describe(`async onError recovery (traceLevel = ${traceLevel})`, () => {
		it('awaits the onError promise', async () => {
			const sm = makeHsm(AsyncOnErrorRecovery, {}, true, traceLevel);
			await sm.sync();
			sm.post('trigger');
			await sm.sync();
			expect(sm.currentStateName).equals('AsyncOnErrorRecovery');
		});
	});
}

class AsyncOnUnhandledRecovery extends Top {
	trigger(): void {
		this.unhandled();
	}

	async onUnhandled<EventName extends keyof Protocol>(_error: UnhandledEventError<Record<string, never>, Protocol, EventName>): Promise<void> {
		await this.sleep(1);
	}
}

for (const traceLevel of TRACE_LEVELS) {
	describe(`async onUnhandled recovery (traceLevel = ${traceLevel})`, () => {
		it('awaits the onUnhandled promise', async () => {
			const sm = makeHsm(AsyncOnUnhandledRecovery, {}, true, traceLevel);
			await sm.sync();
			sm.post('trigger');
			await sm.sync();
			expect(sm.currentStateName).equals('AsyncOnUnhandledRecovery');
		});
	});
}

class MissingHandlerTop extends TopState<Record<string, never>, Protocol> {
	onUnhandled<EventName extends keyof Protocol>(_error: UnhandledEventError<Record<string, never>, Protocol, EventName>): void {
		throw new Error('onUnhandled failed');
	}
}

for (const traceLevel of TRACE_LEVELS) {
	describe(`missing handler with failing onUnhandled (traceLevel = ${traceLevel})`, () => {
		beforeEach(() => clearLastError());

		it('reports dispatch failure', async () => {
			const sm = makeHsm(MissingHandlerTop, {}, true, traceLevel, undefined, createTestDispatchErrorCallback(true));
			await sm.sync();
			sm.post('unknownEvent' as 'trigger');
			await sm.sync();
			expect(getLastError()).instanceOf(Error);
		});
	});
}

class BoomUnhandled extends Top {
	boom(): void {
		this.unhandled();
	}

	onUnhandled<EventName extends keyof Protocol>(_error: UnhandledEventError<Record<string, never>, Protocol, EventName>): void {
		throw new Error('nested unhandled recovery failed');
	}
}

registerSpecStateNames({
	Top,
	HandlerThrowsTransition,
	OnErrorRethrowsTransition,
	OnUnhandledRethrowsTransition,
	InitTransitionTop,
	InitOnEntryThrowsTransition,
	AsyncOnErrorRecovery,
	AsyncOnUnhandledRecovery,
	MissingHandlerTop,
	BoomUnhandled,
});

for (const traceLevel of TRACE_LEVELS) {
	describe(`unhandled() with failing onUnhandled (traceLevel = ${traceLevel})`, () => {
		beforeEach(() => clearLastError());

		it('reports nested dispatch failure', async () => {
			const sm = makeHsm(BoomUnhandled, {}, true, traceLevel, undefined, createTestDispatchErrorCallback(true));
			await sm.sync();
			sm.post('boom');
			await sm.sync();
			expect(getLastError()).instanceOf(Error);
		});
	});
}
