import { expect } from 'chai';
import 'mocha';

import {
	InitialState,
	Port,
	RequestingPort,
	TopState,
	makeActor,
	makeInternalActor,
	makeOwnerActor,
	manifestFor,
	registerStateNames,
} from '../';
import type { Config, OwnerActor } from '../';

interface ChildCtx {
	value: number;
}

interface ChildConfig extends Config {
	context: ChildCtx;
	services: {
		ping(): Promise<string>;
	};
	notifications: {
		open(): void;
	};
	internalServices: {
		initialize(seed: number): Promise<number>;
	};
	internalNotifications: {
		onReady(): void;
	};
}

const childManifest = manifestFor<ChildConfig>({
	services: ['ping'],
	notifications: ['open'],
	internalServices: ['initialize'],
	internalNotifications: ['onReady'],
});

class ChildTop extends TopState {
	static readonly manifest = childManifest;
	declare readonly __ihsm: ChildConfig;

	open(): void {}

	initialize(seed: number): number {
		this.ctx.value = seed;
		return seed * 2;
	}

	onReady(): void {}
}

@InitialState
class ChildIdle extends ChildTop {
	ping(): string {
		return `v${this.ctx.value}`;
	}
}

interface ParentCtx {
	child?: OwnerActor<ChildConfig>;
	sum: number;
}

interface ParentConfig extends Config {
	context: ParentCtx;
	services: {
		boot(seed: number): Promise<number>;
	};
	notifications: Record<string, never>;
	internalServices: Record<string, never>;
	internalNotifications: Record<string, never>;
}

const parentManifest = manifestFor<ParentConfig>({
	services: ['boot'],
	notifications: [],
	internalServices: [],
	internalNotifications: [],
});

class ParentTop extends TopState {
	static readonly manifest = parentManifest;
	declare readonly __ihsm: ParentConfig;

	async boot(seed: number): Promise<number> {
		const doubled = await this.ctx.child!.initialize(seed);
		this.ctx.sum = doubled;
		return doubled;
	}
}

@InitialState
class ParentIdle extends ParentTop {}

class ChildRequestPort extends RequestingPort<ChildTop> {}

registerStateNames({ ChildTop, ChildIdle, ParentTop, ParentIdle });

describe('internal-services (v2)', function (): void {
	it('parent OwnerActor awaits child internalServices', async () => {
		const childPort = new Port<ChildTop>();
		const child = makeOwnerActor(ChildTop as never, { value: 0 }, childPort);
		const parentPort = new Port<ParentTop>();
		const parent = makeOwnerActor(ParentTop as never, { sum: 0, child }, parentPort);
		await parent.hsm.sync();
		const doubled = await parent.boot(3);
		expect(doubled).equals(6);
		expect(parent.ctx.sum).equals(6);
		expect(child.ctx.value).equals(3);
	});

	it('makeActor port.actor is InternalActor without internalServices', async () => {
		const port = new Port<ChildTop>();
		const child = makeActor(ChildTop as never, { value: 0 }, port);
		await child.hsm.sync();
		expect(port.actor).to.exist;
		expect((port.actor as { initialize?: unknown }).initialize).equals(undefined);
		port.actor!.onReady();
		await child.hsm.sync();
	});

	it('RequestingPort widens port.actor with internalServices', async () => {
		const port = new ChildRequestPort();
		const child = makeActor(ChildTop as never, { value: 0 }, port);
		await child.hsm.sync();
		expect(port.actor).to.exist;
		const doubled = await port.actor!.initialize(4);
		expect(doubled).equals(8);
		expect(child.ctx.value).equals(4);
	});

	it('makeInternalActor exposes internalNotifications on the handle', async () => {
		const actor = makeInternalActor(ChildTop as never, { value: 1 }, new Port());
		await actor.hsm.sync();
		actor.onReady();
		await actor.hsm.sync();
		expect(await actor.ping()).equals('v1');
	});
});
