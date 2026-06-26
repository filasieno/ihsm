/** @internal Cooperative task scheduler — microtask batching with macrotask yields. */

export const YIELD_TASK_BUDGET = 64;
export const YIELD_TIME_BUDGET_MS = 5;

export function nowMs(): number {
	return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function createMacrotaskYielder(): (callback: () => void) => void {
	const g = globalThis as typeof globalThis & {
		scheduler?: { postTask: (callback: () => void, options?: { priority?: string }) => void };
		setImmediate?: (callback: () => void) => void;
	};
	/* istanbul ignore if -- scheduler.postTask: Chromium / modern browser only */
	if (typeof g.scheduler?.postTask === 'function') {
		return callback => {
			g.scheduler!.postTask(callback, { priority: 'user-blocking' });
		};
	}
	// Node / Electron main — MessageChannel ports keep the process alive (breaks mocha/nyc exit).
	if (typeof g.setImmediate === 'function') {
		return callback => {
			g.setImmediate(callback);
		};
	}
	/* istanbul ignore start -- MessageChannel: browser / Electron renderer (Node uses setImmediate above) */
	if (typeof MessageChannel !== 'undefined') {
		const channel = new MessageChannel();
		let pending: Array<() => void> = [];
		channel.port1.onmessage = () => {
			const batch = pending;
			pending = [];
			for (const callback of batch) {
				callback();
			}
		};
		return callback => {
			pending.push(callback);
			channel.port2.postMessage(null);
		};
	}
	/* istanbul ignore end */
	/* istanbul ignore next -- setTimeout(0) fallback when no better macrotask primitive exists */
	return callback => {
		setTimeout(callback, 0);
	};
}

export const yieldToMacrotask = createMacrotaskYielder();
