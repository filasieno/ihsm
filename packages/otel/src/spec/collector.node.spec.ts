import { expect } from "chai";
import "mocha";
import { trace } from "@opentelemetry/api";

import { InitialState, Port, TopState, TraceLevel, asParentActor, clearCollectors, configureRunSeed, makeActor, makeChildActor, registerStateNames } from "ihsm";
import type { ChildActor } from "ihsm/types";

import { getActiveSpanContext, getActiveSpanId, getActiveTraceId, traceSpan, traceSpanAsync, traced, tracedAsync, tracedClass } from "../annotate";
import { startOtelNode } from "../env/node";
import * as self from "./collector.node.spec";

const OTEL_ENDPOINT = process.env.OTEL_ENDPOINT ?? "http://localhost:14318";
const SERVICE_NAME =
  process.env.IHSM_OTEL_COLLECTOR_SERVICE ?? "ihsm-otel-collector-it";
const RUN_ID = process.env.IHSM_OTEL_RUN_ID ?? `run-${Date.now().toString(36)}`;

async function collectorReachable(endpoint: string): Promise<boolean> {
  try {
    const response = await fetch(endpoint, { method: "GET" });
    return response.status > 0;
  } catch {
    return false;
  }
}

async function drainActor(
  actor: { hsm: { sync(): Promise<void> } },
  rounds = 4,
): Promise<void> {
  for (let i = 0; i < rounds; ++i) await actor.hsm.sync();
}

class CollectorPort<T extends TopState = TopState> extends Port<T> {
  readonly io: string[] = [];

  recordPortSideEffect(tag: string): void {
    this.io.push(tag);
  }
}

/**
 * Case 1: ports + immediate queue + span links + span events.
 * - `notifyNow` produces immediate-queue dispatch.
 * - self-posted `notify` creates intra-macrostep cause links.
 * - transition emits entry/exit events.
 * - handlers use `hsm.port` for external side effects.
 */
interface QueueCtx {
  readonly order: string[];
}
interface QueueConfig {
  context: QueueCtx;
  notifications: { start(): void; hi(): void; lo(): void; follow(): void };
}
class QueueTop extends TopState<QueueConfig> {
  start(): void {
    this.ctx.order.push("start");
    this.notify.lo();
    this.notifyNow.hi();
    this.hsm.transition(QueueActive);
  }
  hi(): void {
    this.ctx.order.push("hi");
    this.hsm.port.recordPortSideEffect("hi");
  }
  lo(): void {
    this.ctx.order.push("lo");
    this.hsm.port.recordPortSideEffect("lo");
  }
  follow(): void {
    this.ctx.order.push("follow");
    this.hsm.port.recordPortSideEffect("follow");
  }
}
@InitialState
class QueueIdle extends QueueTop {}
class QueueActive extends QueueTop {
  onEntry(): void {
    this.notify.follow();
  }
}

/**
 * Case 2: deferred post.
 */
interface DeferredCtx {
  readonly ticks: string[];
}
interface DeferredConfig {
  context: DeferredCtx;
  notifications: { schedule(): void; fire(): void };
}
class DeferredTop extends TopState<DeferredConfig> {
  schedule(): void {
    this.ctx.ticks.push("schedule");
    this.hsm.port.defer(25).fire();
  }
  fire(): void {
    this.ctx.ticks.push("fire");
  }
}
@InitialState
class DeferredIdle extends DeferredTop {}

/**
 * Case 3: long entry/exit chains.
 */
interface ChainCtx {
  readonly hooks: string[];
}
interface ChainConfig {
  context: ChainCtx;
  notifications: { go(): void };
}
class ChainTop extends TopState<ChainConfig> {
  go(): void {
    this.hsm.transition(ChainBLeaf);
  }
}
@InitialState
class ChainA extends ChainTop {
  onEntry(): void {
    this.ctx.hooks.push("A.entry");
  }
  onExit(): void {
    this.ctx.hooks.push("A.exit");
  }
}
@InitialState
class ChainALeaf extends ChainA {
  onEntry(): void {
    this.ctx.hooks.push("ALeaf.entry");
  }
  onExit(): void {
    this.ctx.hooks.push("ALeaf.exit");
  }
}
class ChainB extends ChainTop {
  onEntry(): void {
    this.ctx.hooks.push("B.entry");
  }
  onExit(): void {
    this.ctx.hooks.push("B.exit");
  }
}
@InitialState
class ChainBLeaf extends ChainB {
  onEntry(): void {
    this.ctx.hooks.push("BLeaf.entry");
  }
  onExit(): void {
    this.ctx.hooks.push("BLeaf.exit");
  }
}

/**
 * Case 4: external + internal embodiments and parent/child composition.
 */
interface ChildCtx {
  value: number;
  readyCount: number;
}
interface ChildConfig {
  context: ChildCtx;
  services: { read(): Promise<number> };
  internalServices: { initialize(seed: number): Promise<number> };
  internalNotifications: { onReady(): void };
}
class ChildTop extends TopState<ChildConfig> {
  async read(): Promise<number> {
    return this.ctx.value;
  }
  async initialize(seed: number): Promise<number> {
    this.ctx.value = seed;
    return seed * 2;
  }
  onReady(): void {
    this.ctx.readyCount += 1;
  }
}
@InitialState
class ChildIdle extends ChildTop {}

interface ParentCtx {
  child?: ChildActor<ChildConfig>;
}
interface ParentConfig {
  context: ParentCtx;
  services: { boot(seed: number): Promise<number> };
}
class ParentTop extends TopState<ParentConfig> {
  async boot(seed: number): Promise<number> {
    if (this.ctx.child === undefined) {
      this.ctx.child = makeChildActor(
        asParentActor(this),
        ChildTop,
        { value: 0, readyCount: 0 },
        new CollectorPort<typeof ChildTop>(),
      );
    }
    const doubled = await this.ctx.child.call.initialize(seed);
    this.ctx.child.notify.onReady();
    return doubled;
  }
}
@InitialState
class ParentIdle extends ParentTop {}

/**
 * Case 5: different logging levels (runtime lifecycle INFO + ERROR path).
 */
interface ErrorCtx {
  steps: number;
}
interface ErrorConfig {
  context: ErrorCtx;
  notifications: { ok(): void; fail(): void };
}
class ErrorTop extends TopState<ErrorConfig> {
  ok(): void {
    this.ctx.steps += 1;
    // Exercise every severity through the structured handler logger (spec §4.10.1).
    this.hsm.log.trace("per-frame trace detail", { "frame.seq": 1 });
    this.hsm.log.debug("branch decision", { depth: 2 });
    this.hsm.log.info("state-meaningful event", {
      "step.count": this.ctx.steps,
    });
    this.hsm.log.warn("dropping duplicate frame", { id: 42 });
    this.hsm.log.error("recovered failure", { retry: 1 });
    this.hsm.log.fatal("unrecoverable condition reached");
  }
  fail(): void {
    this.ctx.steps += 1;
    throw new Error("collector-case-deliberate-error");
  }
}
@InitialState
class ErrorIdle extends ErrorTop {}

/**
 * Case 6: user annotation toolkit + class routines + user logs.
 */
interface FeatureCtx {
  readonly events: string[];
  activeSpanId?: string;
  activeTraceId?: string;
  anchorSpanId?: string;
}
interface FeatureConfig {
  context: FeatureCtx;
  notifications: { run(): Promise<void>; deferred(): void };
}

class FeatureOps {
  @traced("user.decorated.sync")
  syncTask(out: string[], label: string): string {
    out.push(`sync:${label}`);
    return label.toUpperCase();
  }

  @tracedAsync("user.decorated.async")
  async asyncTask(out: string[], label: string): Promise<string> {
    out.push(`async:${label}`);
    await Promise.resolve();
    return `${label}-ok`;
  }
}

@tracedClass({ includeStatic: true })
class FeatureWorkflow {
  static staticTask(out: string[], label: string): void {
    out.push(`static:${label}`);
  }

  instanceTask(out: string[], label: string): void {
    out.push(`instance:${label}`);
  }

  async instanceAsyncTask(out: string[], label: string): Promise<void> {
    out.push(`instance-async:${label}`);
    await Promise.resolve();
  }
}

class FeatureTop extends TopState<FeatureConfig> {
  async run(): Promise<void> {
    const ops = new FeatureOps();
    const workflow = new FeatureWorkflow();
    this.ctx.anchorSpanId = getActiveSpanContext()?.spanId;
    this.ctx.activeSpanId = getActiveSpanId();
    this.ctx.activeTraceId = getActiveTraceId();
    this.hsm.log.info("feature run started", { phase: "start" });
    traceSpan("user.routine.sync", () => {
      this.hsm.log.debug("inside sync routine", { phase: "sync" });
      FeatureWorkflow.staticTask(this.ctx.events, "A");
      workflow.instanceTask(this.ctx.events, "B");
      ops.syncTask(this.ctx.events, "C");
      this.hsm.port.recordPortSideEffect("feature-sync");
    });
    await traceSpanAsync("user.routine.async", async () => {
      await workflow.instanceAsyncTask(this.ctx.events, "D");
      await ops.asyncTask(this.ctx.events, "E");
      this.hsm.port.recordPortSideEffect("feature-async");
      this.notify.deferred();
    });
    this.hsm.log.info("feature run completed", { phase: "end" });
  }

  deferred(): void {
    this.ctx.events.push("deferred:tick");
    this.hsm.log.warn("feature deferred executed", { phase: "deferred" });
  }
}
@InitialState
class FeatureIdle extends FeatureTop {}

registerStateNames(self);

describe("collector integration (server/node → real OTLP HTTP collector)", function (): void {
  this.timeout(30_000);

  before(async function (): Promise<void> {
    const up = await collectorReachable(OTEL_ENDPOINT);
    if (!up) this.skip();
  });

  afterEach(() => clearCollectors());

  it("exports ports + immediate queue + self-post span links + transition span events", async () => {
    configureRunSeed(`${RUN_ID}-queue`);
    const otel = startOtelNode({
      serviceName: SERVICE_NAME,
      endpoint: OTEL_ENDPOINT,
      useSimpleProcessors: true,
      registerGlobal: false,
      resourceAttributes: {
        "ihsm.test.run_id": RUN_ID,
        "ihsm.test.case": "queue",
      },
    });
    const ctx: QueueCtx = { order: [] };
    const port = new CollectorPort<typeof QueueTop>();
    const actor = makeActor(QueueTop, ctx, port, {
      initialize: true,
      traceLevel: TraceLevel.DEBUG,
    });
    await drainActor(actor);
    actor.notify.start();
    await drainActor(actor);
    await otel.forceFlush();
    await otel.shutdown();
    expect(ctx.order).to.eql(["start", "hi", "lo", "follow"]);
    expect(port.io).to.eql(["hi", "lo", "follow"]);
  });

  it("exports deferred posts (timer-triggered work)", async () => {
    configureRunSeed(`${RUN_ID}-deferred`);
    const otel = startOtelNode({
      serviceName: SERVICE_NAME,
      endpoint: OTEL_ENDPOINT,
      useSimpleProcessors: true,
      registerGlobal: false,
      resourceAttributes: {
        "ihsm.test.run_id": RUN_ID,
        "ihsm.test.case": "deferred",
      },
    });
    const ctx: DeferredCtx = { ticks: [] };
    const actor = makeActor(
      DeferredTop,
      ctx,
      new CollectorPort<typeof DeferredTop>(),
      { initialize: true, traceLevel: TraceLevel.DEBUG },
    );
    await drainActor(actor);
    actor.notify.schedule();
    await actor.hsm.sync();
    await new Promise<void>((resolve) => setTimeout(resolve, 40));
    await drainActor(actor);
    await otel.forceFlush();
    await otel.shutdown();
    expect(ctx.ticks).to.eql(["schedule", "fire"]);
  });

  it("exports long exit/entry chains on transitions", async () => {
    configureRunSeed(`${RUN_ID}-chains`);
    const otel = startOtelNode({
      serviceName: SERVICE_NAME,
      endpoint: OTEL_ENDPOINT,
      useSimpleProcessors: true,
      registerGlobal: false,
      resourceAttributes: {
        "ihsm.test.run_id": RUN_ID,
        "ihsm.test.case": "chains",
      },
    });
    const ctx: ChainCtx = { hooks: [] };
    const actor = makeActor(
      ChainTop,
      ctx,
      new CollectorPort<typeof ChainTop>(),
      { initialize: true, traceLevel: TraceLevel.DEBUG },
    );
    await drainActor(actor);
    actor.notify.go();
    await drainActor(actor);
    await otel.forceFlush();
    await otel.shutdown();
    expect(ctx.hooks).to.include.members([
      "ALeaf.exit",
      "A.exit",
      "B.entry",
      "BLeaf.entry",
    ]);
  });

  it("exports parent/child traces through external + internal embodiments", async () => {
    configureRunSeed(`${RUN_ID}-parent-child`);
    const otel = startOtelNode({
      serviceName: SERVICE_NAME,
      endpoint: OTEL_ENDPOINT,
      useSimpleProcessors: true,
      registerGlobal: false,
      resourceAttributes: {
        "ihsm.test.run_id": RUN_ID,
        "ihsm.test.case": "parent-child",
      },
    });
    const ctx: ParentCtx = {};
    const actor = makeActor(
      ParentTop,
      ctx,
      new CollectorPort<typeof ParentTop>(),
      { initialize: true, traceLevel: TraceLevel.DEBUG },
    );
    await drainActor(actor);
    const doubled = await actor.call.boot(7);
    await drainActor(actor);
    await otel.forceFlush();
    await otel.shutdown();
    expect(doubled).to.equal(14);
    expect(ctx.child).to.not.equal(undefined);
    expect(await ctx.child!.call.read()).to.equal(7);
  });

  it("exports lifecycle/error logs at different severities", async () => {
    configureRunSeed(`${RUN_ID}-logs`);
    const otel = startOtelNode({
      serviceName: SERVICE_NAME,
      endpoint: OTEL_ENDPOINT,
      useSimpleProcessors: true,
      registerGlobal: false,
      resourceAttributes: {
        "ihsm.test.run_id": RUN_ID,
        "ihsm.test.case": "logs",
      },
    });
    const actor = makeActor(
      ErrorTop,
      { steps: 0 },
      new CollectorPort<typeof ErrorTop>(),
      {
        initialize: true,
        traceLevel: TraceLevel.DEBUG,
        dispatchErrorCallback: (): void => {
          /* keep running so telemetry gets exported */
        },
      },
    );
    await drainActor(actor);
    actor.notify.ok();
    await drainActor(actor);
    actor.notify.fail();
    await drainActor(actor);
    await otel.forceFlush();
    await otel.shutdown();
  });

  it("exports annotation helpers + class/decorated routines + user logs", async () => {
    configureRunSeed(`${RUN_ID}-feature-surface`);
    trace.disable();
    const otel = startOtelNode({
      serviceName: SERVICE_NAME,
      endpoint: OTEL_ENDPOINT,
      useSimpleProcessors: true,
      registerGlobal: true,
      resourceAttributes: {
        "ihsm.test.run_id": RUN_ID,
        "ihsm.test.case": "feature-surface",
      },
    });
    const ctx: FeatureCtx = { events: [] };
    const port = new CollectorPort<typeof FeatureTop>();
    const actor = makeActor(FeatureTop, ctx, port, {
      initialize: true,
      traceLevel: TraceLevel.DEBUG,
    });
    await drainActor(actor);
    actor.notify.run();
    await drainActor(actor);
    await otel.forceFlush();
    await otel.shutdown();
    expect(ctx.activeSpanId).to.not.equal(undefined);
    expect(ctx.activeTraceId).to.not.equal(undefined);
    expect(ctx.anchorSpanId).to.equal(ctx.activeSpanId);
    expect(ctx.events).to.eql([
      "static:A",
      "instance:B",
      "sync:C",
      "instance-async:D",
      "async:E",
      "deferred:tick",
    ]);
    expect(port.io).to.eql(["feature-sync", "feature-async"]);
  });
});
