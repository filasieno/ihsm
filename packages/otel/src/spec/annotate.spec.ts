import { expect } from "chai";
import "mocha";

import { trace } from "@opentelemetry/api";
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { InitialState, Port, TopState, TraceLevel, clearCollectors, configureRunSeed, registerCollector, registerStateNames } from "ihsm";
import { makeTestActor, settleAll } from "ihsm/testing";
import type { TestActor } from "ihsm/testing";
import type { ReadableSpan } from "@opentelemetry/sdk-trace-base";

import { createOtelInstrumentation } from "../bridge";
import { getActiveSpanContext, traceSpanAsync } from "../annotate";
import * as self from "./annotate.spec";

interface AnnotateConfig {
  context: { anchorSpanId?: string };
  notifications: { run(): Promise<void> };
}

class AnnotateTop extends TopState<AnnotateConfig> {
  async run(): Promise<void> {
    this.ctx.anchorSpanId = getActiveSpanContext()?.spanId;
    await traceSpanAsync("user.helper", async () => {
      await Promise.resolve();
    });
  }
}

@InitialState
class AnnotateIdle extends AnnotateTop {}

registerStateNames(self);

describe("@ihsm/otel annotation toolkit", () => {
  afterEach(() => clearCollectors());

  it("nests user helper spans under the current execute step", async () => {
    configureRunSeed("annotate-helper");
    const spans: InMemorySpanExporter = new InMemorySpanExporter();
    const tracerProvider: BasicTracerProvider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(spans)],
    });
    trace.setGlobalTracerProvider(tracerProvider);
    const instrumentation: ReturnType<typeof createOtelInstrumentation> =
      createOtelInstrumentation({
        tracer: tracerProvider.getTracer("test"),
        clock: "virtual",
      });
    const unregister: () => void = registerCollector(instrumentation);

    const actor: TestActor<AnnotateConfig> = makeTestActor(
      AnnotateTop,
      { anchorSpanId: undefined },
      new Port(),
      {
        initialize: true,
        traceLevel: TraceLevel.PRODUCTION,
      },
    );
    await settleAll(actor);
    actor.notify.run();
    await settleAll(actor);

    const finished: ReadableSpan[] = spans.getFinishedSpans();
    const step: ReadableSpan | undefined = finished.find(
      (s) =>
        s.name.startsWith("execute run ") &&
        s.attributes["ihsm.event"] === "run",
    );
    const helper: ReadableSpan | undefined = finished.find(
      (s) => s.name === "user.helper",
    );
    expect(step).to.not.equal(undefined);
    expect(helper).to.not.equal(undefined);
    expect(helper!.spanContext().traceId).equals(step!.spanContext().traceId);
    const stepSpanId: string = step!.spanContext().spanId;
    const activeAnchorMessage: string =
      "outside handler there is no active anchor";
    expect(helper!.parentSpanContext?.spanId).equals(stepSpanId);
    expect(actor.ctx.anchorSpanId).equals(step!.spanContext().spanId);
    expect(getActiveSpanContext(), activeAnchorMessage).equals(undefined);

    unregister();
    await tracerProvider.shutdown();
  });
});
