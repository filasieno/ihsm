import { Hsm, StateClass, TraceLevel, TraceWriter, makeHsm } from '../../src';

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

export function withTrace<Context, Protocol extends {} | undefined>(topState: StateClass<Context, Protocol>, ctx: Context, initialize = true): { sm: Hsm<Context, Protocol>; writer: CollectingTraceWriter } {
	const writer = new CollectingTraceWriter();
	const sm = makeHsm(topState, ctx, initialize, TraceLevel.VERBOSE_DEBUG, writer);
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
