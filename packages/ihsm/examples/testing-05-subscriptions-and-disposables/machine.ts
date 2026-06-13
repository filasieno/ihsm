/**
 * Subscriptions & `Disposable` — owning a teardown handle, the VS Code way.
 *
 * If you have written a VS Code extension you already know this shape. You subscribe to something,
 * you get a `Disposable` back, and you are responsible for calling `dispose()` to detach:
 *
 * ```ts
 * // VS Code: the subscription IS a Disposable; you must dispose it (or push it to context.subscriptions)
 * const sub: vscode.Disposable = vscode.workspace.onDidChangeTextDocument(e => report(e));
 * context.subscriptions.push(sub);  // disposed automatically when the extension deactivates
 * // ...later, to stop listening early:
 * sub.dispose();
 * ```
 *
 * ihsm models exactly this. A port method that opens an ongoing observation returns a
 * {@link ihsm.ResultWithSubscription} — a `value` **plus** a `Disposable`. The machine stores the
 * `Disposable` in its context (it *owns* it, like `context.subscriptions`) and calls `dispose()`
 * when it stops watching. This `Watcher` machine watches a path for changes:
 *
 * - Public protocol: `start(path)`, `stop()` — what a client posts.
 * - Internal protocol: `onChange(version)`, `onClosed()` — what the *source* pushes back.
 * - Port: `watch(path)` opens the watch and hands back the `Disposable` that closes it.
 *
 * The whole point: subscriptions are resources. Own the `Disposable`, dispose it exactly once on
 * teardown, and a deterministic test can *prove* you did — no leaks, no late events.
 */
import * as ihsm from '../../src';
import * as self from './machine';

/** Mutable domain data shared across all states (a class, constructed fresh per actor). */
export class WatcherCtx {
	/** The path currently being watched (empty when idle). */
	path = '';
	/** The id the source handed back for the active watch. */
	watchId = 0;
	/** Versions observed via `onChange`, in order — only while watching. */
	changes: number[] = [];
	/**
	 * The teardown handle for the active watch, **owned by the machine** (cf. VS Code's
	 * `context.subscriptions`). Disposed on `stop` / `onClosed`, then cleared.
	 */
	subscription?: ihsm.Disposable;
}

export interface WatcherConfig {
	context: WatcherCtx;
notifications: {
		start(path: string): void;
		stop(): void;
	};
	internalNotifications: {
		onChange(version: number): void;
		onClosed(): void;
	};
	port: {
		watch(path: string): ihsm.ResultWithSubscription<number>;
	};
}



/** Outbound boundary to the (impure) watch source. */
export type WatcherPort = ihsm.DomainPortOf<WatcherConfig>;


/** Root state. "Wrong state" events are safe no-ops so a late change can never corrupt Idle. */
export class WatcherTop extends ihsm.TopState<WatcherConfig> {

	start(_path: string): void {} // ignored unless Idle
	stop(): void {} // ignored unless Watching
	onChange(_version: number): void {} // ignored unless Watching
	onClosed(): void {} // ignored unless Watching

	/** Dispose the owned subscription exactly once, then forget it. Shared teardown. */
	protected releaseSubscription(): void {
		this.ctx.subscription?.dispose();
		this.ctx.subscription = undefined;
	}
}

@ihsm.InitialState
export class Idle extends WatcherTop {
	start(path: string): void {
		// Open the watch; take ownership of the Disposable it returns.
		const { value, subscription } = this.hsm.port.watch(path);
		this.ctx.path = path;
		this.ctx.watchId = value;
		this.ctx.subscription = subscription;
		this.ctx.changes = [];
		this.hsm.transition(Watching);
	}
}

export class Watching extends WatcherTop {
	onChange(version: number): void {
		this.ctx.changes.push(version);
	}

	stop(): void {
		this.releaseSubscription(); // client asked to stop — we dispose our handle
		this.hsm.transition(Idle);
	}

	onClosed(): void {
		this.releaseSubscription(); // source closed on its own — dispose is idempotent, so this is safe
		this.hsm.transition(Idle);
	}
}

ihsm.registerStateNames(self);
