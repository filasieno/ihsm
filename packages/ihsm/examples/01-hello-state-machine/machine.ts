/**
 * Hello state machine — minimal open/closed door.
 *
 * Teaches: DoorCtx, DoorProtocol, TopState root, @InitialState, transition()
 * between sibling states, registerStateNames, makeHsm factory.
 */
import * as ihsm from '../../src';
import { PlaygroundTopState } from '../shared/playground-top';
import * as self from './machine';

/** Mutable data owned by the actor for its whole lifetime. */
export interface DoorCtx {
	/** How many times the door has been opened (survives open ↔ closed). */
	openCount: number;
}

/** Event vocabulary — method names must match post('…') strings at compile time. */
export interface DoorProtocol {
	open(): void;
	close(): void;
}

/** Root state: inherits run-to-completion dispatch, transition(), and tracing from TopState. */
export class DoorTop extends PlaygroundTopState<DoorCtx, DoorProtocol> {}

/** Initial leaf after makeHsm + sync — door starts closed. */
@ihsm.InitialState
export class Closed extends DoorTop {
	open(): void {
		this.ctx.openCount += 1;
		// External transition: exit Closed, enter Open (LCA = DoorTop).
		this.transition(Open);
	}
}

export class Open extends DoorTop {
	close(): void {
		this.transition(Closed);
	}
}

// Last statement: register export keys as stable display names (minified builds).
ihsm.registerStateNames(self);

/** Factory used by tests, interactive panel, and application code. */
export function createDoor() {
	return ihsm.makeHsm(DoorTop, { openCount: 0 });
}
