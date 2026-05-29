import { HsmFactory, HsmInitialState, HsmTopState } from '../../src';

export interface QueueCtx {
	events: string[];
}

export interface QueueProtocol {
	start(): void;
	tick(): void;
	done(): void;
}

export class QueueTop extends HsmTopState<QueueCtx, QueueProtocol> implements QueueProtocol {
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

@HsmInitialState
export class Idle extends QueueTop {}

export const queueFactory = new HsmFactory(QueueTop);

export function createQueueMachine() {
	return queueFactory.create({ events: [] });
}
