# Cross-stack: leaf → leaf

## What this presents

Cross-stack transition between leaves in different branches.

## Why it's done this way

LCA is the common ancestor (here the root); full exit of source stack then entry into target leaf.


## Topology

Source and target are **leaves in different stacks**. **LCA = `DeepTop`** (only shared ancestor).

```plantuml
@startuml
left to right direction
state DeepTop {
  state StackWest {
    state MidWest {
      state LeafWestA
    }
  }
  state StackEast {
    state MidEast {
      state LeafEastB
    }
  }
  LeafWestA -down-> LeafEastB : goCrossToLeafEastB
}
@enduml
```


### Expected trace

See the **Trace** panel on the [interactive docs site](https://filasieno.github.io/ihsm/reference), or run `npm run test:examples` headlessly.

## Starting point

`LeafWestA` (west stack)

## What happens

| Step | Action |
| ---- | ------ |
| 1 | LCA = **`DeepTop`** |
| 2 | Exit **entire west stack**: `LeafWestA`, `MidWest`, `StackWest` |
| 3 | Enter **east stack** down to target leaf: `StackEast`, `MidEast`, **`LeafEastB`** |
| 4 | Final leaf = **`LeafEastB`** (non-initial sibling in east mid) |

## Code

```typescript
sm.notify.goCrossToLeafEastB();
await sm.hsm.sync();
```


## Verify

```shell
npm run test:examples -- --grep '05 · 07 cross-stack to leaf'
```
