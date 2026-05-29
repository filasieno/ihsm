import { expect } from 'chai';
import 'mocha';
import { Hsm, HsmAny, HsmEventHandlerError, HsmFactory, HsmFatalErrorState, HsmInitialState, HsmStateClass, HsmTopState } from '../';

import { clearLastError, createTestDispatchErrorCallback, TRACE_LEVELS } from './spec.utils';

interface Protocol {
	executeWithError01(): void;
	executeWithError02(): void;
	executeWithError03(): void;
	executeWithError04(): void;
	executeWithError05(): void;
	transitionTo(s: HsmStateClass<HsmAny, Protocol>): void;
}

class TopState extends HsmTopState<HsmAny, Protocol> {
	transitionTo(s: HsmStateClass<HsmAny, Protocol>): void {
		this.transition(s);
	}

	executeWithError01(): void {
		throw new Error('error 01');
	}

	executeWithError02(): void {
		throw new Error('error 02');
	}

	executeWithError03(): void {
		throw new Error('error 03');
	}

	executeWithError04(): void {
		throw new Error('error 04');
	}

	executeWithError05(): void {
		throw new Error('error 05');
	}
}

class NoRecovery extends TopState {}

@HsmInitialState
class Recovery extends TopState {
	async onError<EventName extends keyof Protocol>(err: HsmEventHandlerError<HsmAny, Protocol, EventName>): Promise<void> {
		switch (err.eventName) {
			case 'executeWithError01':
				return;
			case 'executeWithError02':
				this.transition(B);
				return;
			case 'executeWithError03':
				throw new Error('Error in onError()');
			case 'executeWithError04':
				this.transition(C);
				break;
			case 'executeWithError05':
				throw new Error('Error in onError()');
		}
		await this.sleep(1000);
	}
}

class B extends Recovery {}

class C extends Recovery {
	onEntry(): Promise<void> | void {
		throw new Error('Create a transition error during error recovery');
	}
}

class D extends Recovery {
	onExit(): Promise<void> | void {
		throw new Error('Transition failed while going to fatal error state');
	}
}

for (const traceLevel of TRACE_LEVELS) {
	describe(`Error event (traceLevel = ${traceLevel})`, function(): void {
		let sm: Hsm;
		const factory = new HsmFactory(TopState);

		beforeEach(async () => {
			factory.traceLevel = traceLevel;
			factory.dispatchErrorCallback = createTestDispatchErrorCallback(true);
			clearLastError();
			sm = factory.create({});
			await sm.sync();
		});

		it(`recovers a number error`, async () => {
			expect(sm.currentState).equals(Recovery);
			sm.post('executeWithError01');
			await sm.sync();
			expect(sm.currentState).equals(Recovery);

			await sm.post('executeWithError02');
			await sm.sync();
			expect(sm.currentState).equals(B);
		});

		it(`it does not recover`, async () => {
			expect(sm.currentState).equals(Recovery);
			sm.post('transitionTo', NoRecovery);
			await sm.sync();
			expect(sm.currentState).equals(NoRecovery);
			sm.post('executeWithError01');
			await sm.sync();
			expect(sm.currentState).equals(HsmFatalErrorState);
		});

		it(`it does not recover: Error in onError()`, async () => {
			expect(sm.currentState).equals(Recovery);
			sm.post('executeWithError03');
			await sm.sync();
			expect(sm.currentState).equals(HsmFatalErrorState);
		});

		it(`it does not recover: Error in a transition following onError()`, async () => {
			expect(sm.currentState).equals(Recovery);
			sm.post('executeWithError04');
			await sm.sync();
			expect(sm.currentState).equals(HsmFatalErrorState);
		});

		it(`it does not recover: another error is thrown while going to the FatalErrorState`, async () => {
			expect(sm.currentState).equals(Recovery);
			sm.post('transitionTo', D);
			sm.post('executeWithError05');
			await sm.sync();
			expect(sm.currentState).equals(HsmFatalErrorState);
		});
	});
}
