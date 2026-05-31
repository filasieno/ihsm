import { expect } from 'chai';
import 'mocha';
import { Hsm, makeHsm, InitializationError, InitialState, TopState } from '../';

import { clearLastError, createTestDispatchErrorCallback, getLastError, TRACE_LEVELS } from './spec.utils';

class HsmTop extends TopState {}
@InitialState
class A extends HsmTop {}
@InitialState
// eslint-disable-next-line @typescript-eslint/no-unused-vars
class B extends A {
	onEntry(): void {
		throw new Error('Error during initialization');
	}
}

for (const traceLevel of TRACE_LEVELS) {
	describe(`Initialization failure (traceLevel = ${traceLevel})`, function (): void {
		let sm: Hsm;

		beforeEach(async () => {
			clearLastError();
			sm = makeHsm(HsmTop, {}, true, traceLevel, undefined, createTestDispatchErrorCallback(true));
			await sm.sync();
		});

		it(`moves the state machine to FatalErrorState`, async () => {
			sm = makeHsm(HsmTop, {}, true, traceLevel, undefined, createTestDispatchErrorCallback(true));
			await sm.sync();
			expect(sm.currentStateName).equals('FatalErrorState');
			expect(getLastError()).instanceOf(InitializationError);
		});
	});
}
