import * as ihsm from '../../src';
import * as self from './machine';

export interface ThermostatCtx {
	celsius: number;
}

/** Event vocabulary — drives compile-time checks on post() and call(). */
export interface ThermostatProtocol {
	setTarget(celsius: number): void;
	readTarget(): number;
}

export class ThermostatTop extends ihsm.TopState<ThermostatCtx, ThermostatProtocol> implements ThermostatProtocol {
	setTarget(celsius: number): void {
		this.ctx.celsius = celsius;
	}

	readTarget(): number {
		return this.ctx.celsius;
	}
}

@ihsm.InitialState
export class Idle extends ThermostatTop {}

ihsm.registerStateNames(self); // grabs every exported state automatically

export function createThermostat(initialCelsius: number) {
	return ihsm.makeHsm(ThermostatTop, { celsius: initialCelsius });
}

// Compile-time examples (uncomment to verify the compiler rejects mistakes):
// const t = createThermostat(20);
// t.post('setTargt', 22);        // error: unknown event
// t.post('setTarget', 'hot');    // error: string not assignable to number
