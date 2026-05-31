import { expect } from 'chai';
import 'mocha';
import { InitialState, TopState, makeHsm } from '../';

class HsmTop extends TopState<{ initialized: boolean }> {}

@InitialState
class Ready extends HsmTop {
	onEntry(): void {
		this.ctx.initialized = true;
	}
}

describe('makeHsm', () => {
	it('uses default initialize=true when the third argument is omitted', async () => {
		const ctx = { initialized: false };
		const sm = makeHsm(HsmTop, ctx);
		await sm.sync();
		expect(ctx.initialized).equals(true);
		expect(sm.currentState).equals(Ready);
	});
});
