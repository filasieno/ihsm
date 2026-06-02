import { expect } from 'chai';
import 'mocha';
import { Hsm, Any, makeHsm, FatalErrorState, InitialState, RuntimeError, StateClass, TopState, UnhandledEventError } from '../';
import { clearLastError, createTestDispatchErrorCallback, getLastError, TRACE_LEVELS } from './spec.utils';

interface Protocol {
	hello(): void;
	transitionTo(s: State): void;
}

type State = StateClass<Any, Protocol>;

class HsmTop extends TopState<Any, Protocol> {
	onUnhandled<EventName extends keyof Protocol>(error: UnhandledEventError<Any, Protocol, EventName>): Promise<void> | void {
		console.log(`${error}`);
		if (this.currentState === A) {
			this.transition(B);
		} else {
			this.transition(A);
		}

		if (this.currentState === F) {
			this.transition(E);
		}
	}

	transitionTo(s: StateClass<Any, Protocol>): void {
		this.transition(s);
	}
}

class A extends HsmTop {
	hello(): void {
		this.unhandled();
	}
}

class C extends HsmTop {
	onUnhandled<EventName extends keyof Protocol>(error: UnhandledEventError<Any, Protocol, EventName>): Promise<void> | void {
		console.log(`error: ${error}`);
		throw new Error('Unhandled throws');
	}
}

class E extends HsmTop {
	onEntry(): Promise<void> | void {
		throw new Error('Unhandled throws in a transition');
	}
}

class F extends HsmTop {}

class G extends HsmTop {
	onError<EventName extends keyof Protocol>(error: RuntimeError<Any, Protocol, EventName>): Promise<void> | void {
		console.log(`error: ${error}`);
		console.log('recovered');
	}

	async onUnhandled<EventName extends keyof Protocol>(error: UnhandledEventError<Any, Protocol, EventName>): Promise<void> {
		console.log(`error: ${error}`);
		throw new Error('Error to recover');
	}
}

class H extends HsmTop {
	hello(): void {
		this.unhandled();
	}

	onError<EventName extends keyof Protocol>(error: RuntimeError<Any, Protocol, EventName>): Promise<void> | void {
		console.log(`${error}`);
		throw new Error('Fail now');
	}

	onUnhandled<EventName extends keyof Protocol>(error: UnhandledEventError<Any, Protocol, EventName>): Promise<void> | void {
		console.log(`${error}`);
		throw new Error('Error to recover');
	}
}

@InitialState
class B extends HsmTop {}

class EmptyTopState extends TopState<Any, Protocol> {
	transitionTo(s: StateClass<Any, Protocol>): void {
		this.transition(s);
	}
}

for (const traceLevel of TRACE_LEVELS) {
	describe(`An unhandled event (traceLevel = ${traceLevel})`, function (): void {
		let sm: Hsm<Any, Protocol>;

		beforeEach(async () => {
			clearLastError();
			sm = makeHsm(HsmTop, {}, true, traceLevel, undefined, createTestDispatchErrorCallback(true));
			await sm.sync();
		});

		it(`calls onUnhandledEvent`, async () => {
			sm.post('hello');
			await sm.sync();
			expect(sm.currentState).equals(A);
		});

		it(`calls onUnhandledEvent, when an event handler calls unhandled()`, async () => {
			sm.post('transitionTo', A);
			sm.post('hello');
			await sm.sync();
			expect(sm.currentState).equals(B);
		});

		it(`throws in an onUnhandled()`, async () => {
			sm.post('transitionTo', C);
			sm.post('hello');
			await sm.sync();
			expect(sm.currentState).equals(FatalErrorState);
			expect(getLastError()).instanceOf(RuntimeError);
		});

		it(`throws in a transition after onUnhandled()`, async () => {
			sm.post('transitionTo', F);
			sm.post('hello');
			await sm.sync();
			expect(sm.currentState).equals(FatalErrorState);
			expect(getLastError()).instanceOf(RuntimeError);
		});

		it(`throws and recovers`, async () => {
			sm.post('transitionTo', G);
			sm.post('hello');
			await sm.sync();
			expect(sm.currentState).equals(G);
			expect(getLastError()).equals(undefined);
		});

		it(`throws, and it does not recover in a user marked unhandled`, async () => {
			sm.post('transitionTo', H);
			sm.post('hello');
			await sm.sync();
			expect(sm.currentState).equals(FatalErrorState);
			expect(getLastError()).instanceOf(RuntimeError);
		});

		it(`the standard onUnhandled throws`, async () => {
			const sm = makeHsm(EmptyTopState, {}, true, traceLevel, undefined, createTestDispatchErrorCallback(true));
			sm.post('hello');
			await sm.sync();
			expect(sm.currentState).equals(FatalErrorState);
			expect(getLastError()).instanceOf(RuntimeError);
		});
	});
}
