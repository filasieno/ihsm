import { expect } from 'chai';
import 'mocha';
import { InitialState, TopState, Port, makeHsm, manifestFor } from '../';
import type { Config } from '../';

interface MakeHsmConfig extends Config {
	context: { initialized: boolean };
}

const makeHsmManifest = manifestFor<MakeHsmConfig>({
	services: [],
	notifications: [],
	internalServices: [],
	internalNotifications: [],
});

class HsmTop extends TopState {
	static readonly manifest = makeHsmManifest;
	declare readonly __ihsm: MakeHsmConfig;
}

@InitialState
class Ready extends HsmTop {
	onEntry(): void {
		this.ctx.initialized = true;
	}
}

describe('makeHsm', () => {
	it('uses default initialize=true when the third argument is omitted', async () => {
		const ctx = { initialized: false };
		const sm = makeHsm(HsmTop as never, ctx, new Port());
		await sm.hsm.sync();
		expect(ctx.initialized).equals(true);
		expect(sm.hsm.currentState).equals(Ready);
	});
});
