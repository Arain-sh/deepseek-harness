/**
 * Trusted, per-execution environment contributions for model-facing shell
 * Consumers. Values are resolved immediately before a process starts, never
 * exposed through the Tool schema, and never read from or written to Host
 * `process.env`.
 *
 * @module @deepseek-ai/dsh-shell-exec-env
 */

import { Service, type Context } from '@deepseek-ai/cordis'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Optional trusted environment resolved immediately before one shell execution. */
    shellExecEnv: ShellExecEnvironmentRegistry
  }
}

const ENVIRONMENT_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/u

/** One plugin-owned environment contribution. */
export interface ShellExecEnvironmentContributor {
  /** Stable registration identity. */
  readonly name: string
  /** Complete environment names this contributor may return. */
  readonly keys: readonly string[]
  /**
   * Resolve values for one tool execution.
   * @param execution - current shell Tool execution and optional Agent.
   * @returns declared non-empty values; omitted keys stay unavailable.
   */
  resolve(execution: ToolExecution): Promise<Readonly<Record<string, string>>> | Readonly<Record<string, string>>
}

/** Effect-owned registry collected afresh for every Bash or Pwsh call. */
export default class ShellExecEnvironmentRegistry extends Service {
  private readonly contributors = new Map<string, ShellExecEnvironmentContributor>()
  private readonly keyOwners = new Map<string, string>()

  /**
   * Create and install the optional shell execution environment service.
   * @param ctx - Cordis context that owns the registry and its contributions.
   */
  constructor(ctx: Context) {
    super(ctx, 'shellExecEnv')
  }

  /**
   * Register one exact environment owner.
   * @param contributor - declared keys and their execution-time resolver.
   * @returns the exact contribution disposer.
   */
  register(contributor: ShellExecEnvironmentContributor): () => void {
    const name = contributor.name.trim()
    if (name === '') throw new Error('shell-exec-env: contributor name must be non-empty')
    if (this.contributors.has(name)) throw new Error(`shell-exec-env: contributor "${name}" is already registered`)

    const normalizedKeys = contributor.keys.map(key => key.toUpperCase())
    if (new Set(normalizedKeys).size !== normalizedKeys.length) {
      throw new Error(`shell-exec-env: contributor "${name}" declared duplicate keys`)
    }
    for (const key of contributor.keys) {
      const normalizedKey = key.toUpperCase()
      if (!ENVIRONMENT_KEY.test(key) || normalizedKey.startsWith('DSH_')) {
        throw new Error(`shell-exec-env: contributor "${name}" declared invalid key "${key}"`)
      }
      const owner = this.keyOwners.get(normalizedKey)
      if (owner !== undefined) {
        throw new Error(`shell-exec-env: key "${key}" is already owned by contributor "${owner}"`)
      }
    }

    const registered = { ...contributor, name, keys: [...contributor.keys] }
    const dispose = this.ctx.effect(() => {
      this.contributors.set(name, registered)
      for (const key of normalizedKeys) this.keyOwners.set(key, name)
      return () => {
        this.contributors.delete(name)
        for (const key of normalizedKeys) this.keyOwners.delete(key)
      }
    }, `shell-exec-env:${name}`)
    return () => { void dispose() }
  }

  /**
   * Collect the current trusted environment snapshot. Provider failures reject
   * the shell call before a child process starts.
   * @param execution - current shell Tool execution.
   * @returns an immutable, key-sorted environment map.
   */
  async collect(execution: ToolExecution): Promise<Readonly<Record<string, string>>> {
    const contributors = [...this.contributors.entries()].sort(([left], [right]) => left.localeCompare(right))
    const resolved = await Promise.all(contributors.map(async ([name, contributor]) => ({
      name,
      contributor,
      values: await contributor.resolve(execution),
    })))
    const result: Record<string, string> = {}
    for (const { name, contributor, values } of resolved) {
      const declared = new Map(contributor.keys.map(key => [key.toUpperCase(), key]))
      for (const [key, value] of Object.entries(values)) {
        const declaredKey = declared.get(key.toUpperCase())
        if (declaredKey === undefined || declaredKey !== key) {
          throw new Error(`shell-exec-env: contributor "${name}" returned undeclared key "${key}"`)
        }
        if (value === '') throw new Error(`shell-exec-env: contributor "${name}" returned an empty value for "${key}"`)
        result[key] = value
      }
    }
    return Object.freeze(Object.fromEntries(Object.entries(result).sort(([left], [right]) => left.localeCompare(right))))
  }
}
