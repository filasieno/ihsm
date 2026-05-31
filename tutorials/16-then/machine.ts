import { makeHsm, HsmInitialState, HsmTopState } from '../../src';

export type RouteKind = 'local' | 'remote';

export interface RouteCtx {
	grams: number;
	localLimitGrams: number;
	route: RouteKind | '';
	audit: string[];
}

export interface RouteProtocol {
	weigh(grams: number): void;
}

export class RouteTop extends HsmTopState<RouteCtx, RouteProtocol> implements RouteProtocol {
	weigh(grams: number): void {
		this.ctx.grams = grams;
		this.ctx.audit.push('weighed');
		this.transition(Checking);
	}
}

/** Decision pseudo state — branches in `then()` once entered. */
export class Checking extends RouteTop {
	then(): void {
		this.ctx.audit.push('decide');
		if (this.ctx.grams <= this.ctx.localLimitGrams) {
			this.transition(LocalDelivery);
		} else {
			this.transition(RemoteDelivery);
		}
	}
}

export class LocalDelivery extends RouteTop {
	onEntry(): void {
		this.ctx.route = 'local';
		this.ctx.audit.push('local');
	}
}

export class RemoteDelivery extends RouteTop {
	onEntry(): void {
		this.ctx.route = 'remote';
		this.ctx.audit.push('remote');
	}
}

@HsmInitialState
export class Idle extends RouteTop {}

export function createRouter(localLimitGrams: number) {
	return makeHsm(RouteTop, {
		grams: 0,
		localLimitGrams,
		route: '',
		audit: [],
	});
}
