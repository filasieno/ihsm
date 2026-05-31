import type { Hsm, StateClass } from '../../src';
import type { CollectingTraceWriter } from './trace';

export type TutorialFieldType = 'number' | 'string';

export interface TutorialField {
	name: string;
	label: string;
	type: TutorialFieldType;
	default: string | number;
}

export interface TutorialMessage {
	id: string;
	label: string;
	kind: 'post' | 'call';
	fields?: TutorialField[];
}

export interface TutorialSender {
	id: string;
	label: string;
}

export interface SingleHsmRuntime<Context, Protocol extends {} | undefined> {
	kind: 'single';
	sm: Hsm<Context, Protocol>;
	writer: CollectingTraceWriter;
}

export interface CoordinatorRuntime {
	kind: 'coordinator';
	coordinator: {
		payment: Hsm<{ paid: boolean }, { markPaid(): void }>;
		shipping: Hsm<{ shipped: boolean }, { markShipped(): void }>;
		fulfill(): Promise<void>;
		sync(): Promise<void>;
	};
	writer: CollectingTraceWriter;
}

export type InteractiveRuntime = SingleHsmRuntime<any, any> | CoordinatorRuntime;

export interface TutorialExtraAction {
	id: string;
	label: string;
	run: (runtime: InteractiveRuntime) => Promise<void>;
}

export interface TutorialInteractiveMeta {
	title: string;
	senders: TutorialSender[];
	messagesBySender: Record<string, TutorialMessage[]>;
	createRuntime: () => InteractiveRuntime;
	stateSummary: (runtime: InteractiveRuntime) => string;
	extraActions?: TutorialExtraAction[];
}

export interface SingleSenderTutorialOptions<Context, Protocol extends {} | undefined> {
	title: string;
	topState: StateClass<Context, Protocol>;
	initialCtx: Context;
	initialize?: boolean;
	messages: TutorialMessage[];
	stateSummary: (sm: Hsm<Context, Protocol>) => string;
	extraActions?: TutorialExtraAction[];
	/** Pass `import * as machine from './machine'` so state names survive production minification. */
	machineExports?: Record<string, unknown>;
}
