import { expect } from "chai";
import "mocha";

import { context as otelContext, trace } from "@opentelemetry/api";
import type { Tracer } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import type { ReadableSpan } from "@opentelemetry/sdk-trace-base";
import { InitialState, Port, TopState, TraceLevel, clearCollectors, configureRunSeed, registerCollector, registerStateNames } from "ihsm";
import type { ExternalActor } from "ihsm/types";
import { makeTestActor, settleAll } from "ihsm/testing";
import type { TestActor } from "ihsm/testing";

import { createOtelInstrumentation } from "../bridge";
import { ATTR } from "../semconv";
import { popActiveUserSpan, pushActiveUserSpan } from "../user-anchor";
import * as self from "./extended-tracing.spec";

interface WorkerConfig {
  context: {};
  services: {
    echo(input: string): Promise<string>;
  };
}

class WorkerTop extends TopState<WorkerConfig> {
  async echo(input: string): Promise<string> {
    return input;
  }
}

@InitialState
class WorkerIdle extends WorkerTop {}

interface RequesterConfig {
  context: { tracer: Tracer };
  notifications: {
    go(): Promise<void>;
  };
  port: RequesterPort;
}

class RequesterPort extends Port<typeof RequesterTop> {
  target?: ExternalActor<WorkerConfig>;

  syncCall(): void {
    if (this.target === undefined) throw new Error("missing target");
    void this.target.call.echo("sync");
  }

  async asyncCall(): Promise<void> {
    if (this.target === undefined) throw new Error("missing target");
    await this.target.call.echo("async");
  }
}

class RequesterTop extends TopState<RequesterConfig> {
  async go(): Promise<void> {
    const span: ReturnType<Tracer["startSpan"]> =
      this.ctx.tracer.startSpan("user.notify-anchor");
    const ctx: ReturnType<typeof trace.setSpan> = trace.setSpan(
      otelContext.active(),
      span,
    );
    pushActiveUserSpan(span);
    await otelContext.with(ctx, async () => {
      this.hsm.port.syncCall();
      await this.hsm.port.asyncCall();
    });
    popActiveUserSpan(span);
    span.end();
  }
}

@InitialState
class RequesterIdle extends RequesterTop {}

interface InitConfig {
  context: {};
  notifications: { go(): void };
}

class InitTop extends TopState<InitConfig> {
  go(): void {
    this.hsm.transition(InitB);
  }
}

@InitialState
class InitA extends InitTop {}

class InitB extends InitTop {}

@InitialState
class InitBLeaf extends InitB {}

registerStateNames(self);

describe("@ihsm/otel extended tracing coverage", () => {
  afterEach(() => clearCollectors());

  it("keeps port spans in caller trace and links call traces bidirectionally", async () => {
    configureRunSeed("extended-port-call");
    const spans: InMemorySpanExporter = new InMemorySpanExporter();
    const contextManager: AsyncLocalStorageContextManager =
      new AsyncLocalStorageContextManager().enable();
    otelContext.setGlobalContextManager(contextManager);
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

    const worker: TestActor<WorkerConfig> = makeTestActor(
      WorkerTop,
      {},
      {
        initialize: true,
        traceLevel: TraceLevel.PRODUCTION,
      },
    );
    const requesterPort: RequesterPort = new RequesterPort();
    requesterPort.target = worker;
    const requester: TestActor<RequesterConfig> = makeTestActor(
      RequesterTop,
      { tracer: tracerProvider.getTracer("user") },
      requesterPort,
      {
        initialize: true,
        traceLevel: TraceLevel.PRODUCTION,
      },
    );

    await settleAll(worker, requester);
    requester.notify.go();
    await settleAll(worker, requester);

    const finished: ReadableSpan[] = spans.getFinishedSpans();
    const requesterRoot: ReadableSpan | undefined = finished.find(
      (s) =>
        s.attributes[ATTR.trigger] === "go" &&
        s.attributes[ATTR.actorName] === "Requester",
    );
    expect(requesterRoot).to.not.equal(undefined);
    const requesterTraceId: string = requesterRoot!.spanContext().traceId;
    const requesterTrace: ReadableSpan[] = finished.filter(
      (s) => s.spanContext().traceId === requesterTraceId,
    );
    const portSpans: ReadableSpan[] = requesterTrace.filter((s) =>
      s.name.startsWith("port "),
    );
    const sameTraceForPortSpans: boolean = portSpans.every(
      (s) => s.spanContext().traceId === requesterTraceId,
    );
    const hasExecuteSpan: boolean = requesterTrace.some((s) =>
      s.name.startsWith("execute "),
    );
    expect(portSpans.length).to.be.greaterThan(0);
    expect(sameTraceForPortSpans).equals(true);
    expect(hasExecuteSpan, "new step naming must be used").equals(true);

    const workerRoots: ReadableSpan[] = finished.filter(
      (s) =>
        s.attributes[ATTR.actorName] === "Worker" &&
        s.attributes[ATTR.trigger] !== undefined,
    );
    expect(workerRoots.length).to.be.greaterThan(0);
    const workerTraceIds: Set<string> = new Set(
      workerRoots.map((s) => s.spanContext().traceId),
    );

    const outboundCalls: ReadableSpan[] = finished.filter((s) =>
      s.name.startsWith("call echo"),
    );
    expect(outboundCalls.length).to.be.greaterThan(0);
    const userAnchor: ReadableSpan | undefined = finished.find(
      (s) => s.name === "user.notify-anchor",
    );
    const userAnchorSeenMessage: string = `user routine span exists (seen: ${finished.map((s) => s.name).join(", ")})`;
    const forwardLinkMessage: string = `forward link anchors on current user span (links: ${userAnchor?.links.map((l) => `${l.context.traceId}:${String(l.attributes?.[ATTR.linkKind] ?? "")}`).join(", ")})`;
    const hasForwardLink: boolean =
      userAnchor?.links.some(
        (link) => link.attributes?.[ATTR.linkKind] === "causes",
      ) ?? false;
    expect(userAnchor, userAnchorSeenMessage).to.not.equal(undefined);
    expect(hasForwardLink, forwardLinkMessage).equals(true);
    const back: boolean = workerRoots.some((span) =>
      span.links.some(
        (link) =>
          link.context.traceId !== span.spanContext().traceId &&
          link.attributes?.[ATTR.linkKind] === "caused_by",
      ),
    );
    expect(back, "reciprocal link worker -> requester").equals(true);
    expect(workerTraceIds.size).to.be.greaterThan(0);

    unregister();
    await tracerProvider.shutdown();
    contextManager.disable();
  });

  it("emits initialize spans when transition drills down initial substates", async () => {
    configureRunSeed("extended-initialize-span");
    const spans: InMemorySpanExporter = new InMemorySpanExporter();
    const tracerProvider: BasicTracerProvider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(spans)],
    });
    const instrumentation: ReturnType<typeof createOtelInstrumentation> =
      createOtelInstrumentation({
        tracer: tracerProvider.getTracer("test"),
        clock: "virtual",
      });
    const unregister: () => void = registerCollector(instrumentation);

    const actor: TestActor<InitConfig> = makeTestActor(
      InitTop,
      {},
      {
        initialize: true,
        traceLevel: TraceLevel.PRODUCTION,
      },
    );
    await settleAll(actor);
    const goNotify: unknown = (actor.notify as Record<string, unknown>).go;
    const goNotifyNow: unknown = (actor.notifyNow as Record<string, unknown>)
      .go;
    const goCall: unknown = (actor.call as Record<string, unknown>).go;
    if (typeof goNotify === "function") {
      goNotify.apply(actor.notify);
    } else if (typeof goNotifyNow === "function") {
      goNotifyNow.apply(actor.notifyNow);
    } else if (typeof goCall === "function") {
      await Promise.resolve(goCall.apply(actor.call));
    } else {
      throw new Error("go handler not exposed on notify/notifyNow/call");
    }
    await settleAll(actor);

    const initialize: ReadableSpan | undefined = spans
      .getFinishedSpans()
      .find((s) => s.name.startsWith("initialize "));
    expect(initialize, "initialize drill-down span").to.not.equal(undefined);

    unregister();
    await tracerProvider.shutdown();
  });
});
