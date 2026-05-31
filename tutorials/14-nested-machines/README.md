# Nested Machines

## Problem

Payment and shipping in one chart couples unrelated concerns — hard to test and evolve independently.

## Solution

Run **separate `Hsm` instances** (orthogonal regions) and coordinate with a small coordinator class.

## UML statechart

Two parallel machines:

```plantuml
@startuml
left to right direction
skinparam ranksep 25
state PaymentTop {
  [*] --> PaymentPending
  PaymentPending --> PaymentDone : markPaid
}
--
state ShippingTop {
  [*] --> ShippingWaiting
  ShippingWaiting --> ShippingDone : markShipped
}
@enduml
```

The `OrderCoordinator` owns both actors and orchestrates `fulfill()`.

Payment region:

```typescript
export class PaymentTop extends HsmTopState<PaymentCtx, PaymentProtocol> implements PaymentProtocol {
	markPaid(): void {
		this.ctx.paid = true;
		this.transition(PaymentDone); // ← payment actor only
	}
}
```

Shipping region — independent queue and cache:

```typescript
export class ShippingTop extends HsmTopState<ShippingCtx, ShippingProtocol> implements ShippingProtocol {
	markShipped(): void {
		this.ctx.shipped = true;
		this.transition(ShippingDone);
	}
}
```

Coordinator composes both:

```typescript
export class OrderCoordinator {
	readonly payment = makeHsm(PaymentTop, { paid: false });
	readonly shipping = makeHsm(ShippingTop, { shipped: false });

	async fulfill(): Promise<void> {
		this.payment.post('markPaid');
		await this.payment.sync();
		this.shipping.post('markShipped');
		await this.shipping.sync();
	}
}
```

## Reading the trace

With `HsmTraceLevel.VERBOSE_DEBUG` and a custom `HsmTraceWriter`, ihsm logs each dispatch step. Trace line format is covered in [Tracing](../02-tracing/README.md).

Each line is **`domain|…|StateName: message`**. Domains nest as the runtime descends: `initialize` → `#eventName` → `execute` → `transition from X to Y`.

On the [documentation page](https://filasieno.github.io/ihsm/tutorials/14-nested-machines), use the embedded playground to dispatch events and inspect the **Trace** panel. Or run `npm run test:tutorials` headlessly.

**What to notice:** Each actor has its own trace stream — payment and shipping queues are independent.

## Verify

```shell
npm run test:tutorials -- --grep 'Tutorial 14'
```

