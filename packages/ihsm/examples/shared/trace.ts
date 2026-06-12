import { TraceLevel, TraceWriter, makeOwnerActor, Port, type ActorOptions, type Config, type ConfigContext, type OwnerActor, type TopStateArg } from '../../src';

/** Mirrors {@link ConsoleTraceWriter} — one line per dispatch step. */
export class CollectingTraceWriter implements TraceWriter {
	readonly lines: string[] = [];

	write(hsm: { traceHeader: string; currentStateName: string }, msg: unknown): void {
		if (typeof msg === 'string') {
			this.lines.push(`${hsm.traceHeader}${hsm.currentStateName}: ${msg}`);
		} else {
			this.lines.push(typeof msg === 'object' ? JSON.stringify(msg) : String(msg));
		}
	}

	clear(): void {
		this.lines.length = 0;
	}
}

export function withTrace<C extends Config>(
	topState: TopStateArg<C>,
	ctx: ConfigContext<C>,
	initialize = true,
): { sm: OwnerActor<C>; writer: CollectingTraceWriter } {
	const writer = new CollectingTraceWriter();
	const options: ActorOptions<C> = {
		initialize,
		traceLevel: TraceLevel.VERBOSE_DEBUG,
		traceWriter: writer,
	};
	const sm = makeOwnerActor(topState, ctx, new Port(), options);
	return { sm, writer };
}

export function traceText(writer: CollectingTraceWriter): string {
	return writer.lines.join('\n');
}

export function expectTraceMatching(writer: CollectingTraceWriter, patterns: RegExp[]): void {
	const text = traceText(writer);
	for (const pattern of patterns) {
		if (!pattern.test(text)) {
			throw new Error(`trace missing ${pattern}:\n${text}`);
		}
	}
}
