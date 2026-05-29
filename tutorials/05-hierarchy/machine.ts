import { HsmFactory, HsmInitialState, HsmTopState } from '../../src';

export interface DeepCtx {
	trace: string[];
	value: number;
	/** When true, the next onExit that runs throws (for error demos). */
	failExit: boolean;
}

export interface DeepProtocol {
	tick(): void;
	goSibling(): void;
	goParent(): void;
	goAncestor(): void;
	goRoot(): void;
	goCrossBranch(): void;
	goComposite(): void;
	goAsyncCross(): void;
	goSelf(): void;
	armFailExit(): void;
}

function pushTrace(ctx: DeepCtx, line: string): void {
	ctx.trace.push(line);
}

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
	goSibling(): void {
		this.transition(LeafSouthB);
	}
	goParent(): void {
		this.transition(MidSouth);
	}
	goAncestor(): void {
		this.transition(BranchSouth);
	}
	goRoot(): void {
		this.transition(DeepTop);
	}
	goCrossBranch(): void {
		this.transition(LeafNorthB);
	}
	goComposite(): void {
		this.transition(BranchEast);
	}
	async goAsyncCross(): Promise<void> {
		pushTrace(this.ctx, 'handler:goAsyncCross:start');
		await this.sleep(10);
		pushTrace(this.ctx, 'handler:goAsyncCross:after-await');
		this.transition(LeafNorthA);
	}
	goSelf(): void {
		this.transition(LeafSouthA);
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

/** South branch — initial branch after create (DeepTop → BranchSouth → …). */
@HsmInitialState
export class BranchSouth extends DeepTop {
	onEntry(): void {
		pushTrace(this.ctx, 'enter:BranchSouth');
	}
	onExit(): void {
		this.maybeFailExit('BranchSouth');
		pushTrace(this.ctx, 'exit:BranchSouth');
	}
}

@HsmInitialState
export class MidSouth extends BranchSouth {
	onEntry(): void {
		pushTrace(this.ctx, 'enter:MidSouth');
	}
	onExit(): void {
		this.maybeFailExit('MidSouth');
		pushTrace(this.ctx, 'exit:MidSouth');
	}
}

@HsmInitialState
export class LeafSouthA extends MidSouth {
	onEntry(): void {
		pushTrace(this.ctx, 'enter:LeafSouthA');
	}
	onExit(): void {
		this.maybeFailExit('LeafSouthA');
		pushTrace(this.ctx, 'exit:LeafSouthA');
	}
}

export class LeafSouthB extends MidSouth {
	onEntry(): void {
		pushTrace(this.ctx, 'enter:LeafSouthB');
	}
	onExit(): void {
		this.maybeFailExit('LeafSouthB');
		pushTrace(this.ctx, 'exit:LeafSouthB');
	}
}

/** North branch — different subtree under the same root (cross-ancestor target). */
export class BranchNorth extends DeepTop {
	onEntry(): void {
		pushTrace(this.ctx, 'enter:BranchNorth');
	}
	onExit(): void {
		this.maybeFailExit('BranchNorth');
		pushTrace(this.ctx, 'exit:BranchNorth');
	}
}

@HsmInitialState
export class MidNorth extends BranchNorth {
	onEntry(): void {
		pushTrace(this.ctx, 'enter:MidNorth');
	}
	onExit(): void {
		this.maybeFailExit('MidNorth');
		pushTrace(this.ctx, 'exit:MidNorth');
	}
}

@HsmInitialState
export class LeafNorthA extends MidNorth {
	onEntry(): void {
		pushTrace(this.ctx, 'enter:LeafNorthA');
	}
	onExit(): void {
		this.maybeFailExit('LeafNorthA');
		pushTrace(this.ctx, 'exit:LeafNorthA');
	}
}

export class LeafNorthB extends MidNorth {
	onEntry(): void {
		pushTrace(this.ctx, 'enter:LeafNorthB');
	}
	onExit(): void {
		this.maybeFailExit('LeafNorthB');
		pushTrace(this.ctx, 'exit:LeafNorthB');
	}
}

/** East branch — entering a composite descends to its initial leaf. */
export class BranchEast extends DeepTop {
	onEntry(): void {
		pushTrace(this.ctx, 'enter:BranchEast');
	}
	onExit(): void {
		this.maybeFailExit('BranchEast');
		pushTrace(this.ctx, 'exit:BranchEast');
	}
}

@HsmInitialState
export class LeafEast extends BranchEast {
	onEntry(): void {
		pushTrace(this.ctx, 'enter:LeafEast');
	}
	onExit(): void {
		this.maybeFailExit('LeafEast');
		pushTrace(this.ctx, 'exit:LeafEast');
	}
}

export const deepFactory = new HsmFactory(DeepTop);

export function createDeepMachine(): ReturnType<typeof deepFactory.create> {
	return deepFactory.create({ trace: [], value: 0, failExit: false });
}

/** Expected init trace: outer → inner initial chain. */
export const INIT_TRACE = ['enter:DeepTop', 'enter:BranchSouth', 'enter:MidSouth', 'enter:LeafSouthA'];
