/**
 * Frozen `ihsm.*` attribute keys, span names, and event names (spec doc 4 §4.4–4.10).
 *
 * Names are low-cardinality templates. The macrostep root span is named `<ActorName>.<handler>`
 * (e.g. `Order.submit`); child spans use concise operation names:
 * `execute <event> <service|notification>`, `transition <from>→<to>`, `exit <state>`,
 * `entry <state>`, `port <method>`, `call <service>`, `spawn <child>`, `initialize <state>`.
 * Event/state names are part of the machine's static structure, so the names stay low-cardinality.
 * Identity beyond that (uuids, ids) lives in attributes, never the span name.
 */

export const SCOPE_RUNTIME = '@ihsm/otel/runtime';
export const SCOPE_PORT = '@ihsm/otel/port';

/** Span names (templates). */
export const SPAN = {
	/**
	 * @deprecated The macrostep root span is now named `<ActorName>.<handler>` (e.g. `Order.submit`),
	 * not this static template. Identify macrostep roots by the macrostep-exclusive `ihsm.trigger`
	 * attribute. Retained for back-compat with consumers referencing the legacy name.
	 */
	macrostep: 'ihsm.macrostep',
	step: 'execute',
	transition: 'transition',
	exit: 'exit',
	entry: 'entry',
	port: 'port',
	service: 'call',
	await: 'await',
	spawn: 'spawn',
	initialize: 'initialize',
} as const;

/** Span event names. */
export const EVENT = {
	handlerFound: 'ihsm.handler.found',
	unhandled: 'ihsm.unhandled',
	note: 'ihsm.note',
	exception: 'exception',
} as const;

/** `ihsm.*` attribute keys. */
export const ATTR = {
	// Tier 1 — on every span
	actorUuid: 'ihsm.actor.uuid',
	actorName: 'ihsm.actor.name',
	state: 'ihsm.state',
	// Tier 1+ context
	actorPath: 'ihsm.actor.path',
	actorKind: 'ihsm.actor.kind',
	clock: 'ihsm.clock',
	// macrostep (Tier 2)
	macrostepId: 'ihsm.macrostep.id',
	trigger: 'ihsm.trigger',
	triggerKind: 'ihsm.trigger.kind',
	stateStart: 'ihsm.state.start',
	stateEnd: 'ihsm.state.end',
	transitioned: 'ihsm.transitioned',
	steps: 'ihsm.steps',
	outcome: 'ihsm.outcome',
	// step (Tier 2)
	event: 'ihsm.event',
	eventQueue: 'ihsm.event.queue',
	eventBucket: 'ihsm.event.bucket',
	handlerState: 'ihsm.handler.state',
	async: 'ihsm.async',
	// transition / hooks
	transitionFrom: 'ihsm.transition.from',
	transitionTo: 'ihsm.transition.to',
	hookKind: 'ihsm.hook.kind',
	hookState: 'ihsm.hook.state',
	// error (§4.9)
	errorKind: 'ihsm.error.kind',
	errorPhase: 'ihsm.error.phase',
	errorRecovered: 'ihsm.error.recovered',
	// links (§4.7)
	linkKind: 'ihsm.link.kind',
	peerUuid: 'ihsm.peer.uuid',
	peerName: 'ihsm.peer.name',
	deferDelayMs: 'ihsm.defer.delay_ms',
	// logs (§4.10)
	domain: 'ihsm.domain',
	domainPath: 'ihsm.domain.path',
	logSource: 'ihsm.log.source',
	// resource
	version: 'ihsm.version',
	otelVersion: 'ihsm.otel.version',
	hostKind: 'ihsm.host.kind',
	runSeed: 'ihsm.run.seed',
} as const;
