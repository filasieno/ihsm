# 8. TESTING & DEVTOOLS

Determinism is the product, so the test story is first-class. `@ihsm/react/testing` mounts a **real
React tree** against a **mock-port** InteractionActor, drives Intents and scripted Model events,
advances a **virtual clock**, and asserts **golden ViewModel traces**. `@ihsm/react/devtools` is the
live inspector built on the same seam.

## 8.1 The harness: `renderInteraction`

```ts
import { renderInteraction } from '@ihsm/react/testing';

const h = renderInteraction(<Screen />, {
  Top: TodoTop,
  makeCtx: makeTodoCtx,
  port: makeMockTodoPort(),     // mocks applyOp/cancelOp/loadChildren; records calls
  seed: 1234,                   // seeds any PRNG in the port
});
```

`renderInteraction` returns a handle that fuses **React Testing Library** with the **ihsm test
actor**:

| Member | Purpose |
|--------|---------|
| `h.screen` | RTL queries (`getByRole`, `findByRole`, …) over the mounted tree. |
| `h.user` | `@testing-library/user-event` instance for real keystrokes/Tab/IME. |
| `h.actor` | The `makeTestActor` handle — full protocol + `subscribe`. |
| `h.port` | The mock port: `port.send('onAck', opId, id, rev)`, `port.calls`, `port.advance(ms)`. |
| `h.vm()` | The current published ViewModel (immutable). |
| `h.trace` | The recorded sequence of published VMs (golden trace). |
| `h.sync()` | `await actor.hsm.sync()` then flush React act() — drain both queues to a barrier. |

Two testing modes, mirroring the ihsm examples:

- **Black-box (DOM-driven):** type with `h.user`, settle the "server" with `h.port.send(...)`,
  assert on `h.screen` and `h.vm()`. Proves the Surface + actor + bridge together.
- **White-box (Intent-driven):** post Intents directly via `h.actor.notify.*` to walk a specific
  matrix cell without DOM, then assert the VM verdict.

## 8.2 A worked black-box test (Step 1 button)

```ts
it('archive command is optimistic and settles on ack', async () => {
  const h = renderInteraction(<Screen />, opts);
  await h.sync();

  await h.user.click(h.screen.getByRole('button', { name: /archive all/i }));
  await h.sync();

  expect(h.vm().commands.archiveAll).to.equal('pending');         // optimistic
  expect(h.port.calls).to.deep.equal([{ m: 'applyOp', opId: 1, patch: { archiveAll: true } }]);

  h.port.send('onAck', 1);                                        // server replies when WE decide
  await h.sync();

  expect(h.vm().commands.archiveAll).to.equal('idle');            // settled
});
```

No wall-clock waiting, no flake: `port.send` and `port.advance` make the "network" and "clock"
explicit inputs.

## 8.3 The seeded fuzzer: `InteractionFuzzer` (R11)

The 10/10 guarantee. A seeded generator drives a random but **reproducible** interleaving of
Intents and Model events, and asserts the invariants after every step. A red run is replayed from
its seed exactly.

```ts
import { InteractionFuzzer } from '@ihsm/react/testing';

it('survives any interleaving of edits, acks, rejects, reorders, and disconnects', async () => {
  const fuzz = new InteractionFuzzer({
    seed: process.env.FUZZ_SEED ? Number(process.env.FUZZ_SEED) : undefined,
    steps: 2000,
    intents: ['beginTransient', 'commitField', 'advance', 'delete', 'reorder', 'requestUndo',
              'selectRange', 'extendSelection', 'sortColumn', 'paste', 'fillDown', 'validateField'],
    modelEvents: ['onAck', 'onReject', 'onServerPatch', 'onDiagnostics',
                  'onDisconnected', 'onConnected', 'onResynced'],
    bundles: [listBundle, tableBundle, treeBundle, treeTableBundle],  // R19/R20 — fuzz across shapes
    render: () => <Screen />,
    opts,
  });

  await fuzz.run({
    invariants: [
      vmMatchesProjection,        // R0: vm deep-equals project(authoritative, hot)
      revMonotonic,               // R7: rev never regresses across publishes
      focusCoordResolvable,       // R6: vm.focus always points at an existing row+field (or null)
      noOrphanInflight,           // every inflight opId is settled or cancelled, never leaked
      undoRedoConsistent,         // R8: undo∘do is identity on the VM (modulo focus)
      reconcileMatrixRespected,   // §5.4: every (state×event) took its declared verdict
      selectionResolvable,        // R15: selection.active/anchor/ranges always point at live cells
      validationConsistent,       // R17: a cell is `invalid` iff it carries a matching ValidationVM
      strategyIsolation,          // R20: no strategy mutated reconciliation/focus/undo state
      capabilityLegality,         // R21: no Intent/event fired outside the negotiated capabilities
      diagnosticInventoryExact,   // R22: vm.errorCount == count of nodes in 'invalid'/'rejected'
    ],
  });
});
```

On failure the fuzzer prints `FUZZ_SEED=<n>` and the minimal failing event sequence (it shrinks).
Re-running with that seed reproduces the exact bug — the core DST loop.

## 8.4 Golden ViewModel traces

Because the VM is immutable and serializable, a session is a list of snapshots you can diff
byte-for-byte across runs:

```ts
it('transient create→commit→ack golden trace', async () => {
  const h = renderInteraction(<Screen />, opts);
  await h.user.type(h.screen.getByRole('textbox', { name: /new/i }), 'Ada');
  await h.user.keyboard('{Tab}');
  await h.sync();
  h.port.send('onAck', 1, /*serverId*/ 42, /*rev*/ 7);
  await h.sync();

  expect(h.trace.map(serializeVm)).to.matchGolden('transient-commit-ack.json');
});
```

The golden also asserts the **client id stayed constant** through the ack (so focus was preserved)
and that exactly one `<Row>` changed reference per step (R12 structural sharing).

## 8.5 Conformance matrix (requirement → test)

| Req | Conformance assertion |
|-----|------------------------|
| R0 | `vmMatchesProjection` invariant in every fuzz step; no `useState` of authoritative data (lint rule `no-authoritative-local-state`). |
| R1 | A render counter asserts a component re-renders iff its selected slice changed reference. |
| R4 | Black-box: typing then `Tab` materializes a transient and appends a new empty slot. |
| R5 | `user.type` of 20 fast chars + an IME composition yields one `commitField` with the full value; caret stays at end; zero dropped chars. |
| R6 | After `onAck` remaps id, `document.activeElement` is still the same logical cell. |
| R7 | `reconcileMatrixRespected` + dedicated out-of-order-ack and reject-after-re-edit cases. |
| R8 | `undoRedoConsistent`; undo of an in-flight op asserts a `cancelOp` on `h.port.calls`. |
| R9 | Disconnect mid-edit → reconnect → resync golden trace; no inflight op lost. |
| R12 | Reference-equality assertions: one edit ⇒ one changed `RowVM`. |
| R14 | `getServerSnapshot()` deep-equals the first client `getSnapshot()` (no hydration tear). |
| R15 | Range-select + `mod+C`/`mod+V` golden trace; a 3×3 paste yields one journal entry, N `commitField` ops, one undo. Sort/resize/reorder are Intents reflected in the VM. |
| R16 | Property test: for every row in the §5.0 tables, the DOM event (driven via `h.user`) produces exactly the listed Intent (or none); no handler reads/mutates state beyond geometry. |
| R17 | Advisory (default): invalid value accepted, focus advances, `CellVM.validation` set; async path `h.port.advance(debounceMs)` then `onDiagnostics` updates it; `validationMode:'gating'` opt-in blocks `advance`; debounce cancelled on disconnect. |
| R18 | With a mock OTEL provider: a single-cell edit emits one `ihsm.react.commit` with `renders.warm===1`, `renders.cold===0`; a forced cold re-render is flagged `cold_rerender`. |
| R19 | **Recipe equivalence** (§8.7): the four bundles over one dataset produce the documented shapes; the same gesture script passes the same invariants under each bundle. |
| R20 | `strategyIsolation` invariant; a strategy that attempts to write `ctx`/journal fails a frozen-input assertion in dev. |
| R21 | `capabilityLegality` invariant; a `hierarchy:false` build is a **compile** error if it references `expandNode` (type-level test, `tsd`). |
| R22 | Type an invalid value → `state==='invalid'`, focus advanced, `errorCount===1`; `onDiagnostics([])` promotes to `clean`; with `quarantine`, `onAck(quarantined:true)` keeps `invalid` and the mock port recorded a WARN trace. |

## 8.6 Devtools: `@ihsm/react/devtools`

`<InteractionDevtools>` is a dev-only panel (tree-shaken from production) that taps the same
view-sink and the actor's `subscribe` (in dev builds) to show:

- the **live ViewModel** as a collapsible tree, with changed nodes highlighted per publish;
- the **event log** (Intents in, Model events in, VMs out) with timestamps from the virtual/real
  clock;
- **time-travel** over the command journal — step the journal back/forward and watch the VM and the
  React tree update (uses the same undo/redo machinery, so it can't diverge from production
  semantics);
- the **reconciliation matrix** with the live count of how often each cell fired — surfacing dead
  (never-hit) cells and hot paths.

```tsx
import { InteractionDevtools } from '@ihsm/react/devtools';
{import.meta.env.DEV && <InteractionDevtools position="right" />}
```

Because devtools, the fuzzer, and production all consume the **same** immutable-VM stream and the
**same** journal, "what you debugged" and "what you tested" and "what ships" are the identical
mechanism — which is the whole reason for putting the interaction logic in an `ihsm` actor.

## 8.7 Recipe equivalence — the kernel-is-generic proof (R19/R20)

The recipes are the conformance suite, not just examples. One shared *gesture script* and one
*invariant set* run against **all four bundles**, proving the kernel is shape-agnostic:

```ts
import { listBundle, tableBundle, treeBundle, treeTableBundle } from '@ihsm/react/testing/recipes';

describe.each([
  ['list', listBundle], ['table', tableBundle], ['tree', treeBundle], ['treeTable', treeTableBundle],
])('recipe %s reproduces its shape and passes the kernel invariants', (_name, bundle) => {
  it('transient create → commit → ack → edit → undo', async () => {
    const h = renderInteraction(<NodeViewScreen />, { ...opts, bundle });
    await runGestureScript(h, sharedScript);          // identical script for every shape
    expect(h.invariants()).toSatisfyAll(kernelInvariants); // §8.3 list, unchanged
  });
});
```

Plus per-shape **golden VMs** (`list.json`, `table.json`, `tree.json`, `treeTable.json`) assert the
documented projection (e.g. tree publishes only visible nodes; table carries `columns`+`selection`).
A new shape (kanban, pivot, calendar) is "proven" simply by adding its bundle to the `each` list and
a golden — if the kernel invariants hold, the shape is correct **by construction**. This file is the
operational meaning of "the library ships mechanism, not widgets."
