import { Hsm, HsmFactory, HsmInitialState, HsmTopState } from '../../src';

export interface SessionCtx {
	userId: string;
	lastPage: string;
	/** Records onEntry calls — stays empty when restored from a snapshot. */
	entryLog: string[];
}

export interface SessionProtocol {
	navigate(page: string): void;
}

export class SessionTop extends HsmTopState<SessionCtx, SessionProtocol> implements SessionProtocol {
	navigate(page: string): void {
		this.ctx.lastPage = page;
	}
}

@HsmInitialState
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

export const sessionFactory = new HsmFactory(SessionTop);

/** In-memory stand-in for disk / DB (session id → JSON payload). */
export const sessionDb = new Map<string, string>();

export function createSession(userId: string) {
	return sessionFactory.create({ userId, lastPage: 'home', entryLog: [] });
}

function stateNameOf(sm: Hsm<SessionCtx, SessionProtocol>): SessionStateName {
	for (const [name, stateClass] of Object.entries(SESSION_STATES) as [SessionStateName, typeof Anonymous][]) {
		if (sm.currentState === stateClass) {
			return name;
		}
	}
	throw new Error(`unknown active state: ${String(sm.currentState.name)}`);
}

/** Serialize active state + ctx to a JSON string (file or DB column). */
export function suspendSession(sm: Hsm<SessionCtx, SessionProtocol>): string {
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
	const sm = sessionFactory.create({ userId: '', lastPage: '', entryLog: [] }, false);
	sm.restore(stateClass, ctx);
	return sm;
}

export function suspendSessionToDb(sessionId: string, sm: Hsm<SessionCtx, SessionProtocol>): void {
	sessionDb.set(sessionId, suspendSession(sm));
}

export function resumeSessionFromDb(sessionId: string) {
	const json = sessionDb.get(sessionId);
	if (!json) {
		throw new Error(`session not found: ${sessionId}`);
	}
	return resumeSession(json);
}
