import { expect } from 'chai';
import 'mocha';
import { TopState, InitialState } from '../index';
import * as self from './decorator.spec';
import { clearLastError, registerSpecStateNames } from './spec.utils';

//#region ThisTestSpec

export class HsmTop extends TopState {}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
@InitialState
export class A extends HsmTop {}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export class B extends HsmTop {}

export class DuplicateInitialTop extends TopState {}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
@InitialState
export class DuplicateA extends DuplicateInitialTop {}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export class DuplicateB extends DuplicateInitialTop {}

registerSpecStateNames(self);
//#endregion

describe('@InitialState decorator', function () {
	it('sets TopState._isInitialState and TopState._initialState on TopState constructor', async (): Promise<void> => {
		clearLastError();

		// expect(ihsm.isInitialState(A)).eq(true);
		// expect(ihsm.hasInitialState(A)).eq(false);
		// expect(ihsm.isInitialState(B)).eq(false);
		// expect(ihsm.hasInitialState(B)).eq(false);
		// expect(ihsm.isInitialState(HsmTop)).eq(false);
		// expect(ihsm.hasInitialState(HsmTop)).eq(true);
		// expect(ihsm.getInitialState(HsmTop)).eq(A);
	});

	it('throws InitialStateError if @InitialState is set on two or more states that have the same parent', async (): Promise<void> => {
		try {
			InitialState(DuplicateB);
			expect.fail('Should have failed');
		} catch (_e) {}
	});
});
