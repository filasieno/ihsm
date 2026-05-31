# Cross-stack: leaf → branch composite

## Topology

Target is the **branch composite** `StackEast`, not a leaf. **LCA = `DeepTop`**.

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
    [*] --> MidEast
    state MidEast {
      [*] --> LeafEastA
    }
  }
  LeafWestA -down-> StackEast : goCrossToBranchEast
}
@enduml
```


### Expected trace

See the **Trace** panel on the [interactive docs site](https://filasieno.github.io/ihsm/tutorials/), or run `npm run test:tutorials` headlessly.

## Starting point

`LeafWestA`

## What happens

| Step | Action |
| ---- | ------ |
| 1 | LCA = **`DeepTop`** — exit west stack completely |
| 2 | Enter **`StackEast`** |
| 3 | Target is composite → follow `@InitialState` chain: **`MidEast` → `LeafEastA`** |
| 4 | Final leaf = **`LeafEastA`** (initial east leaf, not `LeafEastB`) |

You call `transition(StackEast)`; ihsm always activates a **leaf**.

## Code

```typescript
sm.post('goCrossToBranchEast');
await sm.sync();
```


## Verify

```shell
npm run test:tutorials -- --grep '05 · 08 cross-stack to branch'
```
