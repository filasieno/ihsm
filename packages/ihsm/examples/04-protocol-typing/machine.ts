/**
 * Protocol typing — compile-time checks on actor notification and service methods.
 *
 * Uncomment the lines at the bottom locally to see TypeScript reject typos.
 */
import * as ihsm from '../../src';
import { makeTestActor } from '../../src/testing';
import { PlaygroundTopState } from '../shared/playground-top';
import * as self from './machine';

export interface ThermostatCtx {
	celsius: number;
}

export interface ThermostatConfig {
	context: ThermostatCtx;
	notifications: {
		setTarget(celsius: number): void;
	};
	services: {
		readTarget(): Promise<number>;
	};
}

export class ThermostatTop extends PlaygroundTopState<ThermostatConfig> {
	setTarget(celsius: number): void {
		this.ctx.celsius = celsius;
	}

	readTarget(): number {
		return this.ctx.celsius;
	}
}

@ihsm.InitialState
export class Idle extends ThermostatTop {}

ihsm.registerStateNames(self);

export function createThermostat(initialCelsius: number) {
	return makeTestActor(ThermostatTop, { celsius: initialCelsius });
}

// Compile-time examples (uncomment to verify the compiler rejects mistakes):
// const t = createThermostat(20);
// t.setTargt(22);        // error: unknown method
// t.setTarget('hot');    // error: string not assignable to number
