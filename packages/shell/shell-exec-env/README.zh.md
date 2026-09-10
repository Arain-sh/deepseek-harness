---
description: "可选的可信逐次执行 shell 环境，供插件作者与维护者把短生命周期的非 DSH_* 值（例如租用的 API key）交给 bash 与 pwsh 命令。"
kind: "package-reference"
---

# @deepseek-ai/dsh-shell-exec-env

[English](README.md) | 中文

## 概述

`dsh-shell-exec-env` 在 `bash` 或 `pwsh` 命令真正启动的那一刻，把短生命周期的能力——租用的 API key、轮换的令牌——交给这一次调用，而不是把它留在 `process.env` 里让所有会话与子进程都能读到。可信插件声明它拥有的确切键名和一个解析当前值的 resolver；重复所有权、未声明或大小写不一致的返回项、`DSH_*` 键名与空值都会在子进程启动前失败。模型看不到这些键，也无法索取。只在命令确实需要这类值时挂载它；其他组合不受影响。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

当命令必须带着只有可信 Host 才能当场取得的值运行时，把这个注册表与面向模型的 shell 工具一起挂载。`dsh-tool-bash` 与 `dsh-tool-pwsh` 是按次查找该服务而不是注入它，因此这一行放在组合的任何位置都可以，注册表本身也不接受配置：

```yaml
- name: '@deepseek-ai/dsh-shell-exec-env'
```

只挂载注册表不会改变任何行为。只有在 provider 插件为某些键注册之后，值才会到达命令。

### 何时选择

当值的生命周期短于 Host 进程、且键名属于外部服务时——租用的令牌、按 agent 发放的凭证——选择这个注册表。可枚举的 Harness 事实请改用 [`dsh-shell-env`](../shell-env/README.zh.md)：保留的 `DSH_*` 命名空间归它所有，本注册表会直接拒绝这类键名。整个部署期间恒定不变的值属于执行器自身的环境，两个包都不需要。

### 注册一个 contributor

Provider 声明一个稳定名称、它可能返回的完整环境键集合，以及一个接收当前 `ToolExecution` 的 resolver：

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

`register` 返回一个 disposer，注册同时也会随注册它的插件 fiber 一起释放。每个 contributor 名称与每个环境键都只有一个所有者；键所有权按大小写不敏感比较，因此在 POSIX 上能加载的组合在 Windows 上会拒绝同样的冲突。resolver 返回的键可以少于它声明的键——被省略的键对这次命令就是不可用。

### 每次 shell 调用收集什么

每次前台与后台 shell 调用都会收集一份新的快照，时机在参数校验、sandbox 策略解析与可能的审批提示之后，进程创建之前。快照已冻结并按键排序，只通过本次调用显式的 `ShellExecRequest.env` 到达命令；`process.env` 从不被读取、修改或缓存，调用之间也不保存任何内容。本地子进程执行器会先从继承的环境里剔除形似凭证的变量，再合并这份显式快照，因此环境里原有的值无法冒用被贡献的键名到达命令。

### 可能出错的地方

resolver 抛错会让工具调用失败，且不会启动子进程——不会退回到陈旧的值或环境里原有的值。以下情况注册失败：contributor 名称为空或重复、键重复或格式非法、键已被另一个 contributor 拥有、键名落在 `DSH_*` 命名空间内。以下情况收集失败：返回了未声明的键、键的大小写与声明不一致、值为空。

### 安全地处置贡献的值

Provider 插件运行在可信 Host 进程中，本就能以该进程的权限行事，因此注册表无法约束 provider 解析出什么。约束在 provider 一侧：只贡献外部服务能接受的最窄、最短命的能力，绝不贡献长期账户凭证，因为被调用的命令能读到提供的每一个值。不要把这些值写入日志、会话事件、模型可见结果、配置或全局环境。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

本节说明注册表背后的设计取舍，并指向实现它们的代码；可观察行为已在[使用本包](#use-this-package)中完整说明。

### 设计理念

- **靠查找获得，而非注入。** 两个 shell 工具的 `inject` 列表里都没有这个服务；每次调用通过 `ctx.get('shellExecEnv')` 获取。未挂载注册表的组合保持工具原有行为，也不必为它等待。
- **所有权声明一次，校验两次。** 键在注册时被认领，在收集时再与该声明比对，因此 resolver 无法在加载后扩大自己的范围。所有权持有在 effect 中，因此它与其插件同生共灭。
- **晚解析，不留存。** 收集发生在工具能安排的、最靠近进程创建的位置，这正是轮换中的值能保持有效而不只是接近有效的原因。不做任何缓存，过期完全由 provider 负责。
- **模型够不到。** 注册表不增加任何工具参数，也不提供列表操作，因此提示词与模型参数都无法枚举或索取某个键。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：`ShellExecEnvironmentRegistry` 服务、注册校验与快照收集 |
| — | 不发布运行时不变式伴生入口；本包是进程内注册表，不发出任何事件、也不持有持久数据——`register` 会拒绝空名称、重复 contributor、格式非法或以 `DSH_` 开头的键，以及已被其他 contributor 占用的键，`collect` 则在任何值进入子进程之前拒绝未声明的键与空值。 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当包级约定不够用时阅读以下页面。它们从 shell 家族逐步进入这些值经过的 seam，以及它们背后的决策。

- [shell 包图谱](../README.zh.md)——shell 能力家族及其角色。
- [shell-env](../shell-env/README.zh.md)——本注册表不得触碰的受管 `DSH_*` 环境。
- [Bash 执行器子系统](../../../docs/subsystems/shell.zh.md)——`ctx.shell` seam 与快照所在的 `ShellExecRequest.env` 字段。
- [tool-bash](../tool-bash/README.zh.md)——bash 调用在何处收集快照。
- [tool-pwsh](../tool-pwsh/README.zh.md)——Windows 对应物。
- [可信逐次执行 shell 环境](../../../.agents/notes/implemented/architecture/2026-08-31-trusted-shell-execution-environment.zh.md)——为什么这些值晚解析并远离 `process.env`。

-----

<a id="model-experience"></a>
## 模型体验

模型仅通过 Skill 或其他可信 shell Consumer 运行的命令间接使用这些值。注册表不会增加提示词、工具 schema 字段、结果字段或持久化会话事件。

#### KV Cache 影响

无。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制说明本注册表何时不合适，或何时需要特别注意。它们是当前包约束，不是任务积压。

- **本次调用进程树中的每个进程都能读到这些值**——它们作为普通环境交给执行器，因此注册表无法限制由哪个可执行文件或后代进程读取某个键。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
