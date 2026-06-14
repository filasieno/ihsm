/**
 * Tutorial 00 — protocol type, generated actor handles, and the `hsm` facade.
 */
import * as ihsm from '../../src';
import { makeTestActor } from '../../src/testing';
import { PlaygroundTopState } from '../shared/playground-top';
import * as self from './machine';

export interface ConnCtx {
	host: string;
	frameCount: number;
}

export interface ConnConfig {
	context: ConnCtx;
	services: {
		fetchFrames(limit: number): Promise<number>;
	};
	notifications: {
		open(host: string): void;
		close(): void;
	};
	internalNotifications: {
		onData(chunk: string): void;
	};
}

export class ConnTop extends PlaygroundTopState<ConnConfig> {
	open(host: string): void {
		this.ctx.host = host;
		this.hsm.transition(Open);
	}

	close(): void {
		this.ctx.host = '';
	}

	onData(chunk: string): void {
		this.ctx.frameCount += chunk.length;
	}

	async fetchFrames(limit: number): Promise<number> {
		return Math.min(this.ctx.frameCount, limit);
	}
}

@ihsm.InitialState
export class Closed extends ConnTop {}

export class Open extends ConnTop {}

ihsm.registerStateNames(self);

export function createConn() {
	return makeTestActor(ConnTop, { host: '', frameCount: 0 }, new ihsm.Port());
}
