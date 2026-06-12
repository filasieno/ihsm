import { expect } from 'chai';
import 'mocha';

import { Any, EventHandlerError, InitialState, Port, TopState, makeOwnerActor, manifestFor, registerStateNames } from '../';
import type { Config } from '../';

interface PromiseCtx {
	order: string[];
}

interface PromiseConfig extends Config {
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

const promiseManifest = manifestFor<PromiseConfig>({
	services: ['getValue', 'getVoid', 'getSync', 'fail', 'transitionThenReply', 'blocking'],
	notifications: ['after'],
	internalServices: [],
	internalNotifications: [],
});

class PromiseTop extends TopState {
	static readonly manifest = promiseManifest;
	declare readonly __ihsm: PromiseConfig;
}

class Done extends PromiseTop {}

@InitialState
class Active extends PromiseTop {
	getValue(value: string): string {
		return `ok:${value}`;
	}

	async getVoid(): Promise<void> {}

	getSync(): number {
		return 7;
	}

	fail(): void {
		throw new Error('service failed');
	}

	transitionThenReply(): string {
		this.hsm.transition(Done);
		return 'moved';
	}

	async blocking(): Promise<string> {
		this.ctx.order.push('blocking-start');
		await this.hsm.sleep(10);
		this.ctx.order.push('blocking-end');
		return 'done';
	}

	after(): void {
		this.ctx.order.push('after');
	}
}

registerStateNames({ PromiseTop, Active, Done });

const recoveryManifest = manifestFor<{ services: { fail(): Promise<void> } }>({
	services: ['fail'],
	notifications: [],
	internalServices: [],
	internalNotifications: [],
});

class RecoveryTop extends TopState {
	static readonly manifest = recoveryManifest;
	declare readonly __ihsm: { services: { fail(): Promise<void> } };

	onError(err: EventHandlerError<Any, Record<string, unknown>, string>): void {
		if (err.eventName === 'fail') return;
		throw err;
	}
}

@InitialState
class Recovery extends RecoveryTop {
	fail(): void {
		throw new Error('recoverable');
	}
}

registerStateNames({ RecoveryTop, Recovery });

function freshCtx(): PromiseCtx {
	return { order: [] };
}

describe('services-promise (v2)', function (): void {
	it('resolves with handler return value', async () => {
		const actor = makeOwnerActor(PromiseTop as never, freshCtx(), new Port());
		await actor.hsm.sync();
		const result = await actor.getValue('hello');
		expect(result).equals('ok:hello');
	});

	it('resolves Promise<void> service', async () => {
		const actor = makeOwnerActor(PromiseTop as never, freshCtx(), new Port());
		await actor.hsm.sync();
		await actor.getVoid();
	});

	it('resolves sync handler on async-typed service', async () => {
		const actor = makeOwnerActor(PromiseTop as never, freshCtx(), new Port());
		await actor.hsm.sync();
		const result = await actor.getSync();
		expect(result).equals(7);
	});

	it('rejects when handler throws', async () => {
		const actor = makeOwnerActor(PromiseTop as never, freshCtx(), new Port());
		await actor.hsm.sync();
		try {
			await actor.fail();
			expect.fail('expected rejection');
		} catch (err) {
			expect((err as Error).message).equals('service failed');
		}
	});

	it('onError recovery still rejects the client promise', async () => {
		const actor = makeOwnerActor(RecoveryTop as never, freshCtx(), new Port());
		await actor.hsm.sync();
		try {
			await actor.fail();
			expect.fail('expected rejection');
		} catch (err) {
			expect((err as Error).message).equals('recoverable');
		}
	});

	it('transition completes before client promise resolves', async () => {
		const actor = makeOwnerActor(PromiseTop as never, freshCtx(), new Port());
		await actor.hsm.sync();
		const result = await actor.transitionThenReply();
		expect(result).equals('moved');
		await actor.hsm.sync();
		expect(actor.hsm.currentStateName).equals('Done');
	});

	it('RTC — awaiting inside a service blocks subsequent notifications', async () => {
		const ctx = freshCtx();
		const actor = makeOwnerActor(PromiseTop as never, ctx, new Port());
		await actor.hsm.sync();
		const servicePromise = actor.blocking();
		actor.after();
		await servicePromise;
		await actor.hsm.sync();
		expect(ctx.order).eqls(['blocking-start', 'blocking-end', 'after']);
	});
});
