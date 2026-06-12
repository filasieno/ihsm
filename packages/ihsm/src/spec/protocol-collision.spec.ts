import { expect } from 'chai';
import 'mocha';

import { InitialState, Port, ProtocolCollisionError, TopState, buildProtocolIndex, makeOwnerActor, manifestFor, registerStateNames } from '../';
import type { Config } from '../';

interface CollisionConfig extends Config {
	context: Record<string, never>;
	services: { ping(): Promise<void> };
	notifications: { tick(): void };
	internalServices: { init(): Promise<void> };
	internalNotifications: { onData(chunk: string): void };
}

const collisionManifest = manifestFor<CollisionConfig>({
	services: ['ping'],
	notifications: ['tick'],
	internalServices: ['init'],
	internalNotifications: ['onData'],
});

class CollisionTop extends TopState {
	static readonly manifest = collisionManifest;
	declare readonly __ihsm: CollisionConfig;
	ping(): void {}
	tick(): void {}
	init(): void {}
	onData(): void {}
}

@InitialState
class CollisionLeaf extends CollisionTop {}

interface DuplicateConfig extends Config {
	services: { dup(): Promise<void> };
	notifications: { dup(): void };
}

const duplicateManifest = manifestFor<DuplicateConfig>({
	services: ['dup'],
	notifications: ['dup'],
	internalServices: [],
	internalNotifications: [],
});

class DuplicateTop extends TopState {
	static readonly manifest = duplicateManifest;
	dup(): void {}
}

interface ReservedConfigKeyConfig extends Config {
	services: { ctx(): Promise<void> };
}

const reservedKeyManifest = manifestFor<ReservedConfigKeyConfig>({
	services: ['ctx'],
	notifications: [],
	internalServices: [],
	internalNotifications: [],
});

class ReservedKeyTop extends TopState {
	static readonly manifest = reservedKeyManifest;
	ctx(): void {}
}

class ReservedStateTop extends TopState {
	ctx(): void {}
}

@InitialState
class ReservedStateLeaf extends ReservedStateTop {}

const hookManifest = manifestFor<{ services: { ping(): Promise<void> } }>({
	services: ['ping'],
	notifications: [],
	internalServices: [],
	internalNotifications: [],
});

class HookTop extends TopState {
	static readonly manifest = hookManifest;
	onEntry(): void {}
	ping(): void {}
}

@InitialState
class HookLeaf extends HookTop {}

class MissingHandlerTop extends TopState {
	static readonly manifest = collisionManifest;
	declare readonly __ihsm: CollisionConfig;
}

registerStateNames({
	CollisionTop,
	CollisionLeaf,
	DuplicateTop,
	ReservedKeyTop,
	ReservedStateTop,
	ReservedStateLeaf,
	HookTop,
	HookLeaf,
	MissingHandlerTop,
});

describe('protocol-collision (v2)', function (): void {
	it('throws on duplicate keys across buckets in manifest', () => {
		expect(() => buildProtocolIndex(DuplicateTop, duplicateManifest)).to.throw(ProtocolCollisionError, /more than one Config bucket/);
	});

	it('throws on reserved symbol as Config key', () => {
		expect(() => buildProtocolIndex(ReservedKeyTop, reservedKeyManifest)).to.throw(ProtocolCollisionError, /reserved symbol "ctx"/);
	});

	it('throws when a state class defines a reserved symbol method', () => {
		const manifest = manifestFor<{ services: { work(): Promise<void> } }>({
			services: ['work'],
			notifications: [],
			internalServices: [],
			internalNotifications: [],
		});
		class BadTop extends TopState {
			static readonly manifest = manifest;
			ctx(): void {}
			work(): void {}
		}
		class ReservedStateWithManifest extends TopState {
			static readonly manifest = manifest;
			ctx(): void {}
			work(): void {}
		}
		expect(() => buildProtocolIndex(BadTop, manifest)).to.throw(ProtocolCollisionError, /reserved symbol "ctx"/);
		expect(() => makeOwnerActor(ReservedStateWithManifest as never, {}, new Port())).to.throw(ProtocolCollisionError, /ReservedStateWithManifest/);
	});

	it('allows lifecycle hooks implemented as hooks', () => {
		expect(() => buildProtocolIndex(HookTop, hookManifest)).not.to.throw();
		const actor = makeOwnerActor(HookTop as never, {}, new Port());
		expect(actor).to.exist;
	});

	it('throws when Config key has no handler on the state graph', () => {
		const manifest = manifestFor<{ services: { orphan(): Promise<void> } }>({
			services: ['orphan'],
			notifications: [],
			internalServices: [],
			internalNotifications: [],
		});
		expect(() => buildProtocolIndex(MissingHandlerTop, manifest)).to.throw(ProtocolCollisionError, /no handler on the state graph/);
	});

	it('throws when handler is not declared on Config', () => {
		class ExtraTop extends TopState {
			extra(): void {}
		}
		expect(() => buildProtocolIndex(ExtraTop, hookManifest)).to.throw(ProtocolCollisionError, /not declared on Config/);
	});

	it('constructs when manifest and handlers align', () => {
		const actor = makeOwnerActor(CollisionTop as never, {}, new Port());
		expect(actor).to.exist;
	});
});
