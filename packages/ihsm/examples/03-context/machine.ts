/**
 * Context example — mutate ctx without changing active state class.
 *
 * Teaches: ctx survives transitions; internal transitions skip onEntry/onExit.
 */
import * as ihsm from '../../src';
import { PlaygroundTopState } from '../shared/playground-top';
import * as self from './machine';

export interface CounterCtx {
	value: number;
	/** Step size for increment/decrement — also stored in ctx, not on the class. */
	step: number;
}

export interface CounterConfig extends ihsm.Config {
	context: CounterCtx;
	notifications: {
		increment(): void;
		decrement(): void;
		reset(): void;
	};
}

const counterManifest = ihsm.manifestFor<CounterConfig>({
	services: [],
	notifications: ['increment', 'decrement', 'reset'],
	internalServices: [],
	internalNotifications: [],
});

export class CounterTop extends PlaygroundTopState<CounterConfig> {
	static readonly manifest = counterManifest;
	declare readonly __ihsm: CounterConfig;

	increment(): void {
		this.ctx.value += this.ctx.step;
		// No transition() → internal transition; Running stays active.
	}

	decrement(): void {
		this.ctx.value -= this.ctx.step;
	}

	reset(): void {
		this.ctx.value = 0;
	}
}

@ihsm.InitialState
export class Running extends CounterTop {}

ihsm.registerStateNames(self);

export function createCounter(initial = 0, step = 1) {
	return ihsm.makeOwnerActor(CounterTop, { value: initial, step }, new ihsm.Port());
}
