import { makeHsm, HsmInitialState, HsmTopState, HsmTraceLevel } from '../../src';
import { CollectingTraceWriter } from '../_shared/trace';

export interface PingCtx {
	pings: number;
}

export interface PingProtocol {
	ping(): void;
}

export class PingTop extends HsmTopState<PingCtx, PingProtocol> implements PingProtocol {
	ping(): void {
		this.ctx.pings += 1;
		this.traceWriter.write(this, `ping count is now ${this.ctx.pings}`);
	}
}

@HsmInitialState
export class Ready extends PingTop {}

export function createTracedPing(writer: CollectingTraceWriter) {
	return makeHsm(PingTop, { pings: 0 }, true, HsmTraceLevel.VERBOSE_DEBUG, writer);
}

export function createPingMachine(writer: CollectingTraceWriter) {
	return createTracedPing(writer);
}
