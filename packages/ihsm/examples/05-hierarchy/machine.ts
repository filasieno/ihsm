/**
 * Deep hierarchy — two stacks under DeepTop; every transition topology from tutorial 05.
 *
 * Handlers on DeepTop; ctx.trace records enter/exit/handler lines. Playground uses this file.
 * Pair with trace-sibling.ts for a shallow A→B→C chain first.
 */
import * as ihsm from '../../src';
import { makeTestActor } from '../../src/testing';
import { PlaygroundTopState } from '../shared/playground-top';
import * as self from './machine';

export interface DeepCtx {
	trace: string[];
	value: number;
	/** When true, the next onExit that runs throws (for error demos). */
	failExit: boolean;
}

export interface DeepConfig {
	context: DeepCtx;
notifications: {
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
	};
}


function pushTrace(ctx: DeepCtx, line: string): void {
	ctx.trace.push(line);
}

/** Root — LCA for every cross-stack transition. */
export class DeepTop extends PlaygroundTopState<DeepConfig> {

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
		this.hsm.transition(LeafWestB);
	}
	goParentWest(): void {
		this.hsm.transition(MidWest);
	}
	goAncestorWest(): void {
		this.hsm.transition(StackWest);
	}
	goRoot(): void {
		this.hsm.transition(DeepTop);
	}
	goSelfWest(): void {
		this.hsm.transition(LeafWestA);
	}
	goCrossToLeafEastB(): void {
		this.hsm.transition(LeafEastB);
	}
	goCrossToBranchEast(): void {
		this.hsm.transition(StackEast);
	}
	goCrossToMidEast(): void {
		this.hsm.transition(MidEast);
	}
	goSiblingEast(): void {
		this.hsm.transition(LeafEastA);
	}
	goCrossToLeafWestB(): void {
		this.hsm.transition(LeafWestB);
	}
	async goAsyncCrossEast(): Promise<void> {
		pushTrace(this.ctx, 'handler:goAsyncCrossEast:start');
		await new Promise<void>(resolve => (this.hsm.port as unknown as ihsm.Port).setTimeout(resolve, 10));
		pushTrace(this.ctx, 'handler:goAsyncCrossEast:after-await');
		this.hsm.transition(LeafEastA);
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
@ihsm.InitialState
export class StackWest extends DeepTop {
	onEntry(): void {
		pushTrace(this.ctx, 'enter:StackWest');
	}
	onExit(): void {
		this.maybeFailExit('StackWest');
		pushTrace(this.ctx, 'exit:StackWest');
	}
}

@ihsm.InitialState
export class MidWest extends StackWest {
	onEntry(): void {
		pushTrace(this.ctx, 'enter:MidWest');
	}
	onExit(): void {
		this.maybeFailExit('MidWest');
		pushTrace(this.ctx, 'exit:MidWest');
	}
}

@ihsm.InitialState
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

@ihsm.InitialState
export class MidEast extends StackEast {
	onEntry(): void {
		pushTrace(this.ctx, 'enter:MidEast');
	}
	onExit(): void {
		this.maybeFailExit('MidEast');
		pushTrace(this.ctx, 'exit:MidEast');
	}
}

@ihsm.InitialState
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
	return makeTestActor(DeepTop, { trace: [], value: 0, failExit: false }, new ihsm.Port());
}

/** After `create()` + `sync()`: outer → inner along `@ihsm.InitialState` chain. */
export const INIT_TRACE = ['enter:DeepTop', 'enter:StackWest', 'enter:MidWest', 'enter:LeafWestA'];

// Registered last so every export (including the const above) is initialized
// before the namespace is enumerated — avoids a TDZ error under strict bundlers.
ihsm.registerStateNames(self); // grabs every exported state automatically
