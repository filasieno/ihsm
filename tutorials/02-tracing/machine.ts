import * as ihsm from '../../src';
import * as self from './machine';
import { CollectingTraceWriter } from '../shared/trace';

export interface PingCtx {
	pings: number;
}

export interface PingProtocol {
	ping(): void;
}

export class PingTop extends ihsm.TopState<PingCtx, PingProtocol> implements PingProtocol {
	ping(): void {
		this.ctx.pings += 1;
		this.traceWriter.write(this, `ping count is now ${this.ctx.pings}`);
	}
}

@ihsm.InitialState
export class Ready extends PingTop {}

ihsm.registerStateNames(self); // grabs every exported state automatically

export function createTracedPing(writer: CollectingTraceWriter) {
	return ihsm.makeHsm(PingTop, { pings: 0 }, true, ihsm.TraceLevel.VERBOSE_DEBUG, writer);
}

export function createPingMachine(writer: CollectingTraceWriter) {
	return createTracedPing(writer);
}
