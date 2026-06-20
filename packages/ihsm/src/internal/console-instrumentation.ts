/**
 * Basic console signal output — a zero-dependency {@link Instrumentation} for development.
 *
 * `ihsm` itself has no OpenTelemetry dependency: observability is driven entirely by the optional
 * {@link Instrumentation} callback surface passed to `makeActor(..., { instrumentation })`. This
 * built-in implementation prints those signals to the console so users who do not want OTEL still
 * get out-of-the-box visibility. The richer OpenTelemetry bridge lives in the separate
 * `@ihsm/otel` package and consumes the very same callbacks.
 */

import type { ActorIdentity, DispatchError, EnqueueInfo, Instrumentation, LogRecord, MacrostepBegin, MacrostepEnd, MicrostepBegin, MicrostepEnd } from './types';

export interface ConsoleInstrumentationOptions {
	/** Sink for each formatted line. Defaults to `console.log`. */
	readonly write?: (line: string) => void;
	/** Prefix prepended to every line. Defaults to `'ihsm'`. */
	readonly prefix?: string;
	/** Emit microstep begin/end and enqueue signals (verbose). Defaults to `true`. */
	readonly microsteps?: boolean;
	/** Emit `hsm.log.*` records. Defaults to `true`. */
	readonly logs?: boolean;
}

function shortUuid(uuid: string): string {
	return uuid.length >= 8 ? uuid.slice(0, 8) : uuid;
}

/**
 * Build a dependency-free {@link Instrumentation} that prints actor signals to the console.
 *
 * Register it globally so tracing stays a cross-cutting concern — actor construction takes no
 * tracing argument and every actor spawned afterwards is traced.
 *
 * @example
 * ```ts
 * import { createConsoleInstrumentation, registerCollector, makeActor, Port } from 'ihsm';
 * registerCollector(createConsoleInstrumentation());
 * const actor = makeActor(Top, ctx, { initialize: true });
 * ```
 */
export function createConsoleInstrumentation(options: ConsoleInstrumentationOptions = {}): Instrumentation {
	const write = options.write ?? ((line: string): void => console.log(line));
	const prefix = options.prefix ?? 'ihsm';
	const microsteps = options.microsteps ?? true;
	const logs = options.logs ?? true;
	const emit = (msg: string, actor = ''): void => write(actor.length > 0 ? `[${prefix}] ${actor} ${msg}` : `[${prefix}] ${msg}`);

	const instrumentation: Instrumentation = {
		onActorCreated(id: ActorIdentity): void {
			emit(`+ actor ${id.path} (${id.kind})`, shortUuid(id.uuid));
		},
		onActorDisposed(id: ActorIdentity): void {
			emit(`- actor ${id.path}`, shortUuid(id.uuid));
		},
		onMacrostepBegin(info: MacrostepBegin): void {
			emit(`\u25b6 macrostep ${info.id} ${info.triggerKind}:${info.trigger} @${info.startState}`, shortUuid(info.actor.uuid));
		},
		onMacrostepEnd(info: MacrostepEnd): void {
			emit(`\u25a0 macrostep ${info.id} \u2192 ${info.endState} (${info.steps} step(s), ${info.outcome})`);
		},
		onError(info: DispatchError): void {
			emit(`\u2716 ${info.phase} ${info.errorClass}: ${info.error.message}${info.recovered ? ' (recovered)' : ''}`);
		},
	};

	if (microsteps) {
		instrumentation.onMicrostepBegin = (info: MicrostepBegin): void => {
			emit(`  \u00b7 #${info.seq} ${info.event} [${info.bucket}/${info.queue}] @${info.fromState}`);
		};
		instrumentation.onMicrostepEnd = (info: MicrostepEnd): void => {
			emit(`  \u00b7 #${info.seq} \u2192 ${info.toState}${info.transitioned ? ' (transition)' : ''} ${info.outcome}`);
		};
		instrumentation.onEnqueue = (info: EnqueueInfo): void => {
			emit(`  \u21b3 enqueue ${info.event} [${info.queue}]${info.delayMs !== undefined ? ` +${info.delayMs}ms` : ''}`);
		};
	}

	if (logs) {
		instrumentation.onLog = (record: LogRecord): void => {
			const attrs = record.attributes !== undefined && Object.keys(record.attributes).length > 0 ? ` ${JSON.stringify(record.attributes)}` : '';
			emit(`  [${record.severity}] ${record.body}${attrs}`);
		};
	}

	return instrumentation;
}
