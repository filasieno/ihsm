import { expect } from 'chai';
import 'mocha';

import { InitialState, Port, ProtocolCollisionError, TopState } from '../';
import { makeTestActor } from '../testing';
import { buildProtocolIndex } from '../internal/runtime';
import type { ActorConfig } from '../';
import * as self from './reserved-names.spec';
import { registerSpecStateNames } from './spec.utils';

//#region ThisTestSpec

export class BadCtxTop extends TopState<ActorConfig> {
	ctx(): void {}
}

export class BadHsmSymbolTop extends TopState<ActorConfig> {
	hsm(): void {}
}

export class HsmMethodTop extends TopState<ActorConfig> {
	work(): void {}
}

// @ts-expect-error intentional reserved-symbol collision on subclass
@InitialState
export class HsmMethodLeaf extends HsmMethodTop {}

export class HookTop extends TopState<ActorConfig> {
	onEntry(): void {}
	onExit(): void {}
	onError(): void {}
	onUnhandled(): void {}
	ping(): void {}
}

// @ts-expect-error intentional reserved-symbol collision on subclass
@InitialState
export class HookLeaf extends HookTop {}

Object.defineProperty(HsmMethodTop.prototype, 'hsm', { value: (): void => undefined });

registerSpecStateNames(self);
//#endregion

describe('reserved-names', function (): void {
	for (const [symbol, top] of [
		['ctx', BadCtxTop],
		['hsm', BadHsmSymbolTop],
	] as const) {
		it(`rejects state method "${symbol}" at index build`, () => {
			expect(() => buildProtocolIndex(top)).to.throw(ProtocolCollisionError, new RegExp(`reserved symbol "${symbol}"`));
		});
	}

	it('rejects state methods named hsm at construction', () => {
		expect(() => makeTestActor(HsmMethodTop, {}, new Port())).to.throw(ProtocolCollisionError, /reserved symbol "hsm"/);
	});

	it('allows lifecycle hooks onEntry onExit onError onUnhandled as real hooks', () => {
		expect(() => makeTestActor(HookTop, {}, new Port())).not.to.throw();
	});
});
