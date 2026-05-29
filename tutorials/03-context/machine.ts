import { HsmFactory, HsmInitialState, HsmTopState } from '../../src';

export interface CounterCtx {
	value: number;
	step: number;
}

export interface CounterProtocol {
	increment(): void;
	decrement(): void;
	reset(): void;
}

export class CounterTop extends HsmTopState<CounterCtx, CounterProtocol> implements CounterProtocol {
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

@HsmInitialState
export class Running extends CounterTop {}

export const counterFactory = new HsmFactory(CounterTop);

export function createCounter(initial = 0, step = 1) {
	return counterFactory.create({ value: initial, step });
}
