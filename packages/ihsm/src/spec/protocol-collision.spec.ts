import { expect } from 'chai';
import 'mocha';

import { InitialState, Port, ProtocolCollisionError, TopState } from '../';
import { makeTestActor } from '../testing';
import { buildProtocolIndex } from '../internal/runtime';
import * as self from './protocol-collision.spec';
import { registerSpecStateNames } from './spec.utils';

//#region ThisTestSpec

interface CollisionConfig {
	context: Record<string, never>;
	services: { ping(): Promise<void> };
	notifications: { tick(): void };
	internalServices: { init(): Promise<void> };
	internalNotifications: { onData(chunk: string): void };
}

export class CollisionTop extends TopState<CollisionConfig> {
	async ping(): Promise<void> {}
	tick(): void {}
	async init(): Promise<void> {}
	onData(): void {}
}

@InitialState
export class CollisionLeaf extends CollisionTop {}

export class BadTop extends TopState<CollisionConfig> {
	// @ts-expect-error intentional reserved-symbol collision probe
	ctx(): void {}
	work(): void {}
}

export class ReservedStateTop extends TopState<CollisionConfig> {
	// @ts-expect-error intentional reserved-symbol collision probe
	ctx(): void {}
}

// @ts-expect-error intentional reserved-symbol collision on subclass
@InitialState
export class ReservedStateLeaf extends ReservedStateTop {}

export class HookTop extends TopState<CollisionConfig> {
	onEntry(): void {}
	ping(): void {}
}

@InitialState
export class HookLeaf extends HookTop {}

export class ExtraTop extends TopState<CollisionConfig> {
	extra(): void {}
	async ping(): Promise<void> {}
}

registerSpecStateNames(self);
//#endregion

describe('protocol-collision', function (): void {
	it('throws when a state class defines a reserved symbol method', () => {
		expect(() => buildProtocolIndex(BadTop)).to.throw(ProtocolCollisionError, /reserved symbol "ctx"/);
		expect(() => makeTestActor(ReservedStateTop, {}, new Port())).to.throw(ProtocolCollisionError, /ReservedStateTop/);
	});

	it('allows lifecycle hooks implemented as hooks', () => {
		expect(() => buildProtocolIndex(HookTop)).not.to.throw();
		const actor = makeTestActor(HookTop, {}, new Port());
		expect(actor).to.not.equal(undefined);
	});

	it('allows helper methods discovered from the state graph', () => {
		expect(() => buildProtocolIndex(ExtraTop)).not.to.throw();
	});

	it('constructs when handlers align with Config', () => {
		const actor = makeTestActor(CollisionTop, {}, new Port());
		expect(actor).to.not.equal(undefined);
	});
});
