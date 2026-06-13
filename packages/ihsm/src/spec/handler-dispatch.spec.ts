import { expect } from 'chai';
import 'mocha';

import { InitialState, Port, ProtocolCollisionError, TopState, makeActor } from '../';
import { makeTestActor } from '../testing';
import type { ActorConfig, DisjointActorConfig } from '../';
import * as self from './handler-dispatch.spec';
import { registerSpecStateNames } from './spec.utils';

//#region ThisTestSpec

interface HandlerDispatchCtx {
	order: string[];
}

interface HandlerDispatchConfig {
	context: HandlerDispatchCtx;
	services: {
		transition(host: string): Promise<void>;
	};
	notifications: {
		close(): void;
		enqueueBoth(): void;
	};
	internalNotifications: {
		abort(): void;
	};
}

export class HandlerTop extends TopState<HandlerDispatchConfig> {
}

@InitialState
export class Idle extends HandlerTop {
	close(): void {
		this.ctx.order.push('close');
	}

	abort(): void {
		this.ctx.order.push('abort');
	}

	enqueueBoth(): void {
		this.ctx.order.push('enqueue-start');
		this.hsm.actor.close();
		this.hsm.immediate.abort();
		this.ctx.order.push('enqueue-end');
	}

	async transition(host: string): Promise<void> {
		this.ctx.order.push(`transition:${host}`);
	}
}

export class Open extends HandlerTop {}

export class BadTop extends TopState<HandlerDispatchConfig> {
	// @ts-expect-error intentional reserved-symbol collision probe
	ctx(): void {}
}

// @ts-expect-error intentional reserved-symbol collision on subclass
@InitialState
export class BadLeaf extends BadTop {}

registerSpecStateNames(self);
//#endregion

type AssertTrue<T extends true> = T;
// @ts-expect-error reserved symbol ctx on protocol
type _ReservedCtxService = AssertTrue<DisjointActorConfig<ActorConfig & { services: { ctx(): Promise<void> } }>>;

describe('handler-dispatch', function (): void {
	it('this.hsm.actor.close() schedules on the default queue', async () => {
		const ctx = { order: [] as string[] };
		const actor = makeTestActor(HandlerTop, ctx, new Port());
		await actor.hsm.sync();
		actor.close();
		await actor.hsm.sync();
		expect(ctx.order).eqls(['close']);
	});

	it('this.hsm.immediate.abort() runs before pending default-queue jobs from the same handler', async () => {
		const ctx = { order: [] as string[] };
		const actor = makeTestActor(HandlerTop, ctx, new Port());
		await actor.hsm.sync();
		actor.enqueueBoth();
		await actor.hsm.sync();
		await actor.hsm.sync();
		expect(ctx.order).eqls(['enqueue-start', 'enqueue-end', 'abort', 'close']);
	});

	it('await actor.transition() works when services.transition is on Config', async () => {
		const ctx = { order: [] as string[] };
		const actor = makeTestActor(HandlerTop, ctx, new Port());
		await actor.hsm.sync();
		await actor.transition('example.com');
		expect(ctx.order).eqls(['transition:example.com']);
	});

	it('actor.hsm does not expose transition (reduced facade)', () => {
		const actor = makeActor(HandlerTop, { order: [] }, new Port());
		expect((actor.hsm as { transition?: unknown }).transition).equals(undefined);
	});

	it('throws ProtocolCollisionError when a state class defines ctx() on the prototype', () => {
		expect(() => makeTestActor(BadTop, { order: [] }, new Port())).to.throw(ProtocolCollisionError);
	});
});
