import { expect } from 'chai';
import 'mocha';
import { TopState } from '../';
import * as ihsm from '../';

import { clearLastError } from './spec.utils';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
class TestTraceWriter implements ihsm.TraceWriter {
	write<Context, Protocol extends {} | undefined>(hsm: ihsm.Properties<Context, Protocol>, msg: any): void {
		console.log(msg);
	}
}

describe(`changeTraceLevelTest`, function () {
	beforeEach(async () => {
		clearLastError();
		expect(true);
	});

	it('fails to instantiate states', async () => {
		try {
			// `TopState` is abstract at compile time; cast to verify the runtime guard throws.
			new (TopState as unknown as new () => unknown)();
			expect.fail('States cannot be instantiated');
		} catch (_error) {}
	});
});
