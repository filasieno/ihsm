import { makeHsm, HsmInitialState, HsmTopState } from '../../src';

export interface TraceCtx {
	log: string[];
}

export interface TraceProtocol {
	goToB(): void;
	goToC(): void;
}

/** Shallow sibling chain — entry/exit order without deep nesting. */
export class TraceTop extends HsmTopState<TraceCtx, TraceProtocol> implements TraceProtocol {
	onEntry(): void {
		this.ctx.log.push('enter:Top');
	}
	onExit(): void {
		this.ctx.log.push('exit:Top');
	}
	goToB(): void {
		this.transition(B);
	}
	goToC(): void {
		this.transition(C);
	}
}

@HsmInitialState
export class A extends TraceTop {
	onEntry(): void {
		this.ctx.log.push('enter:A');
	}
	onExit(): void {
		this.ctx.log.push('exit:A');
	}
}

export class B extends TraceTop {
	onEntry(): void {
		this.ctx.log.push('enter:B');
	}
	onExit(): void {
		this.ctx.log.push('exit:B');
	}
}

export class C extends TraceTop {
	onEntry(): void {
		this.ctx.log.push('enter:C');
	}
}

export function createTracer() {
	return makeHsm(TraceTop, { log: [] });
}
