import { expect } from 'chai';
import 'mocha';

import { InitialState, TopState } from '../';
import type { TestActor } from '../testing';
import { makeTestActor, TestPort } from '../testing';
import * as self from './services.spec';
import { registerSpecStateNames, traceActorOnPort } from './spec.utils';

//#region ThisTestSpec

interface ServicesConfig {
	context: Record<string, never>;
	services: {
		getResult(value: string): Promise<string>;
	};
}

export class HsmTop extends TopState<ServicesConfig> {

	async getResult(value: string): Promise<string> {
		if (value.startsWith('ok:')) {
			return value;
		}
		throw new Error(value);
	}
}

@InitialState
export class A extends HsmTop {}

registerSpecStateNames(self);
//#endregion

describe(`services`, function (): void {
	let sm: TestActor<ServicesConfig>;
	let port: TestPort;

	beforeEach(async () => {
		port = new TestPort();
		sm = makeTestActor(HsmTop, {}, port);
		traceActorOnPort(sm, port);
		await sm.hsm.sync();
		expect(sm.hsm.currentState).equals(A);
	});

	it(`service runs ok`, async () => {
		const value = 'ok: hello';
		const result = await sm.getResult(value);
		expect(result).equals(value);
		// The TestPort observes service calls just like plain events.
		expect(port.trace).eqls([`getResult:${value}`]);
	});

	it(`service fails`, async () => {
		const value = 'fail: error';
		try {
			await sm.getResult(value);
		} catch (error) {
			expect((error as Error).message).equals(value);
		}
		expect(port.events).eqls(['getResult']);
	});
});
