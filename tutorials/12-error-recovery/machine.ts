import { HsmEventHandlerError, makeHsm, HsmInitialState, HsmTopState, HsmUnhandledEventError } from '../../src';

export interface WorkerCtx {
	failures: number;
	recovered: number;
}

export interface WorkerProtocol {
	risky(): void;
	unknown(): void;
}

export class WorkerTop extends HsmTopState<WorkerCtx, WorkerProtocol> implements WorkerProtocol {
	risky(): void {
		throw new Error('simulated failure');
	}

	unknown(): void {
		this.unhandled();
	}
}

@HsmInitialState
export class Working extends WorkerTop {
	onError<EventName extends keyof WorkerProtocol>(_error: HsmEventHandlerError<WorkerCtx, WorkerProtocol, EventName>): void {
		this.ctx.recovered += 1;
		this.ctx.failures += 1;
	}

	onUnhandled<EventName extends keyof WorkerProtocol>(_error: HsmUnhandledEventError<WorkerCtx, WorkerProtocol, EventName>): void {
		this.ctx.failures += 1;
	}
}

export function createWorker() {
	return makeHsm(WorkerTop, { failures: 0, recovered: 0 });
}
