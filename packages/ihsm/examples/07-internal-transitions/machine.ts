/**
 * Internal transitions — update ctx without transition(); onEntry does not re-run.
 *
 * Compare entryCount: it only increments when entering On, not on dim/brighten.
 */
import * as ihsm from '../../src';
import { makeTestActor } from '../../src/testing';
import { PlaygroundTopState } from '../shared/playground-top';
import * as self from './machine';

export interface LampCtx {
	brightness: number;
	/** Increments only on onEntry — proves exit/entry did not run on dim/brighten. */
	entryCount: number;
}

export interface LampConfig {
	context: LampCtx;
notifications: {
		dim(delta: number): void;
		brighten(delta: number): void;
	};
}


export class LampTop extends PlaygroundTopState<LampConfig> {

	onEntry(): void {
		this.ctx.entryCount += 1;
	}

	dim(delta: number): void {
		this.ctx.brightness = Math.max(0, this.ctx.brightness - delta);
		// Internal transition: no hsm.transition() → stay in On, no onEntry.
	}

	brighten(delta: number): void {
		this.ctx.brightness = Math.min(100, this.ctx.brightness + delta);
	}
}

@ihsm.InitialState
export class On extends LampTop {}

ihsm.registerStateNames(self);

export function createLamp(brightness: number) {
	return makeTestActor(LampTop, { brightness, entryCount: 0 }, new ihsm.Port());
}
