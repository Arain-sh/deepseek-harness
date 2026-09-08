# @deepseek-ai/dsh-session-deletion

[English](README.md) | 中文

`ctx.sessionDeletion` 是可选的 Host-only 能力，用于永久删除一个 Session 子树。产品代码在调用前校验归档状态与所有权；本包不提供浏览器 Remote，也不提供模型工具。

## 操作

`preview(rootSessionId)` 按自底向上的删除顺序返回已知后代，最后返回根节点。`deleteTree(rootSessionId)` 会阻止该血缘继续发布，重复发现直到 reservation 覆盖当前完整闭包，并在 disposal 任何 Agent 前，通过 retained idle-disposal 能力认领所有 live Agent。运行中的工作、maintenance、排队输入或未 retained 的 live Agent 都会在持久化删除开始前被拒绝。

已知 persistence identity 通过 `ctx.sessionPersistence.delete()` 自底向上删除。JSONL unlink 精确的 Session 日志，并且只移除已经为空的后端自有目录；SQLite 在一个事务中删除 Session 行及级联拥有的事件；lazy identity 会在不创建 artifact 的情况下取消。每个由 persistence 移除的 identity 都会发布 `session-persistence/deleted`。零事件 live Session 的 lazy intent 可能已经在 Agent disposal 期间完成 retirement，因此仍出现在 `sessionIds`，但不进入 `deletedSessionIds`。重试会跳过已不存在的记录，并最终收敛到根节点删除。本包不会归档、改变 Workspace placement、删除产品 allocation 或删除 Project 目录。

`AgentRegistry.create()` 与 `AgentRegistry.resume()` 会保留其返回的精确 `AgentHandle`，但不会把它暴露给本服务。直接注册或由配置创建的 Agent 在 live 状态下保持不可删除；通过其 owner 停止或 dispose 后，冷 Session 才能在之后被删除。

## 组合

该服务要求 `sessions`、`sessionPersistence` 与 `agents`。所选 provider 报告 `supportsDeletion: false` 时，`deleteTree()` 会在 reservation 或 dispose live state 之前以 `PERSISTENCE_UNSUPPORTED` 拒绝。Product Bundle 必须显式选择接入，并单独挂载获得授权的 Catalog Consumer。

## 模型体验

### Session 删除

#### 模型可见内容

无。`ctx.sessionDeletion` 不注册工具、提示词片段或 Session 事件。

#### Token 影响

每次请求的直接 token 增量为零。

#### KV Cache 影响

无。本包从不组装或修改模型请求前缀。

## 已知限制与延期工作

- 通用服务只删除 Session 状态。Workspace、query、Client projection 与产品 allocation 的清理分别由消费 `session-persistence/deleted` 的所属包提供。
- live Agent 必须由获得授权的 Host 路径 retained，并且处于真正 idle 状态，才能被删除流程认领。
