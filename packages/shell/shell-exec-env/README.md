# @deepseek-ai/dsh-shell-exec-env

English | [中文](README.zh.md)

Optional Service Definition for trusted environment values resolved immediately before a model-facing Bash or Pwsh execution. Providers declare exact keys and return current non-empty values through an effect-owned registration. Contributor names and environment keys have one owner; key ownership is case-insensitive so the same composition behaves safely on Windows. Duplicate ownership, undeclared or case-mismatched results, `DSH_*` keys, and empty values fail before a child process starts.

The package default-exports `ShellExecEnvironmentRegistry`, which registers `ctx.shellExecEnv`. The model-facing shell Consumers discover it through optional `ctx.get('shellExecEnv')`; compositions without the service preserve the official shell behavior.

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

Every foreground and background shell call collects a new snapshot after tool validation, sandbox-policy resolution, and any approval prompt, but before process creation. Provider rejection fails the tool call without starting a process. The snapshot is merged only into that command's explicit `ShellExecRequest.env`; `process.env` is never modified or cached.

This registry does not read process environment, persist values, expose a list operation, or add environment parameters to the model-facing Tool schema. It also rejects the managed `DSH_*` namespace, which remains owned by [`@deepseek-ai/dsh-shell-env`](../shell-env/README.md). Local subprocess providers remove ambient credential-shaped variables before merging this explicit trusted snapshot.

## Security

Provider plugins execute in the trusted Host process and can already run code with that process's authority. They must still contribute narrowly scoped, short-lived capabilities because the invoked command can read every supplied value. Values must not be written to logs, session events, model-visible results, configuration, or global environment.

## Model Experience

Indirectly, through commands run by a Skill or another trusted shell Consumer. The registry adds no prompt text, Tool schema field, result field, or durable session event.

#### KV Cache effect

None.

## Known Limitations and Deferred Work

- Environment values are available to the complete child process tree for that shell call; the registry cannot restrict which executable or descendant reads them.
