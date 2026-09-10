---
description: "The optional trusted per-execution shell environment for plugin authors and maintainers supplying short-lived non-DSH_* values, such as leased API keys, to bash and pwsh commands."
kind: "package-reference"
---

# @deepseek-ai/dsh-shell-exec-env

English | [中文](README.zh.md)

## Summary

`dsh-shell-exec-env` hands a short-lived capability — a leased API key, a rotating token — to one `bash` or `pwsh` command at the moment it runs, instead of leaving it in `process.env` for every session and subprocess to read. A trusted plugin declares the exact keys it owns and a resolver for current values; duplicate ownership, undeclared or case-mismatched results, `DSH_*` names, and empty values fail before a child process starts. The model never sees these keys and cannot ask for them. Mount it only where a command needs such a value; other compositions are unaffected.

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

Mount this registry beside the model-facing shell tools when a command must run with a value only the trusted Host can obtain right now. `dsh-tool-bash` and `dsh-tool-pwsh` look the service up per call rather than injecting it, so the row can sit anywhere in the composition and the registry itself takes no configuration:

```yaml
- name: '@deepseek-ai/dsh-shell-exec-env'
```

Mounting the registry alone changes nothing. Values reach a command only after a provider plugin registers for them.

### When to choose it

Choose this registry for values whose lifetime is shorter than the Host process and whose names belong to an external service — a leased token, a per-agent credential. Choose [`dsh-shell-env`](../shell-env/README.md) instead for enumerable Harness facts: it owns the reserved `DSH_*` namespace, which this registry rejects outright. A value that stays constant for the whole deployment belongs in the executor's own environment and needs neither package.

### Registering a contributor

A provider declares one stable name, the complete set of environment keys it may return, and a resolver that receives the current `ToolExecution`:

```ts
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-shell-exec-env'

declare function obtainShortLivedCapability(agentId: unknown): Promise<string | undefined>

export const inject = ['shellExecEnv']

export function apply(ctx: Context): void {
  ctx.shellExecEnv.register({
    name: 'short-lived-api-capability',
    keys: ['EXAMPLE_API_KEY'],
    async resolve(execution) {
      const value = await obtainShortLivedCapability(execution.agent?.id)
      return value === undefined ? {} : { EXAMPLE_API_KEY: value }
    },
  })
}
```

`register` returns a disposer, and the registration is released with the registering plugin's fiber as well. Each contributor name and each environment key has exactly one owner; key ownership is compared case-insensitively, so a composition that loads on POSIX rejects the same conflicts on Windows. A resolver may return fewer keys than it declared — an omitted key simply stays unavailable to that command.

### What every shell call collects

Each foreground and background shell call collects a fresh snapshot after argument validation, sandbox-policy resolution, and any approval prompt, but before process creation. The snapshot is frozen and key-sorted, and it reaches the command only through that call's explicit `ShellExecRequest.env`; `process.env` is never read, modified, or cached, and nothing is persisted between calls. A local subprocess executor strips credential-shaped variables from the inherited environment before merging this explicit snapshot, so an ambient value cannot reach the command under a contributed key's name.

### What can go wrong

A resolver that rejects fails the tool call, and no child process starts — there is no fallback to a stale or ambient value. Registration fails for an empty or duplicate contributor name, a duplicate or malformed key, a key another contributor already owns, or any name in the `DSH_*` namespace. Collection fails for a returned key the contributor did not declare, a key whose case does not match its declaration, or an empty value.

### Keeping contributed values safe

A provider plugin runs in the trusted Host process and can already act with that process's authority, so the registry cannot constrain what a provider resolves. The discipline is the provider's: contribute the narrowest, shortest-lived capability the external service accepts, never a durable account credential, because the invoked command reads every supplied value. Do not write these values to logs, session events, model-visible results, configuration, or the global environment.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the design decisions behind the registry and points at the code that realizes them; the observable behavior is fully covered in [Use this package](#use-this-package).

### Design philosophy

- **Found, not injected.** The service is absent from both shell tools' `inject` lists; each call reaches it through `ctx.get('shellExecEnv')`. A composition without the registry keeps the ordinary tool behavior and waits for nothing.
- **Ownership declared once, checked twice.** Keys are claimed at registration and re-checked against that declaration at collection, so a resolver cannot widen its reach after load. Ownership is held in an effect, so it disappears exactly when its plugin does.
- **Resolved late, stored nowhere.** Collection runs as close to process creation as the tool can place it, which is what makes a rotating value correct rather than merely recent. Nothing is cached, so a provider owns expiry entirely.
- **Out of the model's reach.** The registry adds no tool argument and exposes no list operation, so neither a prompt nor a model argument can enumerate or request a key.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: the `ShellExecEnvironmentRegistry` service, registration validation, and snapshot collection |
| — | No runtime invariant companion is published; this in-process registry emits no event and retains no durable data — `register` rejects a blank name, a duplicate contributor, a malformed or `DSH_`-prefixed key, and a key another contributor already owns, and `collect` rejects an undeclared key or an empty value before any value reaches a child process. |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the package-level contract is not enough. They move from the shell family to the seam these values travel through and the decision behind them.

- [shell package map](../README.md) — the shell capability family and its roles.
- [shell-env](../shell-env/README.md) — the managed `DSH_*` environment this registry may not touch.
- [Bash executor subsystem](../../../docs/subsystems/shell.md) — the `ctx.shell` seam and the `ShellExecRequest.env` field a snapshot travels in.
- [tool-bash](../tool-bash/README.md) — where a snapshot is collected for a bash call.
- [tool-pwsh](../tool-pwsh/README.md) — the Windows counterpart.
- [Trusted per-execution shell environment](../../../.agents/notes/implemented/architecture/2026-08-31-trusted-shell-execution-environment.md) — why the values resolve late and stay out of `process.env`.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through commands run by a Skill or another trusted shell Consumer. The registry adds no prompt text, Tool schema field, result field, or durable session event.

#### KV Cache effect

None.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define when the registry is a poor fit or needs care. They are current package constraints, not a task backlog.

- **Every process in the call's tree can read the values** — they are handed to the executor as ordinary environment, so the registry cannot restrict which executable or descendant reads a key.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
