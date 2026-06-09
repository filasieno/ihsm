# @ihsm/tools

Development utilities for [ihsm](https://filasieno.github.io/ihsm/) state machines. **Not published to npm** — install from the monorepo while building machines or optimizing dispatch.

## Status

| Tool | Stage | Description |
| ---- | ----- | ----------- |
| **Transition table generator** | v1 (cartesian) | Full `State × State` LCA plans delegating to `ihsm/transition-routines` |
| **Transition oracle tests** | v1 | `@ihsm/core` runtime vs generated routines — verbose trace parity |
| **Reachability analysis** | planned | Only pairs where `this.transition(Target)` appears in source |

## Install (monorepo)

```bash
cd packages/tools
npm install
npm run build
npm test
```

Depends on `ihsm` and `@ihsm/core` via `file:../ihsm` and `file:../core`.

## Shared transition routines (`ihsm/transition-routines`)

The runtime dispatch layer and generated tables share one implementation:

- `planTransitionClasses(from, to)` — LCA exit/entry/final state (same as production dispatch)
- `executeTransitionRoutine(hsm, instance, plan, from, to, options)` — production / debug / verbose execution with `TransitionError` on hook failure
- `createHsmTransitionTrace(hsm)` — verbose trace sink for oracle tests
- `transitionTraceLines(lines)` — canonical trace comparison helper

Generated modules import `executeTransitionRoutine` and static per-pair `TransitionRoutinePlan` constants.

## Transition table generator (cartesian)

```ts
import * as machine from './machine';
import { generateTransitionTableModule, writeTransitionTableFile } from '@ihsm/tools';

writeTransitionTableFile('./machine.transitions.ts', {
  topState: machine.DoorTop,
  exports: machine,
  importPath: './machine',
});
```

Generated modules export:

- `TRANSITION_ROUTINES` — `Record<key, TransitionRoutine>` calling `executeTransitionRoutine`
- `executeTransition(key, instance, setCurrentState, hsm)`
- `TransitionTableKey`, `TRANSITION_STATE_EXPORTS`, `TRANSITION_PLAN_COUNT`

## Oracle tests

`src/spec/transition-oracle.spec.ts` runs the large two-branch LCA machine (same topology as `packages/ihsm/src/spec/transition.spec.ts`) and asserts:

1. **Happy path** — full cartesian product: verbose traces from `@ihsm/core` match generated routines
2. **Failure path** — each `onEntry` / `onExit` along every transition path: identical traces, `TransitionError`, and `FatalErrorState`

The oracle machine supports `runTransition(to)`, `prepareAt(state)`, `setFailTarget(state, hook)`, and `clearFail()` for injected hook failures.

## CLI

```bash
npm run build
npx ihsm-tools transitions --import ./machine.js --top DoorTop --out ./machine.transitions.ts
```

## Package layout

```
src/
  discover.ts
  plan.ts
  generate.ts              # emits ihsm/transition-routines delegates
  oracle/                    # core vs routine comparison harness
  fixtures/transition-oracle.machine.ts
  spec/transition-oracle.spec.ts
```
