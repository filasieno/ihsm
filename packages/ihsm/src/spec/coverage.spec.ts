import { expect } from 'chai';
import 'mocha';

import { State, TopState, TransitionError, UnhandledEventError, FatalErrorState, InitialState } from '../';
import { TestPort, makeTestActor } from '../testing';
import { clearLastError, createTestDispatchErrorCallback, getLastError, TRACE_LEVELS, registerSpecStateNames, traceActorOnPort } from './spec.utils';

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
		const sm = makeTestActor(Top, {}, new TestPort(), { initialize: false });
		let ran = 0;
		const internal = sm as unknown as { unshiftHiPriorityTask: (task: (done: () => void) => void) => void };
		internal.unshiftHiPriorityTask(done => {
			ran += 1;
			done();
		});
		// A second unshift while the queue is already draining hits the early-return guard.
		internal.unshiftHiPriorityTask(done => {
			ran += 1;
			done();
		});
		await sm.sync();
		expect(ran).equals(2);
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
			const port = new TestPort();
			const sm = makeTestActor(HandlerThrowsTransition, {}, port, { traceLevel, dispatchErrorCallback: createTestDispatchErrorCallback(true) });
			traceActorOnPort(sm, port);
			await sm.sync();
			sm.post('trigger');
			await sm.sync();
			expect(getLastError()).instanceOf(TransitionError);
			expect(port.events).eqls(['trigger']);
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
			const sm = makeTestActor(OnErrorRethrowsTransition, {}, new TestPort(), { traceLevel, dispatchErrorCallback: createTestDispatchErrorCallback(true) });
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
			const sm = makeTestActor(OnUnhandledRethrowsTransition, {}, new TestPort(), { traceLevel, dispatchErrorCallback: createTestDispatchErrorCallback(true) });
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
			makeTestActor(InitTransitionTop, {}, new TestPort(), { traceLevel, dispatchErrorCallback: createTestDispatchErrorCallback(true) });
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
			const sm = makeTestActor(AsyncOnErrorRecovery, {}, new TestPort(), { traceLevel });
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
			const sm = makeTestActor(AsyncOnUnhandledRecovery, {}, new TestPort(), { traceLevel });
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
			const sm = makeTestActor(MissingHandlerTop, {}, new TestPort(), { traceLevel, dispatchErrorCallback: createTestDispatchErrorCallback(true) });
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
			const sm = makeTestActor(BoomUnhandled, {}, new TestPort(), { traceLevel, dispatchErrorCallback: createTestDispatchErrorCallback(true) });
			await sm.sync();
			sm.post('boom');
			await sm.sync();
			expect(getLastError()).instanceOf(Error);
		});
	});
}
