import type { ProcessedSpan, ProcessedTrace } from './signals';

/** Conformance failure — dependency-free so the shipped testing module pulls no assertion lib. */
function fail(message: string): never {
	throw new Error(`[ihsm-otel conformance] ${message}`);
}

function assert(condition: boolean, message: string): void {
	if (!condition) fail(message);
}

const TIER1: readonly string[] = ['ihsm.actor.uuid', 'ihsm.actor.name', 'ihsm.state'];

export function assertTier1OnSpan(span: ProcessedSpan): void {
	for (const key of TIER1) {
		assert(Object.prototype.hasOwnProperty.call(span.attributes, key), `span ${span.name} missing ${key}`);
	}
}

export function assertTier1OnEverySpan(trace: ProcessedTrace): void {
	for (const span of trace.spans) {
		assertTier1OnSpan(span);
	}
}

export function assertMacrostepShape(trace: ProcessedTrace, expected: { steps: number; trigger?: string; outcome?: 'ok' | 'error' }): void {
	// The macrostep root span is named `<ActorName>.<handler>`; it is the only span carrying `ihsm.trigger`.
	const root: ProcessedSpan | undefined = trace.spans.find(s => s.attributes['ihsm.trigger'] !== undefined);
	if (root === undefined) fail('missing macrostep root span');
	if (expected.trigger !== undefined) {
		assert(root.attributes['ihsm.trigger'] === expected.trigger, `expected trigger ${expected.trigger}, got ${String(root.attributes['ihsm.trigger'])}`);
	}
	if (expected.outcome !== undefined) {
		assert(root.attributes['ihsm.outcome'] === expected.outcome, `expected outcome ${expected.outcome}, got ${String(root.attributes['ihsm.outcome'])}`);
	}
	const stepSpans: ProcessedSpan[] = trace.spans.filter(s => s.name.startsWith('execute '));
	assert(stepSpans.length === expected.steps, `expected ${expected.steps} step spans, got ${stepSpans.length}`);
	assert(Number(root.attributes['ihsm.steps']) === expected.steps, `root ihsm.steps=${String(root.attributes['ihsm.steps'])} !== ${expected.steps}`);
}

/** Step spans must be ordered by start time (ordering is implicit; no emitted sequence attribute). */
export function assertStepsOrderedByStartTime(trace: ProcessedTrace): void {
	const stepSpans: ProcessedSpan[] = trace.spans.filter(s => s.name.startsWith('execute '));
	for (let i: number = 1; i < stepSpans.length; ++i) {
		assert(stepSpans[i]!.startAt >= stepSpans[i - 1]!.startAt, `step span ${i} starts before previous`);
	}
}

export function assertOneTracePerExternalStimulus(traces: readonly ProcessedTrace[], externalCount: number): void {
	assert(traces.length === externalCount, `expected ${externalCount} traces, got ${traces.length}`);
}

export function findTracesByTrigger(traces: readonly ProcessedTrace[], trigger: string): ProcessedTrace[] {
	return traces.filter(t => t.rootAttributes['ihsm.trigger'] === trigger);
}
