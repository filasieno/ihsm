/**
 * Tracing example — ping handler with CollectingTraceWriter.
 *
 * Teaches: makeActor(..., { traceLevel, traceWriter }), trace lines from handlers.
 */
import * as ihsm from '../../src';
import { makeTestActor } from '../../src/testing';
import { PlaygroundTopState } from '../shared/playground-top';
import * as self from './machine';
import { CollectingTraceWriter } from '../shared/trace';

/** Domain data updated by events. */
export interface PingCtx {
	pings: number;
}

export interface PingConfig {
	context: PingCtx;
notifications: {
		ping(): void;
	};
}


export class PingTop extends PlaygroundTopState<PingConfig> {

	ping(): void {
		this.ctx.pings += 1;
		// Custom writer receives domain|…|StateName: message (also in VERBOSE_DEBUG).
		this.hsm.traceWriter.write(this.hsm as never, `ping count is now ${this.ctx.pings}`);
	}
}

@ihsm.InitialState
export class Ready extends PingTop {}

ihsm.registerStateNames(self);

/** Verbose trace into a collector — used by the reference trace panel and tests. */
export function createTracedPing(writer: CollectingTraceWriter) {
	return makeTestActor(PingTop, { pings: 0 }, new ihsm.Port(), {
		traceLevel: ihsm.TraceLevel.VERBOSE_DEBUG,
		traceWriter: writer,
	});
}

export function createPingMachine(writer: CollectingTraceWriter) {
	return createTracedPing(writer);
}
