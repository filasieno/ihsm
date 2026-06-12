import { FatalErrorState, StateClass } from '../';
import { HsmWithTracing, Transition } from '../internal/defs.private';
import { executeTransitionRoutine, planTransitionClasses } from '../internal/transition-routines';
import { getTransitionKey } from '../internal/utils';

/** Pluggable transition routine resolution (runtime default or generated table). */
export interface TransitionResolver<Context = unknown, Protocol extends object = object> {
	resolve(src: StateClass<Context, Protocol>, dest: StateClass<Context, Protocol>): Transition<Context, Protocol>;
}

class RuntimeTransitionRoutine<Context, Protocol extends object> implements Transition<Context, Protocol> {
	constructor(
		private readonly plan: ReturnType<typeof planTransitionClasses<Context, Protocol>>,
	) {}

	async execute(hsm: HsmWithTracing<Context, Protocol>, srcState: StateClass<Context, Protocol>, dstState: StateClass<Context, Protocol>): Promise<void> {
		await executeTransitionRoutine(hsm, hsm._instance, this.plan, srcState, dstState, {
			style: 'production',
			setCurrentState: state => {
				hsm.currentState = state;
			},
		});
	}
}

/** Default resolver — compute on first use, cache per machine instance. */
export class RuntimeTransitionResolver<Context, Protocol extends object> implements TransitionResolver<Context, Protocol> {
	private readonly cache = new Map<string, Transition<Context, Protocol>>();

	resolve(src: StateClass<Context, Protocol>, dest: StateClass<Context, Protocol>): Transition<Context, Protocol> {
		const key = getTransitionKey(src, dest);
		let routine = this.cache.get(key);
		if (routine === undefined) {
			routine = new RuntimeTransitionRoutine(planTransitionClasses(src, dest));
			this.cache.set(key, routine);
		}
		return routine;
	}
}

/** Execute a pending transition via the resolver; mirrors v1 `doTransition` error handling. */
export async function executePendingTransition<Context, Protocol extends object>(
	host: HsmWithTracing<Context, Protocol>,
	resolver: TransitionResolver<Context, Protocol>,
): Promise<void> {
	if (host._transitionState === undefined) return;
	try {
		const srcState = host.currentState;
		const destState = host._transitionState;
		try {
			await resolver.resolve(srcState, destState).execute(host, srcState, destState);
		} catch (transitionError) {
			host.currentState = FatalErrorState;
			throw transitionError;
		}
	} finally {
		host._transitionState = undefined;
	}
}
