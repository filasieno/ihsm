import type { Instrumentation } from 'ihsm/types';

import type { OtelSignal } from './signals';

export interface SignalCollector {
	readonly signals: OtelSignal[];
	readonly instrumentation: Instrumentation;
	reset(): void;
}

/** Append-only `OtelSignal` list wired to ihsm `Instrumentation` (spec §6.2.1). */
export function createIhsmSignalCollector(): SignalCollector {
	const signals: OtelSignal[] = [];
	const t0: number = Date.now();
	let currentActorUuid: string = '';
	const at = (): number => Date.now() - t0;

	const instrumentation: Instrumentation = {
		onActorCreated(actor): void {
			currentActorUuid = actor.uuid;
			signals.push({ kind: 'actor.created', at: at(), actor });
		},
		onActorDisposed(actor): void {
			signals.push({ kind: 'actor.disposed', at: at(), actor });
		},
		onMacrostepBegin(info): void {
			signals.push({ kind: 'macrostep.begin', at: at(), ...info });
		},
		onMacrostepEnd(info): void {
			signals.push({ kind: 'macrostep.end', at: at(), ...info });
		},
		onMicrostepBegin(info): void {
			signals.push({ kind: 'microstep.begin', at: at(), ...info });
		},
		onMicrostepEnd(info): void {
			signals.push({ kind: 'microstep.end', at: at(), ...info });
		},
		onEnqueue(info): void {
			signals.push({ kind: 'enqueue', at: at(), ...info });
		},
		onError(info): void {
			signals.push({ kind: 'dispatch.error', at: at(), actorUuid: currentActorUuid, ...info });
		},
		onLog(record): void {
			signals.push({ kind: 'log', at: at(), actorUuid: currentActorUuid, record });
		},
	};

	return {
		signals,
		instrumentation,
		reset(): void {
			signals.length = 0;
			currentActorUuid = '';
		},
	};
}

/**
 * Await true actor quiescence.
 *
 * A macrostep closes at the runtime's queue-drain point, which (by microtask
 * ordering) lands one tick *after* `hsm.sync()` resolves. Tests must therefore
 * wait until no further signals are produced across a full macrotask tick —
 * this is the deterministic proxy for "actor reached stability" and guarantees
 * the closing `macrostep.end` (and the macrostep boundary reset) is observed.
 */
export async function settle(collector: SignalCollector, maxTicks: number = 1000): Promise<void> {
	for (let tick: number = 0; tick < maxTicks; ++tick) {
		const before: number = collector.signals.length;
		await new Promise<void>(resolve => setTimeout(resolve, 0));
		if (collector.signals.length === before) return;
	}
}
