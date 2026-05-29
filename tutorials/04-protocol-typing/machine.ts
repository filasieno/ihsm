import { HsmFactory, HsmInitialState, HsmTopState } from '../../src';

export interface ThermostatCtx {
	celsius: number;
}

/** Event vocabulary — drives compile-time checks on post() and call(). */
export interface ThermostatProtocol {
	setTarget(celsius: number): void;
	readTarget(): number;
}

export class ThermostatTop extends HsmTopState<ThermostatCtx, ThermostatProtocol> implements ThermostatProtocol {
	setTarget(celsius: number): void {
		this.ctx.celsius = celsius;
	}

	readTarget(): number {
		return this.ctx.celsius;
	}
}

@HsmInitialState
export class Idle extends ThermostatTop {}

export const thermostatFactory = new HsmFactory(ThermostatTop);

export function createThermostat(initialCelsius: number) {
	return thermostatFactory.create({ celsius: initialCelsius });
}

// Compile-time examples (uncomment to verify the compiler rejects mistakes):
// const t = createThermostat(20);
// t.post('setTargt', 22);        // error: unknown event
// t.post('setTarget', 'hot');    // error: string not assignable to number
