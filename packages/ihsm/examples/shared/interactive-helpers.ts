import type { ActorConfig } from '../../src';
import type { TestActor } from '../../src/testing';
import { CollectingTraceWriter, withTrace } from './trace';
import { registerStateNamesFromExports } from './state-names';
import type { InteractiveRuntime, SingleHsmRuntime, SingleSenderTutorialOptions, TutorialInteractiveMeta, TutorialMessage } from './interactive-types';

const DEFAULT_SENDER = 'machine';

type DispatchableActor = TestActor<ActorConfig> & Record<string, (...args: unknown[]) => unknown>;

export function singleSenderTutorial<C extends ActorConfig>(options: SingleSenderTutorialOptions<C>): TutorialInteractiveMeta {
	const { title, topState, initialCtx, initialize = true, messages, stateSummary, extraActions, machineExports } = options;

	return {
		title,
		senders: [{ id: DEFAULT_SENDER, label: title }],
		messagesBySender: { [DEFAULT_SENDER]: messages },
		createRuntime: () => {
			if (machineExports) {
				registerStateNamesFromExports(machineExports);
			}
			const { sm, writer } = withTrace(topState, initialCtx, initialize);
			return { kind: 'single', sm, writer } as SingleHsmRuntime<C>;
		},
		stateSummary: runtime => {
			if (runtime.kind !== 'single') {
				return '';
			}
			return stateSummary(runtime.sm as TestActor<C>);
		},
		extraActions,
	};
}

export function getSenderHsm<C extends ActorConfig = ActorConfig>(runtime: InteractiveRuntime, senderId: string): TestActor<C> {
	if (runtime.kind === 'single') {
		return runtime.sm as TestActor<C>;
	}
	if (senderId === 'payment') {
		return runtime.coordinator.payment as TestActor<C>;
	}
	if (senderId === 'shipping') {
		return runtime.coordinator.shipping as TestActor<C>;
	}
	throw new Error(`unknown sender: ${senderId}`);
}

export function traceFromRuntime(runtime: InteractiveRuntime): string {
	return runtime.writer.lines.join('\n');
}

export async function dispatchMessage(runtime: InteractiveRuntime, senderId: string, message: TutorialMessage, fieldValues: Record<string, string>): Promise<string | undefined> {
	const sm = getSenderHsm(runtime, senderId) as DispatchableActor;
	const args = (message.fields ?? []).map(field => {
		const raw = fieldValues[field.name] ?? String(field.default);
		return field.type === 'number' ? Number(raw) : raw;
	});

	const method = sm[message.id];
	if (typeof method !== 'function') {
		throw new Error(`unknown message: ${message.id}`);
	}

	if (message.kind === 'service') {
		const result = await method.call(sm, ...args);
		runtime.writer.lines.push(`↳ call ${message.id} → ${JSON.stringify(result)}`);
		await sm.hsm.sync();
		return String(result);
	}

	method.call(sm, ...args);
	await sm.hsm.sync();
	return undefined;
}

export function resetRuntime(meta: TutorialInteractiveMeta, runtime: InteractiveRuntime): InteractiveRuntime {
	runtime.writer.clear();
	if (runtime.kind === 'single') {
		const fresh = meta.createRuntime() as SingleHsmRuntime;
		runtime.sm = fresh.sm;
		runtime.writer = fresh.writer;
		return runtime;
	}
	const fresh = meta.createRuntime() as InteractiveRuntime;
	Object.assign(runtime, fresh);
	return runtime;
}

export function wrapWithTrace<C extends ActorConfig>(
	topState: SingleSenderTutorialOptions<C>['topState'],
	ctx: SingleSenderTutorialOptions<C>['initialCtx'],
	initialize = true,
): { sm: TestActor<C>; writer: CollectingTraceWriter } {
	return withTrace(topState, ctx, initialize);
}
