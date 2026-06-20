import type { AttributeValue, OtelSignal, ProcessedLog, ProcessedSpan, ProcessedSpanEvent, ProcessedSpanLink, ProcessedTelemetry, ProcessedTrace } from './signals';

/** Spans are assembled incrementally across signals, so the reducer works on a mutable view. */
type MutableSpan = { -readonly [K in keyof ProcessedSpan]: ProcessedSpan[K] };

const SEV_MAP: Record<string, ProcessedLog['severity']> = {
	trace: 'TRACE',
	debug: 'DEBUG',
	info: 'INFO',
	warn: 'WARN',
	error: 'ERROR',
	fatal: 'FATAL',
};

/** Build Grafana-like trace/log views from raw signals (spec §6.3). */
export function processSignals(signals: readonly OtelSignal[]): ProcessedTelemetry {
	const spanStarts: Map<string, { signal: Extract<OtelSignal, { kind: 'span.start' }>; span: MutableSpan }> = new Map();
	const tracesByMacrostep: Map<string, { begin: Extract<OtelSignal, { kind: 'macrostep.begin' }>; end?: Extract<OtelSignal, { kind: 'macrostep.end' }>; steps: MutableSpan[] }> = new Map();
	const logs: ProcessedLog[] = [];

	for (const signal of signals) {
		switch (signal.kind) {
			case 'macrostep.begin': {
				tracesByMacrostep.set(signal.id, { begin: signal, steps: [] });
				break;
			}
			case 'macrostep.end': {
				const bucket = tracesByMacrostep.get(signal.id);
				if (bucket !== undefined) bucket.end = signal;
				break;
			}
			case 'microstep.begin': {
				const bucket = tracesByMacrostep.get(signal.macrostepId);
				if (bucket === undefined) break;
				const spanId: string = `${signal.macrostepId}:step:${signal.seq}`;
				const stepSpan: MutableSpan = {
					spanId,
					parentSpanId: `root:${signal.macrostepId}`,
					name: `execute ${signal.event} notification`,
					status: 'unset',
					startAt: signal.at,
					attributes: {
						'ihsm.actor.uuid': bucket.begin.actor.uuid,
						'ihsm.actor.name': bucket.begin.actor.name,
						'ihsm.event': signal.event,
						'ihsm.macrostep.id': signal.macrostepId,
						'ihsm.state': signal.fromState,
						...(signal.handlerState !== undefined ? { 'ihsm.handler.state': signal.handlerState } : {}),
					},
					events: [],
					links: [],
				};
				bucket.steps.push(stepSpan);
				break;
			}
			case 'microstep.end': {
				const bucket = tracesByMacrostep.get(signal.macrostepId);
				if (bucket === undefined) break;
				const spanId: string = `${signal.macrostepId}:step:${signal.seq}`;
				const step: MutableSpan | undefined = bucket.steps.find(s => s.spanId === spanId);
				if (step === undefined) break;
				step.endAt = signal.at;
				step.status = signal.outcome === 'error' ? 'error' : 'ok';
				step.attributes = {
					...step.attributes,
					'ihsm.state': signal.toState,
					'ihsm.async': signal.async,
					'ihsm.transitioned': signal.transitioned,
				};
				break;
			}
			case 'span.start': {
				const span: MutableSpan = {
					spanId: signal.spanId,
					parentSpanId: signal.parentSpanId,
					name: signal.name,
					otelKind: signal.otelKind,
					status: 'unset',
					startAt: signal.at,
					attributes: { ...signal.attributes },
					events: [],
					links: [],
				};
				spanStarts.set(`${signal.traceId}:${signal.spanId}`, { signal, span });
				break;
			}
			case 'span.end': {
				const key: string = `${signal.traceId}:${signal.spanId}`;
				const entry = spanStarts.get(key);
				if (entry === undefined) break;
				entry.span.endAt = signal.at;
				entry.span.status = signal.status;
				if (signal.attributes !== undefined) {
					entry.span.attributes = { ...entry.span.attributes, ...signal.attributes };
				}
				break;
			}
			case 'span.event': {
				const key: string = `${signal.traceId}:${signal.spanId}`;
				const entry = spanStarts.get(key);
				if (entry === undefined) break;
				const ev: ProcessedSpanEvent = { name: signal.name, at: signal.at, attributes: signal.attributes ?? {} };
				entry.span.events.push(ev);
				break;
			}
			case 'span.link': {
				const key: string = `${signal.traceId}:${signal.spanId}`;
				const entry = spanStarts.get(key);
				if (entry === undefined) break;
				const link: ProcessedSpanLink = {
					traceId: signal.linkedTraceId,
					spanId: signal.linkedSpanId,
					attributes: signal.attributes ?? {},
				};
				entry.span.links.push(link);
				break;
			}
			case 'log': {
				logs.push({
					at: signal.at,
					severity: SEV_MAP[signal.record.severity] ?? 'INFO',
					body: signal.record.body,
					labels: {
						ihsm_actor_uuid: signal.actorUuid || undefined,
					},
					attributes: { ...(signal.record.attributes ?? {}) },
				});
				break;
			}
			default:
				break;
		}
	}

	const otlpTraces: ProcessedTrace[] = buildOtlpTraces(spanStarts);
	const seamTraces: ProcessedTrace[] = buildSeamTraces(tracesByMacrostep);
	const traces: ProcessedTrace[] = otlpTraces.length > 0 ? otlpTraces : seamTraces;

	return { traces, logs };
}

function buildSeamTraces(tracesByMacrostep: Map<string, { begin: Extract<OtelSignal, { kind: 'macrostep.begin' }>; end?: Extract<OtelSignal, { kind: 'macrostep.end' }>; steps: MutableSpan[] }>): ProcessedTrace[] {
	const out: ProcessedTrace[] = [];
	for (const [macrostepId, bucket] of tracesByMacrostep) {
		const rootSpanId: string = `root:${macrostepId}`;
		const rootAttributes: Record<string, AttributeValue> = {
			'ihsm.actor.uuid': bucket.begin.actor.uuid,
			'ihsm.actor.name': bucket.begin.actor.name,
			'ihsm.state': bucket.begin.startState,
			'ihsm.macrostep.id': macrostepId,
			'ihsm.trigger': bucket.begin.trigger,
			'ihsm.trigger.kind': bucket.begin.triggerKind,
			'ihsm.state.start': bucket.begin.startState,
		};
		if (bucket.end !== undefined) {
			rootAttributes['ihsm.state.end'] = bucket.end.endState;
			rootAttributes['ihsm.steps'] = bucket.end.steps;
			rootAttributes['ihsm.transitioned'] = bucket.end.transitioned;
			rootAttributes['ihsm.outcome'] = bucket.end.outcome;
		}
		const rootSpan: MutableSpan = {
			spanId: rootSpanId,
			name: bucket.begin.trigger ? `${bucket.begin.actor.name}.${bucket.begin.trigger}` : bucket.begin.actor.name,
			status: bucket.end?.outcome === 'error' ? 'error' : 'ok',
			startAt: bucket.begin.at,
			endAt: bucket.end?.at,
			attributes: rootAttributes,
			events: [],
			links: [],
		};
		const spans: MutableSpan[] = [rootSpan, ...bucket.steps.slice().sort((a, b) => a.startAt - b.startAt)];
		const durationMs: number | undefined = bucket.end !== undefined ? bucket.end.at - bucket.begin.at : undefined;
		out.push({
			traceId: macrostepId,
			rootSpanName: rootSpan.name,
			rootAttributes,
			durationMs,
			spans,
		});
	}
	return out.sort((a, b) => a.spans[0]!.startAt - b.spans[0]!.startAt);
}

function buildOtlpTraces(spanStarts: Map<string, { signal: Extract<OtelSignal, { kind: 'span.start' }>; span: MutableSpan }>): ProcessedTrace[] {
	const byTrace: Map<string, MutableSpan[]> = new Map();
	for (const { signal, span } of spanStarts.values()) {
		const list: MutableSpan[] = byTrace.get(signal.traceId) ?? [];
		list.push(span);
		byTrace.set(signal.traceId, list);
	}
	const out: ProcessedTrace[] = [];
	for (const [traceId, spans] of byTrace) {
		const root: MutableSpan | undefined = spans.find(s => s.parentSpanId === undefined) ?? spans[0];
		if (root === undefined) continue;
		const durationMs: number | undefined = root.endAt !== undefined ? root.endAt - root.startAt : undefined;
		out.push({
			traceId,
			rootSpanName: root.name,
			rootAttributes: { ...root.attributes },
			durationMs,
			spans,
		});
	}
	return out;
}
