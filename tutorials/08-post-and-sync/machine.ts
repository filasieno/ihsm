import * as ihsm from '../../src';
import * as self from './machine';

export interface QueueCtx {
	events: string[];
}

export interface QueueProtocol {
	start(): void;
	tick(): void;
	done(): void;
}

export class QueueTop extends ihsm.TopState<QueueCtx, QueueProtocol> implements QueueProtocol {
	start(): void {
		this.ctx.events.push('start');
		this.post('tick');
		this.post('tick');
		this.post('done');
	}

	tick(): void {
		this.ctx.events.push('tick');
	}

	done(): void {
		this.ctx.events.push('done');
	}
}

@ihsm.InitialState
export class Idle extends QueueTop {}

ihsm.registerStateNames(self); // grabs every exported state automatically

export function createQueueMachine() {
	return ihsm.makeHsm(QueueTop, { events: [] });
}
