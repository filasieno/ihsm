# 7. Conformance matrix — the interaction cases every trace/log shape must cover

This document **classifies all ihsm interaction patterns** that the OTEL integration must observe
correctly. Each case below becomes (a) a deterministic scenario actor, (b) a captured
`OtelSignal[]`, (c) a processed trace/log asserted against doc 4/6, and — once the collector
container exists (doc 8) — (d) an authoritative on-disk OTLP sequence replayed in CI.

A case is **DONE** only when it is covered on **both server (Node) and browser** runtimes.

Legend: **Trigger kind** = `external | call | self | actor | timer | init`. **Boundary** = where the
macrostep starts/ends. **Links** = expected cross-trace span links (doc 4 §4.7).

---

## 7.1 Single-actor lifecycle

| # | Case | Trigger | Expected trace shape |
|---|------|---------|----------------------|
| L1 | Initialize (no initial child state) | `init` | one macrostep `initialize`, ≥1 step, `state.start=Top`, `state.end=leaf` |
| L2 | Initialize cascade into nested initial states | `init` | steps for each `onEntry` down the initial path |
| L3 | External notification, no transition | `external` | one macrostep, 1 step, `transitioned=false` |
| L4 | External notification with transition | `external` | step + `ihsm.transition` + `ihsm.exit`/`ihsm.entry` children |
| L5 | Dispose / final state | — | `actor.disposed`; no dangling open macrostep |

## 7.2 Self-posting & multi-microstep macrosteps

| # | Case | Trigger | Expected |
|---|------|---------|----------|
| S1 | Handler self-posts one event (`this.notify.x`) | `external`→`self` | **one** macrostep, 2 steps, ordered by start time, step 2 links `cause`→step 1 |
| S2 | Handler self-posts hi-priority (`this.notifyNow.x`) | `external`→`self` | priority step runs before already-queued default posts |
| S3 | Long cascade: N self-posts (N≥5) "complex workflow" | `external`→`self`×N | one macrostep, N+1 steps, root ends only at stability |
| S4 | Self-post **with** transition each turn (state-walk workflow) | `external`→`self` | each step carries its own `ihsm.transition`; `state.end` = final |
| S5 | Mixed default + priority interleaving in one macrostep | `external`→`self` | step order matches RTC/FIFO+priority semantics |

## 7.3 Transitions (HSM depth)

| # | Case | Expected |
|---|------|----------|
| T1 | Shallow sibling transition `A→B` | exit A, enter B |
| T2 | Deep transition across branches `A1a→B2b` (LCA computed) | exit chain up to LCA, entry chain down |
| T3 | Self-transition (exit+re-enter same state) | exit S, enter S |
| T4 | Transition to ancestor / descendant | correct partial exit/entry chains |
| T5 | Transition that triggers further initial-state entry | entry continues into initial substate |
| T6 | Transition inside a self-posted step (T4×S1) | transition appears under the **self** step, not the trigger step |

## 7.4 Services (`call`) — request/reply

| # | Case | Trigger | Expected |
|---|------|---------|----------|
| C1 | External `call` returns synchronously | `call` | macrostep `call`, reply within same macrostep |
| C2 | `call` that awaits a port/IO then replies | `call` | step shows async handler; `ihsm.port` child span for the awaited IO |
| C3 | `call` that transitions before replying | `call` | transition child + reply |
| C4 | `call` timeout (`CallTimeoutError`) | `call` | `ihsm.outcome=error`, error recorded on step + root |
| C5 | Self-call deadlock (`SelfCallDeadlockError`) | `call` | error classified, recovered=false |

## 7.5 Ports (caller-internal, never a new trace)

| # | Case | Expected |
|---|------|----------|
| P1 | Handler invokes a port method | `ihsm.port` span **inside** the caller's step; **no** new trace (doc 4 §4.7) |
| P2 | Awaited port call | `ihsm.port` span spans the await; parent step stays open |
| P3 | Port emits inbound notification back to actor | inbound delivery starts a **new** macrostep (`actor`/`external` trigger) |

## 7.6 Parent ↔ child actors (cross-actor causality)

| # | Case | Trigger | Expected links |
|---|------|---------|----------------|
| A1 | Parent spawns child (`makeChildActor`) | `spawn` | child `actor.created`; child root trace **links** back to spawning step (`cause.kind=spawn`) |
| A2 | Parent → child notification | `actor` | **separate** child trace; bidirectional `causes`/`caused-by` links (doc 4 §4.7) |
| A3 | Parent → child awaited `call` | `call` | caller opens `ihsm.await` (CLIENT) span; child trace linked both ways |
| A4 | Child → parent notification (reply/event up) | `actor` | parent macrostep linked from child step |
| A5 | `replyAtStable` service (opt-in) | `call` | caller `ihsm.await` duration matches child macrostep stability |
| A6 | Deterministic identity across topology | — | same `runSeed` + path ⇒ same `ihsm.actor.uuid` for parent and each child (R2) |
| A7 | Multi-level (grandparent→parent→child) fan-out | mixed | each actor = own trace; link chain reconstructs the full causal tree |

## 7.7 External ↔ internal embodiment boundaries

| # | Case | Expected |
|---|------|----------|
| E1 | External actor receives external stimulus | trigger `external`; one trace per stimulus |
| E2 | Inbound actor (port-facing) receives inbound event | trigger `actor`; separate trace |
| E3 | Two external stimuli while idle | **two** traces (boundary closes at stability) |
| E4 | External stimulus arrives while actor still busy (pipelined) | queued; remains part of in-flight macrostep until drain (documented boundary rule) |

## 7.8 Timers

| # | Case | Trigger | Expected |
|---|------|---------|----------|
| TM1 | `port.defer(ms)` fires a deferred notification | `timer` | new macrostep, `cause.kind=timer`, linked to the scheduling step |
| TM2 | Timer scheduled then actor transitions away | `timer` | deferred delivery still attributed to scheduling step |

## 7.9 Failure modes (first-class)

| # | Case | Expected |
|---|------|----------|
| F1 | Handler throws (`EventHandlerError`) | step+root `outcome=error`, exception recorded, `ihsm.error.phase=handler` |
| F2 | Transition routine throws (`TransitionError`) | `phase=transition` |
| F3 | `onEntry`/`onExit` throws | `phase=onEntry`/`onExit` |
| F4 | Unhandled event (`UnhandledEventError`) | `phase=unhandled` |
| F5 | Initialization failure (`InitializationError`/`FatalError`) | `phase=initialize`, fatal state |
| F6 | Instrumentation callback itself throws | swallowed; actor behavior unchanged (R6) |

## 7.10 Determinism & non-interference (cross-cutting, asserted on every case)

| # | Invariant |
|---|-----------|
| D1 | Telemetry **on** vs **off** ⇒ byte-identical transitions and `ctx` outputs (R6) |
| D2 | Same `runSeed` ⇒ identical `ihsm.actor.uuid` and identical processed-trace structure (R2/R6) |
| D3 | Step ordering is by start time only (no emitted sequence) |
| D4 | One macrostep = one trace; root ends exactly at stability |
| D5 | Server and browser runs produce the **same** processed shape (schema parity, R8) |

---

## 7.11 Status tracker

Each row is implemented as a scenario in `packages/otel/src/spec/scenarios/` and asserted with the
doc-6 processor + conformance helpers. The authoritative on-disk OTLP sequence (doc 8) is captured
once the collector container lands.

| Group | Server | Browser | Disk-authoritative |
|-------|:------:|:-------:|:------------------:|
| 7.1 Lifecycle | ☐ | ☐ | ☐ |
| 7.2 Self-post | ☐ | ☐ | ☐ |
| 7.3 Transitions | ☐ | ☐ | ☐ |
| 7.4 Services | ☐ | ☐ | ☐ |
| 7.5 Ports | ☐ | ☐ | ☐ |
| 7.6 Parent/child | ☐ | ☐ | ☐ |
| 7.7 Ext/int | ☐ | ☐ | ☐ |
| 7.8 Timers | ☐ | ☐ | ☐ |
| 7.9 Failures | ☐ | ☐ | ☐ |
| 7.10 Determinism | ☐ | ☐ | ☐ |
