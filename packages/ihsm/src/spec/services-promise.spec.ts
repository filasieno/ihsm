import { expect } from 'chai';
import 'mocha';

import { EventHandlerError, InitialState, Port, TopState } from '../';
import { makeTestActor } from '../testing';
import * as self from './services-promise.spec';
import { registerSpecStateNames } from './spec.utils';

//#region ThisTestSpec

interface PromiseCtx {
	order: string[];
}

interface PromiseConfig {
	context: PromiseCtx;
	services: {
		getValue(value: string): Promise<string>;
		getVoid(): Promise<void>;
		getSync(): Promise<number>;
		fail(): Promise<void>;
		transitionThenReply(): Promise<string>;
		blocking(): Promise<string>;
	};
	notifications: {
		after(): void;
	};
}

export class PromiseTop extends TopState<PromiseConfig> {
}

export class Done extends PromiseTop {}

@InitialState
export class Active extends PromiseTop {
	async getValue(value: string): Promise<string> {
		return `ok:${value}`;
	}

	async getVoid(): Promise<void> {}

	async getSync(): Promise<number> {
		return 7;
	}

	async fail(): Promise<void> {
		throw new Error('service failed');
	}

	async transitionThenReply(): Promise<string> {
		this.hsm.transition(Done);
		return 'moved';
	}

	async blocking(): Promise<string> {
		this.ctx.order.push('blocking-start');
		await new Promise<void>(resolve => setTimeout(resolve, 10));
		this.ctx.order.push('blocking-end');
		return 'done';
	}

	after(): void {
		this.ctx.order.push('after');
	}
}

export class RecoveryTop extends TopState<PromiseConfig> {
	onError(err: EventHandlerError<PromiseConfig, string>): void {
		if (err.eventName === 'fail') return;
		throw err;
	}
}

@InitialState
export class Recovery extends RecoveryTop {
	async fail(): Promise<void> {
		throw new Error('recoverable');
	}
}

registerSpecStateNames(self);
//#endregion

function freshCtx(): PromiseCtx {
	return { order: [] };
}

describe('services-promise', function (): void {
	it('resolves with handler return value', async () => {
		const actor = makeTestActor(PromiseTop, freshCtx(), new Port());
		await actor.hsm.sync();
		const result = await actor.getValue('hello');
		expect(result).equals('ok:hello');
	});

	it('resolves Promise<void> service', async () => {
		const actor = makeTestActor(PromiseTop, freshCtx(), new Port());
		await actor.hsm.sync();
		await actor.getVoid();
	});

	it('resolves sync handler on async-typed service', async () => {
		const actor = makeTestActor(PromiseTop, freshCtx(), new Port());
		await actor.hsm.sync();
		const result = await actor.getSync();
		expect(result).equals(7);
	});

	it('rejects when handler throws', async () => {
		const actor = makeTestActor(PromiseTop, freshCtx(), new Port());
		await actor.hsm.sync();
		try {
			await actor.fail();
			expect.fail('expected rejection');
		} catch (err) {
			expect((err as Error).message).equals('service failed');
		}
	});

	it('onError recovery still rejects the client promise', async () => {
		const actor = makeTestActor(RecoveryTop, freshCtx(), new Port());
		await actor.hsm.sync();
		try {
			await actor.fail();
			expect.fail('expected rejection');
		} catch (err) {
			expect((err as Error).message).equals('recoverable');
		}
	});

	it('transition completes before client promise resolves', async () => {
		const actor = makeTestActor(PromiseTop, freshCtx(), new Port());
		await actor.hsm.sync();
		const result = await actor.transitionThenReply();
		expect(result).equals('moved');
		await actor.hsm.sync();
		expect(actor.hsm.currentStateName).equals('Done');
	});

	it('RTC — awaiting inside a service blocks subsequent notifications', async () => {
		const ctx = freshCtx();
		const actor = makeTestActor(PromiseTop, ctx, new Port());
		await actor.hsm.sync();
		const servicePromise = actor.blocking();
		actor.after();
		await servicePromise;
		await actor.hsm.sync();
		expect(ctx.order).eqls(['blocking-start', 'blocking-end', 'after']);
	});
});
