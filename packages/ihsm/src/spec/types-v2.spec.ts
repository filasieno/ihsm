import { expect } from 'chai';
import 'mocha';

import type {
	AssertAsyncService,
	Config,
	ConfigServices,
	DisjointConfig,
	ServiceArgs,
	ServiceReply,
	TopStateArg,
} from '../';
import { ReservedNames } from '../';

interface GoodConfig extends Config {
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

type _AllowedMachineryNames = AssertAsyncService<GoodConfig['services']['transition']>;

interface OverlapConfig extends Config {
	services: { ping(): Promise<void> };
	notifications: { ping(): void };
}

// @ts-expect-error overlapping keys across protocol buckets
type _OverlapFails = DisjointConfig<OverlapConfig>;

interface ReservedCtxConfig extends Config {
	services: { ctx(): Promise<void> };
}

// @ts-expect-error reserved symbol ctx on Config
type _ReservedCtxFails = DisjointConfig<ReservedCtxConfig>;

interface ReservedHsmConfig extends Config {
	notifications: { hsm(): void };
}

// @ts-expect-error reserved symbol hsm on Config
type _ReservedHsmFails = DisjointConfig<ReservedHsmConfig>;

interface ReservedHookConfig extends Config {
	services: { onEntry(): Promise<void> };
}

// @ts-expect-error lifecycle hook name on Config
type _ReservedHookFails = DisjointConfig<ReservedHookConfig>;

interface SyncServiceConfig extends Config {
	services: { bad(): string };
}

type _SyncServiceCheck = AssertAsyncService<SyncServiceConfig['services']['bad']>;

type _FetchArgs = ServiceArgs<GoodConfig['services'], 'fetch'>;
type _FetchReply = ServiceReply<GoodConfig['services'], 'fetch'>;
type _VoidReply = ServiceReply<GoodConfig['services'], 'sleep'>;

declare class GoodTop {
	readonly __ihsm: GoodConfig;
}

type _TopArg = TopStateArg<GoodConfig>;

describe('types-v2', function (): void {
	it('exports ReservedNames', () => {
		expect(ReservedNames).to.include('ctx');
		expect(ReservedNames).to.include('hsm');
	});

	it('ServiceReply inference', () => {
		const reply: ServiceReply<GoodConfig['services'], 'fetch'> = 42;
		expect(reply).equals(42);
	});
});
