# Agent Note: trusted per-execution shell environment

Status: implemented

English | [中文](2026-08-31-trusted-shell-execution-environment.zh.md)

## Problem

A trusted Host plugin can acquire a short-lived capability for one Agent execution, but the model-facing Bash and Pwsh Consumers have no extension point for passing that current value to the child command. Setting `process.env` makes credentials global across concurrent sessions and leaves stale state after logout or lease rotation. Adding an `env` Tool argument would expose credential injection to the model and duplicate behavior already available through shell syntax. Replacing either shell Tool would also duplicate its approval, sandbox, background-job, workdir, result, and presentation behavior.

The existing `ctx.shellEnv` registry cannot carry these values. It owns enumerable Harness facts in the reserved `DSH_*` namespace, while short-lived capabilities may use external names such as an API-specific `*_API_KEY` and must not become an environment catalog.

## Decision

`@deepseek-ai/dsh-shell-exec-env` defines an optional `ctx.shellExecEnv` registry. A trusted provider registers one stable name, its complete environment-key set, and a resolver that receives the current `ToolExecution`. Each key has one case-insensitive owner so Windows and POSIX compositions reject the same ownership conflicts. The registry rejects `DSH_*`, undeclared or case-mismatched results, and empty values. It exposes collection and registration only; there is no list operation.

`dsh-tool-bash` and `dsh-tool-pwsh` discover the registry through `ctx.get('shellExecEnv')`. They await one fresh snapshot after argument validation, sandbox-policy resolution, and any approval prompt, but before foreground or background process creation. A missing registry preserves the ordinary Tool behavior; a provider rejection fails the Tool call without starting a child. A non-empty snapshot becomes an explicit `ShellExecRequest.env`, while managed Harness facts continue through `dshEnv` and merge last.

The shell Tool schemas remain unchanged and build requests from named model arguments. Extra model keys cannot add or replace environment values. Providers own capability acquisition, expiration, and logout behavior; the registry never reads ambient environment, caches values, persists them, or modifies `process.env`.

## Security properties

The local subprocess implementation still starts from a parent environment with credential-shaped and `DSH_*` names removed. Only values explicitly returned by a trusted provider enter that command. The complete child process tree can read them, so providers contribute the narrowest short-lived capability accepted by the external service and never durable account credentials.

## Alternatives considered

**Extend `ctx.shellEnv` to arbitrary names.** Rejected because it combines enumerable Harness identity facts with non-enumerable credential-shaped capabilities and weakens the reserved-namespace contract.

**Set and restore `process.env` around a command.** Rejected because concurrent calls observe one process-global map; restoration cannot prevent cross-session reads or subprocesses spawned during the interval.

**Replace Bash and Pwsh with Product-owned Tools.** Rejected because preserving official behavior would require copying both Consumers and synchronizing every upstream approval, sandbox, job, rendering, and schema change.

**Add `env` to the model-facing Tool schemas.** Rejected because it grants the model a new credential-injection input without creating authority separation; trusted Host providers, not model arguments, own these values.

## Consequences

Out-of-tree plugins can supply current capabilities without importing shell Tool internals or patching global state. The DSH change remains generic: it defines one optional registry and two Consumer hooks but contains no provider- or Product-specific authentication logic. Resolver latency is added to calls only when the service is mounted, and provider failure intentionally makes the command unavailable rather than falling back to stale or ambient credentials. The ordinary `ShellExecRequest.env` behavior and its merge order remain governed by the [stdin and environment decision](2026-06-30-bash-stdin-env-trusted-plugin-api.md).
