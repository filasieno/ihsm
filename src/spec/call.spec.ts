import { expect } from 'chai';
import 'mocha';

import { Hsm, HsmAny, HsmFactory, HsmInitialState, HsmRejectCallback, HsmResolveCallback, HsmTopState, HsmTraceLevel } from '../';

interface Protocol {
	getResult(resolve: (result: string) => void, reject: (error: Error) => void, value: string): void;
}

class TopState extends HsmTopState<HsmAny, Protocol> implements Protocol {
	async getResult(resolve: HsmResolveCallback<string>, reject: HsmRejectCallback, value: string): Promise<void> {
		if (value.startsWith('ok:')) {
			resolve(value);
		} else {
			reject(new Error(value));
		}
	}
}

@HsmInitialState
class A extends TopState {}

describe(`call`, function(): void {
	let sm: Hsm<HsmAny, Protocol>;
	const factory = new HsmFactory(TopState);

	beforeEach(async () => {
		factory.traceLevel = HsmTraceLevel.VERBOSE_DEBUG;
		sm = factory.create({});
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
			expect(error.message).equals(value);
		}
	});
});
