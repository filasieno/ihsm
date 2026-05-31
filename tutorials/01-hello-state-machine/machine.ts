import { makeHsm, HsmInitialState, HsmTopState } from '../../src';

export interface DoorCtx {
	openCount: number;
}

export interface DoorProtocol {
	open(): void;
	close(): void;
}

export class DoorTop extends HsmTopState<DoorCtx, DoorProtocol> {}

@HsmInitialState
export class Closed extends DoorTop {
	open(): void {
		this.ctx.openCount += 1;
		this.transition(Open);
	}
}

export class Open extends DoorTop {
	close(): void {
		this.transition(Closed);
	}
}

export function createDoor() {
	return makeHsm(DoorTop, { openCount: 0 });
}
