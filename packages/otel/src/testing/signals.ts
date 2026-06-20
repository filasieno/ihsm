/** Raw OTEL observation — see spec/06-TEST-ARTIFACTS.md */

import type { ActorIdentity, DispatchError, EnqueueInfo, LogRecord, MacrostepBegin, MacrostepEnd, MicrostepBegin, MicrostepEnd } from 'ihsm/types';

export type AttributeValue = string | number | boolean | string[];

export type OtelSignal =
	| { kind: 'actor.created'; at: number; actor: ActorIdentity }
	| { kind: 'actor.disposed'; at: number; actor: ActorIdentity }
	| { kind: 'macrostep.begin'; at: number } & MacrostepBegin
	| { kind: 'macrostep.end'; at: number } & MacrostepEnd
	| { kind: 'microstep.begin'; at: number } & MicrostepBegin
	| { kind: 'microstep.end'; at: number } & MicrostepEnd
	| { kind: 'enqueue'; at: number } & EnqueueInfo
	| { kind: 'dispatch.error'; at: number; actorUuid: string } & DispatchError
	| { kind: 'log'; at: number; actorUuid: string; macrostepId?: string; record: LogRecord }
	| {
			kind: 'span.start';
			at: number;
			traceId: string;
			spanId: string;
			parentSpanId?: string;
			name: string;
			otelKind?: string;
			attributes: Record<string, AttributeValue>;
	  }
	| {
			kind: 'span.end';
			at: number;
			traceId: string;
			spanId: string;
			status: 'ok' | 'error' | 'unset';
			attributes?: Record<string, AttributeValue>;
	  }
	| {
			kind: 'span.event';
			at: number;
			traceId: string;
			spanId: string;
			name: string;
			attributes?: Record<string, AttributeValue>;
	  }
	| {
			kind: 'span.link';
			at: number;
			traceId: string;
			spanId: string;
			linkedTraceId: string;
			linkedSpanId: string;
			attributes?: Record<string, AttributeValue>;
	  };

export interface ProcessedSpanEvent {
	readonly name: string;
	readonly at: number;
	readonly attributes: Record<string, AttributeValue>;
}

export interface ProcessedSpanLink {
	readonly traceId: string;
	readonly spanId: string;
	readonly attributes: Record<string, AttributeValue>;
}

export interface ProcessedSpan {
	readonly spanId: string;
	readonly parentSpanId?: string;
	readonly name: string;
	readonly otelKind?: string;
	readonly status: 'ok' | 'error' | 'unset';
	readonly startAt: number;
	readonly endAt?: number;
	readonly attributes: Record<string, AttributeValue>;
	readonly events: ProcessedSpanEvent[];
	readonly links: ProcessedSpanLink[];
}

export interface ProcessedTrace {
	readonly traceId: string;
	readonly rootSpanName: string;
	readonly rootAttributes: Record<string, AttributeValue>;
	readonly durationMs?: number;
	readonly spans: ProcessedSpan[];
}

export interface ProcessedLog {
	readonly at: number;
	readonly severity: 'TRACE' | 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL';
	readonly body: string;
	readonly traceId?: string;
	readonly spanId?: string;
	readonly labels: Record<string, string | undefined>;
	readonly attributes: Record<string, AttributeValue>;
}

export interface ProcessedTelemetry {
	readonly traces: ProcessedTrace[];
	readonly logs: ProcessedLog[];
}
