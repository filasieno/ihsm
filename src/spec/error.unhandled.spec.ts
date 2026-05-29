import { expect } from 'chai';
import 'mocha';
import { Hsm, HsmAny, HsmFactory, HsmFatalErrorState, HsmInitialState, HsmRuntimeError, HsmStateClass, HsmTopState, HsmUnhandledEventError } from '../';
import { clearLastError, createTestDispatchErrorCallback, getLastError, TRACE_LEVELS } from './spec.utils';

interface Protocol {
	hello(): void;
	transitionTo(s: State): void;
}

type State = HsmStateClass<HsmAny, Protocol>;

class TopState extends HsmTopState<HsmAny, Protocol> {
	onUnhandled<EventName extends keyof Protocol>(error: HsmUnhandledEventError<HsmAny, Protocol, EventName>): Promise<void> | void {
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

	transitionTo(s: HsmStateClass<HsmAny, Protocol>): void {
		this.transition(s);
	}
}

class A extends TopState {
	hello(): void {
		this.unhandled();
	}
}

class C extends TopState {
	onUnhandled<EventName extends keyof Protocol>(error: HsmUnhandledEventError<HsmAny, Protocol, EventName>): Promise<void> | void {
		console.log(`error: ${error}`);
		throw new Error('Unhandled throws');
	}
}

class E extends TopState {
	onEntry(): Promise<void> | void {
		throw new Error('Unhandled throws in a transition');
	}
}

class F extends TopState {}

class G extends TopState {
	onError<EventName extends keyof Protocol>(error: HsmRuntimeError<HsmAny, Protocol, EventName>): Promise<void> | void {
		console.log(`error: ${error}`);
		console.log('recovered');
	}

	async onUnhandled<EventName extends keyof Protocol>(error: HsmUnhandledEventError<HsmAny, Protocol, EventName>): Promise<void> {
		console.log(`error: ${error}`);
		throw new Error('Error to recover');
	}
}

class H extends TopState {
	hello(): void {
		this.unhandled();
	}

	onError<EventName extends keyof Protocol>(error: HsmRuntimeError<HsmAny, Protocol, EventName>): Promise<void> | void {
		console.log(`${error}`);
		throw new Error('Fail now');
	}

	onUnhandled<EventName extends keyof Protocol>(error: HsmUnhandledEventError<HsmAny, Protocol, EventName>): Promise<void> | void {
		console.log(`${error}`);
		throw new Error('Error to recover');
	}
}

@HsmInitialState
class B extends TopState {}

class EmptyTopState extends HsmTopState {}

for (const traceLevel of TRACE_LEVELS) {
	describe(`An unhandled event (traceLevel = ${traceLevel})`, function(): void {
		let sm: Hsm<HsmAny, Protocol>;
		const factory = new HsmFactory(TopState);

		beforeEach(async () => {
			factory.traceLevel = traceLevel;
			factory.dispatchErrorCallback = createTestDispatchErrorCallback(true);
			clearLastError();
			sm = factory.create({});
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
			expect(sm.currentState).equals(HsmFatalErrorState);
			expect(getLastError()).instanceOf(HsmRuntimeError);
		});

		it(`throws in a transition after onUnhandled()`, async () => {
			sm.post('transitionTo', F);
			sm.post('hello');
			await sm.sync();
			expect(sm.currentState).equals(HsmFatalErrorState);
			expect(getLastError()).instanceOf(HsmRuntimeError);
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
			expect(sm.currentState).equals(HsmFatalErrorState);
			expect(getLastError()).instanceOf(HsmRuntimeError);
		});

		it(`the standard onUnhandled throws`, async () => {
			const factory = new HsmFactory(EmptyTopState);
			factory.traceLevel = traceLevel;
			factory.dispatchErrorCallback = createTestDispatchErrorCallback(true);
			const sm = factory.create({});
			sm.post('hello');
			await sm.sync();
			expect(sm.currentState).equals(HsmFatalErrorState);
			expect(getLastError()).instanceOf(HsmRuntimeError);
		});
	});
}
