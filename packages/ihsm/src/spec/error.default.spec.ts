import { expect } from 'chai';
import 'mocha';

import { FatalErrorState, InitialState, TopState, makeOwnerActor, manifestFor } from '../';
import type { Config, OwnerActor } from '../';
import { TestPort } from '../testing';

import { clearLastError, TRACE_LEVELS, traceActorOnPort } from './spec.utils';

interface ErrorDefaultConfig extends Config {
	context: Record<string, never>;
	notifications: {
		executeWithError01(): void;
		switchCallback(): void;
	};
}

const errorDefaultManifest = manifestFor<ErrorDefaultConfig>({
	services: [],
	notifications: ['executeWithError01', 'switchCallback'],
	internalServices: [],
	internalNotifications: [],
});

class HsmTop extends TopState {
	static readonly manifest = errorDefaultManifest;
	declare readonly __ihsm: ErrorDefaultConfig;

	executeWithError01(): void {
		throw new Error('This will result in a fatal error');
	}

	async switchCallback(): Promise<void> {
		const defaultCallback = this.hsm.dispatchErrorCallback;
		this.hsm.dispatchErrorCallback = (hsm: unknown, msg: Error): void => {
			try {
				defaultCallback(hsm, msg);
			} catch (error) {
				console.log(`Error ${(error as Error).name} has escaped`);
			}
		};
	}
}

@InitialState
class A extends HsmTop {}

for (const traceLevel of TRACE_LEVELS) {
	describe(`Error dispatch (traceLevel = ${traceLevel})`, function (): void {
		let sm: OwnerActor<ErrorDefaultConfig>;
		let port: TestPort;
		let flag = false;
		let defaultCallback: (hsm: unknown, msg: Error) => void;
		let dispatchErrorCallback: (hsm: unknown, msg: Error) => void;

		beforeEach(async () => {
			defaultCallback = makeOwnerActor(HsmTop as never, {}, new TestPort(), { traceLevel }).hsm.dispatchErrorCallback;
			dispatchErrorCallback = (hsm: unknown, msg: Error): void => {
				try {
					defaultCallback(hsm, msg);
				} catch (error) {
					flag = true;
					console.log(`Error: ${(error as Error).name}`);
				}
			};
			clearLastError();
			flag = false;
			port = new TestPort();
			sm = makeOwnerActor(HsmTop as never, {}, port, { traceLevel, dispatchErrorCallback });
			traceActorOnPort(sm, port);
			await sm.hsm.sync();
		});

		it(`executes the error callback`, async () => {
			expect(sm.hsm.currentState).equals(A);
			sm.executeWithError01();
			await sm.hsm.sync();
			expect(port.events).to.include('executeWithError01');
			expect(sm.hsm.dispatchErrorCallback).equals(dispatchErrorCallback);
			expect(sm.hsm.currentState).equals(FatalErrorState);
			expect(flag).eq(true);
			sm.hsm.dispatchErrorCallback = defaultCallback;
			flag = false;

			sm.hsm.restore(A, {});
			sm.switchCallback();
			sm.executeWithError01();
			await sm.hsm.sync();
			expect(sm.hsm.currentState).equals(FatalErrorState);
			expect(flag).eq(false);
		});
	});
}
