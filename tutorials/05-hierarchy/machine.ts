import { makeHsm, HsmInitialState, HsmTopState } from '../../src';

export interface DeepCtx {
	trace: string[];
	value: number;
	/** When true, the next onExit that runs throws (for error demos). */
	failExit: boolean;
}

export interface DeepProtocol {
	tick(): void;
	goSiblingWest(): void;
	goParentWest(): void;
	goAncestorWest(): void;
	goRoot(): void;
	goSelfWest(): void;
	goCrossToLeafEastB(): void;
	goCrossToBranchEast(): void;
	goCrossToMidEast(): void;
	goSiblingEast(): void;
	goCrossToLeafWestB(): void;
	goAsyncCrossEast(): void;
	armFailExit(): void;
}

function pushTrace(ctx: DeepCtx, line: string): void {
	ctx.trace.push(line);
}

/** Root — LCA for every cross-stack transition. */
export class DeepTop extends HsmTopState<DeepCtx, DeepProtocol> implements DeepProtocol {
	onEntry(): void {
		pushTrace(this.ctx, 'enter:DeepTop');
	}
	onExit(): void {
		this.maybeFailExit('DeepTop');
		pushTrace(this.ctx, 'exit:DeepTop');
	}
	tick(): void {
		this.ctx.value += 1;
		pushTrace(this.ctx, 'handler:tick');
	}
	goSiblingWest(): void {
		this.transition(LeafWestB);
	}
	goParentWest(): void {
		this.transition(MidWest);
	}
	goAncestorWest(): void {
		this.transition(StackWest);
	}
	goRoot(): void {
		this.transition(DeepTop);
	}
	goSelfWest(): void {
		this.transition(LeafWestA);
	}
	goCrossToLeafEastB(): void {
		this.transition(LeafEastB);
	}
	goCrossToBranchEast(): void {
		this.transition(StackEast);
	}
	goCrossToMidEast(): void {
		this.transition(MidEast);
	}
	goSiblingEast(): void {
		this.transition(LeafEastA);
	}
	goCrossToLeafWestB(): void {
		this.transition(LeafWestB);
	}
	async goAsyncCrossEast(): Promise<void> {
		pushTrace(this.ctx, 'handler:goAsyncCrossEast:start');
		await this.sleep(10);
		pushTrace(this.ctx, 'handler:goAsyncCrossEast:after-await');
		this.transition(LeafEastA);
	}
	armFailExit(): void {
		this.ctx.failExit = true;
	}
	protected maybeFailExit(stateName: string): void {
		if (this.ctx.failExit) {
			this.ctx.failExit = false;
			throw new Error(`forced exit failure in ${stateName}`);
		}
	}
}

/** West stack — initial branch after create. Depth: StackWest → MidWest → leaf. */
@HsmInitialState
export class StackWest extends DeepTop {
	onEntry(): void {
		pushTrace(this.ctx, 'enter:StackWest');
	}
	onExit(): void {
		this.maybeFailExit('StackWest');
		pushTrace(this.ctx, 'exit:StackWest');
	}
}

@HsmInitialState
export class MidWest extends StackWest {
	onEntry(): void {
		pushTrace(this.ctx, 'enter:MidWest');
	}
	onExit(): void {
		this.maybeFailExit('MidWest');
		pushTrace(this.ctx, 'exit:MidWest');
	}
}

@HsmInitialState
export class LeafWestA extends MidWest {
	onEntry(): void {
		pushTrace(this.ctx, 'enter:LeafWestA');
	}
	onExit(): void {
		this.maybeFailExit('LeafWestA');
		pushTrace(this.ctx, 'exit:LeafWestA');
	}
}

export class LeafWestB extends MidWest {
	onEntry(): void {
		pushTrace(this.ctx, 'enter:LeafWestB');
	}
	onExit(): void {
		this.maybeFailExit('LeafWestB');
		pushTrace(this.ctx, 'exit:LeafWestB');
	}
}

/** East stack — parallel deep branch under the same root. */
export class StackEast extends DeepTop {
	onEntry(): void {
		pushTrace(this.ctx, 'enter:StackEast');
	}
	onExit(): void {
		this.maybeFailExit('StackEast');
		pushTrace(this.ctx, 'exit:StackEast');
	}
}

@HsmInitialState
export class MidEast extends StackEast {
	onEntry(): void {
		pushTrace(this.ctx, 'enter:MidEast');
	}
	onExit(): void {
		this.maybeFailExit('MidEast');
		pushTrace(this.ctx, 'exit:MidEast');
	}
}

@HsmInitialState
export class LeafEastA extends MidEast {
	onEntry(): void {
		pushTrace(this.ctx, 'enter:LeafEastA');
	}
	onExit(): void {
		this.maybeFailExit('LeafEastA');
		pushTrace(this.ctx, 'exit:LeafEastA');
	}
}

export class LeafEastB extends MidEast {
	onEntry(): void {
		pushTrace(this.ctx, 'enter:LeafEastB');
	}
	onExit(): void {
		this.maybeFailExit('LeafEastB');
		pushTrace(this.ctx, 'exit:LeafEastB');
	}
}

export function createDeepMachine() {
	return makeHsm(DeepTop, { trace: [], value: 0, failExit: false });
}

/** After `create()` + `sync()`: outer → inner along `@HsmInitialState` chain. */
export const INIT_TRACE = ['enter:DeepTop', 'enter:StackWest', 'enter:MidWest', 'enter:LeafWestA'];
