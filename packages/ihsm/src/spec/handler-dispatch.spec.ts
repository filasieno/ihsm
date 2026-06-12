import { expect } from 'chai';
import 'mocha';

import { InitialState, Port, ProtocolCollisionError, TopState, makeActor, makeOwnerActor, manifestFor, registerStateNames } from '../';
import type { Config } from '../';

interface HandlerDispatchConfig extends Config {
	context: { order: string[] };
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

const handlerManifest = manifestFor<HandlerDispatchConfig>({
	services: ['transition'],
	notifications: ['close', 'enqueueBoth'],
	internalServices: [],
	internalNotifications: ['abort'],
});

class HandlerTop extends TopState {
	static readonly manifest = handlerManifest;
	declare readonly __ihsm: HandlerDispatchConfig;
}

@InitialState
class Idle extends HandlerTop {
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

	transition(host: string): void {
		this.ctx.order.push(`transition:${host}`);
	}
}

class Open extends HandlerTop {}

registerStateNames({ HandlerTop, Idle, Open });

// @ts-expect-error services.ctx is a reserved Config key
type _ReservedCtxService = Config & { services: { ctx(): Promise<void> } };

describe('handler-dispatch (v2)', function (): void {
	it('this.hsm.actor.close() schedules on the default queue', async () => {
		const ctx = { order: [] as string[] };
		const actor = makeOwnerActor(HandlerTop as never, ctx, new Port());
		await actor.hsm.sync();
		actor.close();
		await actor.hsm.sync();
		expect(ctx.order).eqls(['close']);
	});

	it('this.hsm.immediate.abort() runs before pending default-queue jobs from the same handler', async () => {
		const ctx = { order: [] as string[] };
		const actor = makeOwnerActor(HandlerTop as never, ctx, new Port());
		await actor.hsm.sync();
		actor.enqueueBoth();
		await actor.hsm.sync();
		await actor.hsm.sync();
		expect(ctx.order).eqls(['enqueue-start', 'enqueue-end', 'abort', 'close']);
	});

	it('await actor.transition() works when services.transition is on Config', async () => {
		const ctx = { order: [] as string[] };
		const actor = makeOwnerActor(HandlerTop as never, ctx, new Port());
		await actor.hsm.sync();
		await actor.transition('example.com');
		expect(ctx.order).eqls(['transition:example.com']);
	});

	it('actor.hsm does not expose transition (reduced facade)', () => {
		const actor = makeActor(HandlerTop as never, { order: [] }, new Port());
		expect((actor.hsm as { transition?: unknown }).transition).equals(undefined);
	});

	it('throws ProtocolCollisionError when a state class defines ctx() on the prototype', () => {
		class BadTop extends TopState {
			static readonly manifest = manifestFor<{ context: Record<string, never> }>({
				services: [],
				notifications: [],
				internalServices: [],
				internalNotifications: [],
			});
			ctx(): void {}
		}
		@InitialState
		class BadLeaf extends BadTop {}
		registerStateNames({ BadTop, BadLeaf });
		expect(() => makeOwnerActor(BadTop as never, {}, new Port())).to.throw(ProtocolCollisionError);
	});
});
