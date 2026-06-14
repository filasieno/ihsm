/**
 * Request manager — parent actor with a request table and two command child types.
 * Cross-actor coordination is notification-only; commands complete via deferred events
 * so requests can be cancelled before completion.
 */
import * as ihsm from '../../src';
import type { ChildActor } from '../../src';
import { makeTestActor, TestPort } from '../../src/testing';
import { PlaygroundTopState } from '../shared/playground-top';
import * as self from './machine';

export type RequestKind = 'alpha' | 'beta';
export type RequestStatus = 'running' | 'done' | 'cancelled';

export interface RequestRow {
	kind: RequestKind;
	status: RequestStatus;
}

/** Events command children fire back to the manager (wired at spawn). */
export interface ManagerChildEvents {
	finished(requestId: number): void;
	cancelled(requestId: number): void;
}

export interface AlphaCtx {
	requestId: number;
	cancelled: boolean;
	manager: ManagerChildEvents;
}

export interface AlphaConfig {
	context: AlphaCtx;
	internalNotifications: {
		start(): void;
		complete(): void;
		cancel(): void;
	};
}

export class AlphaTop extends PlaygroundTopState<AlphaConfig> {
	start(): void {
		this.hsm.transition(AlphaRunning);
	}

	cancel(): void {
		if (this.ctx.cancelled) {
			return;
		}
		this.ctx.cancelled = true;
		this.hsm.transition(AlphaCancelled);
		this.ctx.manager.cancelled(this.ctx.requestId);
	}

	complete(): void {
		if (this.ctx.cancelled) {
			return;
		}
		this.hsm.transition(AlphaDone);
		this.ctx.manager.finished(this.ctx.requestId);
	}
}

@ihsm.InitialState
export class AlphaIdle extends AlphaTop {}

export class AlphaRunning extends AlphaTop {
	onEntry(): void {
		this.hsm.port.defer(50).complete();
	}
}

export class AlphaDone extends AlphaTop {}

export class AlphaCancelled extends AlphaTop {}

export interface BetaCtx {
	requestId: number;
	cancelled: boolean;
	manager: ManagerChildEvents;
}

export interface BetaConfig {
	context: BetaCtx;
	internalNotifications: {
		start(): void;
		complete(): void;
		cancel(): void;
	};
}

export class BetaTop extends PlaygroundTopState<BetaConfig> {
	start(): void {
		this.hsm.transition(BetaRunning);
	}

	cancel(): void {
		if (this.ctx.cancelled) {
			return;
		}
		this.ctx.cancelled = true;
		this.hsm.transition(BetaCancelled);
		this.ctx.manager.cancelled(this.ctx.requestId);
	}

	complete(): void {
		if (this.ctx.cancelled) {
			return;
		}
		this.hsm.transition(BetaDone);
		this.ctx.manager.finished(this.ctx.requestId);
	}
}

@ihsm.InitialState
export class BetaIdle extends BetaTop {}

export class BetaRunning extends BetaTop {
	onEntry(): void {
		this.hsm.port.defer(50).complete();
	}
}

export class BetaDone extends BetaTop {}

export class BetaCancelled extends BetaTop {}

export type CommandChild = ChildActor<AlphaConfig> | ChildActor<BetaConfig>;

export interface RequestManagerCtx {
	nextId: number;
	table: Record<number, RequestRow>;
	children: Record<number, CommandChild>;
	/** TestPort instances used to advance deferred command timers in tests. */
	childPorts: Record<number, TestPort<typeof AlphaTop> | TestPort<typeof BetaTop>>;
}

export interface RequestManagerConfig {
	context: RequestManagerCtx;
	notifications: {
		submit(kind: RequestKind): void;
		cancel(requestId: number): void;
	};
	internalNotifications: {
		commandFinished(requestId: number): void;
		commandCancelled(requestId: number): void;
	};
}

export class RequestManagerTop extends PlaygroundTopState<RequestManagerConfig> {
	submit(kind: RequestKind): void {
		const requestId = ++this.ctx.nextId;
		this.ctx.table[requestId] = { kind, status: 'running' };
		const manager = this.managerEvents();
		if (kind === 'alpha') {
			const alphaCtx: AlphaCtx = { requestId, cancelled: false, manager };
			const port = new TestPort<typeof AlphaTop>();
			const child = ihsm.makeChildActor(ihsm.asParentActor(this), AlphaTop, alphaCtx, port);
			this.ctx.children[requestId] = child;
			this.ctx.childPorts[requestId] = port;
			child.notify.start();
		} else {
			const betaCtx: BetaCtx = { requestId, cancelled: false, manager };
			const port = new TestPort<typeof BetaTop>();
			const child = ihsm.makeChildActor(ihsm.asParentActor(this), BetaTop, betaCtx, port);
			this.ctx.children[requestId] = child;
			this.ctx.childPorts[requestId] = port;
			child.notify.start();
		}
	}

	cancel(requestId: number): void {
		const row = this.ctx.table[requestId];
		const child = this.ctx.children[requestId];
		if (!row || row.status !== 'running' || !child) {
			return;
		}
		child.notify.cancel();
	}

	commandFinished(requestId: number): void {
		const row = this.ctx.table[requestId];
		if (!row || row.status !== 'running') {
			return;
		}
		row.status = 'done';
		delete this.ctx.children[requestId];
		delete this.ctx.childPorts[requestId];
	}

	commandCancelled(requestId: number): void {
		const row = this.ctx.table[requestId];
		if (!row || row.status !== 'running') {
			return;
		}
		row.status = 'cancelled';
		delete this.ctx.children[requestId];
		delete this.ctx.childPorts[requestId];
	}

	private managerEvents(): ManagerChildEvents {
		return {
			finished: id => this.notifyNow.commandFinished(id),
			cancelled: id => this.notifyNow.commandCancelled(id),
		};
	}
}

@ihsm.InitialState
export class ManagerIdle extends RequestManagerTop {}

ihsm.registerStateNames(self);

export function createRequestManager() {
	return makeTestActor(RequestManagerTop, { nextId: 0, table: {}, children: {}, childPorts: {} }, new TestPort<typeof RequestManagerTop>());
}

/** Drain manager and every in-flight command child queue. */
export async function syncRequestManager(manager: ReturnType<typeof createRequestManager>): Promise<void> {
	await manager.hsm.sync();
	for (const child of Object.values(manager.ctx.children)) {
		await child.hsm.sync();
	}
	await manager.hsm.sync();
}
