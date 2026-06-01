/**
 * Tracing example — ping handler with CollectingTraceWriter.
 *
 * Teaches: makeHsm(..., TraceLevel.VERBOSE_DEBUG, writer), trace lines from handlers.
 */
import * as ihsm from '../../src';
import { PlaygroundTopState } from '../shared/playground-top';
import * as self from './machine';
import { CollectingTraceWriter } from '../shared/trace';

/** Domain data updated by events. */
export interface PingCtx {
	pings: number;
}

export interface PingProtocol {
	ping(): void;
}

export class PingTop extends PlaygroundTopState<PingCtx, PingProtocol> {
	ping(): void {
		this.ctx.pings += 1;
		// Custom writer receives domain|…|StateName: message (also in VERBOSE_DEBUG).
		this.traceWriter.write(this, `ping count is now ${this.ctx.pings}`);
	}
}

@ihsm.InitialState
export class Ready extends PingTop {}

ihsm.registerStateNames(self);

/** Verbose trace into a collector — used by the reference trace panel and tests. */
export function createTracedPing(writer: CollectingTraceWriter) {
	return ihsm.makeHsm(PingTop, { pings: 0 }, true, ihsm.TraceLevel.VERBOSE_DEBUG, writer);
}

export function createPingMachine(writer: CollectingTraceWriter) {
	return createTracedPing(writer);
}
