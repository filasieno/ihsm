import type { Config, ConfigContext, OwnerActor, TopStateArg } from '../../src';
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
	kind: 'notification' | 'service';
	fields?: TutorialField[];
}

export interface TutorialSender {
	id: string;
	label: string;
}

export interface SingleHsmRuntime<C extends Config = Config> {
	kind: 'single';
	sm: OwnerActor<C>;
	writer: CollectingTraceWriter;
}

export interface CoordinatorRuntime {
	kind: 'coordinator';
	coordinator: {
		payment: OwnerActor<Config>;
		shipping: OwnerActor<Config>;
		fulfill(): Promise<void>;
		sync(): Promise<void>;
	};
	writer: CollectingTraceWriter;
}

export type InteractiveRuntime = SingleHsmRuntime | CoordinatorRuntime;

export interface TutorialExtraAction {
	id: string;
	label: string;
	run: (runtime: InteractiveRuntime) => Promise<void>;
}

/**
 * Optional live pointer surface. When present, the playground renders an interactive pad;
 * each (throttled) pointer move calls `onMove` with pad-relative coordinates so the machine
 * can react to a real input stream.
 */
export interface TutorialMousePad {
	label: string;
	hint?: string;
	onMove: (runtime: InteractiveRuntime, x: number, y: number) => Promise<void> | void;
}

export interface TutorialInteractiveMeta {
	title: string;
	senders: TutorialSender[];
	messagesBySender: Record<string, TutorialMessage[]>;
	createRuntime: () => InteractiveRuntime;
	stateSummary: (runtime: InteractiveRuntime) => string;
	extraActions?: TutorialExtraAction[];
	mousePad?: TutorialMousePad;
}

export interface SingleSenderTutorialOptions<C extends Config> {
	title: string;
	topState: TopStateArg<C>;
	initialCtx: ConfigContext<C>;
	initialize?: boolean;
	messages: TutorialMessage[];
	stateSummary: (sm: OwnerActor<C>) => string;
	extraActions?: TutorialExtraAction[];
	/** Pass `import * as machine from './machine'` so state names survive production minification. */
	machineExports?: Record<string, unknown>;
}
