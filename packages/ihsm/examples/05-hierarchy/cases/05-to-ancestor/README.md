# Leaf → ancestor composite

## Topology

Target is a **grandparent** (or higher ancestor), not the root. **LCA = that ancestor** (`StackWest`).

```plantuml
@startuml
left to right direction
state StackWest {
  [*] --> MidWest
  state MidWest {
    [*] --> LeafWestA
    LeafWestB -up-> StackWest : goAncestorWest
  }
}
@enduml
```


### Expected trace

See the **Trace** panel on the [interactive docs site](https://filasieno.github.io/ihsm/reference), or run `npm run test:examples` headlessly.

## Starting point

`LeafWestB` (after `goSiblingWest` from `LeafWestA`).

## What happens

| Step | Action |
| ---- | ------ |
| 1 | LCA = **`StackWest`** |
| 2 | Exit **`LeafWestB`**, then **`MidWest`** — stop before `StackWest` |
| 3 | **`DeepTop` is not exited** — still an ancestor of both source and target |
| 4 | Re-enter **`MidWest`** → `@InitialState` **`LeafWestA`** |
| 5 | Final leaf = **`LeafWestA`** |

## Code

```typescript
sm.goSiblingWest();
await sm.hsm.sync();
sm.goAncestorWest();
await sm.hsm.sync();
```


## Verify

```shell
npm run test:examples -- --grep '05 · 05 to ancestor'
```
