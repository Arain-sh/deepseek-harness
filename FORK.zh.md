# 维护 fork 差异

[English](FORK.md) | 中文

此仓库分支是 SuperCode 使用的 DSH Runtime fork。[`fork-manifest.json`](fork-manifest.json) 是机器可读清单，本文解释其所有权与更新规则。fork 基于官方 `dsh-v0.1.5-rc.1`，对应提交 `183f08e9c6dde7e36cd2318eaee70b0da08fb35e`。

## Bundle 与 package 清单

此 fork **没有新增 DSH bundle**，也没有修改 `packages/bundle/` 下的任何 package。Product 组合仍位于 SuperCode 的 `@ainvest-team/supercode-*` package 与封闭的 `supercode-web` patch 中。

此 fork 新增两个通用 DSH package：

| Package | 职责 |
|---|---|
| [`@deepseek-ai/dsh-session-deletion`](packages/session/session-deletion/README.zh.md) | 仅供 Host 使用，在 live 状态、持久化、projection、查询索引、workspace 和 sidecar 中递归删除 Session 谱系。 |
| [`@deepseek-ai/dsh-shell-exec-env`](packages/shell/shell-exec-env/README.zh.md) | 可选注册表，在 Bash 或 Pwsh 执行前解析可信且不向模型公开的环境值。 |

manifest 记录每个修改过的 package、其变更的生产源码文件，以及下游 Runtime 必须一同覆盖的完整 `runtimePatchPackages` 集合。生成文档、测试、翻译记录和仓库脚本不是 Runtime package，因此不在该列表中重复记录。

## 所有权边界

此 fork 只包含可复用的 DSH 能力与缺失的扩展点，不包含 SuperCode UI、AIME 鉴权、Product 策略、Product bundle 或 `@ainvest-team/*` 代码。外部 Product 插件可以消费已发布 API，但 DSH 不得导入该插件。

SuperCode 中检出的 Submodule 是只读的。应在这个独立 fork 中开发改动并运行 DSH 检查，发布 fork 提交后，再同时移动 SuperCode 的 Submodule 提交、`upstream.json` fork 绑定、Runtime package 覆盖与架构文档。

## 更新 fork

1. 有意识地移动上游基线，并审查 `git diff <upstream-commit>...HEAD`。
2. 将每项 fork 改动与新的官方实现核对；上游提供完整行为后删除对应 fork 差异。
3. 新增或修改生产 package 时更新 `fork-manifest.json`。`runtimePatchPackages` 是新增和修改 Runtime package 的精确并集。
4. 保持 package README、子系统参考、中英文 Agent Note、测试与生成目录和代码一致。
5. SuperCode 接受新提交前，要求其 `upstream.json.runtimePatchPackages` 与本 manifest 匹配。

Git 仍是完整文件差异的权威来源。manifest 在 package 与 Runtime 组装层面对差异分类，使下游升级无需依赖提交消息还原历史。
