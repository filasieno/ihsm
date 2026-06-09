import { FatalErrorState, InitialState, StateClass, TopState, getStateName } from 'ihsm';

export type Cons = StateClass<OracleCtx, Protocol>;

export interface FailTarget {
	readonly stateName: string;
	readonly hook: 'onEntry' | 'onExit';
}

export class OracleCtx {
	fail?: FailTarget;

	maybeHook(stateName: string, hook: 'onEntry' | 'onExit'): void {
		if (this.fail?.stateName === stateName && this.fail.hook === hook) {
			throw new Error(`injected@${stateName}.${hook}`);
		}
	}
}

export interface Protocol {
	prepareAt(state: Cons): void;
	runTransition(to: Cons): void;
	setFailTarget(state: Cons, hook: 'onEntry' | 'onExit'): void;
	clearFail(): void;
}

export class HsmTop extends TopState<OracleCtx, Protocol> implements Protocol {
	prepareAt(state: Cons): void {
		this.transition(state);
	}
	runTransition(to: Cons): void {
		this.transition(to);
	}
	setFailTarget(state: Cons, hook: 'onEntry' | 'onExit'): void {
		this.ctx.fail = { stateName: getStateName(state), hook };
	}
	clearFail(): void {
		this.ctx.fail = undefined;
	}
	onEntry(): void {
		this.ctx.maybeHook('HsmTop', 'onEntry');
	}
	onExit(): void {
		this.ctx.maybeHook('HsmTop', 'onExit');
	}
}

export class A extends HsmTop {
	onEntry(): void {
		this.ctx.maybeHook('A', 'onEntry');
	}
	onExit(): void {
		this.ctx.maybeHook('A', 'onExit');
	}
}

export class A1 extends A {
	onEntry(): void {
		this.ctx.maybeHook('A1', 'onEntry');
	}
	onExit(): void {
		this.ctx.maybeHook('A1', 'onExit');
	}
}

export class A11 extends A1 {
	onEntry(): void {
		this.ctx.maybeHook('A11', 'onEntry');
	}
	onExit(): void {
		this.ctx.maybeHook('A11', 'onExit');
	}
}

export class A111 extends A11 {
	onEntry(): void {
		this.ctx.maybeHook('A111', 'onEntry');
	}
	onExit(): void {
		this.ctx.maybeHook('A111', 'onExit');
	}
}

export class A2 extends A {
	onEntry(): void {
		this.ctx.maybeHook('A2', 'onEntry');
	}
	onExit(): void {
		this.ctx.maybeHook('A2', 'onExit');
	}
}

export class A21 extends A2 {
	onEntry(): void {
		this.ctx.maybeHook('A21', 'onEntry');
	}
	onExit(): void {
		this.ctx.maybeHook('A21', 'onExit');
	}
}

export class A211 extends A21 {
	onEntry(): void {
		this.ctx.maybeHook('A211', 'onEntry');
	}
	onExit(): void {
		this.ctx.maybeHook('A211', 'onExit');
	}
}

export class A2111 extends A211 {
	async onEntry(): Promise<void> {
		this.ctx.maybeHook('A2111', 'onEntry');
	}
	async onExit(): Promise<void> {
		this.ctx.maybeHook('A2111', 'onExit');
	}
}

export class B extends HsmTop {
	onEntry(): void {
		this.ctx.maybeHook('B', 'onEntry');
	}
	onExit(): void {
		this.ctx.maybeHook('B', 'onExit');
	}
}

export class B1 extends B {
	onEntry(): void {
		this.ctx.maybeHook('B1', 'onEntry');
	}
	onExit(): void {
		this.ctx.maybeHook('B1', 'onExit');
	}
}

@InitialState
export class C extends HsmTop {
	onEntry(): void {
		this.ctx.maybeHook('C', 'onEntry');
	}
	onExit(): void {
		this.ctx.maybeHook('C', 'onExit');
	}
}

@InitialState
export class C1 extends C {
	onEntry(): void {
		this.ctx.maybeHook('C1', 'onEntry');
	}
	onExit(): void {
		this.ctx.maybeHook('C1', 'onExit');
	}
}

@InitialState
export class C11 extends C1 {
	onEntry(): void {
		this.ctx.maybeHook('C11', 'onEntry');
	}
	onExit(): void {
		this.ctx.maybeHook('C11', 'onExit');
	}
}

@InitialState
export class C111 extends C11 {
	onEntry(): void {
		this.ctx.maybeHook('C111', 'onEntry');
	}
	onExit(): void {
		this.ctx.maybeHook('C111', 'onExit');
	}
}

@InitialState
export class C1111 extends C111 {
	async onEntry(): Promise<void> {
		this.ctx.maybeHook('C1111', 'onEntry');
	}
	async onExit(): Promise<void> {
		this.ctx.maybeHook('C1111', 'onExit');
	}
}

export const oracleExports = {
	HsmTop,
	A,
	A1,
	A11,
	A111,
	A2,
	A21,
	A211,
	A2111,
	B,
	B1,
	C,
	C1,
	C11,
	C111,
	C1111,
	FatalErrorState,
};
