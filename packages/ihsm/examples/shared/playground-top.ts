import * as ihsm from '../../src';

/**
 * Root state base for interactive examples. Events with no handler in the active
 * state are logged and ignored so the trace panel does not enter FatalErrorState.
 */
export abstract class PlaygroundTopState<C extends ihsm.ActorConfig> extends ihsm.TopState<C> {
	onUnhandled(error: ihsm.UnhandledEventError<C>): void {
		this.hsm.traceWriter.write(this.hsm as never, `ignored unhandled #${String(error.eventName)} in ${this.hsm.currentStateName}`);
	}
}
