import { expect } from 'chai';
import 'mocha';
import { InitialState, TopState, makeActor } from '../';
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
		const sm = makeTestActor(HsmTop, ctx);
		await sm.hsm.sync();
		expect(ctx.initialized).equals(true);
		expect(sm.hsm.currentState).equals(Ready);
	});

	it('defaults to a production Port when port is omitted', async () => {
		const ctx = { initialized: false };
		const actor = makeActor(HsmTop, ctx);
		await actor.hsm.sync();
		expect(ctx.initialized).equals(true);
	});

	it('accepts options without an explicit port', async () => {
		const ctx = { initialized: false };
		const actor = makeActor(HsmTop, ctx, { initialize: false });
		await actor.hsm.sync();
		expect(ctx.initialized).equals(false);
	});
});
