import { expect } from "chai";
import "mocha";
import { InitialState, Port, TopState, TraceLevel, clearCollectors, configureRunSeed, mintActorIdentity, registerCollector, registerStateNames } from "ihsm";
import { makeTestActor } from "ihsm/testing";
import type { TestActor } from "ihsm/testing";
import type { ProcessedTrace } from "../testing/index";

import { assertMacrostepShape, assertOneTracePerExternalStimulus, assertStepsOrderedByStartTime, assertTier1OnEverySpan, createIhsmSignalCollector, findTracesByTrigger, processSignals, settle } from "../testing/index";
import * as self from "./instrumentation.spec";

interface PingConfig {
  context: { pings: number };
  notifications: { ping(): void };
}

export class PingTop extends TopState<PingConfig> {
  ping(): void {
    this.ctx.pings += 1;
  }
}

@InitialState
export class Ready extends PingTop {}

interface CounterConfig {
  context: { steps: string[] };
  notifications: { start(): void; follow(): void; go(): void };
}

export class CounterTop extends TopState<CounterConfig> {
  /** Self-posts a follow-up turn → two microsteps inside a single macrostep. */
  start(): void {
    this.ctx.steps.push("start");
    this.notify.follow();
  }
  follow(): void {
    this.ctx.steps.push("follow");
  }
}

@InitialState
export class Idle extends CounterTop {
  go(): void {
    this.ctx.steps.push("go");
    this.hsm.transition(Running);
  }
}

export class Running extends CounterTop {}

registerStateNames(self);

function makeCounter(
  seed: string,
  instrumentation?: ReturnType<
    typeof createIhsmSignalCollector
  >["instrumentation"],
): { actor: TestActor<CounterConfig>; ctx: CounterConfig["context"] } {
  configureRunSeed(seed);
  // Tracing is a cross-cutting concern: register the collector globally before spawning, so the
  // actor adopts it via the global registry (no per-actor `instrumentation` option).
  if (instrumentation !== undefined) registerCollector(instrumentation);
  const ctx: CounterConfig["context"] = { steps: [] };
  const actor: TestActor<CounterConfig> = makeTestActor(
    CounterTop,
    ctx,
    {
      initialize: true,
      traceLevel: TraceLevel.PRODUCTION,
    },
  );
  return { actor, ctx };
}

describe("@ihsm/otel instrumentation (ihsm seam → processed traces)", () => {
  afterEach(() => clearCollectors());

  it("one external ping → one macrostep trace with one step (spec §6.6)", async () => {
    configureRunSeed("otel-test-seed-ping");
    const collector: ReturnType<typeof createIhsmSignalCollector> =
      createIhsmSignalCollector();
    registerCollector(collector.instrumentation);
    const ctx: PingConfig["context"] = { pings: 0 };
    const actor: TestActor<PingConfig> = makeTestActor(
      PingTop,
      ctx,
      {
        initialize: true,
        traceLevel: TraceLevel.PRODUCTION,
      },
    );
    await settle(collector);

    collector.reset();
    actor.notify.ping();
    await settle(collector);

    expect(ctx.pings).equals(1);
    expect(collector.signals.some((s) => s.kind === "macrostep.begin")).equals(
      true,
    );
    expect(collector.signals.some((s) => s.kind === "macrostep.end")).equals(
      true,
    );

    const report: ReturnType<typeof processSignals> = processSignals(
      collector.signals,
    );
    expect(report.traces.length).equals(1);

    const trace: ProcessedTrace = report.traces[0]!;
    assertMacrostepShape(trace, { steps: 1, trigger: "ping", outcome: "ok" });
    assertStepsOrderedByStartTime(trace);
    assertTier1OnEverySpan(trace);
  });

  it("self-posted cascade → one trace with multiple steps, ordered by start time (R0/R1)", async () => {
    const collector: ReturnType<typeof createIhsmSignalCollector> =
      createIhsmSignalCollector();
    const { actor, ctx } = makeCounter(
      "otel-test-seed-cascade",
      collector.instrumentation,
    );
    await settle(collector);

    collector.reset();
    actor.notify.start();
    await settle(collector);

    expect(ctx.steps).eqls(["start", "follow"]);
    const report: ReturnType<typeof processSignals> = processSignals(
      collector.signals,
    );
    expect(report.traces.length).equals(1);
    const trace: ProcessedTrace = report.traces[0]!;
    assertMacrostepShape(trace, { steps: 2, trigger: "start", outcome: "ok" });
    assertStepsOrderedByStartTime(trace);
    assertTier1OnEverySpan(trace);
  });

  it("transitioning event marks the macrostep root transitioned with end state (R1)", async () => {
    const collector: ReturnType<typeof createIhsmSignalCollector> =
      createIhsmSignalCollector();
    const { actor } = makeCounter(
      "otel-test-seed-transition",
      collector.instrumentation,
    );
    await settle(collector);

    collector.reset();
    actor.notify.go();
    await settle(collector);

    const trace: ProcessedTrace = processSignals(collector.signals).traces[0]!;
    const root: ProcessedTrace["spans"][number] = trace.spans.find(
      (s) => s.attributes["ihsm.trigger"] !== undefined,
    )!;
    expect(root.attributes["ihsm.trigger"]).equals("go");
    expect(root.attributes["ihsm.transitioned"]).equals(true);
    expect(root.attributes["ihsm.state.start"]).equals("Idle");
    expect(root.attributes["ihsm.state.end"]).equals("Running");
  });

  it("two separate external stimuli while idle → two traces (R0)", async () => {
    const collector: ReturnType<typeof createIhsmSignalCollector> =
      createIhsmSignalCollector();
    const { actor } = makeCounter(
      "otel-test-seed-two",
      collector.instrumentation,
    );
    await settle(collector);

    collector.reset();
    actor.notify.follow();
    await settle(collector);
    actor.notify.follow();
    await settle(collector);

    const report: ReturnType<typeof processSignals> = processSignals(
      collector.signals,
    );
    assertOneTracePerExternalStimulus(report.traces, 2);
    expect(findTracesByTrigger(report.traces, "follow").length).equals(2);
  });

  it("instrumentation is a pure observer — identical behavior on/off (R6)", async () => {
    const collector: ReturnType<typeof createIhsmSignalCollector> =
      createIhsmSignalCollector();
    const observed: {
      actor: TestActor<CounterConfig>;
      ctx: CounterConfig["context"];
    } = makeCounter("otel-test-seed-r6", collector.instrumentation);
    // Snapshot-at-spawn: the observed actor keeps its collector; clearing first means `plain`
    // spawns with no collector at all — two actors, one traced and one not, in the same process.
    clearCollectors();
    const plain: {
      actor: TestActor<CounterConfig>;
      ctx: CounterConfig["context"];
    } = makeCounter("otel-test-seed-r6");

    await observed.actor.hsm.sync();
    await plain.actor.hsm.sync();

    observed.actor.notify.start();
    plain.actor.notify.start();
    observed.actor.notify.go();
    plain.actor.notify.go();
    await observed.actor.hsm.sync();
    await observed.actor.hsm.sync();
    await plain.actor.hsm.sync();
    await plain.actor.hsm.sync();

    expect(observed.ctx.steps).eqls(plain.ctx.steps);
    expect(observed.ctx.steps).eqls(["start", "go", "follow"]);
  });

  it("deterministic actor uuid from runSeed + path (R2)", () => {
    configureRunSeed("otel-test-seed-uuid");
    const a: ReturnType<typeof mintActorIdentity> = mintActorIdentity(
      "test",
      "Ping",
    );
    const b: ReturnType<typeof mintActorIdentity> = mintActorIdentity(
      "test",
      "Ping",
    );
    expect(a.uuid).equals(b.uuid);
    configureRunSeed("otel-test-seed-other");
    const c: ReturnType<typeof mintActorIdentity> = mintActorIdentity(
      "test",
      "Ping",
    );
    expect(c.uuid).not.equals(a.uuid);
  });
});
