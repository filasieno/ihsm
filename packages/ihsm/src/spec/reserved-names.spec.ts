import { expect } from 'chai';
import 'mocha';

import {
	InitialState,
	Port,
	ProtocolCollisionError,
	ReservedNames,
	TopState,
	buildProtocolIndex,
	makeOwnerActor,
	manifestFor,
	registerStateNames,
} from '../';
import type { Config } from '../';

registerStateNames({});

describe('reserved-names (v2)', function (): void {
	for (const symbol of ReservedNames) {
		it(`rejects Config protocol key "${symbol}" at index build`, () => {
			const manifest = manifestFor<{ services: Record<string, never> }>({
				services: [symbol as 'ping'],
				notifications: [],
				internalServices: [],
				internalNotifications: [],
			});
			class BadTop extends TopState {
				static readonly manifest = manifest;
				[symbol](): void {}
			}
			expect(() => buildProtocolIndex(BadTop, manifest)).to.throw(ProtocolCollisionError, new RegExp(`reserved symbol "${symbol}"`));
		});
	}

	it('rejects state methods named hsm at construction', () => {
		const manifest = manifestFor<{ services: { work(): Promise<void> } }>({
			services: ['work'],
			notifications: [],
			internalServices: [],
			internalNotifications: [],
		});
		class HsmMethodTop extends TopState {
			static readonly manifest = manifest;
			hsm(): void {}
			work(): void {}
		}
		@InitialState
		class HsmMethodLeaf extends HsmMethodTop {}
		registerStateNames({ HsmMethodTop, HsmMethodLeaf });
		expect(() => makeOwnerActor(HsmMethodTop as never, {}, new Port())).to.throw(ProtocolCollisionError, /reserved symbol "hsm"/);
	});

	it('allows lifecycle hooks onEntry onExit onError onUnhandled as real hooks', () => {
		const manifest = manifestFor<{ services: { ping(): Promise<void> } }>({
			services: ['ping'],
			notifications: [],
			internalServices: [],
			internalNotifications: [],
		});
		class HookTop extends TopState {
			static readonly manifest = manifest;
			onEntry(): void {}
			onExit(): void {}
			onError(): void {}
			onUnhandled(): void {}
			ping(): void {}
		}
		@InitialState
		class HookLeaf extends HookTop {}
		registerStateNames({ HookTop, HookLeaf });
		expect(() => makeOwnerActor(HookTop as never, {}, new Port())).not.to.throw();
	});
});
