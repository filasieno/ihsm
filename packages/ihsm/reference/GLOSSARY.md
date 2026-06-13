# ihsm Glossary

Terms used across the reference docs. For how the same `Machine` is reached in different contexts,
see [`DESIGN-REFERENCE.md`](DESIGN-REFERENCE.md).

---

| Term                      | Meaning |
| ------------------------- | ------- |
| **`T`**                   | Author's root class — e.g. **`typeof DoorTop`**. Inferred from `makeActor(DoorTop, …)`. Not a library-defined name. |
| **`TopStateArg`** | Class constructor for `TopState<C>` where `C extends ValidatedActorConfig`. |
| **`ActorConfigOf<T>`**    | Internal peel of the config bag from `T`. Not a public generic parameter. |
| **`ActorContextOf<T>`**   | Context type from `T` (was `ActorContextOf<C>`). |
| **`ActorServicesOf<T>`**  | Public **services** bucket from `T`. |
| **`ActorNotificationsOf<T>`** | Public **notifications** bucket from `T`. |
| **`ActorInternalServicesOf<T>`** | **internalServices** bucket from `T`. |
| **`ActorInternalNotificationsOf<T>`** | **internalNotifications** bucket from `T`. |
| **`ActorPublicOf<T>`**    | `ActorServicesOf<T>` ∪ `ActorNotificationsOf<T>`. |
| **`ActorInternalOf<T>`**  | `ActorInternalServicesOf<T>` ∪ `ActorInternalNotificationsOf<T>`. |
| **`RootProtocol<T>`**     | Bucket selection: notifications + services (`ExternalActor` protocol). |
| **`InboundProtocol<T>`**  | Bucket selection: root + internal notifications (`InboundActor` protocol). |
| **`ChildProtocol<ChildT>`** | Bucket selection: all four buckets (`ChildActor` / `TestActor` protocol). |
| **`ActorPortOf<T>`**      | Port type from `T`. |
| **`ActorStateOf<T>`**     | State constructor extending `T` (was `StateClassOf<C>`). |
| **`ValidatedActorConfig<C>`** | **Single config gate** — disjoint protocol buckets; enforced on `TopState<C>`, not factories. |
| **`ParentActor<T>`**      | Parent-machine link for **any** root `T`; not a protocol shell. |
| **`ChildActor<ChildT>`**  | Child shell — `ChildProtocol<ChildT>` + `ChildHsm<ChildT>`. |
| **`TestActor<T>`**        | Test shell — `ChildProtocol<T>` + `TestHsm<T>` (`ihsm/testing`). |
| **`makeActor`**           | Root factory → `ExternalActor<T>` (`RootProtocol<T>`). |
| **`makeChildActor`**      | Parent composes child → `ChildActor<ChildT>` (`ChildProtocol<ChildT>`). |
| **`makeTestActor`**       | Test factory (`ihsm/testing`) → `TestActor<T>`. |
| **`asParentActor(this)`** | Handler `this` → `ParentActor<ParentT>` for `makeChildActor`. |
| **Protocol**              | Four config buckets; each embodiment **selects** which buckets appear on its shell. |
| **Protocol bucket**       | `notifications`, `services`, `internalNotifications`, `internalServices`. |
| **Embodiment**            | Handler \| Root \| Inbound \| Child \| Parent (via `ChildActor`) \| Test. |
| **Embodiment kind**       | `handler` \| `root` \| `inbound` \| `child` \| `test` — `protocolProto(T, kind)` cache key. |
| **Embodiment shell**      | Plain object: selected protocol buckets + `hsm` toolbox. |
| **Handler facade**        | `HandlerHsm<T>` — implements buckets; `this.hsm` in state handlers. |
| **Root facade**           | `ExternalHsm<T>` — `makeActor` return `.hsm`. |
| **Inbound facade**        | `InboundHsm<T>` — `port.actor.hsm` after `makeActor(…, port)`. |
| **Child facade**          | `ChildHsm<ChildT>` — `ctx.child.hsm` or `RequestingPort.actor.hsm`. |
| **Test facade**           | `TestHsm<T>` — `makeTestActor` return `.hsm`. |
| **`parent` (on actors)**  | Optional `parent?: ParentActor<…>` on every actor shell. |
| **Self-notifications**    | `SelfNotifications<T>` — `hsm.actor`, `hsm.immediate`, `hsm.defer(ms)`. |
| **Port-bound actor**      | `port.actor` on `Port<T>` — inbound (`InboundProtocol<T>`). |
| **Requesting port**       | `RequestingPort<T>` — `port.actor` is child (`ChildProtocol<T>`). |
| **Subscription object**   | `ResultWithSubscription`; callbacks use `port.actor.<internalNotification>(...)`. |

### Reserved names (never protocol keys)

`ctx`, `hsm`, `onEntry`, `onExit`, `onError`, `onUnhandled`
