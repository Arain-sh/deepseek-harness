# @deepseek-ai/dsh-shell-exec-env

[English](README.md) | 中文

这是一个可选的 Service Definition，用于在每次面向模型的 Bash 或 Pwsh 执行前解析可信环境变量。Provider（提供方）声明其拥有的精确键名，并通过 effect（副作用）管理的注册返回当前非空值。贡献者名称和环境键只能有一个所有者；键所有权按大小写不敏感处理，确保同一组合在 Windows 上也安全。重复所有权、未声明或大小写不一致的返回项、`DSH_*` 键以及空值都会在创建子进程前失败。

包默认导出 `ShellExecEnvironmentRegistry`，并注册 `ctx.shellExecEnv`。面向模型的 shell Consumer（消费方）通过可选的 `ctx.get('shellExecEnv')` 发现它；未加载该服务的组合保留官方 shell 行为。

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

每次前台和后台 shell 调用都会收集新的快照。收集发生在工具校验、sandbox 策略解析及可能的审批提示之后，但在进程创建之前。Provider 拒绝时，工具调用失败且不会启动进程。快照只合并到本次命令显式的 `ShellExecRequest.env`；`process.env` 永远不会被修改或缓存。

此注册表不会读取进程环境、持久化值、公开列表操作，也不会给面向模型的工具 schema 增加环境参数。它还拒绝受管理的 `DSH_*` 命名空间；该命名空间仍由 [`@deepseek-ai/dsh-shell-env`](../shell-env/README.zh.md) 拥有。本地子进程 Provider 会先删除环境中形似凭证的变量，再合并这份显式可信快照。

## 安全性

Provider 插件运行在可信 Host 进程中，并已具有执行该进程权限范围内代码的能力。即便如此，它仍必须只贡献作用域较窄、生命周期较短的能力，因为被调用的命令可以读取本次提供的所有值。值不得写入日志、会话事件、模型可见结果、配置或全局环境。

## 模型体验

模型仅通过 Skill 或其他可信 shell Consumer 运行的命令间接使用这些值。注册表不会增加提示词、工具 schema 字段、结果字段或持久化会话事件。

#### KV Cache 影响

无。

## 已知限制与暂缓事项

- 环境值对本次 shell 调用的完整子进程树可见；注册表无法限制由哪个可执行文件或后代进程读取。
