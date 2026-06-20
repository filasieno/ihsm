/**
 * The isomorphic core: map the ihsm `Instrumentation` seam to OpenTelemetry spans and logs.
 *
 * Depends only on `@opentelemetry/api` and `@opentelemetry/api-logs`, so the same logic runs on the
 * server and in the browser; the SDK edges (exporters, context manager, resource) are supplied by
 * the environment entry points (`@ihsm/otel/node`). This module is a **pure observer**: it never
 * calls back into ihsm and never changes dispatch.
 *
 * Trace model (spec doc 4): one macrostep → one trace (root span named `<ActorName>.<handler>`); one microstep →
 * one `ihsm.step` span; a transition → an `ihsm.transition` span with `ihsm.exit`/`ihsm.entry`
 * events; an error → span status `ERROR` + `recordException`; logs → trace-correlated OTEL logs.
 */

import {
  SpanKind,
  SpanStatusCode,
  context as otelContext,
  trace,
} from "@opentelemetry/api";
import type {
  Attributes,
  Context,
  Link,
  Span,
  SpanContext,
  Tracer,
} from "@opentelemetry/api";
import { SeverityNumber } from "@opentelemetry/api-logs";
import type { Logger } from "@opentelemetry/api-logs";
import type {
  ActorIdentity,
  DispatchError,
  EnqueueInfo,
  Instrumentation,
  LogRecord,
  MacrostepBegin,
  MacrostepEnd,
  MicrostepBegin,
  MicrostepEnd,
  OutboundCallBegin,
  OutboundCallEnd,
  PortCallBegin,
  PortCallEnd,
  SpawnInfo,
  TransitionTracer,
  TriggerKind,
} from "ihsm/types";

import { ATTR, EVENT, SPAN } from "./semconv";
import { mintContext, OverridableIdGenerator } from "./idgen";
import type { MintedContext } from "./idgen";
import { currentActiveUserSpan } from "./user-anchor";

type Anchor = { readonly macrostepId?: string; readonly stepSeq?: number };
const anchorResolvers = new Set<(anchor: Anchor) => SpanContext | undefined>();

export function resolveSpanContextForAnchor(anchor: Anchor): SpanContext | undefined {
  for (const resolve of anchorResolvers) {
    const ctx = resolve(anchor);
    if (ctx !== undefined) return ctx;
  }
  return undefined;
}

export interface OtelInstrumentationOptions {
  /** Tracer from the bridge's own `TracerProvider` (never the global one). */
  readonly tracer: Tracer;
  /** Logger from the bridge's own `LoggerProvider`. When omitted, log emission is skipped. */
  readonly logger?: Logger;
  /** `wall` (default) or `virtual` — flags DST runs where span durations are not real time. */
  readonly clock?: "wall" | "virtual";
  /** Emit a derived INFO log per macrostep (so logs appear without the structured `onLog` channel). Default `true`. */
  readonly lifecycleLogs?: boolean;
  /**
   * The bridge's own provider id generator. When supplied, cross-actor sends mint the callee's
   * macrostep root context so caller↔callee links are **bidirectional** (`causes`/`caused_by`,
   * §5.6). Omit to skip forward links (back-links still draw when a carrier is present).
   */
  readonly idGenerator?: OverridableIdGenerator;
}

interface StepRecord {
  readonly seq: number;
  readonly actor: ActorIdentity;
  readonly span: Span;
  readonly ctx: Context;
  /** Leaf state when the step opened — used for log correlation if the step errors. */
  state: string;
  errored?: boolean;
  transition?: { span: Span; ctx: Context; hookSpan?: Span; initializeSpan?: Span };
}

interface MacroRecord {
  readonly id: string;
  readonly actor: ActorIdentity;
  readonly root: Span;
  readonly rootCtx: Context;
  /** Leaf state when the macrostep opened. */
  readonly state: string;
  readonly steps: Map<number, StepRecord>;
  /** SpanContexts of every step (kept after the step ends) so later steps can link to their cause. */
  readonly stepContexts: Map<number, SpanContext>;
  /** Monotonic per-macrostep enqueue index — seeds deterministic cross-actor context minting (§5.6.1). */
  enqueueSeq: number;
  errored?: boolean;
}

interface PortCallRecord {
  readonly callId: number;
  readonly actor: ActorIdentity;
  readonly state: string;
  readonly span: Span;
  readonly ctx: Context;
  readonly macrostepId?: string;
}

interface OutboundCallRecord {
  readonly callId: number;
  readonly actor: ActorIdentity;
  readonly state: string;
  readonly span: Span;
  readonly ctx: Context;
  readonly macrostepId?: string;
}

const SEVERITY: Record<
  LogRecord["severity"],
  { number: SeverityNumber; text: string }
> = {
  trace: { number: SeverityNumber.TRACE, text: "TRACE" },
  debug: { number: SeverityNumber.DEBUG, text: "DEBUG" },
  info: { number: SeverityNumber.INFO, text: "INFO" },
  warn: { number: SeverityNumber.WARN, text: "WARN" },
  error: { number: SeverityNumber.ERROR, text: "ERROR" },
  fatal: { number: SeverityNumber.FATAL, text: "FATAL" },
};

function spanKindForTrigger(kind: TriggerKind): SpanKind {
  return kind === "call" ? SpanKind.SERVER : SpanKind.INTERNAL;
}

/**
 * Build an ihsm {@link Instrumentation} that emits OpenTelemetry traces and logs.
 *
 * Register the result globally with ihsm's `registerCollector()` so tracing is enforced as a
 * cross-cutting protocol — every actor spawned afterwards is observed, and children share the same
 * collector instance automatically. The `startOtelNode`/`startOtelBrowser` entry points do this for
 * you. Actor and handler code never reference instrumentation.
 */
export function createOtelInstrumentation(
  options: OtelInstrumentationOptions,
): Instrumentation {
  const { tracer, logger } = options;
  const clock: "wall" | "virtual" = options.clock ?? "wall";
  const lifecycleLogs: boolean = options.lifecycleLogs ?? true;
  const idGenerator: OverridableIdGenerator | undefined = options.idGenerator;
  const TRACE_FLAG_SAMPLED = 1;
  const remoteContext = (traceId: string, spanId: string): SpanContext => ({
    traceId,
    spanId,
    traceFlags: TRACE_FLAG_SAMPLED,
    isRemote: true,
  });

  const actors = new Map<string, ActorIdentity>();
  const macrosteps = new Map<string, MacroRecord>();
  const activeSteps: StepRecord[] = [];
  const activeMacros: MacroRecord[] = [];
  const activePortCallStack: PortCallRecord[] = [];
  const activePortCalls = new Map<number, PortCallRecord>();
  const outboundCalls = new Map<number, OutboundCallRecord>();
  // Root span contexts retained after a macrostep ends, so a later timer-triggered macrostep can
  // link back to the macrostep that scheduled it (§4.7.5). Bounded to keep memory flat.
  const macroRootContexts = new Map<string, SpanContext>();
  const rememberMacroRoot = (id: string, ctx: SpanContext): void => {
    if (macroRootContexts.size > 2048) macroRootContexts.clear();
    macroRootContexts.set(id, ctx);
  };

  // Cross-actor adoption (§5.6). A callee that is still idle when a cross-actor message arrives folds
  // every message queued before its first drain into ONE macrostep, so all those messages must share
  // a single minted root that the macrostep adopts — otherwise per-message mints would dangle. Track
  // the shared mint + the `caused_by` back-links to attach when that macrostep's root opens.
  interface PendingAdopt {
    readonly mint: MintedContext;
    readonly backLinks: Link[];
  }
  const pendingAdopt = new Map<string, PendingAdopt>();
  let orphanEnqueueSeq = 0;
  // Currently-open macrostep per actor uuid — lets a cross-actor send to an already-running callee
  // link forward to its real root (no minting) and have the consuming step draw the back-link.
  const activeMacroByActor = new Map<string, MacroRecord>();

  const resolveAnchorSpanContext = (anchor: Anchor): SpanContext | undefined => {
    if (anchor.macrostepId === undefined || anchor.stepSeq === undefined)
      return undefined;
    const macro = macrosteps.get(anchor.macrostepId);
    if (macro === undefined) return undefined;
    return (
      macro.steps.get(anchor.stepSeq)?.span.spanContext() ??
      macro.stepContexts.get(anchor.stepSeq)
    );
  };
  anchorResolvers.add(resolveAnchorSpanContext);

  const tier1 = (actor: ActorIdentity, state: string): Attributes => ({
    [ATTR.actorUuid]: actor.uuid,
    [ATTR.actorName]: actor.name,
    [ATTR.actorPath]: actor.path,
    [ATTR.actorKind]: actor.kind,
    [ATTR.state]: state,
    [ATTR.clock]: clock,
  });

  const innermostStep = (): StepRecord | undefined =>
    activeSteps[activeSteps.length - 1];
  const innermostMacro = (): MacroRecord | undefined =>
    activeMacros[activeMacros.length - 1];
  const currentPortCall = (): PortCallRecord | undefined =>
    activePortCallStack[activePortCallStack.length - 1];

  const removeActive = <T>(stack: T[], item: T): void => {
    const i: number = stack.lastIndexOf(item);
    if (i >= 0) stack.splice(i, 1);
  };

  const resolveStepFromCause = (
    cause:
      | { macrostepId?: string; stepSeq?: number; actorUuid?: string }
      | undefined,
  ): { actor: ActorIdentity; state: string; ctx: Context; macrostepId?: string } | undefined => {
    if (cause?.macrostepId === undefined || cause.stepSeq === undefined)
      return undefined;
    const macro = macrosteps.get(cause.macrostepId);
    if (macro === undefined) return undefined;
    const step = macro.steps.get(cause.stepSeq);
    if (step !== undefined) {
      return {
        actor: step.actor,
        state: step.state,
        ctx: step.ctx,
        macrostepId: cause.macrostepId,
      };
    }
    const ctx = macro.stepContexts.get(cause.stepSeq);
    if (ctx === undefined) return undefined;
    return {
      actor: macro.actor,
      state: macro.state,
      ctx: trace.setSpan(otelContext.active(), trace.wrapSpanContext(ctx)),
      macrostepId: cause.macrostepId,
    };
  };

  function emitLog(
    severity: LogRecord["severity"],
    body: string,
    ctx: Context,
    actor: ActorIdentity,
    state: string,
    macrostepId: string | undefined,
    extra: Attributes,
    error?: Error,
  ): void {
    if (logger === undefined) return;
    const sev = SEVERITY[severity];
    const attributes: Attributes = { ...tier1(actor, state), ...extra };
    if (macrostepId !== undefined) attributes[ATTR.macrostepId] = macrostepId;
    if (error !== undefined) {
      attributes["exception.type"] = error.name;
      attributes["exception.message"] = error.message;
      if (error.stack !== undefined)
        attributes["exception.stacktrace"] = error.stack;
    }
    logger.emit({
      severityNumber: sev.number,
      severityText: sev.text,
      body,
      attributes,
      context: ctx,
    });
  }

  const linkForwardFromSpan = (
    sourceSpan: Span,
    sourceCtx: SpanContext,
    targetUuid: string,
    sourceActorUuid: string,
    forwardKind: string,
    cause?: { macrostepId?: string; stepSeq?: number; carrier?: Record<string, string> },
  ): void => {
    const running = activeMacroByActor.get(targetUuid);
    if (running !== undefined) {
      sourceSpan.addLink({
        context: running.root.spanContext(),
        attributes: { [ATTR.linkKind]: forwardKind, [ATTR.peerUuid]: targetUuid },
      });
      if (cause !== undefined) {
        cause.carrier = {
          backTraceId: sourceCtx.traceId,
          backSpanId: sourceCtx.spanId,
          backPeer: sourceActorUuid,
        };
      }
      return;
    }
    let pend = pendingAdopt.get(targetUuid);
    if (pend === undefined) {
      if (pendingAdopt.size > 4096) pendingAdopt.clear();
      let seedId = `${sourceCtx.traceId}:${sourceCtx.spanId}`;
      let seedSeq = orphanEnqueueSeq++;
      if (cause?.macrostepId !== undefined) {
        seedId = cause.macrostepId;
        const callerMacro = macrosteps.get(cause.macrostepId);
        if (callerMacro !== undefined) seedSeq = callerMacro.enqueueSeq++;
      }
      const mint: MintedContext = mintContext(seedId, seedSeq);
      pend = { mint, backLinks: [] };
      pendingAdopt.set(targetUuid, pend);
    }
    sourceSpan.addLink({
      context: remoteContext(pend.mint.traceId, pend.mint.spanId),
      attributes: { [ATTR.linkKind]: forwardKind, [ATTR.peerUuid]: targetUuid },
    });
    pend.backLinks.push({
      context: remoteContext(sourceCtx.traceId, sourceCtx.spanId),
      attributes: {
        [ATTR.linkKind]: "caused_by",
        [ATTR.peerUuid]: sourceActorUuid,
      },
    });
  };

  const transition: TransitionTracer = {
    traceTransitionStart(fromStateName: string, toStateName: string): void {
      const step = innermostStep();
      if (step === undefined) return;
      const attributes: Attributes = {
        ...tier1(step.actor, fromStateName),
        [ATTR.transitionFrom]: fromStateName,
        [ATTR.transitionTo]: toStateName,
      };
      const span = tracer.startSpan(
        `${SPAN.transition} ${fromStateName}→${toStateName}`,
        { kind: SpanKind.INTERNAL, attributes },
        step.ctx,
      );
      step.transition = { span, ctx: trace.setSpan(step.ctx, span) };
    },
    traceInitializeStart(stateName: string): void {
      const step = innermostStep();
      const t = step?.transition;
      if (step === undefined || t === undefined) return;
      const attributes: Attributes = {
        ...tier1(step.actor, stateName),
      };
      t.initializeSpan = tracer.startSpan(
        `${SPAN.initialize} ${stateName}`,
        { kind: SpanKind.INTERNAL, attributes },
        t.ctx,
      );
    },
    traceInitializeDone(finalStateName: string): void {
      const step = innermostStep();
      const t = step?.transition;
      if (step === undefined || t?.initializeSpan === undefined) return;
      t.initializeSpan.setAttribute(ATTR.state, finalStateName);
      t.initializeSpan.setStatus({ code: SpanStatusCode.OK });
      t.initializeSpan.end();
      t.initializeSpan = undefined;
    },
    // `ihsm.exit`/`ihsm.entry` are child spans of the transition (spec §4.2 span tree), bracketing
    // each `onExit`/`onEntry` action; hooks run sequentially so a single open slot suffices.
    traceHookStart(stateName: string, hook: "onExit" | "onEntry"): void {
      const t = innermostStep()?.transition;
      if (t === undefined) return;
      const attributes: Attributes = {
        ...tier1(innermostStep()!.actor, stateName),
        [ATTR.hookKind]: hook,
        [ATTR.hookState]: stateName,
      };
      t.hookSpan = tracer.startSpan(
        `${hook === "onExit" ? SPAN.exit : SPAN.entry} ${stateName}`,
        { kind: SpanKind.INTERNAL, attributes },
        t.ctx,
      );
    },
    traceHookDone(_stateName: string, _hook: "onExit" | "onEntry"): void {
      const t = innermostStep()?.transition;
      if (t?.hookSpan === undefined) return;
      t.hookSpan.setStatus({ code: SpanStatusCode.OK });
      t.hookSpan.end();
      t.hookSpan = undefined;
    },
    traceHookSkipped(): void {
      /* skipped default hooks are intentionally not eventized (spec §4.8) */
    },
    traceHookError(
      stateName: string,
      hook: "onExit" | "onEntry",
      cause: unknown,
    ): void {
      const t = innermostStep()?.transition;
      if (t === undefined) return;
      const err: Error =
        cause instanceof Error ? cause : new Error(String(cause));
      const span = t.hookSpan ?? t.span;
      span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
      span.setAttribute(ATTR.hookKind, hook);
      span.setAttribute(ATTR.hookState, stateName);
      span.recordException(err);
      if (t.hookSpan !== undefined) {
        t.hookSpan.end();
        t.hookSpan = undefined;
      }
      if (t.initializeSpan !== undefined) {
        t.initializeSpan.end();
        t.initializeSpan = undefined;
      }
      t.span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
    },
    traceTransitionDone(_finalStateName: string): void {
      const step = innermostStep();
      const t = step?.transition;
      if (t === undefined || step === undefined) return;
      if (t.hookSpan !== undefined) {
        t.hookSpan.end();
        t.hookSpan = undefined;
      }
      if (t.initializeSpan !== undefined) {
        t.initializeSpan.end();
        t.initializeSpan = undefined;
      }
      t.span.end();
      step.transition = undefined;
    },
  };

  return {
    onActorCreated(id: ActorIdentity): void {
      actors.set(id.uuid, id);
    },

    onActorSpawned(info: SpawnInfo): void {
      const anchor = resolveStepFromCause(info.parent) ?? (() => {
        const port = currentPortCall();
        if (port !== undefined) {
          return {
            actor: port.actor,
            state: port.state,
            ctx: port.ctx,
            macrostepId: port.macrostepId,
          };
        }
        const step = innermostStep();
        if (step !== undefined) {
          return {
            actor: step.actor,
            state: step.state,
            ctx: step.ctx,
            macrostepId: undefined,
          };
        }
        return undefined;
      })();
      if (anchor === undefined) return;
      const span = tracer.startSpan(
        `${SPAN.spawn} ${info.child.name}`,
        {
          kind: SpanKind.INTERNAL,
          attributes: {
            ...tier1(anchor.actor, anchor.state),
            [ATTR.peerUuid]: info.child.uuid,
            [ATTR.peerName]: info.child.name,
          },
        },
        anchor.ctx,
      );
      linkForwardFromSpan(
        span,
        span.spanContext(),
        info.child.uuid,
        anchor.actor.uuid,
        "spawn",
        info.parent,
      );
      span.setStatus({ code: SpanStatusCode.OK });
      span.end();
    },

    onMacrostepBegin(info: MacrostepBegin): void {
      actors.set(info.actor.uuid, info.actor);
      const attributes: Attributes = {
        ...tier1(info.actor, info.startState),
        [ATTR.macrostepId]: info.id,
        [ATTR.trigger]: info.trigger,
        [ATTR.triggerKind]: info.triggerKind,
        [ATTR.stateStart]: info.startState,
      };
      if (info.actor.parentUuid !== undefined)
        attributes[ATTR.peerUuid] = info.actor.parentUuid;
      const links: Link[] = [];
      // A timer/`defer`-fired macrostep links back to the macrostep that scheduled it (§4.7.5).
      if (
        info.triggerKind === "timer" &&
        info.cause?.macrostepId !== undefined
      ) {
        const schedulerCtx = macroRootContexts.get(info.cause.macrostepId);
        if (schedulerCtx !== undefined) {
          const linkAttrs: Attributes = { [ATTR.linkKind]: "timer" };
          if (info.delayMs !== undefined)
            linkAttrs[ATTR.deferDelayMs] = info.delayMs;
          links.push({ context: schedulerCtx, attributes: linkAttrs });
        }
      }
      // Cross-actor: adopt the caller-minted root context for this callee (so the ids match the
      // caller's forward `causes` link) and draw the reciprocal `caused_by` back-link(s) (§5.6.1).
      const pend = pendingAdopt.get(info.actor.uuid);
      if (pend !== undefined) {
        idGenerator?.arm(pend.mint);
        for (const link of pend.backLinks) links.push(link);
        pendingAdopt.delete(info.actor.uuid);
      }
      // The trace name is the handler that woke the actor: `<ActorName>.<handler>` (e.g. `Order.submit`).
      // The span type stays queryable via the `ihsm.trigger`/`ihsm.macrostep.id` attributes.
      const rootName: string = info.trigger ? `${info.actor.name}.${info.trigger}` : info.actor.name;
      const root = tracer.startSpan(
        rootName,
        {
          kind: spanKindForTrigger(info.triggerKind),
          root: true,
          attributes,
          links,
        },
        otelContext.active(),
      );
      const rootCtx: Context = trace.setSpan(otelContext.active(), root);
      rememberMacroRoot(info.id, root.spanContext());
      const record: MacroRecord = {
        id: info.id,
        actor: info.actor,
        root,
        rootCtx,
        state: info.startState,
        steps: new Map(),
        stepContexts: new Map(),
        enqueueSeq: 0,
      };
      macrosteps.set(info.id, record);
      activeMacros.push(record);
      activeMacroByActor.set(info.actor.uuid, record);
    },

    onMicrostepBegin(info: MicrostepBegin): void {
      const record = macrosteps.get(info.macrostepId);
      if (record === undefined) return;
      const attributes: Attributes = {
        ...tier1(record.actor, info.fromState),
        [ATTR.event]: info.event,
        [ATTR.eventBucket]: info.bucket,
        [ATTR.eventQueue]: info.queue,
      };
      if (info.handlerState !== undefined)
        attributes[ATTR.handlerState] = info.handlerState;
      // Link this step to the earlier step that caused it (intra-macrostep causality, §4.7.5).
      const links: Link[] = [];
      if (
        info.cause?.macrostepId === info.macrostepId &&
        info.cause.stepSeq !== undefined
      ) {
        const causeCtx = record.stepContexts.get(info.cause.stepSeq);
        if (causeCtx !== undefined)
          links.push({
            context: causeCtx,
            attributes: { [ATTR.linkKind]: "cause" },
          });
      }
      // Cross-actor message consumed by an already-running callee (busy branch of onEnqueue):
      // this step draws the `caused_by` back-link to the caller's real step (§4.7.5).
      const back = info.cause?.carrier;
      if (back?.backTraceId !== undefined && back.backSpanId !== undefined) {
        const linkAttrs: Attributes = { [ATTR.linkKind]: "caused_by" };
        if (back.backPeer !== undefined)
          linkAttrs[ATTR.peerUuid] = back.backPeer;
        links.push({
          context: remoteContext(back.backTraceId, back.backSpanId),
          attributes: linkAttrs,
        });
      }
      const span = tracer.startSpan(
        `${SPAN.step} ${info.event} ${
          info.bucket === "services" || info.bucket === "internalServices"
            ? "service"
            : "notification"
        }`,
        { kind: SpanKind.INTERNAL, attributes, links },
        record.rootCtx,
      );
      if (info.handlerState !== undefined)
        span.addEvent(EVENT.handlerFound, { state: info.handlerState });
      const ctx: Context = trace.setSpan(record.rootCtx, span);
      const stepRec: StepRecord = {
        seq: info.seq,
        actor: record.actor,
        span,
        ctx,
        state: info.fromState,
      };
      record.steps.set(info.seq, stepRec);
      record.stepContexts.set(info.seq, span.spanContext());
      activeSteps.push(stepRec);
    },

    onPortCallBegin(info: PortCallBegin): void {
      const anchor = resolveStepFromCause(info.cause);
      const actor = anchor?.actor ?? innermostStep()?.actor ?? innermostMacro()?.actor;
      if (actor === undefined) return;
      const state = anchor?.state ?? innermostStep()?.state ?? innermostMacro()?.state ?? actor.name;
      const parentCtx = anchor?.ctx ?? innermostStep()?.ctx ?? innermostMacro()?.rootCtx ?? otelContext.active();
      const span = tracer.startSpan(
        `${SPAN.port} ${info.method}`,
        {
          kind: SpanKind.INTERNAL,
          attributes: {
            ...tier1(actor, state),
          },
        },
        parentCtx,
      );
      const rec: PortCallRecord = {
        callId: info.callId,
        actor,
        state,
        span,
        ctx: trace.setSpan(parentCtx, span),
        macrostepId: anchor?.macrostepId,
      };
      activePortCalls.set(info.callId, rec);
      activePortCallStack.push(rec);
    },

    onPortCallEnd(info: PortCallEnd): void {
      const rec = activePortCalls.get(info.callId);
      if (rec === undefined) return;
      rec.span.setStatus({
        code: info.outcome === "error" ? SpanStatusCode.ERROR : SpanStatusCode.OK,
        ...(info.error !== undefined ? { message: info.error.message } : {}),
      });
      if (info.error !== undefined) rec.span.recordException(info.error);
      rec.span.end();
      activePortCalls.delete(info.callId);
      removeActive(activePortCallStack, rec);
    },

    onOutboundCallBegin(info: OutboundCallBegin): void {
      const port = currentPortCall();
      const anchor = resolveStepFromCause(info.cause);
      const actor = port?.actor ?? anchor?.actor ?? innermostStep()?.actor ?? innermostMacro()?.actor;
      if (actor === undefined) return;
      const state = port?.state ?? anchor?.state ?? innermostStep()?.state ?? innermostMacro()?.state ?? actor.name;
      const parentCtx = port?.ctx ?? anchor?.ctx ?? innermostStep()?.ctx ?? innermostMacro()?.rootCtx ?? otelContext.active();
      const span = tracer.startSpan(
        `${SPAN.service} ${info.service}`,
        {
          kind: SpanKind.CLIENT,
          attributes: {
            ...tier1(actor, state),
          },
        },
        parentCtx,
      );
      const activeSource = currentActiveUserSpan() ?? trace.getSpan(otelContext.active());
      if (activeSource !== undefined && info.targetUuid !== undefined) {
        linkForwardFromSpan(
          activeSource,
          activeSource.spanContext(),
          info.targetUuid,
          info.cause?.actorUuid ?? actor.uuid,
          "causes",
          info.cause,
        );
      }
      if (info.targetUuid !== undefined) {
        linkForwardFromSpan(
          span,
          span.spanContext(),
          info.targetUuid,
          actor.uuid,
          "causes",
          info.cause,
        );
      }
      outboundCalls.set(info.callId, {
        callId: info.callId,
        actor,
        state,
        span,
        ctx: trace.setSpan(parentCtx, span),
        macrostepId: anchor?.macrostepId,
      });
    },

    onOutboundCallEnd(info: OutboundCallEnd): void {
      const rec = outboundCalls.get(info.callId);
      if (rec === undefined) return;
      rec.span.setStatus({
        code: info.outcome === "error" ? SpanStatusCode.ERROR : SpanStatusCode.OK,
        ...(info.error !== undefined ? { message: info.error.message } : {}),
      });
      if (info.error !== undefined) rec.span.recordException(info.error);
      rec.span.end();
      outboundCalls.delete(info.callId);
    },

    onMicrostepEnd(info: MicrostepEnd): void {
      const record = macrosteps.get(info.macrostepId);
      const stepRec = record?.steps.get(info.seq);
      if (record === undefined || stepRec === undefined) return;
      if (stepRec.transition !== undefined) {
        stepRec.transition.span.end();
        stepRec.transition = undefined;
      }
      stepRec.span.setAttribute(ATTR.transitioned, info.transitioned);
      stepRec.span.setAttribute(ATTR.async, info.async);
      stepRec.span.setAttribute(ATTR.state, info.toState);
      const stepErrored: boolean =
        stepRec.errored === true || info.outcome === "error";
      stepRec.span.setStatus({
        code: stepErrored ? SpanStatusCode.ERROR : SpanStatusCode.OK,
      });
      stepRec.span.end();
      record.steps.delete(info.seq);
      removeActive(activeSteps, stepRec);
    },

    onError(info: DispatchError): void {
      const step = innermostStep();
      const macro = innermostMacro();
      const targetSpan: Span | undefined = step?.span ?? macro?.root;
      const targetCtx: Context | undefined = step?.ctx ?? macro?.rootCtx;
      const actor: ActorIdentity | undefined = step?.actor ?? macro?.actor;
      const state: string = step?.state ?? macro?.state ?? actor?.name ?? "";
      if (step !== undefined) step.errored = true;
      if (macro !== undefined) macro.errored = true;
      const stamp = (span: Span | undefined): void => {
        if (span === undefined) return;
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: info.error.message,
        });
        span.setAttribute(ATTR.errorKind, info.errorClass);
        span.setAttribute(ATTR.errorPhase, info.phase);
        span.setAttribute(ATTR.errorRecovered, info.recovered);
        span.recordException(info.error);
      };
      stamp(targetSpan);
      if (macro !== undefined && macro.root !== targetSpan) stamp(macro.root);
      if (actor !== undefined && targetCtx !== undefined) {
        // FatalError / InitializationError surface at FATAL; recovered/other failures at ERROR (§4.10.1).
        const severity: LogRecord["severity"] =
          info.errorClass === "FatalError" ||
          info.errorClass === "InitializationError"
            ? "fatal"
            : "error";
        emitLog(
          severity,
          `${info.errorClass}: ${info.error.message}`,
          targetCtx,
          actor,
          state,
          macro?.id,
          {
            [ATTR.errorKind]: info.errorClass,
            [ATTR.errorPhase]: info.phase,
            [ATTR.errorRecovered]: info.recovered,
          },
          info.error,
        );
      }
    },

    onMacrostepEnd(info: MacrostepEnd): void {
      const record = macrosteps.get(info.id);
      if (record === undefined) return;
      const errored: boolean =
        record.errored === true || info.outcome === "error";
      const outcome: "ok" | "error" = errored ? "error" : info.outcome;
      record.root.setAttribute(ATTR.stateEnd, info.endState);
      record.root.setAttribute(ATTR.steps, info.steps);
      record.root.setAttribute(ATTR.transitioned, info.transitioned);
      record.root.setAttribute(ATTR.outcome, outcome);
      record.root.setStatus({
        code: errored ? SpanStatusCode.ERROR : SpanStatusCode.OK,
      });
      if (lifecycleLogs) {
        const severity: LogRecord["severity"] = errored ? "error" : "info";
        emitLog(
          severity,
          `macrostep ${record.root.spanContext().traceId.slice(0, 8)} → ${info.endState} (${info.steps} step(s), ${outcome})`,
          record.rootCtx,
          record.actor,
          info.endState,
          info.id,
          {
            [ATTR.outcome]: outcome,
            [ATTR.steps]: info.steps,
            [ATTR.transitioned]: info.transitioned,
          },
        );
      }
      record.root.end();
      macrosteps.delete(info.id);
      removeActive(activeMacros, record);
      if (activeMacroByActor.get(record.actor.uuid) === record)
        activeMacroByActor.delete(record.actor.uuid);
    },

    onEnqueue(info: EnqueueInfo): void {
      // Intra-macrostep self-post cause links are drawn at onMicrostepBegin from info.cause.
      // Cross-actor sends get bidirectional `causes`/`caused_by` links (§5.6, §4.7.5):
      //  - idle callee  → mint a shared root the callee's macrostep adopts; forward link → mint,
      //    back-links queued for the root. All messages queued before the callee drains share one
      //    mint (they fold into one macrostep), so no per-message link ever dangles.
      //  - busy callee  → forward link → its real open root; the consuming step draws the back-link.
      const cause = info.cause;
      if (
        cause.kind !== "message" &&
        cause.kind !== "spawn" &&
        cause.kind !== "wire"
      )
        return;
      if (cause.macrostepId === undefined || cause.stepSeq === undefined)
        return;
      const target: string | undefined = info.targetUuid;
      if (target === undefined || target === cause.actorUuid) return; // not cross-actor
      const callerMacro = macrosteps.get(cause.macrostepId);
      const callerStep = callerMacro?.steps.get(cause.stepSeq);
      const callerCtx = callerMacro?.stepContexts.get(cause.stepSeq);
      if (
        callerMacro === undefined ||
        callerStep === undefined ||
        callerCtx === undefined
      )
        return;
      const forwardKind: string = cause.kind === "spawn" ? "spawn" : "causes";
      const active = currentActiveUserSpan() ?? trace.getSpan(otelContext.active());
      const sourceSpan: Span = active ?? callerStep.span;
      const sourceCtx: SpanContext = active?.spanContext() ?? callerCtx;
      // Capture source and mint target context at enqueue/call-notify site.
      linkForwardFromSpan(
        sourceSpan,
        sourceCtx,
        target,
        cause.actorUuid,
        forwardKind,
        cause,
      );
    },

    onLog(record: LogRecord): void {
      const step = innermostStep();
      const macro = innermostMacro();
      const ctx: Context | undefined =
        step?.ctx ?? macro?.rootCtx ?? otelContext.active();
      const actor: ActorIdentity | undefined = step?.actor ?? macro?.actor;
      if (actor === undefined) return;
      const extra: Attributes = { [ATTR.logSource]: record.source };
      if (record.frames.length > 0) {
        extra[ATTR.domainPath] = record.frames.map((f) => f.name);
        extra[ATTR.domain] = record.frames[record.frames.length - 1]!.name;
      }
      if (record.attributes !== undefined)
        Object.assign(extra, record.attributes);
      const state: string = step?.state ?? macro?.state ?? actor.name;
      emitLog(
        record.severity,
        record.body,
        ctx,
        actor,
        state,
        macro?.id,
        extra,
        record.error,
      );
    },

    transition,
  };
}
