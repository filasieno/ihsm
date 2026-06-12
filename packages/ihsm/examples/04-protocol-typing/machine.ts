/**
 * Protocol typing — compile-time checks on actor notification and service methods.
 *
 * Uncomment the lines at the bottom locally to see TypeScript reject typos.
 */
import * as ihsm from '../../src';
import { PlaygroundTopState } from '../shared/playground-top';
import * as self from './machine';

export interface ThermostatCtx {
	celsius: number;
}

export interface ThermostatConfig extends ihsm.Config {
	context: ThermostatCtx;
	notifications: {
		setTarget(celsius: number): void;
	};
	services: {
		readTarget(): Promise<number>;
	};
}

const thermostatManifest = ihsm.manifestFor<ThermostatConfig>({
	services: ['readTarget'],
	notifications: ['setTarget'],
	internalServices: [],
	internalNotifications: [],
});

export class ThermostatTop extends PlaygroundTopState<ThermostatConfig> {
	static readonly manifest = thermostatManifest;
	declare readonly __ihsm: ThermostatConfig;

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
	return ihsm.makeOwnerActor(ThermostatTop, { celsius: initialCelsius }, new ihsm.Port());
}

// Compile-time examples (uncomment to verify the compiler rejects mistakes):
// const t = createThermostat(20);
// t.setTargt(22);        // error: unknown method
// t.setTarget('hot');    // error: string not assignable to number
