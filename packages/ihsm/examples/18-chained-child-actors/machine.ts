/**
 * Chained child actors — parent session owns a Link child via makeChildActor.
 * Contrasts with UML parallel regions; see tutorial 14 for a multi-child parent actor.
 */
import * as ihsm from '../../src';
import type { ChildActor } from '../../src';
import { makeTestActor } from '../../src/testing';
import { PlaygroundTopState } from '../shared/playground-top';
import * as self from './machine';

/** Child link — own queue, port, and internal open/dial vocabulary. */
export interface LinkCtx {
	host: string;
	attempts: number;
	linkUp: boolean;
	lastPayload: string;
}

export interface LinkConfig {
	context: LinkCtx;
	services: {
		deliver(payload: string): Promise<boolean>;
	};
	internalNotifications: {
		open(host: string): void;
		finishDial(): void;
	};
	internalServices: {
		dial(): Promise<boolean>;
	};
}

export class LinkTop extends PlaygroundTopState<LinkConfig> {
	open(host: string): void {
		this.ctx.host = host;
		this.hsm.transition(Connecting);
	}

	async dial(): Promise<boolean> {
		this.ctx.attempts += 1;
		const ok = this.ctx.attempts <= 2;
		this.ctx.linkUp = ok;
		return ok;
	}

	async deliver(payload: string): Promise<boolean> {
		if (!this.ctx.linkUp) {
			return false;
		}
		this.ctx.lastPayload = payload;
		return true;
	}
}

@ihsm.InitialState
export class Down extends LinkTop {}

export class Connecting extends LinkTop {
	onEntry(): void {
		this.notifyNow.finishDial();
	}

	finishDial(): void {
		this.ctx.attempts += 1;
		const ok = this.ctx.attempts <= 2;
		this.ctx.linkUp = ok;
		this.hsm.transition(ok ? Up : Failed);
	}
}

export class Up extends LinkTop {}

export class Failed extends LinkTop {}

/** Parent gateway — spawns Link on Active entry, drops child on exit. */
export interface GatewayCtx {
	host: string;
	delivered: number;
	link?: ChildActor<LinkConfig>;
	/** Same object passed to `makeChildActor` — parent-readable child domain data. */
	linkCtx?: LinkCtx;
}

export interface GatewayConfig {
	context: GatewayCtx;
	notifications: {
		activate(host: string): void;
		deactivate(): void;
	};
	services: {
		relay(payload: string): Promise<boolean>;
	};
}

export class GatewayTop extends PlaygroundTopState<GatewayConfig> {
	activate(host: string): void {
		this.ctx.host = host;
		this.hsm.transition(Active);
	}

	deactivate(): void {
		this.hsm.transition(Idle);
	}

	async relay(payload: string): Promise<boolean> {
		if (!this.ctx.link) {
			return false;
		}
		const ok = await this.ctx.link.call.deliver(payload);
		if (ok) {
			this.ctx.delivered += 1;
		}
		return ok;
	}
}

@ihsm.InitialState
export class Idle extends GatewayTop {}

export class Active extends GatewayTop {
	onEntry(): void {
		if (!this.ctx.link) {
			const linkCtx: LinkCtx = {
				host: this.ctx.host,
				attempts: 0,
				linkUp: false,
				lastPayload: '',
			};
			this.ctx.linkCtx = linkCtx;
			this.ctx.link = ihsm.makeChildActor(ihsm.asParentActor(this), LinkTop, linkCtx);
		}
		this.ctx.link.notifyNow.open(this.ctx.host);
	}

	onExit(): void {
		this.ctx.link = undefined;
		this.ctx.linkCtx = undefined;
	}
}

ihsm.registerStateNames(self);

export function createGateway() {
	return makeTestActor(GatewayTop, { host: '', delivered: 0 });
}
