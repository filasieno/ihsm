import { expect } from 'chai';
import 'mocha';

import type { AssertAsyncService, ActorServicesOf, DisjointActorConfig, ServiceArgs, ServiceReply, TopStateArg } from '../';
import { ReservedNames } from '../internal/runtime';
import * as self from './actor-config.spec';
import { registerSpecStateNames } from './spec.utils';

//#region ThisTestSpec

interface GoodConfig {
	context: { n: number };
	services: {
		transition(value: string): Promise<string>;
		sleep(ms: number): Promise<void>;
		fetch(value: number): Promise<number>;
	};
	notifications: {
		now(): void;
		open(host: string): void;
	};
}

type _AllowedMachineryNames = AssertAsyncService<ActorServicesOf<GoodConfig>['transition']>;

interface OverlapConfig {
	context: Record<string, never>;
	services: { ping(): Promise<void> };
	notifications: { ping(): void };
}

interface ReservedCtxConfig {
	context: Record<string, never>;
	services: { ctx(): Promise<void> };
}

interface ReservedHsmConfig {
	context: Record<string, never>;
	notifications: { hsm(): void };
}

interface ReservedHookConfig {
	context: Record<string, never>;
	services: { onEntry(): Promise<void> };
}

type AssertTrue<T extends true> = T;
// @ts-expect-error overlapping keys across protocol buckets
type _OverlapFails = AssertTrue<DisjointActorConfig<OverlapConfig>>;
// @ts-expect-error reserved symbol ctx on protocol
type _ReservedCtxFails = AssertTrue<DisjointActorConfig<ReservedCtxConfig>>;
// @ts-expect-error reserved symbol hsm on protocol
type _ReservedHsmFails = AssertTrue<DisjointActorConfig<ReservedHsmConfig>>;
// @ts-expect-error lifecycle hook name on protocol
type _ReservedHookFails = AssertTrue<DisjointActorConfig<ReservedHookConfig>>;

interface SyncServiceConfig {
	context: Record<string, never>;
	services: { bad(): string };
}

type _SyncServiceCheck = AssertAsyncService<ActorServicesOf<SyncServiceConfig>['bad']>;

type _FetchArgs = ServiceArgs<ActorServicesOf<GoodConfig>, 'fetch'>;
type _FetchReply = ServiceReply<ActorServicesOf<GoodConfig>, 'fetch'>;
type _VoidReply = ServiceReply<ActorServicesOf<GoodConfig>, 'sleep'>;

type _TopArg = TopStateArg<GoodConfig>;

registerSpecStateNames(self);
//#endregion

describe('actor-config', function (): void {
	it('defines ReservedNames', () => {
		expect(ReservedNames).to.include('ctx');
		expect(ReservedNames).to.include('hsm');
	});

	it('ServiceReply inference', () => {
		const reply: ServiceReply<ActorServicesOf<GoodConfig>, 'fetch'> = 42;
		expect(reply).equals(42);
	});
});
