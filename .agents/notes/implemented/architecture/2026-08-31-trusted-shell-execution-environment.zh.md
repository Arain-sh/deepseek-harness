# Agent Note: trusted per-execution shell environment

Status: implemented

[English](2026-08-31-trusted-shell-execution-environment.md) | 中文

## 问题

可信 Host 插件能够为单次 Agent 执行获取短期能力，但面向模型的 Bash 与 Pwsh Consumer 没有扩展点把当前值传给子命令。设置 `process.env` 会让凭证在并发会话间变成全局状态，并在退出登录或租约轮换后留下陈旧值。给工具增加 `env` 参数会把凭证注入能力暴露给模型，同时重复 shell 语法已有的行为。替换任一 shell 工具还会复制其审批、sandbox、后台任务、工作目录、结果和展示逻辑。

现有 `ctx.shellEnv` 注册表不能承载这些值。它拥有保留 `DSH_*` 命名空间内可枚举的 Harness 事实，而短期能力可能使用外部名称，例如某个 API 专用的 `*_API_KEY`，且不得成为环境变量目录。

## 决策

`@deepseek-ai/dsh-shell-exec-env` 定义可选的 `ctx.shellExecEnv` 注册表。可信 Provider 注册稳定名称、完整环境键集合，以及接收当前 `ToolExecution` 的解析器。每个键按大小写不敏感方式只有一个所有者，使 Windows 与 POSIX 组合拒绝相同的所有权冲突。注册表拒绝 `DSH_*`、未声明或大小写不一致的结果和空值。它只公开收集与注册操作，不提供列表操作。

`dsh-tool-bash` 与 `dsh-tool-pwsh` 通过 `ctx.get('shellExecEnv')` 发现注册表。它们在参数校验、sandbox 策略解析及可能的审批提示之后，但在前台或后台进程创建之前，等待一份新快照。缺少注册表时保留工具的普通行为；Provider 拒绝时工具调用失败且不会启动子进程。非空快照成为显式的 `ShellExecRequest.env`，受管理的 Harness 事实继续通过 `dshEnv` 传递并最后合并。

shell 工具 schema 保持不变，并通过具名模型参数构建请求。额外模型键无法添加或替换环境值。Provider 拥有能力获取、过期和退出登录行为；注册表不读取环境、缓存值、持久化值或修改 `process.env`。

## 安全属性

本地子进程实现仍从已删除凭证形态名称和 `DSH_*` 名称的父进程环境开始。只有可信 Provider 显式返回的值才进入本次命令。完整子进程树都能读取这些值，因此 Provider 只贡献外部服务接受的最窄短期能力，绝不贡献持久账户凭证。

## 考虑过的替代方案

**把 `ctx.shellEnv` 扩展到任意名称。** 拒绝，因为这会混合可枚举的 Harness 身份事实与不可枚举、形似凭证的能力，并削弱保留命名空间约定。

**围绕命令设置并恢复 `process.env`。** 拒绝，因为并发调用会观察同一份进程全局映射；恢复无法阻止跨会话读取，也无法约束该时间段内启动的其他子进程。

**用 Product 自有工具替换 Bash 与 Pwsh。** 拒绝，因为保留官方行为需要复制两个 Consumer，并同步上游每一项审批、sandbox、任务、渲染和 schema 变更。

**给面向模型的工具 schema 增加 `env`。** 拒绝，因为它会给模型新增凭证注入输入，却没有形成权限隔离；这些值应由可信 Host Provider 而非模型参数拥有。

## 后果

仓库外插件可以提供当前能力，而无需导入 shell 工具内部实现或修改全局状态。DSH 改动保持通用：它定义一个可选注册表和两个 Consumer 钩子，不包含特定 Provider 或 Product 的鉴权逻辑。只有挂载该服务时，解析延迟才会加入调用；Provider 失败会有意使命令不可用，而不会回退到陈旧或环境凭证。普通 `ShellExecRequest.env` 行为及其合并顺序仍由 [stdin 与环境决策](2026-06-30-bash-stdin-env-trusted-plugin-api.zh.md)规定。
