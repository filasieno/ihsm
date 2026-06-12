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

export interface WorkerConfig extends ihsm.Config {
	context: WorkerCtx;
	notifications: {
		risky(): void;
		unknown(): void;
	};
}

const workerManifest = ihsm.manifestFor<WorkerConfig>({
	services: [],
	notifications: ['risky', 'unknown'],
	internalServices: [],
	internalNotifications: [],
});

export class WorkerTop extends PlaygroundTopState<WorkerConfig> {
	static readonly manifest = workerManifest;
	declare readonly __ihsm: WorkerConfig;

	risky(): void {
		throw new Error('simulated failure');
	}

	unknown(): void {
		this.hsm.unhandled();
	}
}

@ihsm.InitialState
export class Working extends WorkerTop {
	onError(_error: ihsm.EventHandlerError<WorkerCtx, Record<string, unknown>, string>): void {
		this.ctx.recovered += 1;
		this.ctx.failures += 1;
	}

	onUnhandled(_error: ihsm.UnhandledEventError<WorkerCtx, Record<string, unknown>, string>): void {
		this.ctx.failures += 1;
	}
}

ihsm.registerStateNames(self);

export function createWorker() {
	return ihsm.makeOwnerActor(WorkerTop, { failures: 0, recovered: 0 }, new ihsm.Port());
}
