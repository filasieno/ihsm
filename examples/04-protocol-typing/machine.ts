/**
 * Protocol typing — compile-time checks on post() event names and payloads.
 *
 * Uncomment the lines at the bottom locally to see TypeScript reject typos.
 */
import * as ihsm from '../../src';
import { PlaygroundTopState } from '../shared/playground-top';
import * as self from './machine';

export interface ThermostatCtx {
	celsius: number;
}

/** Event vocabulary — drives compile-time checks on post() and call(). */
export interface ThermostatProtocol {
	setTarget(celsius: number): void;
	readTarget(): number;
}

export class ThermostatTop extends PlaygroundTopState<ThermostatCtx, ThermostatProtocol> {
	setTarget(celsius: number): void {
		this.ctx.celsius = celsius;
	}

	/** Synchronous “service-like” method still typed on the protocol (not call() here). */
	readTarget(): number {
		return this.ctx.celsius;
	}
}

@ihsm.InitialState
export class Idle extends ThermostatTop {}

ihsm.registerStateNames(self);

export function createThermostat(initialCelsius: number) {
	return ihsm.makeHsm(ThermostatTop, { celsius: initialCelsius });
}

// Compile-time examples (uncomment to verify the compiler rejects mistakes):
// const t = createThermostat(20);
// t.post('setTargt', 22);        // error: unknown event
// t.post('setTarget', 'hot');    // error: string not assignable to number
