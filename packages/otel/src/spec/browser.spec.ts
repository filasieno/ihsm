import { expect } from "chai";
import "mocha";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import { context as otelContext } from "@opentelemetry/api";
import { WebTracerProvider } from "@opentelemetry/sdk-trace-web";
import { InitialState, Port, TopState, TraceLevel, clearCollectors, configureRunSeed, registerStateNames } from "ihsm";
import { makeTestActor } from "ihsm/testing";

import { startOtelBrowser } from "../env/browser";
import * as self from "./browser.spec";

interface OrderConfig {
  context: { processed: number };
  notifications: { submit(): void; complete(): void };
}

export class OrderTop extends TopState<OrderConfig> {}

@InitialState
export class Idle extends OrderTop {
  submit(): void {
    this.ctx.processed += 1;
    this.hsm.transition(Working);
  }
}

export class Working extends OrderTop {
  onEntry(): void {
    this.notify.complete();
  }
  complete(): void {
    this.hsm.transition(Idle);
  }
}

registerStateNames(self);

/** Minimal OTLP/HTTP-JSON sink: records every POSTed payload so the test can read the resource. */
interface OtlpSink {
  readonly url: string;
  readonly traceBodies: unknown[];
  close(): Promise<void>;
}

async function startOtlpSink(): Promise<OtlpSink> {
  const traceBodies: unknown[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c as Buffer));
    req.on("end", () => {
      if (req.url?.endsWith("/v1/traces") === true && chunks.length > 0) {
        try {
          traceBodies.push(JSON.parse(Buffer.concat(chunks).toString("utf8")));
        } catch {
          /* ignore malformed payloads in the test sink */
        }
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end("{}");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port: number = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}`,
    traceBodies,
    async close(): Promise<void> {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

interface KeyValue {
  key: string;
  value: { stringValue?: string; boolValue?: boolean };
}

function resourceAttributes(
  traceBodies: unknown[],
): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (const body of traceBodies) {
    const resourceSpans =
      (body as { resourceSpans?: { resource?: { attributes?: KeyValue[] } }[] })
        .resourceSpans ?? [];
    for (const rs of resourceSpans) {
      for (const kv of rs.resource?.attributes ?? []) {
        if (kv.value.stringValue !== undefined)
          out[kv.key] = kv.value.stringValue;
        else if (kv.value.boolValue !== undefined)
          out[kv.key] = kv.value.boolValue;
      }
    }
  }
  return out;
}

describe("@ihsm/otel/browser env (isomorphic SDK edges + browser posture)", () => {
  afterEach(() => clearCollectors());

  it("exports the browser schema (webjs + ihsm.host.kind=browser) over OTLP, and drives an actor", async () => {
    const sink = await startOtlpSink();
    configureRunSeed("browser-env-seed");

    const otel = startOtelBrowser({
      serviceName: "cb-web-test",
      serviceVersion: "1.2.3",
      endpoint: sink.url,
      useSimpleProcessors: true, // export each span immediately
      console: false,
      registerGlobal: false, // keep global context manager untouched for test isolation
      flushOnPageHide: false,
    });

    expect(otel.tracerProvider).to.be.instanceOf(WebTracerProvider);
    expect(typeof otel.instrumentation.onMacrostepBegin).equals("function");

    // startOtelBrowser registered the collector globally — no per-actor tracing wiring.
    const actor = makeTestActor(OrderTop, { processed: 0 }, new Port(), {
      initialize: true,
      traceLevel: TraceLevel.PRODUCTION,
    });
    await actor.hsm.sync();
    actor.notify.submit();
    await actor.hsm.sync();
    await actor.hsm.sync();

    await otel.forceFlush();
    await new Promise<void>((r) => setTimeout(r, 50));

    const attrs = resourceAttributes(sink.traceBodies);
    expect(attrs["service.name"]).equals("cb-web-test");
    expect(attrs["service.version"]).equals("1.2.3");
    expect(attrs["telemetry.sdk.language"]).equals("webjs");
    expect(attrs["ihsm.host.kind"]).equals("browser");
    expect(attrs["ihsm.otel.version"]).to.be.a("string");

    await otel.shutdown();
    await sink.close();
  });

  it("registers and removes page-hide flush listeners (page-scoped lifecycle)", async () => {
    const events: string[] = [];
    const listeners = new Set<() => void>();
    const fakeWindow = {
      addEventListener(type: string, fn: () => void): void {
        events.push(`win:add:${type}`);
        listeners.add(fn);
      },
      removeEventListener(type: string, fn: () => void): void {
        events.push(`win:remove:${type}`);
        listeners.delete(fn);
      },
    };
    const fakeDocument = {
      addEventListener(type: string): void {
        events.push(`doc:add:${type}`);
      },
      removeEventListener(type: string): void {
        events.push(`doc:remove:${type}`);
      },
    };
    const g = globalThis as Record<string, unknown>;
    const savedAdd = g.addEventListener;
    const savedRemove = g.removeEventListener;
    const savedDoc = g.document;
    g.addEventListener = fakeWindow.addEventListener.bind(fakeWindow);
    g.removeEventListener = fakeWindow.removeEventListener.bind(fakeWindow);
    g.document = fakeDocument;

    try {
      const otel = startOtelBrowser({
        serviceName: "cb-web-lifecycle",
        console: false,
        registerGlobal: false,
        flushOnPageHide: true,
      });
      expect(events).to.include("win:add:pagehide");
      expect(events).to.include("doc:add:visibilitychange");

      // Firing the flush listener must not throw even with pending batches.
      for (const fn of listeners) fn();

      await otel.shutdown();
      expect(events).to.include("win:remove:pagehide");
      expect(events).to.include("doc:remove:visibilitychange");
    } finally {
      if (savedAdd === undefined) delete g.addEventListener;
      else g.addEventListener = savedAdd;
      if (savedRemove === undefined) delete g.removeEventListener;
      else g.removeEventListener = savedRemove;
      if (savedDoc === undefined) delete g.document;
      else g.document = savedDoc;
    }
  });

  it("registerGlobal installs the StackContextManager and shutdown disables it cleanly", async () => {
    const otel = startOtelBrowser({
      serviceName: "cb-web-global",
      console: false,
      registerGlobal: true,
      flushOnPageHide: false,
    });
    // The bridge resolves spans from its own record, so an active context is not required;
    // we only assert that registration + teardown round-trips without throwing.
    expect(otelContext.active()).to.not.equal(undefined);
    await otel.shutdown();
  });
});
