# 2. REQUIREMENTS

The goals only. Design follows in docs 3–10. Each requirement is testable; doc 8 maps it to a
conformance assertion.

## 2.1 Central requirement

> **R0 — Pure projection.** React renders a pure function of an **immutable ViewModel**. No
> interaction state lives in React (`useState` may hold only ephemeral, non-authoritative input
> buffers — §R5). All interaction logic lives in the InteractionActor and is deterministically
> replayable.

> **The library ships *mechanism*, not *widgets*.** What is reusable — and what `@ihsm/react`
> exports — is the generic interaction **kernel** (the node ViewModel, reconciliation, focus/undo,
> input normalization, the protocol client, tracing) plus a small set of **strategy plug-points**.
> List, Table, Tree, and TreeTable are *not* library components; they are **recipe proofs** built
> from the kernel + strategies and living in the test suite (R19/R20, doc 10). This is the sharpest
> form of "the interaction protocol is the reusable thing, not the control."

## 2.2 Functional requirements

| # | Requirement |
|---|-------------|
| **R1** | **Binding.** A React subtree can subscribe to one InteractionActor and re-render *exactly* when the published ViewModel reference changes, and not otherwise. Slice selectors must allow a component to ignore unrelated VM changes. |
| **R2** | **Intent dispatch.** Components emit typed *Intent events* to the actor (`notify` facet). Dispatch is fire-and-forget; the resulting ViewModel arrives asynchronously via the store. Dispatchers are fully typed from the actor `Config`. |
| **R3** | **Generic, accessible primitives.** The library ships *shape-agnostic* unstyled primitives: a command trigger, an inline editable field, a focus scope with keyboard navigation, an optimistic-state boundary, an undo provider, and a generic **`NodeView`** that renders the node ViewModel (doc 4). It does **not** ship List/Table/Tree/TreeTable — those are recipe proofs (R19). All primitives are behaviour + ARIA only. |
| **R4** | **Transient-record lifecycle.** Typing on a writable trailing slot materializes a transient record; `Tab`/`Enter` commits the field and advances; completing a transient row spawns the next transient; `Esc` abandons. This lifecycle is owned by the actor; *where* the writable slot lives (trailing row, trailing child under an expanded parent) is the `TransientModel` strategy (R20). |
| **R5** | **Controlled-input correctness.** Editable fields must not drop characters, jump the caret, or break IME composition. Local keystroke buffering is permitted; only *semantic* events (begin/commit/cancel/advance) cross into the actor. |
| **R6** | **Focus survival.** When the ViewModel is replaced (including transient→canonical id remap), DOM focus and caret intent are preserved on the logically-same cell. Focus authority is the `{rowId, field}` coordinate, not a DOM node. |
| **R7** | **Optimistic reconciliation (total).** Every `(local-row-state × incoming-model-event)` pair has a defined verdict: ack, reject→rollback, reject-after-re-edit→rebase, server-patch-vs-pending→conflict policy. Out-of-order acks are handled via per-op ids and per-row revisions. |
| **R8** | **Undo/redo.** The actor maintains a command journal. Undo inverts the last user-visible mutation **and** cancels any in-flight op it produced; redo re-applies. The library exposes an undo provider, hook, and default keybindings. |
| **R9** | **Connection lifecycle.** Disconnect, reconnect, and resync are first-class. Unconfirmed ops survive a reconnect (replayed or snapshot-reconciled); the ViewModel exposes a connection/sync status for components to reflect. |
| **R10** | **Bridge contract.** The library defines the message contract between InteractionActor and ModelActor (intents out; `onAck`/`onReject`/`onServerPatch`/`onConnected`/`onDisconnected`/`onResynced` in). It never performs I/O itself; the transport lives in the ModelActor's Port. |
| **R15** | **Tabular interaction (a capability, not a type).** When the negotiated capabilities include `columns`, the node ViewModel carries ordered columns (header, width, alignment, pinned, editable, sortable), a **cell/range selection** model (anchor + active + ranges), multi-column **sort**, per-column **filter**, and **clipboard** (`copy`/`paste`/`fill-down`) — all immutable VM state + Intents, never DOM-local. Column **resize**/**reorder** are Intents. This is a *view* over the same node VM (R19), exercised by the Table recipe. |
| **R16** | **Input normalization (total).** Every handled DOM input (keyboard incl. IME composition, mouse/pointer, wheel, drag) maps through the `Keymap` strategy (R20) to exactly one semantic Intent (or is explicitly ignored). DOM handlers contain *no* business logic — they translate gesture → Intent and nothing else, so the interaction is testable from Intents alone (R0/R11). |
| **R17** | **Interactive validation.** Cells carry validation state in the VM (`invalid` + message + severity). **Synchronous** validation runs inside the actor's projection (pure, replayable); **asynchronous** validation (uniqueness, cross-record) is a bridge round-trip, debounced on the **virtual clock** so it is deterministic. Validation is **advisory by default** (R22); gating is opt-in per field. Validation never lives in React. |
| **R18** | **Observability.** Surface components are classified **hot / warm / cold** (def in doc 9). The Binding integrates with `@ihsm/otel` to trace a full **gesture → macrostep → React commit** span chain (which components re-rendered, by hotness), linked to the macrostep that produced the VM. Hot renders are **aggregated** (counted, not one-span-each) to bound cardinality; tracing is a dev/debug posture and a no-op when no provider is attached. |
| **R19** | **Generic node kernel.** A single immutable `InteractionVM` of ordered, stably-keyed **nodes** (each with optional `parentId`/`depth`/`expanded`, a `fields` map, and a row state) plus optional `columns` expresses **list, table, tree, and tree-table** as the *same* structure under different projection/interaction policy. Every hard invariant (R4–R9, R15–R18, R22) is shape-agnostic — it operates on nodes+cells+focus, never on "tree-ness". |
| **R20** | **Strategy plug-points.** The *only* shape-specific surface is four pluggable strategies: `ProjectModel` (authoritative → visible nodes: sort/filter/flatten/expand), `NavModel` (geometry of `advance`/arrows), `TransientModel` (where the writable slot lives), and `Keymap` (DOM event → Intent). Strategies are pure and **cannot** reach into reconciliation, focus, or undo — those stay kernel-owned. A "widget" *is* a bundle of four strategies (doc 10). |
| **R21** | **Capability-negotiated protocol.** One LSP-like JSON-RPC contract governs the InteractionActor ↔ ModelActor bridge (and, over the wire, the backend). `initialize` negotiates capabilities (`hierarchy`, `columns`, `windowing`, `validationMode`, `batchOps`, `quarantine`); the legal Intent/op/event set is **derived and typed** from the negotiated capabilities. There is **one** protocol, not one per shape (doc 10 §10.4). |
| **R22** | **Error tolerance.** Invalid input is **accepted by default**, not gated: a cell may hold an invalid value in an explicit `invalid-accepted` state (distinct from server `rejected`). Diagnostics are advisory and pushed (LSP `publishDiagnostics` model); the VM exposes an **error inventory** and navigation (`gotoNextDiagnostic`). The backend **quarantines** invalid values in a draft layer and **traces** them (otel WARN), promoting to canonical only when clean. The user repairs interactively; nothing blocks the flow. |

## 2.3 Non-functional requirements

| # | Requirement |
|---|-------------|
| **R11** | **Determinism & testability.** `@ihsm/react/testing` mounts a real React tree against a mock-port actor, drives Intents and scripted model events, advances a virtual clock, and asserts golden ViewModel traces. A seeded `InteractionFuzzer` replays any failing interleaving from its seed. |
| **R12** | **Performance.** Projection uses **structural sharing**: an edit to one row yields a new top-level VM whose unchanged rows keep their references, so per-row memo bails out. Large collections support virtualization. Target: a single-cell edit re-renders O(1) rows, not O(n). |
| **R13** | **Zero-coupling / tree-shakeable.** Root export = Binding (peer-deps `ihsm`, `react`). `surface`, `testing`, `devtools` are separate subpaths. No styling is imposed (headless); no global singletons. |
| **R14** | **SSR / hydration.** `useSyncExternalStore` server-snapshot support: the actor can produce an initial ViewModel synchronously for SSR, and hydration must not tear (server and first client snapshot agree). |

## 2.4 Explicit non-goals (this revision)

- **Multi-user convergence (CRDT/OT).** Reconciliation (R7) is *single-editor* with last-write-wins
  for server pushes. Note R22 deliberately adopts an **accept-everything, mark-validity** stance
  (rather than reject-at-gate) — this is convergence-friendly but **not** concurrent multi-user
  merge, which stays out of scope. The bridge is forward-compatible (a CRDT ModelActor can be
  swapped in without touching the kernel or recipes).
- **Shipping concrete widgets.** List/Table/Tree/TreeTable are recipe **proofs** in the test suite
  (R19/R20), not exported library components this revision. Whether they later graduate to an
  optional `recipes` subpath is a packaging decision that does not affect the kernel.
- **Styling / design system.** Primitives are headless (behavior + ARIA only).
- **Routing, data fetching beyond the bridge, global app state.** Out of scope.
- **Non-React renderers.** The store/actor/kernel core is renderer-agnostic, but only React
  bindings ship here.
