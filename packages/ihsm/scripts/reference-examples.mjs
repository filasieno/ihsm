/**
 * Interactive reference examples: marker id, placement, when/why prose, source files.
 * Markers in reference/REFERENCE.md: <!-- @example:<id> -->
 */
export const referenceExamples = [
	{
		id: '01-hello-state-machine',
		importName: 'helloPlayground',
		title: 'Hello state machine',
		grepLabel: 'Tutorial 01',
		whenAndWhy: `
Use this pattern when behaviour depends on **mode** (open vs closed, idle vs busy) and you want invalid mode combinations to be impossible at compile time.

**Why classes instead of flags:** a single class with \`isOpen\` / \`isClosed\` booleans forces every method to re-check flags; two states can both be true in memory. One **leaf state class** is always active; events are methods on that class.

**When to reach for \`makeHsm\`:** you need actor semantics (serialized mailbox), typed \`post('event')\`, and optional tracing — not a one-off callback. For a single open/close loop, this is the smallest correct shape: \`DoorCtx\`, \`DoorProtocol\`, \`@InitialState\`, and \`transition()\` between siblings under one root.
`,
	},
	{
		id: '02-tracing',
		importName: 'tracingPlayground',
		title: 'Tracing',
		grepLabel: 'Tutorial 02',
		whenAndWhy: `
Use tracing when you are **debugging transition order**, cache behaviour, or handler boundaries — especially after adopting hierarchy (tutorial 05).

**Why not only \`console.log\` in handlers:** the runtime already knows LCA paths, cache hits, and dispatch phases. \`TraceLevel.VERBOSE_DEBUG\` plus a \`TraceWriter\` (here \`CollectingTraceWriter\`) gives a consistent timeline without sprinkling logs in every \`onEntry\`/\`onExit\`.

**When to inject a custom writer:** tests (assert on trace lines), structured logging, or the docs site trace panel. Pass \`makeHsm(Top, ctx, true, TraceLevel.VERBOSE_DEBUG, writer)\` once; handlers use \`this.traceWriter\` indirectly via the framework.
`,
	},
	{
		id: '03-context',
		importName: 'contextPlayground',
		title: 'Context',
		grepLabel: 'Tutorial 03',
		whenAndWhy: `
Use a dedicated **context object** when the machine owns **mutable domain data** that survives across events and transitions (counters, session fields, order totals).

**Why not store everything on the state instance:** \`ctx\` is created once in \`makeHsm\` and stays the same object reference; transitions swap the **state class**, not the bag of data. That matches UML “extended state” and keeps serialization straightforward.

**When internal transitions are enough:** handlers only update \`this.ctx\` and never call \`transition()\` — no exit/entry cost (see tutorial 07). This example stays in one state class while incrementing and resetting \`value\`.
`,
	},
	{
		id: '04-protocol-typing',
		importName: 'protocolPlayground',
		title: 'Protocol typing',
		grepLabel: 'Tutorial 04',
		whenAndWhy: `
Use a \`Protocol\` interface whenever **callers** \`post\` or \`call\` on the machine — the compiler should reject typos in event names and wrong payload types before runtime.

**Why ihsm invests in generics:** stringly-typed event names (\`'setTargt'\`) fail in production. Binding \`Hsm<Context, Protocol>\` to your vocabulary catches mistakes at build time, including service methods with \`resolve\`/\`reject\` parameters (not passed by the client).

**When to keep the protocol small:** one interface per machine actor; split orthogonal concerns into **multiple machines** (tutorial 14) instead of one mega-protocol.
`,
	},
	{
		id: '05-hierarchy',
		importName: 'hierarchyPlayground',
		title: 'Hierarchy and transitions',
		grepLabel: 'Tutorial 05',
		diagramIndex: 1,
		sourceFiles: ['trace-sibling.ts', 'machine.ts'],
		whenAndWhy: `
Use hierarchy when substates **share behaviour** via inheritance (handlers on \`DeepTop\`) and when you need predictable **entry/exit** order across nested modes.

**Why two files:** \`trace-sibling.ts\` is a shallow A→B→C chain — easy to read exit/enter lines. \`machine.ts\` is the full topology table (sibling, parent, ancestor, cross-stack, async transition). Learn shallow first, then use the deep machine in tests and the trace panel.

**When to call \`transition()\`:** only when the **active leaf class** must change. Updating \`ctx.trace\` alone is an internal transition. The playground drives the **deep** machine — match its chart below.
`,
	},
	{
		id: '07-internal-transitions',
		importName: 'internalPlayground',
		title: 'Internal transitions',
		grepLabel: 'Tutorial 07',
		whenAndWhy: `
Use internal transitions when the **state mode is unchanged** but domain data updates — dimming a lamp, ticking a counter, appending to a log.

**Why avoid a self-loop \`transition(SameState)\`:** exit and entry would run again (\`onEntry\` fires, \`entryCount\` increments). Omitting \`transition()\` keeps the same leaf class and skips lifecycle hooks — faster and closer to UML internal transitions.

**When you still need \`onEntry\`:** setup when **entering** a mode (run once). Brighten/dim here only touch \`ctx.brightness\`.
`,
	},
	{
		id: '08-post-and-sync',
		importName: 'postSyncPlayground',
		title: 'post and sync',
		grepLabel: 'Tutorial 08',
		whenAndWhy: `
Use \`post\` + \`sync()\` when the **client** must wait for asynchronous side effects — tests, HTTP handlers, or scripts that enqueue several events and need a single barrier.

**Why \`post\` chains inside a handler defer:** \`this.post('tick')\` from \`start()\` schedules work **after** \`start\` finishes and any transition it requested. Without \`sync()\`, the client might observe partial \`ctx.events\`.

**When one \`sync()\` is enough:** after a burst of posts from one handler, one marker drains the whole queue through \`done\`. After \`call()\`, you usually \`await\` the returned Promise instead.
`,
	},
	{
		id: '09-deferred-post',
		importName: 'deferredPlayground',
		title: 'Deferred post',
		grepLabel: 'Tutorial 09',
		whenAndWhy: `
Use \`deferredPost\` when a handler must **schedule a follow-up event after a delay** without blocking the current handler — reminders, retries, or UI debouncing.

**Why not \`setTimeout\` + manual \`post\` in app code:** \`deferredPost\` still goes through the actor mailbox (serialized with other events) and respects the same state instance. The delay is implemented inside the runtime; you stay in the protocol vocabulary.

**When to prefer explicit timers outside:** cross-process scheduling or when the machine may be destroyed before the delay fires — persist a job id in \`ctx\` instead.
`,
	},
	{
		id: '10-call-services',
		importName: 'callPlayground',
		title: 'call services',
		grepLabel: 'Tutorial 10',
		whenAndWhy: `
Use \`call\` when the client needs a **typed Promise result** from the same actor — balance lookup, validation, or any query — while keeping mailbox serialization (no re-entrancy).

**Why services use \`resolve\`/\`reject\` in the protocol:** the runtime injects callbacks; the client never passes them. Sync services call \`resolve\` before return; async services \`await\` then resolve.

**When to use \`post\` instead:** fire-and-forget side effects where nobody awaits an outcome. Mix both on one machine: events mutate state; services answer questions.
`,
	},
	{
		id: '11-restore',
		importName: 'restorePlayground',
		title: 'restore',
		grepLabel: 'Tutorial 11',
		whenAndWhy: `
Use \`restore\` when you **hydrate** a machine from storage after restart — DB session, checkpoint, or test fixture — without replaying init entry/exit.

**Why \`makeHsm(..., false)\` then \`restore\`:** initialization runs \`onEntry\` descent; snapshots already represent “where we were”. \`restore(StateClass, ctx)\` sets leaf class and context atomically.

**When to record state names:** JSON cannot store class constructors — map string names to classes (\`SESSION_STATES\`) on resume. Keep \`ctx\` JSON-serializable.
`,
	},
	{
		id: '12-error-recovery',
		importName: 'errorPlayground',
		title: 'Error recovery',
		grepLabel: 'Tutorial 12',
		whenAndWhy: `
Use \`onError\` / \`onUnhandled\` when handlers can throw or when unknown events should **recover** instead of crashing the process — retries, counters, or transition to a safe state.

**Why typed errors:** \`EventHandlerError\` and \`UnhandledEventError\` carry event name and state context for logging. Override on the state class (or parent) that should own policy.

**When to let errors propagate:** fatal invariants — omit recovery and the machine enters \`FatalErrorState\` after failed recovery.
`,
	},
	{
		id: '13-async-handlers',
		importName: 'asyncPlayground',
		title: 'Async handlers',
		grepLabel: 'Tutorial 13',
		whenAndWhy: `
Use **async handlers** when one event performs a **multi-step I/O pipeline** and staying in one state until completion is correct — open/read/write/close without inventing substates per syscall.

**Why ihsm awaits before \`transition()\`:** the leaf class stays \`Idle\` through all \`await\`s; queued \`post\`/\`call\` messages wait. Add substates only when “in flight” is a **domain mode** (cancellable upload, different events allowed).

**When \`sync()\` matters:** client waits until the whole \`transfer\` handler and its transition to \`Done\` finish.
`,
	},
	{
		id: '14-nested-machines',
		importName: 'nestedPlayground',
		title: 'Nested machines (orthogonal regions)',
		grepLabel: 'Tutorial 14',
		whenAndWhy: `
Use **multiple \`Hsm\` instances** when two concerns evolve independently — payment vs shipping — but your app coordinates them. This is ihsm’s answer to orthogonal regions: one queue per actor, explicit messaging between them.

**Why not one giant hierarchy:** coupling unrelated lifecycles into one tree forces artificial LCA transitions. Two machines stay simple; \`OrderCoordinator\` posts to each and \`sync()\`s.

**When to merge into one machine:** true shared parent state and a single mailbox ordering requirement across both concerns.
`,
	},
	{
		id: '15-complex-workflow',
		importName: 'workflowPlayground',
		title: 'Complex workflow',
		grepLabel: 'Tutorial 15',
		whenAndWhy: `
Use **\`postNow\` from \`onEntry\`** when a composite state must run **immediate internal steps** (validation, guards) before normal-priority \`post\` work from the same turn — classic “decision pseudo-state” without a separate class per micro-step.

**Why not \`transition()\` inside \`onEntry\`:** transitions scheduled from lifecycle hooks are **cleared** at end of dispatch. Branch with \`postNow\` (hi-priority) or move branching into the event handler.

**When async handlers plus transitions:** \`submit\` awaits work then \`transition(Validating)\`; validating uses \`postNow('applyValidation')\` to approve or reject before deferred side effects.
`,
	},
	{
		id: '17-post-now',
		importName: 'postNowPlayground',
		title: 'postNow',
		grepLabel: 'Tutorial 17',
		whenAndWhy: `
Use \`postNow\` for **extended transitions**: several internal steps (lock inventory, capture payment) that must complete in order **before** normal \`post\` messages from the same handler — e.g. \`cancel\` posted in the same \`confirm()\` must not run until hi-priority steps finish.

**Why handler-only:** external clients use ordinary \`post\`; priority is a runtime scheduling rule inside one dispatch generation.

**When hi-priority is overkill:** a single handler body with straight-line code and no competing \`post\` from the same turn.
`,
	},
];

/** @deprecated — use referenceExamples; kept for scripts that still import placements */
export const playgroundPlacements = referenceExamples.map(ex => ({
	after: `<!-- @example:${ex.id} -->`,
	exampleId: ex.id,
	importName: ex.importName,
}));
