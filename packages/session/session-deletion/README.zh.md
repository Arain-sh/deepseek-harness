---
description: "仅限 Host 的递归 Session 删除能力，供产品代码与维护者跨 live Agent 与持久化存储永久移除一条 Session 血缘。"
kind: "package-reference"
---

# @deepseek-ai/dsh-session-deletion

[English](README.md) | 中文

## 概述

`dsh-session-deletion` 永久移除一个 Session 及其下的所有后代。`preview` 按自底向上的顺序返回删除计划；`deleteTree` 执行该计划：先阻止这条血缘继续发布，再把每个 live 成员认领为 idle，最后自底向上删除持久化记录。运行中的工作、排队输入，或没有任何 owner 持有的 live Agent，都会在任何一条记录被移除之前让整个子树被拒绝；删除到一半时重试会收敛。当产品界面需要抹除而不是归档一条血缘时选择它。归档状态与所有权校验仍由调用方负责，`ctx.sessionDeletion` 也只存在于 Host 侧。

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

在提供永久删除能力的 Host 组合中挂载本服务。它要求 `sessions`、`sessionPersistence` 与 `agents`，自身不接受任何配置：

```yaml
- name: '@deepseek-ai/dsh-session'
- name: '@deepseek-ai/dsh-agent'
- name: '@deepseek-ai/dsh-session-persistence-jsonl'
  config:
    root: /absolute/path/to/session-logs
- name: '@deepseek-ai/dsh-session-deletion'
```

本包不提供浏览器 Remote，也不提供模型工具：`ctx.sessionDeletion` 只能被 Host 代码访问。Product Bundle 必须显式选择接入，并单独挂载获得授权的 Catalog Consumer。

### 何时选择

当一个 Session 及其子节点必须不复存在时选择本服务——用户抹除一段对话、租户退出。归档、Workspace placement、产品 allocation 与 Project 目录都归其他所有者，本包一概不碰；调用前校验归档状态与所有权是调用方的职责。挂载的 persistence provider 必须支持删除：provider 报告 `supportsDeletion: false` 时，`deleteTree()` 会在 reservation 或 dispose 任何 live state 之前以 `PERSISTENCE_UNSUPPORTED` 拒绝。

### 规划一次删除

`preview(rootSessionId)` 按删除将采用的顺序返回已知后代，最后返回根节点，不做任何 reservation 或修改。它把 live Session 注册表与 persistence 列表合并，而该列表本身已经会报告已创建但从未写入的 Session，因此未实体化的 identity 同样出现在计划中。

### 删除一个子树

`deleteTree(rootSessionId)` 先阻止这条血缘继续发布，然后重复发现直到 reservation 覆盖当前完整闭包，因此计划形成期间新出现的子节点会被纳入而不是被遗落。随后它通过每个 live 成员所属 Agent 的 retained idle-disposal 能力认领该成员，认领全部完成后才 dispose 其中任何一个。运行中的工作、maintenance、排队输入，或 Agent 未被任何人 retained 的 live Session，都会在持久化删除开始前让本次尝试被拒绝，且此前取得的每个认领都会释放。

已知的 persistence identity 随后通过 `ctx.sessionPersistence.delete()` 自底向上删除。JSONL unlink 精确的 Session 日志，并且只移除已经为空的后端自有目录；SQLite 在一个事务中删除 Session 行及其级联拥有的事件；lazy identity 会在不创建 artifact 的情况下取消。每个由 persistence 移除的 identity 都会发布 `session-persistence/deleted`。零事件 live Session 的 lazy intent 可能已在 Agent disposal 期间完成 retirement，因此它仍留在 `sessionIds`，但不进入 `deletedSessionIds`。重试会跳过已不存在的记录，并最终收敛到根节点删除。

### 哪些 live Session 可以被认领

`AgentRegistry.create()` 与 `AgentRegistry.resume()` 会保留其返回的精确 `AgentHandle` 而不把它暴露给本服务，因此这些 Session 可以被认领。直接注册或由配置创建的 Agent 在 live 状态下保持不可删除；通过其自身 owner 停止或 dispose 之后，它的冷 Session 才能在后续尝试中被删除。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

本节说明本服务强制的执行顺序，并指向实现它的代码；可观察行为已在[使用本包](#use-this-package)中完整说明。

### 设计理念

- **先设栅栏，最后才删。** reservation 在计划稳定期间阻止新的发布进入该子树；它不是存储锁，因为 persistence 自身的单写入方认领已经排除了并发的持久化写入。
- **宁可拒绝，也不强夺。** live 成员只能通过其 owner 持有的句柄认领，绝不强行夺取。忙碌或无主的成员会在所有记录都还完整时结束本次尝试，这正是失败表现为拒绝而不是半删血缘的原因。
- **靠重试收敛，而非事务。** 持久化删除是一串逐 identity 的移除，因此中途崩溃留下的是一棵更短的子树。自底向上的顺序加上跳过已不存在的记录，使下一次尝试能完成同样的工作。
- **只删 Session 状态。** 派生状态——Workspace 注册、query 索引、Client projection、产品 allocation——由消费 `session-persistence/deleted` 的 Consumer 清理，它们随各自所属的包一起提供。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：`SessionDeletion` 服务、自底向上规划、live 认领与持久化移除 |
| — | 不发布运行时不变式伴生入口；本服务不追加任何自有事件，它持有的每一项关系——删除 reservation 与每个 `AgentIdleDisposalReservation`——都在一次 `deleteTree` 调用内取得并释放，因此重放或 dispatch 观察者找不到任何可校验的持久关系；拒绝会以 `SessionDeletionError` 即时抛出，生命周期与双后端测试覆盖这些状态转换。 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当包级约定不够用时阅读以下页面。它们从 Session 家族逐步进入本服务借以删除的持久化约定，以及它所认领的 Agent 生命周期。

- [session 包图谱](../README.zh.md)——Session 家族及其角色。
- [session-persistence](../session-persistence/README.zh.md)——每次移除都要经过的 `delete()` 与 `supportsDeletion` 约定。
- [Session 子系统](../../../docs/subsystems/session.zh.md)——`reserveForDeletion`、`isDeletionReserved` 与 `api-session/deleted` 事件。
- [会话持久化子系统](../../../docs/subsystems/persistence.zh.md)——`ctx.sessionDeletion` 与它依赖的持久化 seam 并列。
- [agent](../../core/agent/README.zh.md)——retained `AgentHandle` 与认领所使用的 idle-disposal reservation。

-----

<a id="model-experience"></a>
## 模型体验

### Session 删除

#### 模型看到什么

无。`ctx.sessionDeletion` 不注册工具、提示词片段或 Session 事件。

#### Token 影响

每次请求的直接 token 增量为零。

#### KV Cache 影响

无。本包从不组装或修改模型请求前缀。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制说明本服务何时不合适，或何时需要特别注意。它们是当前包约束，不是任务积压。

- **通用服务只删除 Session 状态**——Workspace、query、Client projection 与产品 allocation 的清理由消费 `session-persistence/deleted` 的 Consumer 负责，随各自所属的包一起提供。
- **live Agent 必须被 retained 且处于真正 idle**——获得授权的 Host 路径必须持有它的句柄，删除流程才能认领它；因此在该路径之外注册的 Agent 会一直阻塞其 Session，直到 owner 停止它。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
