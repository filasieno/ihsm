/**
 * Hello state machine — minimal open/closed door.
 *
 * Teaches: DoorCtx, Door, TopState root, @InitialState, hsm.transition()
 * between sibling states, registerStateNames, makeActor factory.
 */
import * as ihsm from '../../src';
import { makeTestActor } from '../../src/testing';
import { PlaygroundTopState } from '../shared/playground-top';
import * as self from './machine';

/** Mutable data owned by the actor for its whole lifetime. */
export interface DoorCtx {
	/** How many times the door has been opened (survives open ↔ closed). */
	openCount: number;
}

export interface DoorConfig {
	context: DoorCtx;
	notifications: {
		open(): void;
		close(): void;
	};
}

/** Root state: inherits run-to-completion dispatch, transition(), and tracing from TopState. */
export class DoorTop extends PlaygroundTopState<DoorConfig> {}

/** Initial leaf after makeActor + sync — door starts closed. */
@ihsm.InitialState
export class Closed extends DoorTop {
	open(): void {
		this.ctx.openCount += 1;
		// External transition: exit Closed, enter Open (LCA = DoorTop).
		this.hsm.transition(Open);
	}
}

export class Open extends DoorTop {
	close(): void {
		this.hsm.transition(Closed);
	}
}

// Last statement: register export keys as stable display names (minified builds).
ihsm.registerStateNames(self);

/** Factory used by tests, interactive panel, and application code. */
export function createDoor() {
	return makeTestActor(DoorTop, { openCount: 0 }, new ihsm.Port());
}
