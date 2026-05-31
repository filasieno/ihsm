import * as ihsm from '../../src';
import * as self from './machine';

export interface CounterCtx {
	value: number;
	step: number;
}

export interface CounterProtocol {
	increment(): void;
	decrement(): void;
	reset(): void;
}

export class CounterTop extends ihsm.TopState<CounterCtx, CounterProtocol> implements CounterProtocol {
	increment(): void {
		this.ctx.value += this.ctx.step;
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

ihsm.registerStateNames(self); // grabs every exported state automatically

export function createCounter(initial = 0, step = 1) {
	return ihsm.makeHsm(CounterTop, { value: initial, step });
}
