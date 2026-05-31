import { expect } from 'chai';
import 'mocha';
import { TopState, InitialState } from '../index';
import { clearLastError } from './spec.utils';

describe('@InitialState decorator', function () {
	it('sets TopState._isInitialState and TopState._initialState on TopState constructor', async (): Promise<void> => {
		clearLastError();

		class HsmTop extends TopState {}

		@InitialState
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		class A extends HsmTop {}

		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		class B extends HsmTop {}

		// expect(ihsm.isInitialState(A)).eq(true);
		// expect(ihsm.hasInitialState(A)).eq(false);
		// expect(ihsm.isInitialState(B)).eq(false);
		// expect(ihsm.hasInitialState(B)).eq(false);
		// expect(ihsm.isInitialState(HsmTop)).eq(false);
		// expect(ihsm.hasInitialState(HsmTop)).eq(true);
		// expect(ihsm.getInitialState(HsmTop)).eq(A);
	});

	it('throws InitialStateError if @InitialState is set on two or more states that have the same parent', async (): Promise<void> => {
		class HsmTop extends TopState {}

		@InitialState
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		class A extends HsmTop {}

		try {
			@InitialState
			// eslint-disable-next-line @typescript-eslint/no-unused-vars
			class B extends HsmTop {}
			expect.fail('Should have failed');
		} catch (_e) {}
	});
});
