import { expect } from 'chai';
import 'mocha';

import { FatalErrorState, InitialState, TopState, TransitionError, UnhandledEventError, makeOwnerActor, manifestFor } from '../';
import type { Config, HandlerHsm } from '../';
import { TestPort } from '../testing';
import { kMachine } from '../v2/handles';
import type { HandleOwn } from '../v2/handles';
import { clearLastError, createTestDispatchErrorCallback, getLastError, TRACE_LEVELS, registerSpecStateNames, traceActorOnPort } from './spec.utils';

interface CoverageConfig extends Config {
	context: Record<string, never>;
	notifications: {
		trigger(): void;
		boom(): void;
	};
}

const coverageManifest = manifestFor<CoverageConfig>({
	services: [],
	notifications: ['trigger', 'boom'],
	internalServices: [],
	internalNotifications: [],
});

function transitionError(hsm: HandlerHsm<CoverageConfig>, phase: 'onEntry' | 'onExit' = 'onEntry'): TransitionError<Record<string, never>, CoverageConfig['notifications'], 'trigger'> {
	const stateName = hsm.currentStateName;
	return new TransitionError(hsm as never, new Error('transition failed'), stateName, phase, stateName, 'Target');
}

class Top extends TopState {
	static readonly manifest = coverageManifest;
	declare readonly __ihsm: CoverageConfig;

	trigger(): void {}
	boom(): void {}
}

describe('hi-priority queue when idle', () => {
	it('runs an unshifted task without a preceding main-queue job', async () => {
		const actor = makeOwnerActor(Top as never, {}, new TestPort(), { initialize: false });
		let ran = 0;
		(actor as HandleOwn)[kMachine].unshiftHiPriorityTask(done => {
			ran += 1;
			done();
		});
		// A second unshift while the queue is already draining hits the early-return guard.
		(actor as HandleOwn)[kMachine].unshiftHiPriorityTask(done => {
			ran += 1;
			done();
		});
		await actor.hsm.sync();
		expect(ran).equals(2);
	});
});

class HandlerThrowsTransition extends Top {
	trigger(): void {
		throw transitionError(this.hsm);
	}
}

for (const traceLevel of TRACE_LEVELS) {
	describe(`handler throws TransitionError (traceLevel = ${traceLevel})`, () => {
		beforeEach(() => clearLastError());

		it('surfaces the transition error through dispatch', async () => {
			const port = new TestPort();
			const sm = makeOwnerActor(HandlerThrowsTransition as never, {}, port, { traceLevel, dispatchErrorCallback: createTestDispatchErrorCallback(true) });
			traceActorOnPort(sm, port);
			await sm.hsm.sync();
			sm.trigger();
			await sm.hsm.sync();
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
		throw transitionError(this.hsm);
	}
}

for (const traceLevel of TRACE_LEVELS) {
	describe(`onError rethrows TransitionError (traceLevel = ${traceLevel})`, () => {
		beforeEach(() => clearLastError());

		it('does not recover', async () => {
			const sm = makeOwnerActor(OnErrorRethrowsTransition as never, {}, new TestPort(), { traceLevel, dispatchErrorCallback: createTestDispatchErrorCallback(true) });
			await sm.hsm.sync();
			sm.trigger();
			await sm.hsm.sync();
			expect(getLastError()).to.exist;
		});
	});
}

class OnUnhandledRethrowsTransition extends Top {
	trigger(): void {
		this.hsm.unhandled();
	}

	onUnhandled<EventName extends keyof CoverageConfig['notifications']>(_error: UnhandledEventError<Record<string, never>, CoverageConfig['notifications'], EventName>): void {
		throw transitionError(this.hsm);
	}
}

for (const traceLevel of TRACE_LEVELS) {
	describe(`onUnhandled rethrows TransitionError (traceLevel = ${traceLevel})`, () => {
		beforeEach(() => clearLastError());

		it('moves to fatal state', async () => {
			const sm = makeOwnerActor(OnUnhandledRethrowsTransition as never, {}, new TestPort(), { traceLevel, dispatchErrorCallback: createTestDispatchErrorCallback(true) });
			await sm.hsm.sync();
			sm.trigger();
			await sm.hsm.sync();
			expect(sm.hsm.currentState).equals(FatalErrorState);
		});
	});
}

const initOnlyManifest = manifestFor<{ notifications: Record<string, never> }>({
	services: [],
	notifications: [],
	internalServices: [],
	internalNotifications: [],
});

class InitTransitionTop extends TopState {
	static readonly manifest = initOnlyManifest;
	declare readonly __ihsm: { notifications: Record<string, never> };
}

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
			makeOwnerActor(InitTransitionTop as never, {}, new TestPort(), { traceLevel, dispatchErrorCallback: createTestDispatchErrorCallback(true) });
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
		await this.hsm.sleep(1);
	}
}

for (const traceLevel of TRACE_LEVELS) {
	describe(`async onError recovery (traceLevel = ${traceLevel})`, () => {
		it('awaits the onError promise', async () => {
			const sm = makeOwnerActor(AsyncOnErrorRecovery as never, {}, new TestPort(), { traceLevel });
			await sm.hsm.sync();
			sm.trigger();
			await sm.hsm.sync();
			expect(sm.hsm.currentStateName).equals('AsyncOnErrorRecovery');
		});
	});
}

class AsyncOnUnhandledRecovery extends Top {
	trigger(): void {
		this.hsm.unhandled();
	}

	async onUnhandled<EventName extends keyof CoverageConfig['notifications']>(_error: UnhandledEventError<Record<string, never>, CoverageConfig['notifications'], EventName>): Promise<void> {
		await this.hsm.sleep(1);
	}
}

for (const traceLevel of TRACE_LEVELS) {
	describe(`async onUnhandled recovery (traceLevel = ${traceLevel})`, () => {
		it('awaits the onUnhandled promise', async () => {
			const sm = makeOwnerActor(AsyncOnUnhandledRecovery as never, {}, new TestPort(), { traceLevel });
			await sm.hsm.sync();
			sm.trigger();
			await sm.hsm.sync();
			expect(sm.hsm.currentStateName).equals('AsyncOnUnhandledRecovery');
		});
	});
}

const missingHandlerManifest = manifestFor<{ notifications: Record<string, never> }>({
	services: [],
	notifications: [],
	internalServices: [],
	internalNotifications: [],
});

class MissingHandlerTop extends TopState {
	static readonly manifest = missingHandlerManifest;
	declare readonly __ihsm: { notifications: Record<string, never> };

	onUnhandled(_error: UnhandledEventError<Record<string, never>, Record<string, never>, never>): void {
		throw new Error('onUnhandled failed');
	}
}

for (const traceLevel of TRACE_LEVELS) {
	describe(`missing handler with failing onUnhandled (traceLevel = ${traceLevel})`, () => {
		beforeEach(() => clearLastError());

		it('reports dispatch failure', async () => {
			const sm = makeOwnerActor(MissingHandlerTop as never, {}, new TestPort(), { traceLevel, dispatchErrorCallback: createTestDispatchErrorCallback(true) });
			await sm.hsm.sync();
			(sm as HandleOwn)[kMachine].dispatchNotification('unknownEvent', [], 'default');
			await sm.hsm.sync();
			expect(getLastError()).instanceOf(Error);
		});
	});
}

class BoomUnhandled extends Top {
	boom(): void {
		this.hsm.unhandled();
	}

	onUnhandled<EventName extends keyof CoverageConfig['notifications']>(_error: UnhandledEventError<Record<string, never>, CoverageConfig['notifications'], EventName>): void {
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
	MissingHandlerTop,
	AsyncOnErrorRecovery,
	AsyncOnUnhandledRecovery,
	BoomUnhandled,
});

for (const traceLevel of TRACE_LEVELS) {
	describe(`unhandled() with failing onUnhandled (traceLevel = ${traceLevel})`, () => {
		beforeEach(() => clearLastError());

		it('reports nested dispatch failure', async () => {
			const sm = makeOwnerActor(BoomUnhandled as never, {}, new TestPort(), { traceLevel, dispatchErrorCallback: createTestDispatchErrorCallback(true) });
			await sm.hsm.sync();
			sm.boom();
			await sm.hsm.sync();
			expect(getLastError()).instanceOf(Error);
		});
	});
}
