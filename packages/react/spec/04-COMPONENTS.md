# 4. COMPONENTS & HOOKS

The library ships **generic, shape-agnostic** primitives only. Every one is **headless** (behavior +
ARIA, no styling) and follows the same contract: it **reads a slice of the immutable node ViewModel**
via the Binding layer and **emits Intent events** to the InteractionActor. None holds authoritative
state. List/Table/Tree/TreeTable are **not** here — they are recipe proofs assembled from these
primitives + a strategy bundle (§4.9, doc 10).

Legend for each entry: **Reads** = the VM slice it subscribes to · **Emits** = the Intents it
posts · **Owns locally** = the only React state it is allowed to keep (per R5/R0).

---

## 4.1 Binding layer (root export `@ihsm/react`)

### `<InteractionProvider>`

Holds the actor handle and its store in React context. One per InteractionActor subtree.

```tsx
<InteractionProvider actor={actor} store={store}>
  {children}
</InteractionProvider>
```

| Prop | Type | Notes |
|------|------|-------|
| `actor` | `ExternalActor<C>` | The production InteractionActor (`makeActor`). |
| `store` | `InteractionStore<VM>` | From `createInteractionStore(initialVm)`; its `sink` was given to the actor's ctx/Port. |
| `children` | `ReactNode` | The Surface. |

### `<StrategyProvider bundle={…}>`

Injects the four strategies (`ProjectModel`/`NavModel`/`TransientModel`/`Keymap`, R20) the generic
primitives read. A **recipe** (List/Table/Tree/TreeTable) is just `NodeView` under a specific bundle
(§4.9). One per shape subtree; nests under `InteractionProvider`.

### `useViewModel(): VM` · `useSelector(select, isEqual?)`

`useViewModel` returns the whole VM (prefer `useSelector`). `useSelector` subscribes to a derived
slice; default `isEqual` is `Object.is` (correct because the VM is immutable + structurally shared).

```ts
const status   = useSelector((vm) => vm.status);
const nodeIds  = useSelector((vm) => vm.nodes.map((n) => n.id), shallowArrayEqual);
const canUndo  = useSelector((vm) => vm.canUndo);
```

### `useIntent(): Intents`

Returns the typed Intent dispatchers — the actor's `notify` facet, narrowed to the Intent bucket of
`Config` **and to the negotiated capabilities** (R21: no `expandNode` without `hierarchy`). Stable
identity (safe in deps).

```ts
const intent = useIntent();
intent.beginEdit(nodeId, 'name');
intent.commitField(nodeId, 'name', 'Ada');
intent.advance('forward');          // Tab/Enter semantics (geometry from NavModel)
intent.invoke('archive', nodeId);   // command
```

### `useStrategies(): Bundle`

The active strategy bundle (for recipes/devtools that need to introspect or override a single
strategy). Rarely needed by app code.

### `useActorStatus(): { status; canUndo; canRedo; pendingOps; errorCount }`

Connection/sync status and global flags, for status bars and disabling affordances. `errorCount`
drives the diagnostics inventory affordance (R22).

### `createInteractionStore(initialVm)`

Factory (doc 3 §3.4). Returns `{ getSnapshot, getServerSnapshot, subscribe, sink }`. Hand `sink` to
the actor when you build it; pass the store to `<InteractionProvider>`.

---

## 4.2 `<Command>` — the button replacement

A DMI has no buttons, but it still has *commands* (archive, delete, run). `Command` is the
**accessible trigger** that fires a command Intent and reflects its lifecycle from the VM —
pending, disabled-while-in-flight, success/failure — without local state.

- **Reads:** the command's status from the VM (`vm.commands?.[name]` or a selector you pass).
- **Emits:** `invoke(name, ...args)`.
- **Owns locally:** nothing.

```tsx
<Command name="archive" args={[rowId]}>
  {({ pending, disabled }) => (
    <span aria-busy={pending}>{pending ? 'Archiving…' : 'Archive'}</span>
  )}
</Command>
```

| Prop | Type | Notes |
|------|------|-------|
| `name` | `CommandName` | Key in the actor's command Intent bucket. |
| `args` | `unknown[]` | Forwarded to the Intent. |
| `selectStatus?` | `(vm) => CommandStatus` | Override how status is read. |
| `keybinding?` | `string` | e.g. `"mod+backspace"`; bound while focused within the enclosing `FocusScope`. |
| `children` | render-prop | Receives `{ pending, disabled, invoke }`. |

It renders a real `<button>` by default (keyboard + screen-reader correct); render-prop lets you
project it onto any element. The point: even the "button" path goes through the actor, so it is
covered by the same deterministic tests.

---

## 4.3 `<Field>` — inline editable cell (controlled-but-buffered)

The atom of direct editing. Solves R5: it keeps the **draft text and caret/IME local**, and emits
only **semantic** events. The committed value comes from the VM.

- **Reads:** one `CellVM` (`value`, `invalid`, `pending`, `validation`) for `{nodeId, field}`.
- **Emits:** `beginEdit`, `commitField`, `cancelEdit`, `advance` (on Tab/Enter), optional
  `draftChanged` (throttled, only if the actor wants live preview — off by default).
- **Owns locally:** the in-progress draft string and the DOM caret (via the native input).

```tsx
<Field nodeId={nodeId} field="name" />
```

| Prop | Type | Notes |
|------|------|-------|
| `nodeId` | `ClientId` | Stable node identity (alias: `rowId`). |
| `field` | `FieldKey` | Column key. |
| `as?` | `'input' \| 'textarea' \| Component` | Default `input`. |
| `commitOn?` | `('blur'\|'enter'\|'tab')[]` | Default all three. |
| `livePreview?` | `boolean` | If true, emits throttled `draftChanged` for optimistic preview. Default false. |
| `format?` / `parse?` | functions | View ↔ model value mapping. |

Draft reconciliation rule (doc 6 §6.1): while focused-and-editing, the **local draft wins**; the VM
`value` is applied to the input only when the field is *not* actively being edited, or when the
incoming value differs from the draft's *base* (a real external change), in which case the user is
warned via the `conflict` row state rather than being silently overwritten.

---

## 4.4 `<NodeView>` — the generic node substrate (the one renderer for every shape)

The single, shape-agnostic primitive that renders `vm.nodes`. It is what the List, Table, Tree, and
TreeTable recipes *are* — each is `NodeView` under a different strategy bundle (§4.9). It
renders the visible nodes **plus the writable transient slot(s)** wherever the active `TransientModel`
places them (trailing row, or trailing child under an expanded parent). It routes keystrokes through
the active `Keymap` and never decides geometry itself.

- **Reads:** `vm.nodes` (ordered, includes transient slots), `vm.focus`, `vm.columns?`, `vm.selection`.
- **Emits:** whatever the bound `Keymap` produces — typically `beginTransient`, `commitField`,
  `advance`, `cancelEdit`, `reorder`, `delete`, and (with `columns`/`hierarchy`) the table/tree
  Intents.
- **Owns locally:** nothing (delegates cells to `<Field>`; transient placement comes from the VM).

```tsx
<StrategyProvider bundle={listBundle}>
  <NodeView>
    {(node) => (
      <Row key={node.id} depth={node.depth}>
        <Field nodeId={node.id} field="name" />
        <Field nodeId={node.id} field="qty" />
        {!node.transient && <Command name="delete" args={[node.id]} keybinding="mod+backspace" />}
      </Row>
    )}
  </NodeView>
</StrategyProvider>
```

| Prop | Type | Notes |
|------|------|-------|
| `children` | `(node: NodeVM) => ReactNode` | Node renderer; receives each VM node incl. transient slots. |
| `columns?` | `{ cell, header?, corner? }` | When the `columns` capability is on, a columnar renderer (cell receives `(node, col)`). |
| `virtualize?` | `boolean \| VirtualizeOptions` | Windowed rows (and columns) for large data (R12). |
| `selectNodes?` | `(vm) => NodeVM[]` | Override the node source (rarely needed; projection is the `ProjectModel`'s job). |

The transient lifecycle is **the actor's** (R4) and *where* the slot lives is the `TransientModel`
(R20): first keypress on a writable slot → `beginTransient` (actor mints a client id, inserts a
`transient: true` node); `advance` past the last field → actor commits the node (enqueues an op) and
the `TransientModel` appends a fresh empty slot. "Add a record" is a sequence of Intents with no
button anywhere — for a list, a tree, or a grid, with the same code.

---

## 4.5 `<FocusScope>` — keyboard navigation + focus survival

Wraps an editable region and provides keyboard navigation (arrows, `Tab`/`Shift+Tab`, `Enter`,
`Esc`, `Home`/`End`) with a **roving tabindex**, and — critically — **restores DOM focus across a
ViewModel swap** (R6). Navigation *geometry* (what "down" means) is delegated to the active
`NavModel` (R20), so the same `FocusScope` serves a list, a grid, and a tree.

- **Reads:** `vm.focus`.
- **Emits:** `focusCell`, `advance`, `cancelEdit` (the raw DOM→Intent step is the `Keymap`, doc 5 §5.0).
- **Owns locally:** a `Map<coordKey, HTMLElement>` of registered cells (refs), not state.

```tsx
<FocusScope>
  <NodeView>{/* … */}</NodeView>
</FocusScope>
```

| Prop | Type | Notes |
|------|------|-------|
| `wrap?` | `boolean` | Wrap at row/column edges. |
| `restoreOn?` | `'layoutEffect' \| 'effect'` | When to re-assert focus after a VM swap. Default `layoutEffect`. |

(2-D vs linear navigation and `role="grid"` vs `role="tree"` come from the bundle, not a prop.)

How focus survives a swap (doc 6 §6.2): cells register their DOM node under the **stable
`{nodeId, field}` coordinate**. After every committed render, `FocusScope` reads `vm.focus` and, if
`document.activeElement` is not the registered element for that coordinate, re-focuses it and
restores caret intent. Because the coordinate uses the **client id** (not the server id), a
transient→canonical id remap does *not* move focus.

---

## 4.6 `<OptimisticBoundary>` — reconciliation & diagnostic affordances

Visualizes per-node optimistic state and exposes recovery actions, reading purely from `RowState`
and the node's diagnostics. It distinguishes server `rejected` from locally-accepted `invalid` (R22).

- **Reads:** a node's `state` (`clean`/`editing`/`pending`/`rejected`/`conflict`/`invalid`) and its
  diagnostics.
- **Emits:** `retryOp`, `rollback`, `resolveConflict('keepMine'|'takeTheirs')`, `gotoNextDiagnostic`.
- **Owns locally:** nothing.

```tsx
<OptimisticBoundary nodeId={node.id}>
  {({ state, diagnostics, retry, rollback, resolveConflict }) => (
    state === 'rejected' ? <RejectBanner onRetry={retry} onDiscard={rollback}/> :
    state === 'conflict' ? <ConflictBanner onKeepMine={() => resolveConflict('keepMine')}
                                            onTakeTheirs={() => resolveConflict('takeTheirs')}/> :
    state === 'invalid'  ? <Squiggle diagnostics={diagnostics}/> :   // advisory, non-blocking (R22)
    null
  )}
</OptimisticBoundary>
```

The boundary never *decides* policy — it surfaces the actor's `RowState`/diagnostics and forwards the
user's choice as an Intent. `invalid` is advisory by default (the value is accepted and quarantined,
doc 10 §10.6); the reconciliation matrix that produces these states is doc 5 §5.4.

---

## 4.7 `<UndoProvider>` + `useUndo()` — journaled undo/redo (R8)

The actor owns a **command journal**; the provider binds default keystrokes and exposes state.

- **Reads:** `vm.canUndo`, `vm.canRedo`.
- **Emits:** `requestUndo`, `requestRedo`.
- **Owns locally:** nothing.

```tsx
<UndoProvider keymap={{ undo: 'mod+z', redo: 'mod+shift+z' }}>
  <FocusScope><NodeView>{/* … */}</NodeView></FocusScope>
</UndoProvider>

// or imperatively:
const { undo, redo, canUndo, canRedo } = useUndo();
```

Undo semantics are the actor's (doc 6 §6.4): undoing an op that is **still in flight** also cancels
it on the ModelActor; undoing a **confirmed** op enqueues a compensating op. Because the journal
lives in the actor and every entry is an Intent, undo/redo is itself replayable and fuzz-tested.

---

## 4.8 Strategy interfaces — the only shape-specific surface (R20)

The four pluggable strategies the generic primitives read. They are **pure** and may **not** touch
reconciliation, focus, or undo (those are kernel-owned). Full definitions and the canonical bundles
are doc 10 §10.2.

| Strategy | Responsibility | Read by |
|----------|----------------|---------|
| `ProjectModel` | authoritative dataset → visible, ordered `nodes` (sort/filter/flatten/expand) | the actor's `project()` |
| `NavModel` | geometry of `advance`/arrows (`next(coord, dir, vm)`) | `FocusScope` |
| `TransientModel` | *where* the writable slot lives (trailing row vs trailing child) | `NodeView` / actor (R4) |
| `Keymap` | DOM event → exactly one Intent (doc 5 §5.0) | `NodeView` / `FocusScope` |

A `Bundle` is `{ project, nav, transient, keymap }` plus a declared capability set. Provide it with
`<StrategyProvider bundle={…}>`; introspect with `useStrategies()`.

---

## 4.9 Recipe proofs — List · Table · Tree · TreeTable (test-only)

The four classic shapes are **not** library components; they are bundles in `tests/recipes/` that
prove the kernel + four strategies can express every shape (R19, doc 8). Each is the *same*
`NodeView` + `Field` + `FocusScope` under a different bundle:

```tsx
// tests/recipes/table.tsx  (a PROOF, not a library export)
export const tableBundle: Bundle = {
  capabilities: { columns: true, hierarchy: false, /* … */ },
  project: sortFilterFlat,   nav: grid2d,
  transient: trailingRow,    keymap: tableKeys,   // shift+arrow, header sort, fill-handle …
};

function TableScreen() {
  return (
    <StrategyProvider bundle={tableBundle}>
      <FocusScope>
        <NodeView columns={{ header, cell: (n, col) => <Field nodeId={n.id} field={col.field} /> }}>
          {(n) => <Row node={n} />}
        </NodeView>
      </FocusScope>
    </StrategyProvider>
  );
}
```

| Recipe | Bundle (project · nav · transient · keymap) | Capabilities |
|--------|---------------------------------------------|--------------|
| **List** | identity/filter · linear · trailing-row · list | — |
| **Table** | sort+filter · grid-2D · trailing-row · table (+range/clipboard) | `columns` |
| **Tree** | flatten-visible · linear-descend · trailing-child? · tree (+expand) | `hierarchy` |
| **TreeTable** | flatten+sort · grid-2D+descend · trailing-child · tree∪table | `hierarchy`, `columns` |

Swapping `tableBundle` → `treeBundle` turns a grid into a tree with no other code change — the
headline demo (doc 7 §7.7). Apps that want one of these copy the recipe; apps that want a *new* shape
(kanban, pivot, calendar) write a fifth bundle and inherit every guarantee for free.

---

## 4.10 Component → Intent → VM-slice matrix

Shipped generic primitives only (recipes emit Intents via their `Keymap`, summarized at bottom):

| Component | Reads (VM slice) | Emits (Intents) |
|-----------|------------------|-----------------|
| `Command` | command status | `invoke` |
| `Field` | one `CellVM` | `beginEdit`, `commitField`, `cancelEdit`, `advance`, `draftChanged?` |
| `NodeView` | `nodes`, `focus`, `columns?`, `selection` | (via `Keymap`) `beginTransient`, `commitField`, `advance`, `reorder`, `delete`, … |
| `FocusScope` | `focus` | `focusCell`, `advance`, `cancelEdit` |
| `OptimisticBoundary` | node `state`, diagnostics | `retryOp`, `rollback`, `resolveConflict`, `gotoNextDiagnostic` |
| `UndoProvider` | `canUndo`, `canRedo` | `requestUndo`, `requestRedo` |

Recipe Intent surfaces (emitted through `NodeView`'s `Keymap`, gated by capability): **Table** adds
`selectRange`, `extendSelection`, `sortColumn`, `filterColumn`, `resizeColumn`, `moveColumn`,
`copy`, `cut`, `paste`, `fillDown`; **Tree** adds `expandNode`, `collapseNode`, `loadChildren`;
**TreeTable** = the union.

Every Intent here is a method on the InteractionActor's `notifications` (Intent) bucket and gets a
verdict in the decision matrix (doc 5 §5.4) and a fuzz path (doc 8).

> **DOM events are not in this table on purpose.** Components emit *Intents*, not DOM events. The
> exhaustive mapping of raw keyboard / mouse / pointer / wheel / IME events to these Intents — the
> only place DOM-level logic lives — is **doc 5 §5.0**. Each primitive's "Emits" column is the
> *output* of that normalization; the normalization itself is shared and centrally tested (R16).
