import { expect } from "chai";
import "mocha";

import { SpanStatusCode } from "@opentelemetry/api";
import { InMemoryLogRecordExporter, LoggerProvider, SimpleLogRecordProcessor } from "@opentelemetry/sdk-logs";
import type { ReadableLogRecord } from "@opentelemetry/sdk-logs";
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import type { ReadableSpan } from "@opentelemetry/sdk-trace-base";
import { InitialState, Port, TopState, TraceLevel, clearCollectors, configureRunSeed, registerCollector, registerStateNames } from "ihsm";
import { makeTestActor } from "ihsm/testing";

import { createOtelInstrumentation } from "../bridge";
import { ATTR, SPAN } from "../semconv";
import * as self from "./bridge.spec";

interface OrderConfig {
  context: { processed: number };
  notifications: {
    submit(): void;
    complete(): void;
    reset(): void;
    fail(): void;
  };
}

export class OrderTop extends TopState<OrderConfig> {}

@InitialState
export class Idle extends OrderTop {
  submit(): void {
    this.ctx.processed += 1;
    this.hsm.transition(Processing);
  }
}

export class Processing extends OrderTop {
  onEntry(): void {
    this.notify.complete();
  }

  complete(): void {
    this.hsm.transition(Done);
  }
}

export class Done extends OrderTop {
  reset(): void {
    this.hsm.transition(Idle);
  }

  fail(): void {
    throw new Error("order reconciliation failed");
  }
}

registerStateNames(self);

interface Harness {
  readonly spans: InMemorySpanExporter;
  readonly logRecords: InMemoryLogRecordExporter;
  readonly instrumentation: ReturnType<typeof createOtelInstrumentation>;
  shutdown(): Promise<void>;
}

function buildOtel(): Harness {
  const spans = new InMemorySpanExporter();
  const tracerProvider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(spans)],
  });
  const logRecords = new InMemoryLogRecordExporter();
  const loggerProvider = new LoggerProvider({
    processors: [new SimpleLogRecordProcessor(logRecords)],
  });
  const instrumentation = createOtelInstrumentation({
    tracer: tracerProvider.getTracer("test"),
    logger: loggerProvider.getLogger("test"),
    clock: "virtual",
  });
  // Tracing is a cross-cutting concern: register globally before spawning the actor under test.
  const unregister = registerCollector(instrumentation);
  return {
    spans,
    logRecords,
    instrumentation,
    async shutdown(): Promise<void> {
      unregister();
      await tracerProvider.shutdown();
      await loggerProvider.shutdown();
    },
  };
}

async function settle(sync: () => Promise<void>): Promise<void> {
  await sync();
  for (let i = 0; i < 5; ++i) await new Promise<void>((r) => setTimeout(r, 0));
}

function tier1Present(span: ReadableSpan): boolean {
  const a = span.attributes;
  return (
    typeof a[ATTR.actorUuid] === "string" &&
    typeof a[ATTR.actorName] === "string" &&
    typeof a[ATTR.state] === "string"
  );
}

describe("@ihsm/otel bridge (ihsm seam → real OTEL spans/logs)", () => {
  afterEach(() => clearCollectors());

  it("maps one external stimulus to one macrostep trace with step + transition spans", async () => {
    configureRunSeed("bridge-ok");
    const otel = buildOtel();
    const actor = makeTestActor(OrderTop, { processed: 0 }, {
      initialize: true,
      traceLevel: TraceLevel.PRODUCTION,
    });
    await settle(() => actor.hsm.sync());

    actor.notify.submit();
    await settle(() => actor.hsm.sync());

    const all: ReadableSpan[] = otel.spans.getFinishedSpans();
    const root = all.find((s) => s.attributes[ATTR.trigger] === "submit");
    expect(root, "submit macrostep root span").to.not.equal(undefined);
    expect(root!.name, "macrostep root span name").to.equal("Order.submit");
    const traceId: string = root!.spanContext().traceId;
    const inTrace = all.filter((s) => s.spanContext().traceId === traceId);
    const steps = inTrace.filter((s) => s.name.startsWith(SPAN.step));
    const transitions = inTrace.filter((s) =>
      s.name.startsWith(SPAN.transition),
    );
    const exits = inTrace.filter((s) => s.name.startsWith(`${SPAN.exit} `));
    const entries = inTrace.filter((s) =>
      s.name.startsWith(`${SPAN.entry} `),
    );

    expect(root!.attributes[ATTR.outcome]).equals("ok");
    expect(root!.attributes[ATTR.steps]).equals(2); // submit + self-posted complete
    expect(root!.attributes[ATTR.stateEnd]).equals("Done");
    expect(root!.attributes[ATTR.triggerKind]).equals("external");
    expect(steps.length).equals(2);
    expect(transitions.length).to.be.greaterThanOrEqual(2); // Idle→Processing, Processing→Done
    expect(entries.length).to.be.greaterThan(0);
    expect(
      inTrace.some((s) => s.name.startsWith("ihsm.exit")),
      "legacy hook names should be absent",
    ).equals(false);
    expect(
      inTrace.some((s) => s.name.startsWith("ihsm.entry")),
      "legacy hook names should be absent",
    ).equals(false);
    // every span carries Tier-1 and is parented within the macrostep
    expect(inTrace.every(tier1Present)).equals(true);
    expect(
      steps.every(
        (s) => s.parentSpanContext?.spanId === root!.spanContext().spanId,
      ),
    ).equals(true);
    // step spans ordered by start time (implicit sequence)
    for (let i = 1; i < steps.length; ++i)
      expect(
        steps[i]!.startTime[0] * 1e9 + steps[i]!.startTime[1],
      ).to.be.greaterThanOrEqual(
        steps[i - 1]!.startTime[0] * 1e9 + steps[i - 1]!.startTime[1],
      );

    await otel.shutdown();
  });

  it("emits a derived INFO log per macrostep, trace-correlated", async () => {
    configureRunSeed("bridge-log");
    const otel = buildOtel();
    const actor = makeTestActor(OrderTop, { processed: 0 }, {
      initialize: true,
      traceLevel: TraceLevel.PRODUCTION,
    });
    await settle(() => actor.hsm.sync());
    actor.notify.submit();
    await settle(() => actor.hsm.sync());

    const logs: ReadableLogRecord[] = otel.logRecords.getFinishedLogRecords();
    const submitLog = logs.find(
      (l) =>
        l.attributes[ATTR.macrostepId] !== undefined &&
        l.attributes[ATTR.outcome] === "ok" &&
        String(l.body).includes("Done"),
    );
    expect(submitLog, "a macrostep INFO log").to.not.equal(undefined);
    expect(
      submitLog!.spanContext?.traceId,
      "log is correlated to a trace",
    ).to.be.a("string");
    expect(submitLog!.attributes[ATTR.actorUuid]).to.be.a("string");

    await otel.shutdown();
  });

  it("marks the error path: ERROR status, ihsm.outcome=error, exception + ERROR log", async () => {
    configureRunSeed("bridge-err");
    const otel = buildOtel();
    const actor = makeTestActor(OrderTop, { processed: 0 }, {
      initialize: true,
      traceLevel: TraceLevel.PRODUCTION,
      dispatchErrorCallback: (): void => {
        /* swallow so the test can inspect telemetry */
      },
    });
    await settle(() => actor.hsm.sync());
    actor.notify.submit(); // → Done
    await settle(() => actor.hsm.sync());
    actor.notify.fail(); // throws in Done
    await settle(() => actor.hsm.sync());

    const all: ReadableSpan[] = otel.spans.getFinishedSpans();
    const failRoot = all.find((s) => s.attributes[ATTR.trigger] === "fail");
    expect(failRoot, "fail macrostep root").to.not.equal(undefined);
    expect(failRoot!.attributes[ATTR.outcome]).equals("error");
    expect(failRoot!.status.code).equals(SpanStatusCode.ERROR);
    expect(failRoot!.attributes[ATTR.errorKind]).to.be.a("string");

    const failTrace = all.filter(
      (s) => s.spanContext().traceId === failRoot!.spanContext().traceId,
    );
    const withException = failTrace.some((s) =>
      s.events.some((e) => e.name === "exception"),
    );
    expect(
      withException,
      "an exception event on a span in the fail trace",
    ).equals(true);

    const logs: ReadableLogRecord[] = otel.logRecords.getFinishedLogRecords();
    const errorLog = logs.find(
      (l) => l.attributes[ATTR.errorKind] !== undefined,
    );
    expect(errorLog, "an ERROR log with ihsm.error.kind").to.not.equal(
      undefined,
    );

    await otel.shutdown();
  });

  it("is deterministic: same run seed → identical actor uuid on spans", async () => {
    const uuidFor = async (seed: string): Promise<string> => {
      configureRunSeed(seed);
      const otel = buildOtel();
      const actor = makeTestActor(OrderTop, { processed: 0 }, {
        initialize: true,
        traceLevel: TraceLevel.PRODUCTION,
      });
      await settle(() => actor.hsm.sync());
      actor.notify.submit();
      await settle(() => actor.hsm.sync());
      const root = otel.spans
        .getFinishedSpans()
        .find((s) => s.attributes[ATTR.trigger] !== undefined);
      const uuid = String(root!.attributes[ATTR.actorUuid]);
      await otel.shutdown();
      return uuid;
    };

    const a: string = await uuidFor("determinism-seed");
    const b: string = await uuidFor("determinism-seed");
    const c: string = await uuidFor("a-different-seed");
    expect(a).equals(b);
    expect(a).to.not.equal(c);
  });
});
