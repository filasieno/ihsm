# 6. CHALLENGES & SOLUTIONS

Each subsection states a hard problem these UIs are notorious for, then the exact mechanism
`@ihsm/react` uses to solve it. These are the items that separate a "looks fine in a demo"
implementation from a 10/10 one.

## 6.1 Controlled inputs without dropped characters or caret jumps (R5)

**Problem.** The classic React controlled-input bug: routing every keystroke through an async store
makes the input value lag the DOM by a tick, so fast typists lose characters and the caret jumps to
the end. IME composition (CJK, dead keys) is mangled because each composition keystroke triggers a
state write.

**Solution — local draft, semantic commit.** `<Field>` is *buffered*:

1. The native input is **uncontrolled during an edit**: the in-progress draft string and caret live
   in the DOM. The library does **not** write each keystroke into the actor.
2. Only **semantic** events cross into the actor: `beginEdit`/`beginTransient` on the first
   meaningful keystroke, `commitField` on `Enter`/`Tab`/blur, `cancelEdit` on `Esc`.
3. The VM carries the **committed** value. A small reconciler applies `vm.value` to the input *only
   when the field is not actively being edited* (i.e. the draft equals the committed value, or the
   field is blurred). During an active edit the **draft wins**.
4. IME: `compositionstart`/`compositionend` gate commits — no event is emitted mid-composition.
5. Optional `livePreview` emits a **throttled** `draftChanged` (via `port.defer` coalescing in the
   actor) for apps that want optimistic preview, off by default so the common path never round-trips.

Result: typing is as fast as a plain `<input>`, yet every *committed* value is a deterministic
Intent the tests can assert.

## 6.2 Focus survival across an immutable-ViewModel swap (R6)

**Problem.** When the VM is replaced (every change is a new reference), React reconciles the list. If
focus identity is tied to a DOM node or array index, the active cell loses focus — especially on the
**transient→canonical id remap**, where a row's "id" appears to change on ack.

**Solution — client id as identity + imperative restore.**

1. **Stable client id.** Every row gets a client-minted `id` at `beginTransient`; it is the React
   `key`, the focus coordinate, and the journal key. The server's `serverId` is a *separate field*
   assigned on ack and **never** used for identity. So an ack does not change any key React sees.
2. **Logical focus in the VM.** `vm.focus = {rowId, field}` is authoritative, computed by the actor
   on `advance`/`focusCell`. It is part of the immutable snapshot.
3. **Imperative re-assert.** `FocusScope` registers each cell's DOM node under its coordinate. In a
   `useLayoutEffect` that runs after every committed render, it compares `document.activeElement` to
   the registered node for `vm.focus`; if they differ (because React re-mounted/re-ordered), it
   refocuses and restores caret position. Because the coordinate is the stable client id, the *same
   logical cell* keeps focus through any VM swap, remap, or reorder.

## 6.3 "When did it change?" with no production `subscribe` (R1)

**Problem.** ihsm's production `ExternalActor` has no `subscribe` (it is test-only). React needs a
change signal.

**Solution — push through the Port boundary into an external store.** The actor is given a
`viewSink` (in `ctx` or as a Port method) and calls `viewSink.publish(vm)` at the end of any turn
whose projection differs. The store fans that out to `useSyncExternalStore` listeners. Immutability
gives the *equality* (skip if `Object.is`), the sink gives the *timing*. This is the supported
analogue of the test `subscribe`, using the same event-bridge pattern ihsm already uses for
child→parent callbacks. (Full code: doc 3 §3.4.)

## 6.4 Undo/redo that also cancels in-flight work (R8)

**Problem.** Undo in an optimistic UI is not "pop a stack and set state": the op being undone may be
*in flight*, or *already confirmed*, and the two require opposite actions.

**Solution — a journal of Intents with op linkage.** Each user-visible mutation pushes a journal
entry `{ intent, opId?, inverse }`. On `requestUndo` (diagram 5.3.6):

- **Op still in flight** → send `cancelOp(opId)` to the ModelActor and remove the optimistic effect.
- **Op confirmed** → enqueue a **compensating op** (the recorded `inverse`) as a new op.
- **No op (pure local, e.g. focus)** → just invert in `ctx`.

The undone entry moves to the redo stack; a new mutation clears redo. Because the journal lives in
the actor and every entry is itself an Intent, the entire undo/redo history is deterministic and
fuzz-tested like any other path. `vm.canUndo`/`canRedo` drive the UI.

## 6.5 Performance: O(1)-row re-render on a single edit (R12)

**Problem.** A naive immutable rebuild allocates a brand-new `rows` array with all-new `RowVM`
objects, so every row's selector result changes and the whole list re-renders on each keystroke
commit.

**Solution — structural sharing + selector bail-out + virtualization.**

1. `project()` reuses the previous `RowVM` reference for every row that did not change, allocating a
   new object only for the edited row(s). Helpers in `viewModel.ts` (`replaceRow`, `patchCell`) do
   this; an Immer-style draft is also supported.
2. Components subscribe via `useSelector` with the default `Object.is`. Unchanged rows yield the
   *same* `RowVM` reference → selector result identical → no re-render. Only the edited `<Row>`
   re-renders.
3. `NodeView` accepts `virtualize` for windowed rendering (rows and columns) so even the *mounted*
   set is bounded for large data.
4. The actor coalesces high-frequency Intents (`draftChanged`) on the virtual clock, so projection
   runs at most once per frame-equivalent, deterministically.

## 6.6 Reconciliation totality & ordering (R7)

**Problem.** Out-of-order acks, rejects after re-edit, and server pushes onto pending rows are where
optimistic UIs silently corrupt data.

**Solution — per-op ids, per-row revisions, and a total matrix.** Outbound ops carry an `opId` and
the row's `baseRev`; inflight ops are keyed by `opId` (so acks settle order-independently). Every
inbound message is guarded by **monotonic `rev`** — a stale message can never regress the VM. The
full `(state × event)` matrix in doc 5 §5.4 assigns one verdict to every cell, including the
**rebase** case (reject after re-edit) and the **conflict** case (server patch vs pending). The
matrix is the test oracle.

## 6.7 Connection loss without losing edits (R9)

**Problem.** A dropped socket mid-edit must not discard the user's unconfirmed work.

**Solution — connection as actor state; inflight + journal survive.** `onDisconnected` moves the
actor to `reconnecting` but **keeps** the inflight op map and journal; the UI keeps accepting edits
(queued). On `onConnected` the actor enters `resyncing` and **replays unconfirmed ops by `opId`**; on
`onResynced(snapshot, rev)` it reconciles the authoritative snapshot against optimistic state under
the `rev` guard, then returns to `connected`. `vm.status` lets components show the state honestly.

## 6.8 SSR / hydration without tearing (R14)

**Problem.** `useSyncExternalStore` requires a server snapshot; a mismatch between server and first
client snapshot causes a hydration tear.

**Solution — synchronous initial projection.** The actor can produce its initial ViewModel
synchronously from seed data (`project(seed, freshHot)`); `store.getServerSnapshot()` returns that
exact frozen value, and the client store is constructed from the **same** serialized seed so the
first client `getSnapshot()` is identical. Live updates begin only after hydration, when the actor's
Port is connected. (Apps that don't SSR ignore this entirely.)

## 6.9 Methodology cost — and why it's bounded

**Problem.** ihsm's invariant-first, verdict-per-cell discipline is real upfront work; applying it to
every widget would be overkill.

**Solution — the library absorbs the discipline once.** The hard matrices (reconciliation, focus,
transient lifecycle, undo) are implemented **inside `@ihsm/react` and a reference InteractionActor
template**, fully tested. App authors mostly compose Surface primitives and define their domain
`project()` and op shapes; they inherit determinism without re-deriving the matrix. The full ihsm
methodology is only needed when extending the *protocol* (new Intent/Model events), where doc 5 §5.4
is the template.

## 6.10 One ViewModel for four shapes — without leaking shape into the kernel (R19/R20)

**Problem.** "Make List/Table/Tree/TreeTable user-definable" tempts a generic kernel riddled with
`if (isTree)` branches — at which point it is neither generic nor maintainable, and the hard
invariants (reconciliation, focus) start depending on shape.

**Solution — node VM + four pure strategies, with a hard isolation boundary.** All four shapes are
the same `InteractionVM` of nodes (doc 10 §10.1); shape lives **only** in four pure strategies
(`ProjectModel`/`NavModel`/`TransientModel`/`Keymap`, R20). The kernel calls strategies but
strategies cannot call into reconciliation/focus/undo — enforced by giving them *read-only* VM/event
inputs and no handle to `ctx`. The proof the seam is sufficient (not just plausible) is doc 8: the
four recipe bundles reproduce all four widgets and pass the *same* fuzzer; a fifth shape (kanban)
needs only a fifth bundle. This is why the kernel never knows "tree-ness" yet supports trees.

## 6.11 Error tolerance without corrupting reconciliation (R22)

**Problem.** A true DMI must *accept* invalid input (no gate), yet optimistic reconciliation is built
on "every value is en route to a server that will ack or reject it." Naively, an invalid value looks
like a permanent in-flight or a rejection, and either corrupts the matrix or blocks the user.

**Solution — `invalid` is a first-class *accepted* state, distinct from `rejected`.** A failing value
commits to `state:'invalid'` (doc 3 §3.3): it is a normal, acked value that merely carries advisory
diagnostics and counts toward `errorCount`. The §5.4 matrix gives `invalid` its own total row, and
`onDiagnostics([])` is the **promotion** path to `clean`. The backend doesn't refuse it — it
*quarantines* and *traces* it (doc 10 §10.6, doc 9 §9), so invalid data is durable, auditable, and
repairable via the diagnostics inventory (`gotoNextDiagnostic`) instead of a modal error. Gating
remains available per field for the rare hard constraint, as the exception.

## 6.12 Capability negotiation that stays fully typed (R21)

**Problem.** One protocol for every shape risks runtime "is this method supported?" checks scattered
through handlers — exactly the untested branching ihsm exists to remove. And an untyped capability
bag loses R2's "dispatchers fully typed from Config".

**Solution — capabilities as a type parameter, negotiated once.** `initialize` returns a
`Capabilities` record that is both a runtime value (`vm.capabilities`) **and** a type parameter that
narrows the Intent/op/event surface (doc 10 §10.4). `useIntent()` for a `hierarchy:false` app has no
`expandNode` member — a *compile* error to call, not a runtime guard. Negotiation is a single boot
macrostep (traced once, doc 9 §9.5), so there is no per-turn capability check anywhere in the hot
path.
