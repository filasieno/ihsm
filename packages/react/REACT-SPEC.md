# REACT-SPEC — `@ihsm/react`: a React UI library for InteractionActors

Status: Draft 1 · Target runtime: `ihsm` 0.1.1 · React 18/19 (`useSyncExternalStore`) · Scope:
**direct-manipulation interfaces** driven by an `ihsm` *InteractionActor* over a live transport
(WebSocket / HTTP+SSE).

`@ihsm/react` is **not** a generic state-management binding. It is a focused toolkit for building
**Direct Manipulation Interfaces (DMIs)** — UIs with *no forms and no buttons*, where the user
edits the data surface directly (the last row of a list is writable; typing materializes a
transient record; `Tab`/`Enter` advances and spawns the next one). The hard parts of a DMI —
optimistic mutation, server reconciliation, focus survival, undo/redo — are modelled in an
`ihsm` actor so they are **deterministic and replayable**, and React is reduced to a **pure
projection of an immutable ViewModel**.

This specification is split into focused documents under [`./spec`](./spec). Read in order:

| # | Document | Contents |
|---|----------|----------|
| 1 | [`spec/01-MOTIVATION-AND-AS-IS.md`](./spec/01-MOTIVATION-AND-AS-IS.md) | What a DMI is, why React-only/Redux/XState bindings leave the racy parts untested, and the InteractionActor + immutable-ViewModel principle this library is built on. |
| 2 | [`spec/02-REQUIREMENTS.md`](./spec/02-REQUIREMENTS.md) | The goals (R1–R14). Central requirement: **React renders a pure function of an immutable ViewModel; all interaction logic lives in the actor and is deterministically testable.** |
| 3 | [`spec/03-ARCHITECTURE.md`](./spec/03-ARCHITECTURE.md) | The three layers — **Binding**, **Surface**, **Harness** — the ViewModel contract, the `useSyncExternalStore` view-sink (no production `subscribe` in ihsm), structural sharing, and the focus authority. |
| 4 | [`spec/04-COMPONENTS.md`](./spec/04-COMPONENTS.md) | **The core.** Every key component and hook: providers, selectors, intent dispatch, and the Surface primitives `Command` / `Field` / `Collection` / `FocusScope` / `OptimisticBoundary` / `Tree` / `TreeTable`, plus the undo provider. Props, the events each emits, and the VM slice each reads. |
| 5 | [`spec/05-EVENTS-AND-SEQUENCES.md`](./spec/05-EVENTS-AND-SEQUENCES.md) | The full event taxonomy (Intent / Model / Output) and PlantUML sequence diagrams for command invoke, transient create→commit→ack, optimistic reject→rollback, out-of-order acks, focus advance, undo, and reconnect→resync. |
| 6 | [`spec/06-CHALLENGES.md`](./spec/06-CHALLENGES.md) | Each hard problem and exactly how the library solves it: controlled-input/IME, focus survival across a VM swap, reconciliation totality, undo of in-flight ops, performance, and SSR. |
| 7 | [`spec/07-USAGE-EXAMPLES.md`](./spec/07-USAGE-EXAMPLES.md) | Incremental tutorials: **Button → Editable field → Transient list → Tree → TreeTable**, each as actor `Config` + React usage. |
| 8 | [`spec/08-TESTING.md`](./spec/08-TESTING.md) | `@ihsm/react/testing`: the DST harness, the seeded `InteractionFuzzer`, golden-trace assertions, React Testing Library integration, and `@ihsm/react/devtools`. |

## The one idea to keep in mind

> The user manipulates the data surface directly; React **never owns interaction state**. Every
> gesture is an **Intent event** posted to an `ihsm` InteractionActor. The actor keeps its *hot*
> bookkeeping in a mutable `ctx` and, at the end of each run-to-completion turn, projects an
> **immutable `ViewModel`** that it publishes to a tiny external store. React reads that store via
> `useSyncExternalStore` and re-renders by **referential equality** — exactly when, and only when,
> the ViewModel changed.
>
> Because all of the racy logic (optimistic apply, ack/reject reconciliation, focus, undo) is in
> a serialized, port-isolated actor, the **whole UI replays byte-for-byte** under a seeded fuzz
> test. Determinism is the product.

## Naming

The component family is called **Surface** — it is the projection of the immutable ViewModel onto
interactive React elements. `@ihsm/react` exports the Binding hooks from the root, the Surface
primitives from `@ihsm/react/surface`, the test harness from `@ihsm/react/testing`, and the live
inspector from `@ihsm/react/devtools`.
