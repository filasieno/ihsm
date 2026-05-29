import { expect } from 'chai';
import 'mocha';
import { HsmTopState, HsmInitialState } from '../index';
import { clearLastError } from './spec.utils';

describe('@HsmInitialState decorator', function() {
	it('sets HsmTopState._isInitialState and HsmTopState._initialState on HsmTopState constructor', async (): Promise<void> => {
		clearLastError();

		class TopState extends HsmTopState {}

		@HsmInitialState
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		class A extends TopState {}

		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		class B extends TopState {}

		// expect(ihsm.isInitialState(A)).eq(true);
		// expect(ihsm.hasInitialState(A)).eq(false);
		// expect(ihsm.isInitialState(B)).eq(false);
		// expect(ihsm.hasInitialState(B)).eq(false);
		// expect(ihsm.isInitialState(TopState)).eq(false);
		// expect(ihsm.hasInitialState(TopState)).eq(true);
		// expect(ihsm.getInitialState(TopState)).eq(A);
	});

	it('throws HsmInitialStateError if @HsmInitialState is set on two or more states that have the same parent', async (): Promise<void> => {
		class TopState extends HsmTopState {}

		@HsmInitialState
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		class A extends TopState {}

		try {
			@HsmInitialState
			// eslint-disable-next-line @typescript-eslint/no-unused-vars
			class B extends TopState {}
			expect.fail('Should have failed');
		} catch (e) {}
	});
});
