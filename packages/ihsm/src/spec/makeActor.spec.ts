import { expect } from 'chai';
import 'mocha';
import { InitialState, TopState, Port } from '../';
import { makeTestActor } from '../testing';
import * as self from './makeActor.spec';
import { registerSpecStateNames } from './spec.utils';

//#region ThisTestSpec

interface MakeHsmConfig {
	context: { initialized: boolean };
}

export class HsmTop extends TopState<MakeHsmConfig> {}

@InitialState
export class Ready extends HsmTop {
	onEntry(): void {
		this.ctx.initialized = true;
	}
}

registerSpecStateNames(self);

//#endregion

describe('makeActor (factory)', () => {
	it('uses default initialize=true when the third argument is omitted', async () => {
		const ctx = { initialized: false };
		const sm = makeTestActor(HsmTop, ctx, new Port());
		await sm.hsm.sync();
		expect(ctx.initialized).equals(true);
		expect(sm.hsm.currentState).equals(Ready);
	});
});
