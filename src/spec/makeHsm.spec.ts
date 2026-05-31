import { expect } from 'chai';
import 'mocha';
import { HsmInitialState, HsmTopState, makeHsm } from '../';

class TopState extends HsmTopState<{ initialized: boolean }> {}

@HsmInitialState
class Ready extends TopState {
	onEntry(): void {
		this.ctx.initialized = true;
	}
}

describe('makeHsm', () => {
	it('uses default initialize=true when the third argument is omitted', async () => {
		const ctx = { initialized: false };
		const sm = makeHsm(TopState, ctx);
		await sm.sync();
		expect(ctx.initialized).equals(true);
		expect(sm.currentState).equals(Ready);
	});

	it('exposes the default empty then() on HsmTopState', () => {
		expect(TopState.prototype.then()).equals(undefined);
	});
});
