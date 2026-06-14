/**
 * Error recovery — onError and onUnhandled on Working state.
 */
import * as ihsm from '../../src';
import { makeTestActor } from '../../src/testing';
import { PlaygroundTopState } from '../shared/playground-top';
import * as self from './machine';

export interface WorkerCtx {
	failures: number;
	recovered: number;
}

export interface WorkerConfig {
	context: WorkerCtx;
	notifications: {
		risky(): void;
		unknown(): void;
	};
}

export class WorkerTop extends PlaygroundTopState<WorkerConfig> {
	risky(): void {
		throw new Error('simulated failure');
	}

	unknown(): void {
		this.hsm.unhandled();
	}
}

@ihsm.InitialState
export class Working extends WorkerTop {
	onError(_error: ihsm.EventHandlerError<WorkerConfig>): void {
		this.ctx.recovered += 1;
		this.ctx.failures += 1;
	}

	onUnhandled(_error: ihsm.UnhandledEventError<WorkerConfig>): void {
		this.ctx.failures += 1;
	}
}

ihsm.registerStateNames(self);

export function createWorker() {
	return makeTestActor(WorkerTop, { failures: 0, recovered: 0 }, new ihsm.Port());
}
