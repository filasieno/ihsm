import * as ihsm from '../../src';
import * as self from './machine';

export interface LampCtx {
	brightness: number;
	entryCount: number;
}

export interface LampProtocol {
	dim(delta: number): void;
	brighten(delta: number): void;
}

export class LampTop extends ihsm.TopState<LampCtx, LampProtocol> implements LampProtocol {
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

@ihsm.InitialState
export class On extends LampTop {}

ihsm.registerStateNames(self); // grabs every exported state automatically

export function createLamp(brightness: number) {
	return ihsm.makeHsm(LampTop, { brightness, entryCount: 0 });
}
