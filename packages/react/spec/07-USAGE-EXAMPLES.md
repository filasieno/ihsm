# 7. USAGE EXAMPLES (incremental)

Six steps, each adding one capability: **Button → Editable field → Transient list → Tree →
TreeTable → Interactive validation**. Every step is the *same shape*: define the InteractionActor
`Config` (Intents in, Model events in, immutable VM out), wire the store, and compose Surface
primitives. Code is illustrative (the runnable versions live under `examples/` once implemented).

## 7.0 One-time wiring (shared by all steps)

```tsx
import * as ihsm from 'ihsm';
import { InteractionProvider, StrategyProvider, createInteractionStore } from '@ihsm/react';
import { TodoTop, makeInitialVm, makeTodoCtx } from './todoActor';
import { listBundle } from '../tests/recipes/list';        // a recipe PROOF; copy or write your own

const store = createInteractionStore(makeInitialVm());
const ctx   = makeTodoCtx({ viewSink: store.sink });        // sink lives in hot ctx
const actor = ihsm.makeActor(TodoTop, ctx, new TodoPort()); // TodoPort talks to the ModelActor

export function App() {
  return (
    <InteractionProvider actor={actor} store={store}>
      <StrategyProvider bundle={listBundle}>             {/* the shape lives here, R20 */}
        <Screen />
      </StrategyProvider>
    </InteractionProvider>
  );
}
```

The actor projects and `ctx.viewSink.publish(vm)` at the end of each changed turn. React reads
`store`; the `bundle` decides the *shape* (list here). That is the entire integration.

---

## 7.1 Step 1 — Button (a command, no local state)

The simplest direct-manipulation element: a command that is optimistic and self-describing.

**Actor `Config` (Intent + Model slices):**

```ts
interface TodoConfig {
  context: TodoCtx;
  notifications: {                 // Intents
    invoke(name: 'archiveAll'): void;
  };
  internalNotifications: {         // Model events + glue
    onAck(opId: number): void;
    onReject(opId: number, reason: string): void;
    doReproject(): void;
  };
  port: TodoPort;
}
```

**Handler sketch (verdict B — the only state-changing verdict):**

```ts
class Idle extends TodoTop {
  invoke(name: 'archiveAll'): void {
    this._checkInvariant();
    const opId = ++this.ctx.nextOpId;
    this.ctx.commands.archiveAll = 'pending';
    this.hsm.port.applyOp(opId, { archiveAll: true });
    this.notify.doReproject();        // publish VM with button = "Archiving…"
  }
  onAck(opId: number): void {
    this._checkInvariant();
    this.ctx.commands.archiveAll = 'idle';
    this.notify.doReproject();
  }
}
```

**React:**

```tsx
import { Command } from '@ihsm/react/surface';

function Screen() {
  return (
    <Command name="archiveAll">
      {({ pending }) => <span aria-busy={pending}>{pending ? 'Archiving…' : 'Archive all'}</span>}
    </Command>
  );
}
```

What you got for free: the button reflects the *real* in-flight state from the VM, and the whole
click→op→ack flow is one deterministic test (doc 8 §8.2).

---

## 7.2 Step 2 — Editable field (inline, buffered)

Edit a single record's field directly. No form, no save button.

**New Intents:** `beginEdit(rowId, field)`, `commitField(rowId, field, value)`, `cancelEdit(...)`.

**React:**

```tsx
import { Field, FocusScope } from '@ihsm/react/surface';

function Screen() {
  return (
    <FocusScope>
      <Field rowId="title" field="text" />   {/* committed value from VM; draft is local */}
    </FocusScope>
  );
}
```

**Reconciliation already present:** committing sets the row `pending`, enqueues an op; `onAck` →
`clean`, `onReject` → `rejected` (and an `OptimisticBoundary` can render a retry/discard banner).
The caret never jumps because the draft is DOM-local (doc 6 §6.1).

---

## 7.3 Step 3 — Transient list (the signature DMI)

A list whose **last row is writable**. Typing materializes a transient record; `Tab`/`Enter`
advances and spawns the next transient. No `+` button anywhere.

**New Intents:** `beginTransient(field, firstChar)`, `advance(dir)`, `delete(rowId)`,
`reorder(rowId, toIndex)`.

**Actor sketch (transient lifecycle owned by the actor):**

```ts
class Editing extends TodoTop {
  beginTransient(field: FieldKey, firstChar: string): void {
    this._checkInvariant();
    const id = mintClientId();
    this.ctx.rows.set(id, { id, serverId: null, state: 'editing', transient: true, data: {} });
    this.ctx.focus = { rowId: id, field };
    this.notify.doReproject();
  }
  advance(dir: 'forward' | 'back' | 'down' | 'up'): void {
    this._checkInvariant();
    const next = computeNextCoord(this.ctx, dir);     // may commit a transient + append a fresh one
    if (next.committedRowId) {
      const opId = ++this.ctx.nextOpId;
      this.ctx.inflight.set(opId, next.committedRowId);
      this.hsm.port.applyOp(opId, { insert: this.ctx.rows.get(next.committedRowId)! });
    }
    this.ctx.focus = next.focus;
    this.notify.doReproject();
  }
}
```

**React (generic `NodeView` under the list bundle):**

```tsx
import { NodeView, Field, FocusScope, OptimisticBoundary, Command } from '@ihsm/react/surface';

function Screen() {
  return (
    <FocusScope>
      <NodeView>
        {(node) => (
          <div role="row" key={node.id}>
            <Field nodeId={node.id} field="text" />
            <Field nodeId={node.id} field="due" />
            {!node.transient && (
              <OptimisticBoundary nodeId={node.id}>
                {({ state, retry, rollback }) =>
                  state === 'rejected' ? <button onClick={retry}>retry</button> : null}
              </OptimisticBoundary>
            )}
            {!node.transient && <Command name="delete" args={[node.id]} keybinding="mod+backspace" />}
          </div>
        )}
      </NodeView>
    </FocusScope>
  );
}
```

This is the full optimistic-list experience — transient creation, per-node reconciliation, focus
advance, keyboard delete — with **zero buttons in the add path** and complete determinism. Note the
component is the *generic* `NodeView`; "list" is entirely in `listBundle` (§7.0).

---

## 7.4 Step 4 — Tree (swap the bundle, keep the component)

Add depth. **The React component does not change** — swap `listBundle` → `treeBundle` (which
negotiates the `hierarchy` capability and supplies flatten-visible projection + descend navigation).
The VM publishes only **visible** nodes; expansion is actor state (survives reconnect, testable).

**New Intents (now legal because `hierarchy` was negotiated):** `expandNode(nodeId)`,
`collapseNode(nodeId)`, `loadChildren(nodeId)` (lazy).

**React:**

```tsx
import { NodeView, Field, FocusScope } from '@ihsm/react/surface';

function Screen() {
  return (
    <FocusScope>
      <NodeView>
        {(node) => (
          <div role="treeitem" aria-expanded={node.expanded}
               style={{ paddingLeft: (node.depth ?? 0) * 16 }} key={node.id}>
            <Twisty nodeId={node.id} expanded={!!node.expanded} />
            <Field nodeId={node.id} field="label" />
          </div>
        )}
      </NodeView>
    </FocusScope>
  );
}

function Twisty({ nodeId, expanded }: { nodeId: string; expanded: boolean }) {
  const intent = useIntent();
  return <button aria-label={expanded ? 'collapse' : 'expand'}
                 onClick={() => (expanded ? intent.collapseNode(nodeId) : intent.expandNode(nodeId))}>
    {expanded ? '▾' : '▸'}
  </button>;
}
```

Lazy children: first `expandNode` on a node with `hasChildren && !loaded` makes the actor emit
`loadChildren`; the ModelActor returns `onChildren(nodeId, children)`; the actor splices them in and
reprojects. A collapse re-renders O(visible) because collapsed subtrees aren't in `vm.nodes`.

---

## 7.5 Step 5 — TreeTable (the complete surface = `hierarchy` + `columns`)

Combine everything: hierarchy + columns + **editable transient child rows** under each expanded
parent + 2-D keyboard navigation across columns *and* depth. This is a directly-editable
hierarchical grid with no buttons — the canonical DMI. It is the *same* `NodeView` under
`treeTableBundle` (negotiates `hierarchy` **and** `columns`).

**Intents:** the union of Steps 1–4 (`expand/collapse`, `beginTransient` *scoped to a parent*,
`commitField`, `advance` with column+depth awareness, `reorder`, `delete`, `invoke`, plus the table
range/clipboard Intents).

**React:**

```tsx
import { NodeView, Field, FocusScope, UndoProvider } from '@ihsm/react/surface';

function Screen() {
  return (
    <UndoProvider keymap={{ undo: 'mod+z', redo: 'mod+shift+z' }}>
      <FocusScope>
        <NodeView
          virtualize
          columns={{
            header: (col) => <ColumnHeader col={col} />,
            cell:   (node, col) => <Field nodeId={node.id} field={col.field} />,
            corner: () => null,
          }}>
          {(node) => <Twisty nodeId={node.id} expanded={!!node.expanded} />}
        </NodeView>
      </FocusScope>
    </UndoProvider>
  );
}
```

`treeTableBundle` is *composed of* the tree and table strategies — demonstrating the strategy
vocabulary is complete (doc 10 §10.2). The trailing transient child row under an expanded parent lets
the user add a sub-item by typing; `Tab` walks columns then descends to the transient child;
`Ctrl+Z` undoes the last edit (cancelling its in-flight op if needed). Everything in this screen is
covered by one seeded fuzz test (doc 8 §8.3).

---

## 7.5b The headline demo — one screen, three shapes

Because the component is always `NodeView` and the shape is the injected bundle, the *same* JSX is a
list, a table, or a tree depending only on `<StrategyProvider bundle>`:

```tsx
import { listBundle, tableBundle, treeBundle } from '../tests/recipes';

function Shapeable({ shape }: { shape: 'list' | 'table' | 'tree' }) {
  const bundle = { list: listBundle, table: tableBundle, tree: treeBundle }[shape];
  return (
    <StrategyProvider bundle={bundle}>
      <FocusScope><NodeView /* same renderer */ /></FocusScope>
    </StrategyProvider>
  );
}
```

Flipping `shape` re-projects the *same* authoritative dataset through a different `ProjectModel` and
re-binds a different `NavModel`/`Keymap` — no data reload, no component swap, focus and undo intact.
This is the proof that the kernel is generic and the widgets are policy.

---

## 7.6 Step 6 — Interactive validation & error tolerance (advisory, R22)

Validation is more projection plus one push event — no React-side rules. The default is
**accept-and-mark**: an invalid value is committed into `state:'invalid'`, the user keeps moving, and
the error joins a navigable inventory they clean up later (true DMI, not a form).

**New Intent:** `validateField(nodeId, field, value)`. **New Model event:**
`onDiagnostics(nodeId, diagnostics[])` (advisory; `[]` ⇒ promote to clean).

**Actor sketch (advisory, both tiers):**

```ts
class Editing extends TodoTop {
  commitField(nodeId: ClientId, field: FieldKey, value: string): void {
    this._checkInvariant();
    const node = this.ctx.nodes.get(nodeId)!;
    node.data[field] = value;                            // ACCEPTED — never blocked (advisory default)

    // ── sync tier: pure, re-runs inside project() ──
    const diag = validateSync(field, value);            // required / format / regex → Diagnostic | null
    this.setDiagnostic(node, field, diag);              // updates node.state ('invalid' iff any error)

    if (field === 'email') {                             // ── async tier: debounced uniqueness ──
      this.markChecking(node, field);
      this.hsm.port.defer(this.policy.debounceMs, () => this.notify.doValidate(nodeId, field));
    }
    this.advanceFocus();                                 // focus ADVANCES regardless (R22)
    this.notify.doReproject();
  }

  doValidate(nodeId: ClientId, field: FieldKey): void {
    const node = this.ctx.nodes.get(nodeId)!;
    this.hsm.port.validateField(nodeId, field, node.data[field]);   // → ModelActor (quarantine + WARN-trace)
  }

  onDiagnostics(nodeId: ClientId, diagnostics: Diagnostic[]): void {
    this._checkInvariant();
    const node = this.ctx.nodes.get(nodeId)!;
    this.applyDiagnostics(node, diagnostics);           // []  ⇒ state→'clean' (promotion); else 'invalid'
    this.notify.doReproject();
  }
}
```

**React (unchanged `Field`; it renders `CellVM.validation`; the inventory drives a "next error" jump):**

```tsx
import { NodeView, Field, FocusScope } from '@ihsm/react/surface';
import { useSelector, useIntent } from '@ihsm/react';

function ValidatedCell({ nodeId, field }: { nodeId: string; field: string }) {
  const v = useSelector((vm) => vm.nodes.find((n) => n.id === nodeId)?.fields[field]?.validation);
  return (
    <div>
      <Field nodeId={nodeId} field={field} />
      {v?.checking && <span role="status">checking…</span>}
      {v && !v.checking && <span role="alert" data-severity={v.severity}>{v.message}</span>}
    </div>
  );
}

function ErrorJump() {                                    // the "Problems panel" affordance
  const errorCount = useSelector((vm) => vm.errorCount);
  const intent = useIntent();
  return errorCount > 0
    ? <button onClick={() => intent.gotoNextDiagnostic()}>Next error ({errorCount})</button>
    : null;
}
```

What you got: invalid values are **accepted** (the flow never stalls), shown as inline squiggles,
counted in `errorCount`, and swept up via `gotoNextDiagnostic` (F8). The backend quarantines and
WARN-traces them (doc 9 §9, doc 10 §10.6). The test types an invalid value, asserts
`vm.nodes[0].state === 'invalid'` and that focus **did advance**; then `h.port.advance(debounceMs)`,
`h.port.send('onDiagnostics', nodeId, [])`, and asserts promotion to `clean`. The rare hard
constraint opts into `validationMode:'gating'` to block instead. No timers, no flake (doc 8 §8.5, R22).

---

## 7.7 What stayed constant across all six steps

| Constant | Why it matters |
|----------|----------------|
| React held **no authoritative state** | Pure projection; every step is replayable. |
| The component was always **`NodeView` + `Field`** | List/table/tree/treetable differ only by the injected strategy **bundle** (R19/R20), never by component. |
| Each gesture was an **Intent** (via the bundle's `Keymap`) | The add/edit/expand/undo paths are all testable sequences, no DOM-event guessing. |
| The VM was **immutable + structurally shared** | Re-render scope stayed O(changed nodes) even at TreeTable complexity. |
| Identity was the **client id** | Focus and undo survived every optimistic remap *and* id quarantine. |
| Invalid input was **accepted, not gated** | Errors became a navigable inventory (R22), keeping the DMI flow. |
| Transport stayed in the **ModelActor Port** behind one **capability-negotiated protocol** | The whole UI tested against a mock port + virtual clock. |

The complexity grew from a single button to a hierarchical editable grid — and the screen could be
re-shaped at runtime by swapping a bundle — but the **programming model never changed**, and the
library never shipped a single widget. That is the central claim.
