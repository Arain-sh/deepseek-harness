import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import ShellExecEnvironmentRegistry from '@deepseek-ai/dsh-shell-exec-env'

const execution = {} as ToolExecution

describe('shell-exec-env', () => {
  it('collects current values, rejects ownership conflicts, and disposes exactly', async () => {
    const ctx = new Context()
    await ctx.plugin(ShellExecEnvironmentRegistry)
    let current = 'first'
    const dispose = ctx.shellExecEnv.register({
      name: 'test',
      keys: ['TEST_CAPABILITY'],
      resolve: () => ({ TEST_CAPABILITY: current }),
    })
    expect(await ctx.shellExecEnv.collect(execution)).toEqual({ TEST_CAPABILITY: 'first' })
    current = 'second'
    expect(await ctx.shellExecEnv.collect(execution)).toEqual({ TEST_CAPABILITY: 'second' })
    expect(() => ctx.shellExecEnv.register({
      name: 'duplicate',
      keys: ['test_capability'],
      resolve: () => ({}),
    })).toThrow(/already owned/u)
    dispose()
    expect(await ctx.shellExecEnv.collect(execution)).toEqual({})
  })

  it('rejects duplicate, managed, undeclared, case-mismatched, and empty values', async () => {
    const ctx = new Context()
    await ctx.plugin(ShellExecEnvironmentRegistry)
    expect(() => ctx.shellExecEnv.register({
      name: ' ', keys: ['ONE'], resolve: () => ({}),
    })).toThrow(/name must be non-empty/u)
    ctx.shellExecEnv.register({
      name: 'same-name', keys: ['SAME_NAME'], resolve: () => ({}),
    })
    expect(() => ctx.shellExecEnv.register({
      name: 'same-name', keys: ['OTHER_NAME'], resolve: () => ({}),
    })).toThrow(/already registered/u)
    expect(() => ctx.shellExecEnv.register({
      name: 'duplicate', keys: ['ONE', 'one'], resolve: () => ({}),
    })).toThrow(/duplicate keys/u)
    expect(() => ctx.shellExecEnv.register({
      name: 'invalid', keys: ['INVALID-KEY'], resolve: () => ({}),
    })).toThrow(/invalid key/u)
    expect(() => ctx.shellExecEnv.register({
      name: 'managed', keys: ['dsh_secret'], resolve: () => ({}),
    })).toThrow(/invalid key/u)

    ctx.shellExecEnv.register({
      name: 'undeclared', keys: ['DECLARED'], resolve: () => ({ OTHER: 'value' }),
    })
    await expect(ctx.shellExecEnv.collect(execution)).rejects.toThrow(/undeclared key/u)

    const second = new Context()
    await second.plugin(ShellExecEnvironmentRegistry)
    second.shellExecEnv.register({
      name: 'case', keys: ['EXACT_CASE'], resolve: () => ({ exact_case: 'value' }),
    })
    await expect(second.shellExecEnv.collect(execution)).rejects.toThrow(/undeclared key/u)

    const third = new Context()
    await third.plugin(ShellExecEnvironmentRegistry)
    third.shellExecEnv.register({
      name: 'empty', keys: ['EMPTY'], resolve: () => ({ EMPTY: '' }),
    })
    await expect(third.shellExecEnv.collect(execution)).rejects.toThrow(/empty value/u)
  })

  it('sorts and freezes snapshots without exposing a list operation', async () => {
    const ctx = new Context()
    await ctx.plugin(ShellExecEnvironmentRegistry)
    ctx.shellExecEnv.register({
      name: 'values', keys: ['Z_VALUE', 'A_VALUE'], resolve: () => ({ Z_VALUE: 'z', A_VALUE: 'a' }),
    })
    const result = await ctx.shellExecEnv.collect(execution)
    expect(Object.keys(result)).toEqual(['A_VALUE', 'Z_VALUE'])
    expect(Object.isFrozen(result)).toBe(true)
    expect('list' in ctx.shellExecEnv).toBe(false)
  })

  it('disposes a contribution with its registering plugin fiber', async () => {
    const ctx = new Context()
    await ctx.plugin(ShellExecEnvironmentRegistry)
    const fiber = ctx.plugin({
      inject: ['shellExecEnv'],
      apply(scope: Context) {
        scope.shellExecEnv.register({
          name: 'scoped', keys: ['SCOPED_CAPABILITY'], resolve: () => ({ SCOPED_CAPABILITY: 'active' }),
        })
      },
    })
    await fiber
    expect(await ctx.shellExecEnv.collect(execution)).toEqual({ SCOPED_CAPABILITY: 'active' })
    await fiber.dispose()
    expect(await ctx.shellExecEnv.collect(execution)).toEqual({})
  })
})
