import { expect } from 'chai';
import 'mocha';

import { InitialState, Port, RequestingPort, TopState, asParentActor, makeActor, makeChildActor } from '../';
import type { ChildActor, InboundActor } from '../';
import * as self from './internal-services.spec';
import { registerSpecStateNames } from './spec.utils';

//#region ThisTestSpec

interface ChildCtx {
	value: number;
}

interface ChildConfig {
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

export class ChildTop extends TopState<ChildConfig> {
	open(): void {}

	async initialize(seed: number): Promise<number> {
		this.ctx.value = seed;
		return seed * 2;
	}

	onReady(): void {}
}

@InitialState
export class ChildIdle extends ChildTop {
	async ping(): Promise<string> {
		return `v${this.ctx.value}`;
	}
}

interface ParentCtx {
	child?: ChildActor<ChildConfig>;
	sum: number;
}

interface ParentConfig {
	context: ParentCtx;
	services: {
		boot(seed: number): Promise<number>;
	};
}

export class ParentTop extends TopState<ParentConfig> {
	async boot(seed: number): Promise<number> {
		const doubled = await this.ctx.child!.call.initialize(seed);
		this.ctx.sum = doubled;
		return doubled;
	}
}

@InitialState
export class ParentIdle extends ParentTop {
	onEntry(): void {
		if (this.ctx.child === undefined) {
			this.ctx.child = makeChildActor(asParentActor(this), ChildTop, { value: 0 }, new Port<typeof ChildTop>());
		}
	}
}

class ChildRequestPort extends RequestingPort<typeof ChildTop> {}

registerSpecStateNames(self);
//#endregion

describe('internal-services', function (): void {
	it('parent ChildActor awaits child internalServices', async () => {
		const parentPort = new Port<typeof ParentTop>();
		const parentCtx: ParentCtx = { sum: 0 };
		const parent = makeActor(ParentTop, parentCtx, parentPort);
		await parent.hsm.sync();
		const doubled = await parent.call.boot(3);
		expect(doubled).equals(6);
		expect(parentCtx.child!.id).equals(parentCtx.child!.hsm.id);
		expect(parentCtx.child!.id).to.not.equal(parent.hsm.id);
		expect(parentCtx.sum).equals(6);
		expect(parentCtx.child).to.not.equal(undefined);
		expect(await parentCtx.child!.call.ping()).equals('v3');
	});

	it('makeActor port.actor exposes discovered services on the internal port handle', async () => {
		const port = new Port<typeof ChildTop>();
		const childCtx = { value: 0 };
		makeActor(ChildTop, childCtx, port);
		await port.actor!.hsm.sync();
		expect(port.actor).to.not.equal(undefined);
		expect(typeof (port.actor as { call: { initialize?: unknown } }).call.initialize).equals('function');
		(port.actor as InboundActor<ChildConfig>).notify.onReady();
		await port.actor!.hsm.sync();
	});

	it('RequestingPort widens port.actor with internalServices', async () => {
		const port = new ChildRequestPort();
		const childCtx = { value: 0 };
		makeActor(ChildTop, childCtx, port);
		await port.actor.hsm.sync();
		expect(port.actor).to.not.equal(undefined);
		const doubled = await port.actor.call.initialize(4);
		expect(doubled).equals(8);
		expect(childCtx.value).equals(4);
	});

	it('port.actor exposes internalNotifications after makeActor', async () => {
		const port = new Port<typeof ChildTop>();
		const childCtx = { value: 1 };
		makeActor(ChildTop, childCtx, port);
		await port.actor!.hsm.sync();
		port.actor!.notify.onReady();
		await port.actor!.hsm.sync();
		expect(await port.actor!.call.ping()).equals('v1');
	});
});
