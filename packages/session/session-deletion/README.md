---
description: "Host-only recursive Session deletion for product code and maintainers permanently removing a Session lineage across live Agents and durable persistence."
kind: "package-reference"
---

# @deepseek-ai/dsh-session-deletion

English | [中文](README.zh.md)

## Summary

`dsh-session-deletion` permanently removes a Session and every descendant below it. `preview` returns the plan in bottom-up order; `deleteTree` runs it, fencing the lineage against new publication, claiming each live member as idle, and deleting durable records bottom-up. Running work, queued input, or a live Agent nobody retained rejects the whole subtree before a single record is removed, and a partial deletion converges on retry. Choose it when a product surface must erase a lineage rather than archive it. The caller still owns the archive and ownership checks, and `ctx.sessionDeletion` exists only on the Host.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount this service in a Host composition whose product code offers permanent deletion. It requires `sessions`, `sessionPersistence`, and `agents`, and takes no configuration of its own:

```yaml
- name: '@deepseek-ai/dsh-session'
- name: '@deepseek-ai/dsh-agent'
- name: '@deepseek-ai/dsh-session-persistence-jsonl'
  config:
    root: /absolute/path/to/session-logs
- name: '@deepseek-ai/dsh-session-deletion'
```

There is no browser Remote and no model tool: `ctx.sessionDeletion` is reachable from Host code only. Product bundles opt in explicitly and mount their authorized Catalog Consumer separately.

### When to choose it

Choose this service when a Session and its children must stop existing — a user erasing a conversation, a tenant leaving. Archiving, Workspace placement, product allocations, and Project directories belong to other owners, and this package touches none of them; validating archive state and ownership before the call is the caller's job. The mounted persistence provider must support deletion: `deleteTree()` rejects with `PERSISTENCE_UNSUPPORTED` before reserving or disposing any live state when the provider reports `supportsDeletion: false`.

### Planning a deletion

`preview(rootSessionId)` returns the known descendants followed by the root, in the order deletion will use, and reserves or mutates nothing. It merges the live Session registry with the persistence listing, and that listing already reports sessions created but never written, so an unmaterialized identity still appears in the plan.

### Deleting a subtree

`deleteTree(rootSessionId)` reserves the lineage against Session publication, then repeats discovery until the reservation covers the current closure, so a child that appears while the plan is forming is included instead of orphaned. It next claims every live member through the retained idle-disposal capability of its owning Agent, and only then disposes any of them. Running work, maintenance, queued input, or a live Session whose Agent nobody retained rejects the attempt before persistence deletion begins, and every claim taken so far is released.

Known persistence identities then delete bottom-up through `ctx.sessionPersistence.delete()`. JSONL unlinks the exact Session log and removes only its empty backend-owned directory; SQLite deletes the Session row and its cascade-owned events in one transaction; a lazy identity cancels without inventing an artifact. Every identity persistence removed publishes `session-persistence/deleted`. A zero-event live Session may already have retired its lazy intent during Agent disposal, so it stays in `sessionIds` but not in `deletedSessionIds`. A retry skips absent records and converges on root deletion.

### Which live Sessions can be claimed

`AgentRegistry.create()` and `AgentRegistry.resume()` retain the exact `AgentHandle` they returned without exposing it to this service, so their Sessions can be claimed. An Agent registered directly, or created from configuration, stays undeletable while live; stopping or disposing it through its own owner makes its cold Session eligible on a later attempt.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the ordering the service enforces and points at the code that realizes it; the observable behavior is fully covered in [Use this package](#use-this-package).

### Design philosophy

- **Fence first, delete last.** The reservation stops new publication into the subtree while the plan settles; it is not a storage lock, because persistence's own single-writer claim already excludes concurrent durable writes.
- **Refuse rather than force.** A live member is claimed through its owner's retained handle, never seized. A busy or unowned member ends the attempt while every record is still intact, which is why the failure mode is a refusal instead of a half-deleted lineage.
- **Convergent retry, not a transaction.** Durable deletion is a sequence of per-identity removals, so a crash mid-way leaves a shorter subtree. Bottom-up order plus skipping absent records makes the next attempt finish the same work.
- **Session state only.** Derived state — Workspace registrations, query indexes, Client projections, product allocations — is cleaned up by Consumers of `session-persistence/deleted` that ship with their owning packages.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: the `SessionDeletion` service, bottom-up planning, live claims, and durable removal |
| — | No runtime invariant companion is published; this service appends no event of its own, and every relation it holds — the deletion reservation and each `AgentIdleDisposalReservation` — is taken and released inside one `deleteTree` call, so a replay or dispatch observer would find nothing durable to check; refusals are raised eagerly as `SessionDeletionError`, and lifecycle and dual-backend tests cover the transitions. |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the package-level contract is not enough. They move from the Session family to the persistence contract this service deletes through and the Agent lifecycle it claims.

- [session package map](../README.md) — the Session family and its roles.
- [session-persistence](../session-persistence/README.md) — the `delete()` and `supportsDeletion` contract every removal goes through.
- [Session subsystem](../../../docs/subsystems/session.md) — `reserveForDeletion`, `isDeletionReserved`, and the `api-session/deleted` event.
- [Session persistence subsystem](../../../docs/subsystems/persistence.md) — `ctx.sessionDeletion` beside the persistence seam it depends on.
- [agent](../../core/agent/README.md) — retained `AgentHandle`s and the idle-disposal reservation a claim uses.

-----

<a id="model-experience"></a>
## Model Experience

### Session deletion

#### What the model sees

Nothing. `ctx.sessionDeletion` registers no tools, prompt sections, or Session events.

#### Token effect

Zero direct tokens on every request.

#### KV Cache effect

None. The package never assembles or changes a model request prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define when the service is a poor fit or needs care. They are current package constraints, not a task backlog.

- **The generic service deletes Session state only** — Workspace, query, Client projection, and product-allocation cleanup are derived Consumers of `session-persistence/deleted` and ship with their owning packages.
- **A live Agent must be retained and truly idle** — an authorized Host path has to hold its handle before deletion can claim it, so an Agent registered outside that path blocks its Session until its owner stops it.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
