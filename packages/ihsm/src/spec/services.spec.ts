import { expect } from 'chai';
import 'mocha';

import { InitialState, TopState, makeOwnerActor, manifestFor } from '../';
import type { Config, OwnerActor } from '../';
import { TestPort } from '../testing';
import { traceActorOnPort } from './spec.utils';

interface ServicesConfig extends Config {
	context: Record<string, never>;
	services: {
		getResult(value: string): Promise<string>;
	};
}

const servicesManifest = manifestFor<ServicesConfig>({
	services: ['getResult'],
	notifications: [],
	internalServices: [],
	internalNotifications: [],
});

class HsmTop extends TopState {
	static readonly manifest = servicesManifest;
	declare readonly __ihsm: ServicesConfig;

	async getResult(value: string): Promise<string> {
		if (value.startsWith('ok:')) {
			return value;
		}
		throw new Error(value);
	}
}

@InitialState
class A extends HsmTop {}

describe(`services`, function (): void {
	let sm: OwnerActor<ServicesConfig>;
	let port: TestPort;

	beforeEach(async () => {
		port = new TestPort();
		sm = makeOwnerActor(HsmTop as never, {}, port);
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
