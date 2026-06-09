import { expect } from 'chai';
import 'mocha';

import { Any, InitialState, RejectCallback, ResolveCallback, TopState } from '../';
import { TestPort, TestActor, makeTestActor } from '../testing';
import { traceActorOnPort } from './spec.utils';

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
	let sm: TestActor<Any, Protocol, {}, TestPort>;
	let port: TestPort;

	beforeEach(async () => {
		port = new TestPort();
		sm = makeTestActor(HsmTop, {}, port);
		traceActorOnPort(sm, port);
		await sm.sync();
		expect(sm.currentState).equals(A);
	});

	it(`call runs ok`, async () => {
		const value = 'ok: hello';
		const result = await sm.call('getResult', value);
		expect(result).equals(value);
		// The TestPort observes service calls just like plain events.
		expect(port.trace).eqls([`getResult:${value}`]);
	});

	it(`call fails`, async () => {
		const value = 'fail: error';
		try {
			await sm.call('getResult', value);
		} catch (error) {
			expect((error as Error).message).equals(value);
		}
		expect(port.events).eqls(['getResult']);
	});
});
