import { InitialState, TopState } from 'ihsm';

export interface DoorCtx {
	openCount: number;
	trace: string[];
}

export interface DoorProtocol {
	open(): void;
	close(): void;
}

export class DoorTop extends TopState<DoorCtx, DoorProtocol> {}

@InitialState
export class Closed extends DoorTop {
	onEntry(): void {
		this.ctx.trace.push('enter:Closed');
	}
	onExit(): void {
		this.ctx.trace.push('exit:Closed');
	}
	open(): void {
		this.transition(Open);
	}
}

export class Open extends DoorTop {
	onEntry(): void {
		this.ctx.trace.push('enter:Open');
	}
	onExit(): void {
		this.ctx.trace.push('exit:Open');
	}
	close(): void {
		this.transition(Closed);
	}
}
