/**
 * Caller-minted span context support (spec §5.6).
 *
 * Cross-actor causality is rendered as **bidirectional links between separate traces**, not nesting.
 * To make the caller→callee (`causes`) link possible, the caller mints the callee's macrostep root
 * `SpanContext` *before* the callee exists and the callee later **adopts** that exact id. OTEL's
 * `IdGenerator` API has no parameter to force an id, so adoption uses a tiny synchronous override
 * slot on a custom generator: the bridge sets `nextOverride` immediately before `startSpan(root)`,
 * the SDK reads it in the same synchronous tick, and the slot self-clears — nothing can interleave
 * (single-threaded JS, no `await` between set and start).
 */

export interface MintedContext {
	readonly traceId: string;
	readonly spanId: string;
}

/** Deterministic, replay-stable id pair from a caller macrostep + enqueue index (no RNG, no crypto). */
export function mintContext(callerMacrostepId: string, enqueueSeq: number): MintedContext {
	const seed = `${callerMacrostepId}#${enqueueSeq}`;
	return { traceId: fnvHex(`${seed}:trace`, 32), spanId: fnvHex(`${seed}:span`, 16) };
}

function fnvHex(input: string, hexLen: number): string {
	let h = 0x811c9dc5 >>> 0;
	let out = '';
	let counter = 0;
	while (out.length < hexLen) {
		for (let i = 0; i < input.length; ++i) {
			h ^= input.charCodeAt(i);
			h = Math.imul(h, 0x01000193) >>> 0;
		}
		h ^= counter++;
		h = Math.imul(h, 0x01000193) >>> 0;
		out += (h >>> 0).toString(16).padStart(8, '0');
	}
	const hex = out.slice(0, hexLen);
	// Guard against the all-zero id (invalid in OTEL) — astronomically unlikely, but cheap to ensure.
	return /^0+$/.test(hex) ? '1'.padStart(hexLen, '0') : hex;
}

function randomHex(hexLen: number): string {
	let out = '';
	while (out.length < hexLen) {
		out += Math.floor(Math.random() * 0x100000000)
			.toString(16)
			.padStart(8, '0');
	}
	return out.slice(0, hexLen);
}

/**
 * An OTEL `IdGenerator` that returns a one-shot overridden id pair when armed, else random ids.
 * Plug into the bridge's own `TracerProvider` (never the global one).
 */
export class OverridableIdGenerator {
	private override?: MintedContext;

    /**
     * Arm the next root span to adopt this exact id pair. The SDK's `Tracer.startSpan` generates
     * the span id **first** and the trace id **second** (only for roots), so the override is cleared
     * on `generateTraceId` — after both ids have been read — to keep the pair coherent. A defensive
     * watchdog also clears the slot if it is somehow left armed across two span-id reads.
     */
    arm(ctx: MintedContext): void {
        this.override = ctx;
        this.spanIdReads = 0;
    }

    private spanIdReads = 0;

    generateTraceId(): string {
        const o = this.override;
        if (o !== undefined) {
            this.override = undefined;
            this.spanIdReads = 0;
            return o.traceId;
        }
        return randomHex(32);
    }

    generateSpanId(): string {
        const o = this.override;
        if (o !== undefined) {
            // A root span reads span id then trace id; if a second span id is requested while still
            // armed, the intended root never materialized — drop the override rather than leak it.
            if (this.spanIdReads >= 1) {
                this.override = undefined;
                this.spanIdReads = 0;
                return randomHex(16);
            }
            this.spanIdReads += 1;
            return o.spanId;
        }
        return randomHex(16);
    }
}
