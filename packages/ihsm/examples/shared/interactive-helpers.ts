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

export function getSenderHsm<C extends ActorConfig = ActorConfig>(runtime: InteractiveRuntime, _senderId: string): TestActor<C> {
	return runtime.sm as TestActor<C>;
}

export function traceFromRuntime(runtime: InteractiveRuntime): string {
	return runtime.writer.lines.join('\n');
}

export async function dispatchMessage(runtime: InteractiveRuntime, senderId: string, message: TutorialMessage, fieldValues: Record<string, string>, afterDispatch?: (runtime: InteractiveRuntime) => Promise<void>): Promise<string | undefined> {
	const sm = getSenderHsm(runtime, senderId) as DispatchableActor;
	const args = (message.fields ?? []).map(field => {
		const raw = fieldValues[field.name] ?? String(field.default);
		return field.type === 'number' ? Number(raw) : raw;
	});

	const facet = message.kind === 'service' ? sm.call : sm.notify;
	const method = facet[message.id as keyof typeof facet];
	if (typeof method !== 'function') {
		throw new Error(`unknown message: ${message.id}`);
	}

	if (message.kind === 'service') {
		const result = await (method as (...args: unknown[]) => Promise<unknown>).apply(facet, args);
		runtime.writer.lines.push(`↳ call ${message.id} → ${JSON.stringify(result)}`);
		await sm.hsm.sync();
		if (afterDispatch) {
			await afterDispatch(runtime);
		}
		return String(result);
	}

	(method as (...args: unknown[]) => void).apply(facet, args);
	await sm.hsm.sync();
	if (afterDispatch) {
		await afterDispatch(runtime);
	}
	return undefined;
}

export function resetRuntime(meta: TutorialInteractiveMeta, runtime: InteractiveRuntime): InteractiveRuntime {
	runtime.writer.clear();
	const fresh = meta.createRuntime();
	runtime.sm = fresh.sm;
	runtime.writer = fresh.writer;
	return runtime;
}

export function wrapWithTrace<C extends ActorConfig>(topState: SingleSenderTutorialOptions<C>['topState'], ctx: SingleSenderTutorialOptions<C>['initialCtx'], initialize = true): { sm: TestActor<C>; writer: CollectingTraceWriter } {
	return withTrace(topState, ctx, initialize);
}
