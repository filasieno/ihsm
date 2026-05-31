import type { Hsm, HsmStateClass } from '../../src';
import { CollectingTraceWriter, withTrace } from './trace';
import type { InteractiveRuntime, SingleMachineRuntime, SingleSenderTutorialOptions, TutorialInteractiveMeta, TutorialMessage } from './interactive-types';

const DEFAULT_SENDER = 'machine';

export function singleSenderTutorial<Context, Protocol extends {} | undefined>(options: SingleSenderTutorialOptions<Context, Protocol>): TutorialInteractiveMeta {
	const { title, topState, initialCtx, initialize = true, messages, stateSummary, extraActions } = options;

	return {
		title,
		senders: [{ id: DEFAULT_SENDER, label: title }],
		messagesBySender: { [DEFAULT_SENDER]: messages },
		createRuntime: () => {
			const { sm, writer } = withTrace(topState, initialCtx, initialize);
			return { kind: 'single', sm, writer };
		},
		stateSummary: runtime => {
			if (runtime.kind !== 'single') {
				return '';
			}
			return stateSummary(runtime.sm);
		},
		extraActions,
	};
}

export function getSenderMachine(runtime: InteractiveRuntime, senderId: string): Hsm<any, any> {
	if (runtime.kind === 'single') {
		return runtime.sm;
	}
	if (senderId === 'payment') {
		return runtime.coordinator.payment;
	}
	if (senderId === 'shipping') {
		return runtime.coordinator.shipping;
	}
	throw new Error(`unknown sender: ${senderId}`);
}

export function traceFromRuntime(runtime: InteractiveRuntime): string {
	return runtime.writer.lines.join('\n');
}

export async function dispatchMessage(runtime: InteractiveRuntime, senderId: string, message: TutorialMessage, fieldValues: Record<string, string>): Promise<string | undefined> {
	const sm = getSenderMachine(runtime, senderId);
	const args = (message.fields ?? []).map(field => {
		const raw = fieldValues[field.name] ?? String(field.default);
		return field.type === 'number' ? Number(raw) : raw;
	});

	if (message.kind === 'call') {
		const result = await sm.call(message.id, ...args);
		runtime.writer.lines.push(`↳ call ${message.id} → ${JSON.stringify(result)}`);
		await sm.sync();
		return String(result);
	}

	sm.post(message.id, ...args);
	await sm.sync();
	return undefined;
}

export function resetRuntime(meta: TutorialInteractiveMeta, runtime: InteractiveRuntime): InteractiveRuntime {
	runtime.writer.clear();
	if (runtime.kind === 'single') {
		const fresh = meta.createRuntime() as SingleMachineRuntime<any, any>;
		runtime.sm = fresh.sm;
		runtime.writer = fresh.writer;
		return runtime;
	}
	const fresh = meta.createRuntime() as InteractiveRuntime;
	Object.assign(runtime, fresh);
	return runtime;
}

export function wrapWithTrace<Context, Protocol extends {} | undefined>(topState: HsmStateClass<Context, Protocol>, ctx: Context, initialize = true): { sm: Hsm<Context, Protocol>; writer: CollectingTraceWriter } {
	return withTrace(topState, ctx, initialize);
}
