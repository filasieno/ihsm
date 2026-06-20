/**
 * End-to-end demo: drive an ihsm actor with the OTEL bridge attached and export real traces + logs
 * to an OpenTelemetry collector (the grafana/otel-lgtm dev stack), then flush and shut down.
 *
 * Run (from packages/otel):
 *   OTEL_ENDPOINT=http://localhost:14318 npx ts-node --transpile-only examples/grafana-demo.ts
 *
 * Then query in Grafana / via the Grafana MCP:
 *   Tempo:  { resource.service.name = "ihsm-otel-demo" }
 *   Loki:   { service_name = "ihsm-otel-demo" }
 */

import {
  InitialState,
  Port,
  TopState,
  TraceLevel,
  configureRunSeed,
  makeActor,
  registerStateNames,
} from "ihsm";

import { startOtelNode } from "../src/env/node";

interface OrderConfig {
  context: { processed: number; failures: number };
  notifications: {
    submit(id: string): void;
    complete(): void;
    reset(): void;
    fail(): void;
  };
}

class OrderTop extends TopState<OrderConfig> {}

@InitialState
class Idle extends OrderTop {
  submit(_id: string): void {
    this.ctx.processed += 1;
    this.hsm.transition(Processing);
  }
}

class Processing extends OrderTop {
  onEntry(): void {
    // self-post a follow-up → a second microstep in the SAME macrostep (one trace, two steps)
    this.notify.complete();
  }

  complete(): void {
    this.hsm.transition(Done);
  }
}

class Done extends OrderTop {
  reset(): void {
    this.hsm.transition(Idle);
  }

  fail(): void {
    this.ctx.failures += 1;
    throw new Error("order reconciliation failed");
  }
}

registerStateNames({ OrderTop, Idle, Processing, Done });

async function main(): Promise<void> {
  configureRunSeed("grafana-demo-seed-v1");

  const otel = startOtelNode({
    serviceName: "ihsm-otel-demo",
    serviceVersion: "0.1.0",
    endpoint: process.env.OTEL_ENDPOINT ?? "http://localhost:14318",
    useSimpleProcessors: true, // flush immediately for a short script
    console: false,
    resourceAttributes: { "deployment.environment.name": "dev" },
  });

  // startOtelNode already registered the collector globally — actor construction stays tracing-free.
  const actor = makeActor(OrderTop, { processed: 0, failures: 0 }, {
    initialize: true,
    // PRODUCTION silences the legacy console TraceWriter; the OTEL bridge still receives every signal.
    traceLevel: TraceLevel.PRODUCTION,
    // Swallow the deliberate demo error so the script keeps running and flushes telemetry.
    dispatchErrorCallback: (_hsm, err: Error): void =>
      console.log(`captured dispatch error: ${err.message}`),
  });
  console.log(
    `actor uuid = ${actor.hsm.actorUuid}  name = ${actor.hsm.actorName}`,
  );
  await actor.hsm.sync();

  // Macrostep 1: submit → Processing.onEntry self-posts complete → Done (multi-step, 2 transitions, 1 trace).
  actor.notify.submit("order-1001");
  await actor.hsm.sync();
  await actor.hsm.sync();

  // Macrostep 2: reset Done → Idle.
  actor.notify.reset();
  await actor.hsm.sync();

  // Macrostep 3: another order, ending in Done.
  actor.notify.submit("order-1002");
  await actor.hsm.sync();
  await actor.hsm.sync();

  // Macrostep 4: an error path — fail() throws inside Done (error trace + error log).
  actor.notify.fail();
  await actor.hsm.sync();
  await actor.hsm.sync();

  await otel.forceFlush();
  await new Promise((r) => setTimeout(r, 500));
  await otel.shutdown();
  console.log(
    "flushed + shut down; check Tempo/Loki for service.name = ihsm-otel-demo",
  );
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
