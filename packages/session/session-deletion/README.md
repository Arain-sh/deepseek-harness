# @deepseek-ai/dsh-session-deletion

English | [中文](README.zh.md)

`ctx.sessionDeletion` is an optional Host-only capability that permanently removes a Session subtree. Product code validates archive state and ownership before calling it; this package exposes no browser Remote and no model tool.

## Operation

`preview(rootSessionId)` returns the known descendants followed by the root in bottom-up deletion order. `deleteTree(rootSessionId)` reserves that lineage against publication, repeats discovery until the reservation covers the current closure, and claims every live Agent through its retained idle-disposal capability before disposing any Agent. Running work, maintenance, queued input, or an unretained live Agent rejects before persistence deletion begins.

Known persistence identities delete bottom-up through `ctx.sessionPersistence.delete()`. JSONL unlinks the exact Session log and removes only its empty backend-owned directory; SQLite deletes the Session row and cascade-owned events in one transaction; a lazy identity cancels without inventing an artifact. Every identity removed by persistence publishes `session-persistence/deleted`. A zero-event live Session may already have retired its lazy intent during Agent disposal, so it remains in `sessionIds` but not `deletedSessionIds`. A retry skips absent records and converges on root deletion. The package never archives, changes Workspace placement, removes product allocations, or deletes Project directories.

`AgentRegistry.create()` and `AgentRegistry.resume()` retain their exact returned `AgentHandle` without exposing it to this service. Directly registered or configuration-created Agents remain undeletable while live; stopping or disposing them through their owner makes their cold Session eligible later.

## Composition

The service requires `sessions`, `sessionPersistence`, and `agents`. `deleteTree()` rejects with `PERSISTENCE_UNSUPPORTED` before reserving or disposing live state when the selected provider reports `supportsDeletion: false`. Product bundles opt in explicitly and mount their authorized Catalog Consumer separately.

## Model Experience

### Session deletion

#### What the model sees

Nothing. `ctx.sessionDeletion` registers no tools, prompt sections, or Session events.

#### Token effect

Zero direct tokens on every request.

#### KV Cache effect

None. The package never assembles or changes a model request prefix.

## Known Limitations and Deferred Work

- The generic service deletes Session state only. Workspace, query, Client projection, and product-allocation cleanup are derived Consumers of `session-persistence/deleted` and ship with their owning packages.
- A live Agent must be retained by an authorized Host path and truly idle before deletion can claim it.
