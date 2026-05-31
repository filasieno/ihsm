import { expect } from 'chai';
import 'mocha';
import { makeHsm, HsmFatalErrorState, HsmInitialState, HsmThenDepthError, HsmTopState, HsmTransitionError } from '../';
import { MAX_THEN_STEPS } from '../internal/dispatch-then';
import { clearLastError, createTestDispatchErrorCallback, getLastError, TRACE_LEVELS } from './spec.utils';

interface Ctx {
	log: string[];
}

interface Protocol {
	go(): void;
	goAsync(): void;
	enterPendingChild(): void;
}

class Top extends HsmTopState<Ctx, Protocol> implements Protocol {
	go(): void {
		this.transition(Pending);
	}
	goAsync(): void {
		this.transition(AsyncPending);
	}
	enterPendingChild(): void {
		this.transition(PendingChild);
	}
}

@HsmInitialState
class Idle extends Top {}

class Pending extends Top {
	then(): void {
		this.ctx.log.push('then:Pending');
		this.transition(Done);
	}
}

class Done extends Top {}

class AsyncPending extends Top {
	async then(): Promise<void> {
		await this.sleep(1);
		this.ctx.log.push('then:AsyncPending');
		this.transition(AsyncDone);
	}
}

class AsyncDone extends Top {}

class PendingChild extends Pending {}

class BootTop extends HsmTopState<Ctx, Protocol> implements Protocol {
	go(): void {
		this.transition(Pending);
	}
	goAsync(): void {
		this.transition(AsyncPending);
	}
	enterPendingChild(): void {
		this.transition(PendingChild);
	}
}

@HsmInitialState
class Boot extends BootTop {
	then(): void {
		this.ctx.log.push('then:Boot');
		this.transition(BootReady);
	}
}

class BootReady extends BootTop {}

class ChainTop extends HsmTopState<Ctx, Protocol> implements Protocol {
	go(): void {}
	goAsync(): void {}
	enterPendingChild(): void {}
}

@HsmInitialState
class StepOne extends ChainTop {
	then(): void {
		this.ctx.log.push('then:StepOne');
		this.transition(StepTwo);
	}
}

class StepTwo extends ChainTop {
	then(): void {
		this.ctx.log.push('then:StepTwo');
		this.transition(StepThree);
	}
}

class StepThree extends ChainTop {
	then(): void {
		this.ctx.log.push('then:StepThree');
	}
}

class SideEffectTop extends HsmTopState<Ctx, Protocol> implements Protocol {
	go(): void {}
	goAsync(): void {}
	enterPendingChild(): void {}
}

@HsmInitialState
class SideEffectOnly extends SideEffectTop {
	then(): void {
		this.ctx.log.push('then:SideEffectOnly');
	}
}

class BadThenTop extends SideEffectTop {}

@HsmInitialState
class BadThen extends BadThenTop {
	then(): void {
		throw new Error('then failed');
	}
}

class SelfLoopTop extends SideEffectTop {}

@HsmInitialState
class SelfLoop extends SelfLoopTop {
	then(): void {
		this.transition(SelfLoop);
	}
}

for (const traceLevel of TRACE_LEVELS) {
	describe(`then (traceLevel = ${traceLevel})`, function () {
		beforeEach(() => {
			clearLastError();
		});

		it('does not run the default empty then from HsmTopState', async () => {
			const sm = makeHsm(Top, { log: [] }, true, traceLevel);
			await sm.sync();
			expect(sm.currentState).equals(Idle);
			expect(sm.currentState.prototype.hasOwnProperty('then')).equals(false);
		});

		it('runs then after a handler-requested transition', async () => {
			const sm = makeHsm(Top, { log: [] }, true, traceLevel);
			await sm.sync();
			sm.post('go');
			await sm.sync();
			expect(sm.currentState).equals(Done);
			expect(sm.ctx.log).to.eql(['then:Pending']);
		});

		it('runs then after initialization', async () => {
			const sm = makeHsm(BootTop, { log: [] }, true, traceLevel);
			await sm.sync();
			expect(sm.currentState).equals(BootReady);
			expect(sm.ctx.log).to.eql(['then:Boot']);
		});

		it('supports async then', async () => {
			const sm = makeHsm(Top, { log: [] }, true, traceLevel);
			await sm.sync();
			sm.post('goAsync');
			await sm.sync();
			expect(sm.currentState).equals(AsyncDone);
			expect(sm.ctx.log).to.eql(['then:AsyncPending']);
		});

		it('chains multiple then steps in one dispatch', async () => {
			const sm = makeHsm(ChainTop, { log: [] }, true, traceLevel);
			await sm.sync();
			expect(sm.currentState).equals(StepThree);
			expect(sm.ctx.log).to.eql(['then:StepOne', 'then:StepTwo', 'then:StepThree']);
		});

		it('runs then without requesting a further transition', async () => {
			const sm = makeHsm(SideEffectTop, { log: [] }, true, traceLevel);
			await sm.sync();
			expect(sm.currentState).equals(SideEffectOnly);
			expect(sm.ctx.log).to.eql(['then:SideEffectOnly']);
		});

		it('does not inherit then from a parent state class', async () => {
			const sm = makeHsm(Top, { log: [] }, true, traceLevel);
			await sm.sync();
			sm.post('enterPendingChild');
			await sm.sync();
			expect(sm.currentState).equals(PendingChild);
			expect(sm.ctx.log).to.eql([]);
		});

		it('moves to HsmFatalErrorState when then throws', async () => {
			const sm = makeHsm(BadThenTop, { log: [] }, true, traceLevel, undefined, createTestDispatchErrorCallback(true));
			await sm.sync();
			expect(sm.currentState).equals(HsmFatalErrorState);
		});

		it('moves to HsmFatalErrorState when then chain exceeds the limit', async () => {
			const sm = makeHsm(SelfLoopTop, { log: [] }, true, traceLevel, undefined, createTestDispatchErrorCallback(true));
			await sm.sync();
			expect(sm.currentState).equals(HsmFatalErrorState);
		});
	});
}

describe('then errors', () => {
	it('exposes HsmTransitionError for then failures', async () => {
		clearLastError();
		const sm = makeHsm(BadThenTop, { log: [] }, true, undefined, undefined, createTestDispatchErrorCallback(true));
		await sm.sync();
		const err = getLastError();
		expect(err).instanceOf(HsmTransitionError);
		const transitionErr = err as HsmTransitionError<Ctx, Protocol, 'go'>;
		expect(transitionErr.failedCallback).equals('then');
		expect(transitionErr.message).includes('BadThen.then()');
	});

	it('exposes HsmThenDepthError when the chain is too long', async () => {
		clearLastError();
		const sm = makeHsm(SelfLoopTop, { log: [] }, true, undefined, undefined, createTestDispatchErrorCallback(true));
		await sm.sync();
		const err = getLastError();
		expect(err).instanceOf(HsmThenDepthError);
		expect(err!.message).includes(String(MAX_THEN_STEPS));
	});
});
