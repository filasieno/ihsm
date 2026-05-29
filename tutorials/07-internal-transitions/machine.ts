import { HsmFactory, HsmInitialState, HsmTopState } from '../../src';

export interface LampCtx {
	brightness: number;
	entryCount: number;
}

export interface LampProtocol {
	dim(delta: number): void;
	brighten(delta: number): void;
}

export class LampTop extends HsmTopState<LampCtx, LampProtocol> implements LampProtocol {
	onEntry(): void {
		this.ctx.entryCount += 1;
	}

	dim(delta: number): void {
		this.ctx.brightness = Math.max(0, this.ctx.brightness - delta);
		// Internal transition: no this.transition()
	}

	brighten(delta: number): void {
		this.ctx.brightness = Math.min(100, this.ctx.brightness + delta);
	}
}

@HsmInitialState
export class On extends LampTop {}

export const lampFactory = new HsmFactory(LampTop);

export function createLamp(brightness: number) {
	return lampFactory.create({ brightness, entryCount: 0 });
}
