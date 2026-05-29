import { expect } from 'chai';
import 'mocha';
import { HsmTopState } from '../';
import * as ihsm from '../';

import { clearLastError } from './spec.utils';

class TopState extends HsmTopState {}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
class TestTraceWriter implements ihsm.HsmTraceWriter {
	write<Context, Protocol>(hsm: ihsm.HsmProperties<Context, Protocol>, msg: any): void {
		console.log(msg);
	}
}

describe(`changeTraceLevelTest`, function() {
	beforeEach(async () => {
		clearLastError();
		expect(true);
	});

	it('fails to instantiate states', async () => {
		try {
			new TopState();
			expect.fail('States cannot be instantiated');
		} catch (error) {}
	});
});
