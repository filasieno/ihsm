# Leaf → root (LCA = top)

## Topology

Target is the **root state class** `DeepTop`. **LCA = `DeepTop`**.

```plantuml
@startuml
left to right direction
state DeepTop {
  [*] --> StackWest
  state StackWest {
    state MidWest {
      LeafWestA -up-> DeepTop : goRoot
    }
  }
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
| 1 | LCA = **`DeepTop`** |
| 2 | Exit entire west stack: **`LeafWestA` → `MidWest` → `StackWest`** |
| 3 | **`DeepTop.onExit` / `onEntry` do not run** — LCA is neither exited nor re-entered |
| 4 | Re-enter **`StackWest`** ( `@HsmInitialState` branch ) → **`MidWest` → `LeafWestA`** |
| 5 | Final leaf = **`LeafWestA`** |

Transitioning to the root **does not** leave you “bare” at the root class — ihsm immediately descends the **initial branch** again.

## Code

```typescript
sm.post('goRoot');
await sm.sync();
```


## Verify

```shell
npm run test:tutorials -- --grep '05 · 06 to root'
```
