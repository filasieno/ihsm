/**
 * Error recovery — onError and onUnhandled on Working state.
 */
import * as ihsm from '../../src';
import { PlaygroundTopState } from '../shared/playground-top';
import * as self from './machine';

export interface WorkerCtx {
	failures: number;
	recovered: number;
}

export interface WorkerProtocol {
	risky(): void;
	unknown(): void;
}

export class WorkerTop extends PlaygroundTopState<WorkerCtx, WorkerProtocol> {
	risky(): void {
		throw new Error('simulated failure');
	}

	unknown(): void {
		this.unhandled();
	}
}

@ihsm.InitialState
export class Working extends WorkerTop {
	onError<EventName extends keyof WorkerProtocol>(_error: ihsm.EventHandlerError<WorkerCtx, WorkerProtocol, EventName>): void {
		this.ctx.recovered += 1;
		this.ctx.failures += 1;
	}

	onUnhandled<EventName extends keyof WorkerProtocol>(_error: ihsm.UnhandledEventError<WorkerCtx, WorkerProtocol, EventName>): void {
		this.ctx.failures += 1;
	}
}

ihsm.registerStateNames(self);

export function createWorker() {
	return ihsm.makeHsm(WorkerTop, { failures: 0, recovered: 0 });
}
