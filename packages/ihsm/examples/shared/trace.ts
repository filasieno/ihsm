import { TraceLevel, TraceWriter, type ActorOptions, type ActorConfig, type ActorContextOf, type TopStateArg } from '../../src';
import { makeTestActor, type TestActor } from '../../src/testing';

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

export function withTrace<C extends ActorConfig>(
	topState: TopStateArg<C>,
	ctx: ActorContextOf<C>,
	initialize = true,
): { sm: TestActor<C>; writer: CollectingTraceWriter } {
	const writer = new CollectingTraceWriter();
	const options: ActorOptions<C> = {
		initialize,
		traceLevel: TraceLevel.VERBOSE_DEBUG,
		traceWriter: writer,
	};
	const sm = makeTestActor(topState as never, ctx as never, undefined, options);
	return { sm, writer };
}

export function traceText(writer: CollectingTraceWriter): string {
	return writer.lines.join('\n');
}

export function expectTraceMatching(writer: CollectingTraceWriter, patterns: RegExp[]): void {
	const text = traceText(writer);
	for (const pattern of patterns) {
		if (!pattern.test(text)) {
			throw new Error(`trace missing pattern ${pattern}\n---\n${text}`);
		}
	}
}
