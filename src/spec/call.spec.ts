import { expect } from 'chai';
import 'mocha';

import { Hsm, Any, makeHsm, InitialState, RejectCallback, ResolveCallback, TopState, TraceLevel } from '../';

interface Protocol {
	getResult(resolve: (result: string) => void, reject: (error: Error) => void, value: string): void;
}

class HsmTop extends TopState<Any, Protocol> implements Protocol {
	async getResult(resolve: ResolveCallback<string>, reject: RejectCallback, value: string): Promise<void> {
		if (value.startsWith('ok:')) {
			resolve(value);
		} else {
			reject(new Error(value));
		}
	}
}

@InitialState
class A extends HsmTop {}

describe(`call`, function (): void {
	let sm: Hsm<Any, Protocol>;

	beforeEach(async () => {
		sm = makeHsm(HsmTop, {}, true, TraceLevel.VERBOSE_DEBUG);
		await sm.sync();
		expect(sm.currentState).equals(A);
	});

	it(`call runs ok`, async () => {
		const value = 'ok: hello';
		const result = await sm.call('getResult', value);
		expect(result).equals(value);
	});

	it(`call fails`, async () => {
		const value = 'fail: error';
		try {
			await sm.call('getResult', value);
		} catch (error) {
			expect((error as Error).message).equals(value);
		}
	});
});
