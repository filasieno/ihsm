/**
 * Shallow hierarchy — A → B → C siblings under TraceTop.
 *
 * Use this file to learn entry/exit order before the deep machine in machine.ts.
 * LCA for A→B and B→C is TraceTop; root onExit/onEntry do not repeat.
 */
import * as ihsm from '../../src';
import { makeTestActor } from '../../src/testing';
import { PlaygroundTopState } from '../shared/playground-top';

export interface TraceCtx {
	log: string[];
}

export interface TraceConfig {
	context: TraceCtx;
	notifications: {
		goToB(): void;
		goToC(): void;
	};
}

/** Shallow sibling chain — entry/exit order without deep nesting. */
export class TraceTop extends PlaygroundTopState<TraceConfig> {
	onEntry(): void {
		this.ctx.log.push('enter:Top');
	}
	onExit(): void {
		this.ctx.log.push('exit:Top');
	}
	goToB(): void {
		this.hsm.transition(B);
	}
	goToC(): void {
		this.hsm.transition(C);
	}
}

@ihsm.InitialState
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
	return makeTestActor(TraceTop, { log: [] }, new ihsm.Port());
}
