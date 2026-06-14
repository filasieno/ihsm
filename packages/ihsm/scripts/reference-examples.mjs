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

**When to reach for \`makeActor\`:** you need actor semantics (serialized, run-to-completion dispatch), typed \`notify\` / \`call\`, and optional tracing — not a one-off callback. For a single open/close loop, this is the smallest correct shape: \`DoorConfig\`, \`@InitialState\`, and \`transition()\` between siblings under one root.
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

**When to inject a custom writer:** tests (assert on trace lines), structured logging, or the docs site trace panel. Pass \`makeActor(Top, ctx, port, { traceLevel: TraceLevel.VERBOSE_DEBUG, traceWriter: writer })\` once; handlers use \`this.hsm.traceWriter\` indirectly via the framework.
`,
	},
	{
		id: '03-context',
		importName: 'contextPlayground',
		title: 'Context',
		grepLabel: 'Tutorial 03',
		whenAndWhy: `
Use a dedicated **context object** when the machine owns **mutable domain data** that survives across events and transitions (counters, session fields, order totals).

**Why not store everything on the state instance:** \`ctx\` is created once in \`makeActor\` and stays the same object reference; transitions swap the **state class**, not the bag of data. That matches UML “extended state” and keeps serialization straightforward.

**When internal transitions are enough:** handlers only update \`this.ctx\` and never call \`transition()\` — no exit/entry cost (see tutorial 07). This example stays in one state class while incrementing and resetting \`value\`.
`,
	},
	{
		id: '04-protocol-typing',
		importName: 'protocolPlayground',
		title: 'Protocol typing',
		grepLabel: 'Tutorial 04',
		whenAndWhy: `
Use a \`Config\` interface whenever **callers** \`notify\` or \`call\` on the machine — the compiler should reject typos in event names and wrong payload types before runtime.

**Why ihsm invests in generics:** stringly-typed event names (\`'setTargt'\`) fail in production. Binding \`TopState<YourConfig>\` to your vocabulary catches mistakes at build time, including service methods with \`resolve\`/\`reject\` parameters (not passed by the client).

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
Use \`notify\` + \`sync()\` when the **client** must wait for asynchronous side effects — tests, HTTP handlers, or scripts that enqueue several events and need a single barrier.

**Why chained \`this.notify\` inside a handler defer:** \`this.notify.tick()\` from \`start()\` schedules work **after** \`start\` finishes and any transition it requested. Without \`sync()\`, the client might observe partial \`ctx.events\`.

**When one \`sync()\` is enough:** after a burst of notifications from one handler, one marker drains the whole queue through \`done\`. After \`call()\`, you usually \`await\` the returned Promise instead.
`,
	},
	{
		id: '09-deferred-post',
		importName: 'deferredPlayground',
		title: 'Deferred post',
		grepLabel: 'Tutorial 09',
		whenAndWhy: `
Use \`hsm.port.defer(ms)\` when a handler must **schedule a follow-up notification after a delay** without blocking the current handler — reminders, retries, or UI debouncing.

**Why not \`setTimeout\` + manual \`notify\` in app code:** \`port.defer\` still goes through the actor's run-to-completion dispatch (serialized with other events) and respects the same state instance. The delay is implemented by the machine's **port timer service** — a \`Port\` the runtime always instantiates when you don't supply one — so you stay in the protocol vocabulary. It is handler-only and never reaches the external actor surface.

**When to prefer explicit timers outside:** cross-process scheduling or when the machine may be destroyed before the delay fires — persist a job id in \`ctx\` instead.
`,
	},
	{
		id: '10-call-services',
		importName: 'callPlayground',
		title: 'call services',
		grepLabel: 'Tutorial 10',
		whenAndWhy: `
Use \`call\` when the client needs a **typed Promise result** from the same actor — balance lookup, validation, or any query — while keeping run-to-completion serialization (no re-entrancy).

**Why services use \`resolve\`/\`reject\` in the protocol:** the runtime injects callbacks; the client never passes them. Sync services call \`resolve\` before return; async services \`await\` then resolve.

**When to use \`notify\` instead:** fire-and-forget side effects where nobody awaits an outcome. Mix both on one machine: notifications mutate state; services answer questions.
`,
	},
	{
		id: '11-restore',
		importName: 'restorePlayground',
		title: 'restore',
		grepLabel: 'Tutorial 11',
		whenAndWhy: `
Use \`restore\` when you **hydrate** a machine from storage after restart — DB session, checkpoint, or test fixture — without replaying init entry/exit.

**Why \`makeActor(..., { initialize: false })\` then \`restore\`:** initialization runs \`onEntry\` descent; snapshots already represent “where we were”. \`restore(StateClass, ctx)\` sets leaf class and context atomically.

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

**Why ihsm awaits before \`transition()\`:** the leaf class stays \`Idle\` through all \`await\`s; queued \`notify\`/\`call\` messages wait. Add substates only when “in flight” is a **domain mode** (cancellable upload, different events allowed).

**When \`sync()\` matters:** client waits until the whole \`transfer\` handler and its transition to \`Done\` finish.
`,
	},
	{
		id: '14-nested-machines',
		importName: 'nestedPlayground',
		title: 'Nested machines (sibling actors)',
		grepLabel: 'Tutorial 14',
		whenAndWhy: `
Use **multiple \`makeActor\` instances** when two concerns evolve independently — payment vs shipping — but your app coordinates them. This is ihsm’s answer to UML orthogonal regions **without** \`type: 'parallel'\` in one chart: one queue per actor, explicit messaging between them.

**Why not one giant hierarchy:** coupling unrelated lifecycles into one tree forces artificial LCA transitions. Two machines stay simple; \`OrderCoordinator\` notifies each and \`sync()\`s.

**When to merge into one machine:** true shared parent state and a single run-to-completion ordering requirement across both concerns.
`,
	},
	{
		id: '18-chained-child-actors',
		importName: 'chainedChildPlayground',
		title: 'Chained child actors (not parallel states)',
		grepLabel: 'Tutorial 18',
		whenAndWhy: `
ihsm **rejects UML parallel regions** inside one chart — they share one queue, one \`Config\`, and one port. Real systems need independent dispatch, per-concern protocols, optional lifecycles, and typed \`await child.call…\` across boundaries.

**Use \`makeChildActor(asParentActor(this), ChildTop, ctx, port)\`** when a parent state **owns** a child: spawn in \`onEntry\`, drop the handle in \`onExit\`, orchestrate with \`child.notify\` / \`child.call\`. Stronger than parallel states: phased concerns, internal child vocabulary, isolated DST mocks, parent-orchestrated retries.

**Versus tutorial 14:** siblings + external coordinator when no parent state owns the regions; chained children when lifecycle is tied to a composite parent state.
`,
	},
	{
		id: '15-complex-workflow',
		importName: 'workflowPlayground',
		title: 'Complex workflow',
		grepLabel: 'Tutorial 15',
		whenAndWhy: `
Use **\`notifyNow\` from \`onEntry\`** when a composite state must run **immediate internal steps** (validation, guards) before normal-priority \`notify\` work from the same turn — classic “decision pseudo-state” without a separate class per micro-step.

**Why not \`transition()\` inside \`onEntry\`:** transitions scheduled from lifecycle hooks are **cleared** at end of dispatch. Branch with \`notifyNow\` (hi-priority) or move branching into the event handler.

**When async handlers plus transitions:** \`submit\` awaits work then \`transition(Validating)\`; validating uses \`this.notifyNow.applyValidation()\` to approve or reject before deferred side effects.
`,
	},
	{
		id: '17-post-now',
		importName: 'postNowPlayground',
		title: 'notifyNow',
		grepLabel: 'Tutorial 17',
		whenAndWhy: `
Use \`notifyNow\` for **extended transitions**: several internal steps (lock inventory, capture payment) that must complete in order **before** normal \`notify\` messages from the same handler — e.g. \`cancel\` notified in the same \`confirm()\` must not run until hi-priority steps finish.

**Why handler-only:** external clients use ordinary \`notify\`; priority is a runtime scheduling rule inside one dispatch generation.

**When hi-priority is overkill:** a single handler body with straight-line code and no competing \`notify\` from the same turn.
`,
	},
];

/**
 * Interactive examples for the dedicated **Deterministic testing** chapter
 * (reference/TESTING.md → website/docs/testing.mdx). Same shape as {@link referenceExamples};
 * markers in TESTING.md: <!-- @example:<id> -->
 */
export const testingExamples = [
	{
		id: 'testing-01-deferred-timers',
		importName: 'testing01Playground',
		title: 'Deferred timers & simulated time',
		grepLabel: 'Testing 01',
		sourceFiles: ['machine.ts', 'tutorial.spec.ts'],
		whenAndWhy: `
Start every testable machine here: never wait on the wall clock. A \`Heartbeat\` machine ticks **every hour** via \`hsm.port.defer(ms)\`, backed by the port timer service. In a test you substitute a \`TestPort\` and \`advance()\` it to simulate 48 hours in microseconds — zero flakiness.

**Test actor vs. test port:** \`makeTestActor\` returns the merged protocol (drive internal \`onTick\` directly), typed access to \`port\`, and a \`subscribe()\` channel that observes every event. A production handle from \`makeActor\` exposes only the public protocol. \`TestPort\` *records* outbound work and supplies a virtual clock you \`advance()\` by hand to fire due deferred timers deterministically.

**Positional arguments, no wrappers:** factories take \`topState\`, \`ctx\`, and \`port\` positionally, then an optional options bag. Import the test surface from \`ihsm/testing\`.
`,
	},
	{
		id: 'testing-02-network-fetch',
		importName: 'testing02Playground',
		title: 'Network fetch behind a port',
		grepLabel: 'Testing 02',
		sourceFiles: ['machine.ts', 'tutorial.spec.ts'],
		whenAndWhy: `
Network calls are the classic flaky dependency. Put \`fetch()\` (against, say, \`https://google.com\`) behind a port and a test decides **what** the response is and **when** it arrives — no sockets, no DNS, no latency.

**Why stub + send:** \`request\` is an abstract \`@mock\` method scripted with \`port.request.default(...)\` to return an id and an abort \`Disposable\` — but it delivers **no response** from the synchronous call. The test settles the request *when it wants* by pushing \`onResponse\` / \`onFailure\` inward with \`port.send(...)\`. That separation makes the in-flight \`Fetching\` state reachable and the whole flow timer-free; \`cancel()\` disposes the request so a late response is provably dropped.

**How to test it:** one abstract \`@mock\` serves every scenario — drive it through the public path (\`actor.notify.fetch()\` → assert \`Fetching\` → \`port.send('onResponse', …)\` → assert \`Done\`/\`Failed\`), or pin \`Fetching\` directly with \`initialize: false\` and notify the settled event.
`,
	},
	{
		id: 'testing-03-event-streaming',
		importName: 'testing03Playground',
		title: 'Event streaming behind a port',
		grepLabel: 'Testing 03',
		sourceFiles: ['machine.ts', 'tutorial.spec.ts'],
		whenAndWhy: `
Use a port whenever the machine depends on a push source whose timing you do not control — OS input, a file watcher, a network socket, a WebSocket/SSE feed. The port is the single seam where impurity lives; everything above it is pure and deterministically testable.

**Why a public/internal protocol split:** clients call \`notify.listen\` / \`notify.stopListening\`; the *source* pushes \`onMouseMove\`. Keeping them separate means a client can never forge a stream event, and a test can drive either side. \`stopListening\` \`dispose()\`s the subscription, so the source provably goes quiet.

**Device state lives in the mock, not the actor:** the OS owns the cursor and keeps moving it whether or not you are subscribed, so the abstract \`@mock\` holds the pointer position in **public** fields (\`cursor\`, \`live\`) and exposes drive commands (\`moveTo\` / \`moveBy\` / \`path\`) the tester calls; the machine stores only the moves it *observed while listening*. The two legitimately diverge — model the simulated world inside the test double, and let the machine own only what it perceived.

**How to test it:** script \`subscribe\` with \`port.subscribe.default(...)\` so it only delivers while live, then drive the mock and notify internal events directly with \`makeTestActor\`. Either way there are no timers and no races — barrier with \`await actor.hsm.sync()\`.
`,
	},
	{
		id: 'testing-04-fault-injection',
		importName: 'testing04Playground',
		title: 'Fault injection & seeded DST',
		grepLabel: 'Testing 04',
		sourceFiles: ['machine.ts', 'tutorial.spec.ts'],
		whenAndWhy: `
Deterministic Simulation Testing (DST) makes *failure* reproducible. A worker retries a flaky operation; whether each attempt fails is decided by a **seeded** PRNG — never \`Math.random()\` or the clock. Same seed ⇒ same fault sequence ⇒ a red run you can replay byte-for-byte.

**One \`@mock\`, scripted per scenario:** \`attempt\` is an abstract \`@mock\` method whose calls are auto-recorded (\`port.trace\` is the golden list of attempts that ran). The test scripts it with \`port.attempt.default(...)\` — either \`port.feedRandom(...)\` plus \`port.random()\` for a seeded fault injector that pushes \`onResult\` inward, or a no-op so the test drives \`onResult\` by hand. Retries are ordinary run-to-completion events, so there is nothing to race.

**How to test it:** seeded (run twice with one seed; assert \`port.trace\`, \`ctx.log\`, and outcome are identical; pin \`failRate\` to 0/1 for guaranteed terminals), or hand-injected (a no-op \`attempt.default\`; \`port.send('onResult', …)\` to walk the retry budget, asserting \`port.attempt.calls\`).
`,
	},
	{
		id: 'testing-05-subscriptions-and-disposables',
		importName: 'testing05Playground',
		title: 'Subscriptions & disposables',
		grepLabel: 'Testing 05',
		sourceFiles: ['machine.ts', 'tutorial.spec.ts'],
		whenAndWhy: `
A subscription outlives the call that created it, so every one needs a teardown handle — a \`Disposable\` — and somebody must own it. ihsm models exactly the VS Code pattern: a port method returns \`ResultWithSubscription\` (a value **plus** a \`Disposable\`), the machine stores the handle in its context (its own \`context.subscriptions\`), and disposes it on \`stop\` or a source-initiated \`onClosed\`. \`dispose()\` is **idempotent**, so overlapping teardown is always safe.

**Authoring the mock — \`@mock\` + \`makeTestPort\`:** declare each port method \`abstract\` with the **exact port signature** and decorate the class with \`@mock\` — no bodies, the port surface is inferred from the machine's \`TopState\`. Build the mock with \`makeTestPort(WatcherMock)\`, then **script** each call with \`port.watch.default(impl)\` (persistent) or \`port.watch.once(impl)\` (one-shot, FIFO) — including the \`Disposable\` it returns, so the test controls teardown; inspect \`port.watch.calls\` (typed args) and \`port.watch.reset()\` to reuse the mock. Two separate channels: \`default\`/\`once\` script what an **outbound** method returns; \`port.send('onChange', v)\` pushes **inbound** internal events. An unscripted method throws \`PreloadError\` naming the method — never a silent \`undefined\`.

**DST is the payoff:** subscribe, push changes, stop, and *prove* the handle was disposed **exactly once** with no leak; a late change after teardown is dropped; the **golden trace** (\`['watch:/etc/hosts', 'dispose watch /etc/hosts']\`) is byte-identical across runs. No \`setTimeout\`, no real filesystem, no \`Math.random()\` — advance with \`sync()\` and decide every event yourself.
`,
	},
];

/** @deprecated — use referenceExamples; kept for scripts that still import placements */
export const playgroundPlacements = referenceExamples.map(ex => ({
	after: `<!-- @example:${ex.id} -->`,
	exampleId: ex.id,
	importName: ex.importName,
}));
