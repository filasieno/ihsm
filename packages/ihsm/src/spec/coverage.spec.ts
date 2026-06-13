import { expect } from 'chai';
import 'mocha';

import { FatalErrorState, InitialState, TopState, TransitionError, UnhandledEventError } from '../';
import type { ActorNotificationsOf, HandlerHsm } from '../';
import { kMachine } from '../internal/runtime';
import type { HandleOwn } from '../internal/runtime';
import { makeTestActor, TestPort } from '../testing';
import * as self from './coverage.spec';
import { clearLastError, createTestDispatchErrorCallback, getLastError, TRACE_LEVELS, registerSpecStateNames, traceActorOnPort } from './spec.utils';

function transitionError(hsm: HandlerHsm<CoverageConfig>, phase: 'onEntry' | 'onExit' = 'onEntry'): TransitionError<CoverageConfig, 'trigger'> {
	const stateName = hsm.currentStateName;
	return new TransitionError(hsm as never, new Error('transition failed'), stateName, phase, stateName, 'Target');
}

//#region ThisTestSpec

interface CoverageConfig {
	context: Record<string, never>;
	notifications: {
		trigger(): void;
		boom(): void;
	};
}

export class Top extends TopState<CoverageConfig> {

	trigger(): void {}
	boom(): void {}
}

export class HandlerThrowsTransition extends Top {
	trigger(): void {
		throw transitionError(this.hsm);
	}
}

export class OnErrorRethrowsTransition extends Top {
	trigger(): void {
		throw new Error('handler failed');
	}

	onError(): void {
		throw transitionError(this.hsm);
	}
}

export class OnUnhandledRethrowsTransition extends Top {
	trigger(): void {
		this.hsm.unhandled();
	}

	onUnhandled<EventName extends keyof ActorNotificationsOf<CoverageConfig>>(_error: UnhandledEventError<CoverageConfig, EventName>): void {
		throw transitionError(this.hsm);
	}
}

export class InitTransitionTop extends TopState<CoverageConfig> {
}

@InitialState
export class InitOnEntryThrowsTransition extends InitTransitionTop {
	onEntry(): void {
		throw transitionError(this.hsm);
	}
}

void InitOnEntryThrowsTransition;

export class AsyncOnErrorRecovery extends Top {
	trigger(): void {
		throw new Error('handler failed');
	}

	async onError(): Promise<void> {
		await new Promise<void>(resolve => setTimeout(resolve, 1));
	}
}

export class AsyncOnUnhandledRecovery extends Top {
	trigger(): void {
		this.hsm.unhandled();
	}

	async onUnhandled<EventName extends keyof ActorNotificationsOf<CoverageConfig>>(_error: UnhandledEventError<CoverageConfig, EventName>): Promise<void> {
		await new Promise<void>(resolve => setTimeout(resolve, 1));
	}
}

export class MissingHandlerTop extends TopState<CoverageConfig> {

	onUnhandled(_error: UnhandledEventError<CoverageConfig, never>): void {
		throw new Error('onUnhandled failed');
	}
}

export class BoomUnhandled extends Top {
	boom(): void {
		this.hsm.unhandled();
	}

	onUnhandled<EventName extends keyof ActorNotificationsOf<CoverageConfig>>(_error: UnhandledEventError<CoverageConfig, EventName>): void {
		throw new Error('nested unhandled recovery failed');
	}
}

registerSpecStateNames(self);
//#endregion

describe('hi-priority queue when idle', () => {
	it('runs an unshifted task without a preceding main-queue job', async () => {
		const actor = makeTestActor(Top, {}, new TestPort(), { initialize: false });
		let ran = 0;
		(actor as unknown as HandleOwn)[kMachine].unshiftHiPriorityTask(done => {
			ran += 1;
			done();
		});
		// A second unshift while the queue is already draining hits the early-return guard.
		(actor as unknown as HandleOwn)[kMachine].unshiftHiPriorityTask(done => {
			ran += 1;
			done();
		});
		await actor.hsm.sync();
		expect(ran).equals(2);
	});
});

for (const traceLevel of TRACE_LEVELS) {
	describe(`handler throws TransitionError (traceLevel = ${traceLevel})`, () => {
		beforeEach(() => clearLastError());

		it('surfaces the transition error through dispatch', async () => {
			const port = new TestPort();
			const sm = makeTestActor(HandlerThrowsTransition, {}, port, { traceLevel, dispatchErrorCallback: createTestDispatchErrorCallback(true) });
			traceActorOnPort(sm, port);
			await sm.hsm.sync();
			sm.trigger();
			await sm.hsm.sync();
			expect(getLastError()).instanceOf(TransitionError);
			expect(port.events).eqls(['trigger']);
		});
	});
}

for (const traceLevel of TRACE_LEVELS) {
	describe(`onError rethrows TransitionError (traceLevel = ${traceLevel})`, () => {
		beforeEach(() => clearLastError());

		it('does not recover', async () => {
			const sm = makeTestActor(OnErrorRethrowsTransition, {}, new TestPort(), { traceLevel, dispatchErrorCallback: createTestDispatchErrorCallback(true) });
			await sm.hsm.sync();
			sm.trigger();
			await sm.hsm.sync();
			expect(getLastError()).to.exist;
		});
	});
}

for (const traceLevel of TRACE_LEVELS) {
	describe(`onUnhandled rethrows TransitionError (traceLevel = ${traceLevel})`, () => {
		beforeEach(() => clearLastError());

		it('moves to fatal state', async () => {
			const sm = makeTestActor(OnUnhandledRethrowsTransition, {}, new TestPort(), { traceLevel, dispatchErrorCallback: createTestDispatchErrorCallback(true) });
			await sm.hsm.sync();
			sm.trigger();
			await sm.hsm.sync();
			expect(sm.hsm.currentState).equals(FatalErrorState);
		});
	});
}

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

for (const traceLevel of TRACE_LEVELS) {
	describe(`async onError recovery (traceLevel = ${traceLevel})`, () => {
		it('awaits the onError promise', async () => {
			const sm = makeTestActor(AsyncOnErrorRecovery, {}, new TestPort(), { traceLevel });
			await sm.hsm.sync();
			sm.trigger();
			await sm.hsm.sync();
			expect(sm.hsm.currentStateName).equals('AsyncOnErrorRecovery');
		});
	});
}

for (const traceLevel of TRACE_LEVELS) {
	describe(`async onUnhandled recovery (traceLevel = ${traceLevel})`, () => {
		it('awaits the onUnhandled promise', async () => {
			const sm = makeTestActor(AsyncOnUnhandledRecovery, {}, new TestPort(), { traceLevel });
			await sm.hsm.sync();
			sm.trigger();
			await sm.hsm.sync();
			expect(sm.hsm.currentStateName).equals('AsyncOnUnhandledRecovery');
		});
	});
}

for (const traceLevel of TRACE_LEVELS) {
	describe(`missing handler with failing onUnhandled (traceLevel = ${traceLevel})`, () => {
		beforeEach(() => clearLastError());

		it('reports dispatch failure', async () => {
			const sm = makeTestActor(MissingHandlerTop, {}, new TestPort(), { traceLevel, dispatchErrorCallback: createTestDispatchErrorCallback(true) });
			await sm.hsm.sync();
			(sm as unknown as HandleOwn)[kMachine].dispatchNotification('unknownEvent', [], 'default');
			await sm.hsm.sync();
			expect(getLastError()).instanceOf(Error);
		});
	});
}

for (const traceLevel of TRACE_LEVELS) {
	describe(`unhandled() with failing onUnhandled (traceLevel = ${traceLevel})`, () => {
		beforeEach(() => clearLastError());

		it('reports nested dispatch failure', async () => {
			const sm = makeTestActor(BoomUnhandled, {}, new TestPort(), { traceLevel, dispatchErrorCallback: createTestDispatchErrorCallback(true) });
			await sm.hsm.sync();
			sm.boom();
			await sm.hsm.sync();
			expect(getLastError()).instanceOf(Error);
		});
	});
}
