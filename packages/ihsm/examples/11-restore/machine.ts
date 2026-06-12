/**
 * restore — suspend/resume session without init entry/exit.
 *
 * Teaches: makeOwnerActor(..., { initialize: false }), hsm.restore(StateClass, ctx), JSON persistence helpers.
 */
import * as ihsm from '../../src';
import { PlaygroundTopState } from '../shared/playground-top';
import * as self from './machine';

export interface SessionCtx {
	userId: string;
	lastPage: string;
	/** Records onEntry calls — stays empty when restored from a snapshot. */
	entryLog: string[];
}

export interface SessionConfig extends ihsm.Config {
	context: SessionCtx;
	notifications: {
		navigate(page: string): void;
	};
}

const sessionManifest = ihsm.manifestFor<SessionConfig>({
	services: [],
	notifications: ['navigate'],
	internalServices: [],
	internalNotifications: [],
});

export class SessionTop extends PlaygroundTopState<SessionConfig> {
	static readonly manifest = sessionManifest;
	declare readonly __ihsm: SessionConfig;

	navigate(page: string): void {
		this.ctx.lastPage = page;
	}
}

@ihsm.InitialState
export class Anonymous extends SessionTop {
	onEntry(): void {
		this.ctx.entryLog.push('Anonymous');
	}
}

export class Authenticated extends SessionTop {
	onEntry(): void {
		this.ctx.entryLog.push('Authenticated');
	}
}

/** Map persisted state names back to state classes after JSON parse. */
export const SESSION_STATES = {
	Anonymous,
	Authenticated,
} as const;

export type SessionStateName = keyof typeof SESSION_STATES;

/** JSON-serializable row — what you store in a DB column or file. */
export interface PersistedSession {
	stateName: SessionStateName;
	ctx: SessionCtx;
}

/** In-memory stand-in for disk / DB (session id → JSON payload). */
export const sessionDb = new Map<string, string>();

ihsm.registerStateNames(self);

export function createSession(userId: string) {
	return ihsm.makeOwnerActor(SessionTop, { userId, lastPage: 'home', entryLog: [] }, new ihsm.Port());
}

function stateNameOf(sm: ihsm.OwnerActor<SessionConfig>): SessionStateName {
	const name = sm.hsm.currentStateName as SessionStateName;
	if (!(name in SESSION_STATES)) {
		throw new Error(`unknown active state: ${name}`);
	}
	return name;
}

/** Serialize active state + ctx to a JSON string (file or DB column). */
export function suspendSession(sm: ihsm.OwnerActor<SessionConfig>): string {
	const payload: PersistedSession = {
		stateName: stateNameOf(sm),
		ctx: { ...sm.ctx, entryLog: [...sm.ctx.entryLog] },
	};
	return JSON.stringify(payload);
}

/** Parse JSON and hydrate a **new** machine instance — no init entry/exit. */
export function resumeSession(json: string) {
	const { stateName, ctx } = JSON.parse(json) as PersistedSession;
	const stateClass = SESSION_STATES[stateName];
	const sm = ihsm.makeOwnerActor(SessionTop as ihsm.TopStateArg<SessionConfig>, { userId: '', lastPage: '', entryLog: [] }, new ihsm.Port(), {
		initialize: false,
	});
	(sm.hsm as ihsm.OwnerActorHsm<SessionConfig>).restore(stateClass, ctx);
	return sm;
}

export function suspendSessionToDb(sessionId: string, sm: ihsm.OwnerActor<SessionConfig>): void {
	sessionDb.set(sessionId, suspendSession(sm));
}

export function resumeSessionFromDb(sessionId: string) {
	const json = sessionDb.get(sessionId);
	if (!json) {
		throw new Error(`session not found: ${sessionId}`);
	}
	return resumeSession(json);
}
