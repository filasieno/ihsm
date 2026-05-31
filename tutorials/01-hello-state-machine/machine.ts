import * as ihsm from '../../src';
import * as self from './machine';

export interface DoorCtx {
	openCount: number;
}

export interface DoorProtocol {
	open(): void;
	close(): void;
}

export class DoorTop extends ihsm.TopState<DoorCtx, DoorProtocol> {}

@ihsm.InitialState
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

ihsm.registerStateNames(self); // grabs every exported state automatically

export function createDoor() {
	return ihsm.makeHsm(DoorTop, { openCount: 0 });
}
