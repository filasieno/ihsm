import { expect } from 'chai';
import 'mocha';
import { Hsm, HsmFactory, HsmInitializationError, HsmInitialState, HsmTopState } from '../';

import { clearLastError, createTestDispatchErrorCallback, getLastError, TRACE_LEVELS } from './spec.utils';

class TopState extends HsmTopState {}
@HsmInitialState
class A extends TopState {}
@HsmInitialState
// eslint-disable-next-line @typescript-eslint/no-unused-vars
class B extends A {
	onEntry(): void {
		throw new Error('Error during initialization');
	}
}

for (const traceLevel of TRACE_LEVELS) {
	describe(`Initialization failure (traceLevel = ${traceLevel})`, function(): void {
		let sm: Hsm;
		const factory = new HsmFactory(TopState);

		beforeEach(async () => {
			factory.traceLevel = traceLevel;
			factory.dispatchErrorCallback = createTestDispatchErrorCallback(true);
			clearLastError();
			sm = factory.create({});
			await sm.sync();
		});

		it(`moves the state machine to FatalErrorState`, async () => {
			sm = factory.create({});
			await sm.sync();
			expect(sm.currentStateName).equals('HsmFatalErrorState');
			expect(getLastError()).instanceOf(HsmInitializationError);
		});
	});
}
