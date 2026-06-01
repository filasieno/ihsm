import * as ihsm from '../../src';

/**
 * Root state base for interactive examples. Events with no handler in the active
 * state are logged and ignored so the trace panel does not enter FatalErrorState.
 */
export abstract class PlaygroundTopState<Context, Protocol extends {} | undefined = undefined> extends ihsm.TopState<Context, Protocol> {
	onUnhandled<EventName extends keyof Protocol>(error: ihsm.UnhandledEventError<Context, Protocol, EventName>): void {
		this.traceWriter.write(this, `ignored unhandled #${String(error.eventName)} in ${this.currentStateName}`);
	}
}
