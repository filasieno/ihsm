import { HsmFactory, HsmInitialState, HsmTopState } from '../../src';

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

export const doorFactory = new HsmFactory(DoorTop);

export function createDoor(): ReturnType<typeof doorFactory.create> {
	return doorFactory.create({ openCount: 0 });
}
