import { expect } from 'chai';
import 'mocha';

import { InitialState, Port, TopState, makeActor } from '../';
import type { ChildActor, ExternalActor, ExternalHsm, HandlerHsm, InboundActor } from '../';
import { makeTestActor, TestPort } from '../testing';
import type { TestActor } from '../testing';
import * as self from './embodiments.spec';
import { registerSpecStateNames, traceActorOnPort } from './spec.utils';

//#region ThisTestSpec

interface DemoCtx {
	log: string[];
}

interface DemoConfig {
	context: DemoCtx;
	services: {
		fetch(n: number): Promise<number>;
	};
	notifications: {
		ping(): void;
		go(): void;
	};
	internalServices: {
		secret(): Promise<string>;
	};
	internalNotifications: {
		tick(): void;
	};
}

export class DemoTop extends TopState<DemoConfig> {
	async fetch(n: number): Promise<number> {
		this.ctx.log.push(`fetch:${n}`);
		return n * 2;
	}

	async secret(): Promise<string> {
		return 'shh';
	}

	ping(): void {
		this.ctx.log.push('ping');
	}

	tick(): void {
		this.ctx.log.push('tick');
	}
}

@InitialState
export class Idle extends DemoTop {
	go(): void {
		// Handler embodiment: self-directed facets, transition via hsm.
		this.notify.ping();
		this.notifyNow.tick();
		this.hsm.transition(Busy);
	}
}

export class Busy extends DemoTop {}

registerSpecStateNames(self);
//#endregion

//#region Type-level actor surface gating (load-bearing — compile-time checks for notify/call/hsm split)

type Assert<T extends true> = T;
type Has<O, K extends PropertyKey> = K extends keyof O ? true : false;

// external: public protocol on facets, internal hidden, no transition.
type _ExtCallHasPublic = Assert<Has<ExternalActor<DemoConfig>['call'], 'fetch'>>;
type _ExtNotifyHasPublic = Assert<Has<ExternalActor<DemoConfig>['notify'], 'ping'>>;
type _ExtNotifyNowHasPublic = Assert<Has<ExternalActor<DemoConfig>['notifyNow'], 'ping'>>;
// @ts-expect-error external `call` must not expose internal services
type _ExtCallNoInternal = Assert<Has<ExternalActor<DemoConfig>['call'], 'secret'>>;
// @ts-expect-error external `notify` must not expose internal notifications
type _ExtNotifyNoInternal = Assert<Has<ExternalActor<DemoConfig>['notify'], 'tick'>>;
// @ts-expect-error external hsm must not expose transition
type _ExtHsmNoTransition = Assert<Has<ExternalHsm<DemoConfig>, 'transition'>>;

// handler: self notify facets, transition on hsm, NO call.
type _HandlerHasNotify = Assert<Has<TopState<DemoConfig>, 'notify'>>;
type _HandlerHsmHasTransition = Assert<Has<HandlerHsm<DemoConfig>, 'transition'>>;
// @ts-expect-error a handler cannot call a service on its own machine (deadlock)
type _HandlerNoCall = Assert<Has<TopState<DemoConfig>, 'call'>>;

// inbound / child: internal notifications visible; child `call` adds internal services.
type _InboundNotifyHasInternal = Assert<Has<InboundActor<DemoConfig>['notify'], 'tick'>>;
type _ChildCallHasInternal = Assert<Has<ChildActor<DemoConfig>['call'], 'secret'>>;
type _ChildCallHasPublic = Assert<Has<ChildActor<DemoConfig>['call'], 'fetch'>>;
// @ts-expect-error inbound `call` must not expose internal services
type _InboundCallNoInternal = Assert<Has<InboundActor<DemoConfig>['call'], 'secret'>>;

// No flat protocol surface anywhere — every interaction goes through a facet,
// so `actor.theEvent()` / `actor.theService()` is impossible by construction.
// @ts-expect-error external actor must not expose a flat notification
type _ExtNoFlatNotify = Assert<Has<ExternalActor<DemoConfig>, 'ping'>>;
// @ts-expect-error external actor must not expose a flat service
type _ExtNoFlatCall = Assert<Has<ExternalActor<DemoConfig>, 'fetch'>>;
// @ts-expect-error inbound actor must not expose a flat notification
type _InboundNoFlatNotify = Assert<Has<InboundActor<DemoConfig>, 'ping'>>;
// @ts-expect-error child actor must not expose a flat service
type _ChildNoFlatCall = Assert<Has<ChildActor<DemoConfig>, 'fetch'>>;
// @ts-expect-error handler `this` must not expose a flat notification
type _HandlerNoFlatNotify = Assert<Has<TopState<DemoConfig>, 'ping'>>;

//#endregion

function freshCtx(): DemoCtx {
	return { log: [] };
}

describe('embodiments', function (): void {
	describe('external (makeActor)', function (): void {
		let actor: ExternalActor<DemoConfig>;
		beforeEach(async () => {
			actor = makeActor(DemoTop, freshCtx(), new Port());
			await actor.hsm.sync();
		});

		it('actor.call.<service>() returns a Promise reply', async () => {
			const result = await actor.call.fetch(21);
			expect(result).equals(42);
		});

		it('actor.notify.<event>() is fire-and-forget on the default queue', async () => {
			actor.notify.ping();
			await actor.hsm.sync();
			const result = await actor.call.fetch(1);
			expect(result).equals(2);
		});

		it('actor.notifyNow.<event>() jumps ahead of queued default work', async () => {
			actor.notify.ping();
			actor.notifyNow.ping();
			await actor.hsm.sync();
			// both delivered; ordering verified in handler-dispatch spec
		});
	});

	describe('handler (this)', function (): void {
		it('this.notify / this.notifyNow / this.hsm.transition drive the machine', async () => {
			const ctx = freshCtx();
			const port = new TestPort();
			const actor: TestActor<DemoConfig> = makeTestActor(DemoTop, ctx, port);
			traceActorOnPort(actor, port);
			await actor.hsm.sync();
			actor.notify.go();
			await actor.hsm.sync();
			await actor.hsm.sync();
			expect(ctx.log).to.include('ping');
			expect(ctx.log).to.include('tick');
			expect(actor.hsm.currentStateName).equals('Busy');
		});
	});

	describe('test (makeTestActor)', function (): void {
		it('the test embodiment can call internal services via actor.call', async () => {
			const actor = makeTestActor(DemoTop, freshCtx(), new Port());
			await actor.hsm.sync();
			const secret = await actor.call.secret();
			expect(secret).equals('shh');
		});

		it('the test embodiment can post internal notifications via actor.notify', async () => {
			const ctx = freshCtx();
			const actor = makeTestActor(DemoTop, ctx, new Port());
			await actor.hsm.sync();
			actor.notify.tick();
			await actor.hsm.sync();
			expect(ctx.log).to.include('tick');
		});
	});
});
