# Multi-Agent Max 当前项目与最终需求复用矩阵

**版本**：1.1  
**日期**：2026-07-27  
**状态**：已审计的源资产与迁移决策基线  
**需求基线**：`docs/final-reuse-integration-plan.md` 2.1  
**需求追踪**：`docs/readme/MAM_REQUIREMENTS_DELTA_2026-07-27.md`  
**源项目**：当前 `multi-agent-max` 工作树  
**目标**：新建独立程序，优先复制当前定制实现，不在旧 Orca 产品中继续裁剪

## 1. 结论

当前项目并不是应当废弃的错误实现，但也不能作为主体整块迁移。它是新程序的主要源资产库；每个迁移单元必须按工程事实区分直接复用、模型改造、局部提取和新增实现。

本矩阵落实以下已确认决策：

- Task 由用户人工分配给 Role；Claim 只是非排他的执行提示，不能拒绝第二个 Attempt。
- Workflow Run 固定 Workflow 和可分配 Role version catalog，Task 创建时固定定义；每个 Attempt 解析最新资源并冻结 Effective Config Snapshot。
- Codex、Grok 和 Pi 只通过结构化 CLI/API 与统一结果 JSON 完成任务；PTY/TUI 不能作为完成协议。
- 首期包含可视化 Workflow Editor、Attempt 历史时间线和 Git code diff；不做 Artifact 专用并排比较。
- 首期只验收 macOS；不做 Role 继承、Session override、自动 fallback、独立 Agent Session 或 Pi 专属 Extension。

旧实现偏离最终需求的主要方向包括：

- 把任务分配给设备，而不是由用户人工分配给角色后在任意机器执行。
- 引入 Device Registry、设备心跳和设备恢复作为主要领域对象。
- 把容器作为强制执行边界。
- 扩张到 jcode、Claude Code 和通用 ACP Runtime。
- 继续依赖 Orca 旧 orchestration、SSH、hosted work-item/PR 等产品能力。
- 尚未完成角色级 Provider/Model Registry、细粒度 MCP、Knowledge Base、结构化结果、可视化工作流编辑器和 merge queue。

当前代码统计只用于描述源资产规模：

| 范围 | 文件数 | 行数 | 审计结论 |
| --- | ---: | ---: | --- |
| MAM 生产 TS/TSX | 108 | 15,241 | 4 个文件已确认整体排除；其余文件仍需逐项评级，不能视为 104 个直接复用文件 |
| MAM 测试 TS/TSX | 45 | 6,229 | 大部分测试直接迁移或替换 fixture；设备/容器 E2E 改写 |
| MAM 合计 | 153 | 21,470 | 是新程序的主要代码来源 |
| Orca Git 生产模块 | 24 | 8,077 | 复制 native Git/worktree 垂直切片，不整体搬入 hosted/SSH 分支 |
| shadcn UI primitives | 30 | 2,935 | MAM 当前实际使用 10 个组件，可直接复制 |
| MAM 专用 E2E/helper | 9 | 1,293 | UI、Runtime provider、Review fixture 可复用，场景按新语义改写 |

只有以下 4 个 MAM 生产文件建议整体不复制：

```text
src/main/mam/application/mam-device-projection-refresh.ts
src/main/mam/devices/device-registry.ts
src/main/mam/runtimes/pi/pi-container-runtime-bundle.ts
src/main/mam/state-store/local-orca-state-store.ts
```

它们共 525 行，占当前 MAM 生产代码约 3.4%。该比例只说明整文件排除量，不能推导其余文件的行为复用率或保留 LOC。审计前的 `70%-85%` 估算取消；后续分别统计 `R0/R1` 直接复用、`R2` 改造、`R3` 提取和新增代码，并以可编译迁移单元及测试验证。

## 2. 复用等级

| 标记 | 名称 | 含义 | 迁移方法 |
| --- | --- | --- | --- |
| `R0` | 原样直接复用 | 行为和领域语义与最终需求一致 | 连同测试复制，只修 import、包名和构建路径 |
| `R1` | 收口后直接复用 | 主体实现一致，只需改名、裁掉旧枚举或删除一个分支 | 先整文件复制，通过窄 patch 收口，不重写算法 |
| `R2` | 模型改造复用 | 算法、状态机或组件结构正确，但输入模型仍有 device/runtime/Orca 耦合 | 复制生产代码和测试，再以新 schema/port 替换边界 |
| `R3` | 局部提取复用 | 文件混合了保留能力和明确删除能力 | 只提取已标记的函数、class 或本地 host 分支，并复制对应测试 |
| `T` | 测试/fixture 复用 | 生产入口不再使用，但失败模式、fixture 或断言仍有价值 | 改写为新接口的 contract/negative test |
| `X` | 不复制 | 与最终需求冲突或属于旧产品 | 不进入新程序，也不为了兼容保留空壳 |

只有 `R0`、`R1` 计入直接复用量。`R2` 表示可把原文件作为改造起点，`R3` 只表示局部源资产有价值；二者均不得折算成直接保留 LOC 或据此承诺工期。

## 3. 当前验证状态

### 3.1 当前工作树

- 本轮文档对齐开始前，源工作树的 `git status --short` 有 4,044 项变更；本次新增/修改的需求文档和 `.gitignore` 不计入该源基线统计。
- MAM 直接相关变更包含 Application Service、Execution Coordinator、Execution Host、Pi Role materialization、Role Editor、Application API 和新 Skills 模块。
- 迁移前必须冻结当前工作树文件内容，不能只记录 HEAD commit。

### 3.2 本轮实测

本轮对当前工作树执行了聚焦验证：

| 验证 | 结果 |
| --- | --- |
| MAM 核心测试，排除旧多设备 E2E、Pi 容器/容器物化和单独复核的 Skill 测试 | 41 个测试文件、114 项全部通过 |
| `src/main/runtime/rpc/methods/mam.test.ts` | 通过，4 项 |
| `mam-skill-registry.test.ts` | 3 项中 2 项通过；符号链接逃逸被正确拒绝，但实际错误码 `mam_skill_path_escape` 与测试预期 `mam_skill_symbolic_links_not_allowed` 不同 |
| `pnpm typecheck:web` | 通过 |
| `pnpm typecheck` | 被非 MAM 文件 `src/main/ipc/settings.ts` 的未使用 `PersistedState` 阻断 |

第一次包含所有 MAM 测试的运行还暴露了旧多设备 E2E 和 Pi 容器物化失败，并因遗留进程不退出而人工终止。两者都属于最终设计中要删除或重写的范围，不能据此否定 MAM 核心复用。

### 3.3 历史验收证据

当前 `acceptance/reports` 中 37 个节点：30 个 `passed`、6 个 `blocked`、1 个 `partial`。阻塞主要来自缺少真实 `MAM_GROK_BINARY`、`MAM_JCODE_BINARY` 及其级联最终链路。最终方案不再需要 jcode，Grok 改为用户本机 Grok CLI Adapter，因此旧阻塞项不应原样迁移为新项目验收门。

## 4. 最终需求与当前实现对照

| 最终需求 | 当前实现 | 差距 | 复用结论 |
| --- | --- | --- | --- |
| 任意 Role Profile | 已有 Zod schema、编辑器、持久化、Workflow 引用和 RoleInstance | 仍混有 deviceId、container policy 和 Runtime 枚举 | `R2`：保留模型和 UI，替换字段 |
| Executor + Provider + Model 自由组合 | Role 已有 `runtimeId`、`providerProfileId`、`modelProfileId`；Pi/Grok materializer 已能写 model/base URL | Provider/Model 目前只是字符串引用，没有正式 Registry；Codex 隔离配置不足 | `R2`：保留 EffectiveRoleConfig、materializer 和 preflight 主体 |
| 角色级 Skills 白名单 | 包校验、digest、Role Editor 和 materializer 已有构件 | Registry ID 依赖 host/path，缺共享 version/enable mutation；Pi/Codex 不是 Attempt 级不可变隔离 | `R2`：validator 可 `R0/R1`，Registry/materializer 必须改造 |
| 角色级 MCP 白名单 | Role 字段、Policy preflight、Grok/jcode profile materializer 已有基础 | 没有 MCP Profile Registry，未细分 tool/resource/prompt | `R2`：保留字段、策略和物化模式，新增细粒度 Gateway |
| 角色级知识库 | 当前没有正式领域模块 | 缺 KnowledgeBaseProfile、Registry、Local Binding、Gateway、UI | 新增模块；复用 Skill Registry、Policy、Diagnostics 模式 |
| 任意工作流 | 已支持 role_task、condition、parallel、join、review_gate、approval_gate、finish | 缺 dynamic_tasks、artifact_transform、command、git_merge、显式有界循环和可视化图编辑器 | `R2/R3 + 新增 UI`：解析、DAG 校验和 plan hash 可复用；循环执行与图编辑器是新主体 |
| Artifact 契约 | schema、内容校验、内容寻址存储、hash、diff/commit Artifact 已实现 | 需增加 taskId、标准 Attempt Result、GitChange 和 8E-B 历史投影；删除 PR Artifact | `R1/R2` |
| 多角色 Review | fan-out、fan-in、聚合、结构化 finding、人工分歧、返工次数已实现 | 与新的 Attempt/commit 失效规则和工作流节点衔接需补齐 | `R1/R2` |
| Scheduler-only 权威写入 | Kernel event batch、command authority、state writer 已实现 | actor 和 command 中混有 device assignment/lease | `R2`：保留权威边界和幂等逻辑 |
| 任务分配给角色 | 当前 dispatch 分配给 device，并附带 role | 需要用户人工 Role Assignment、不可变 Attempt 和非排他 execution notice | `R2/R3`：提取查找、Attempt 创建和诊断，删除领取成功/lease 语义 |
| 并发执行提示 | LeaseManager 有 TTL、stale 和重复 acquire 测试 | 最终不做排他锁；需要显示已有执行并允许用户继续，每次启动创建独立 Attempt | `新增 + R3/T`：仅提取 freshness/重复提示模式，不复制 lease authority |
| Git 共享权威状态 | append-only events、replay、state hash、pending queue、real Git 双 clone 测试已实现 | 需要独立 `mam-state` worktree、批次原子性、真正应用 resolution batch，并在最新 projection 重跑 command | `R2/R3`：保留 event/replay 构件，重做事务和 retry；CAS 不用于排他 Claim |
| task branch/worktree | MAM WorkspaceHost、ownership、local provider、Artifact factory 已实现 | 分支命名和 base policy需改；SSH provider、PR dry run 删除 | `R1/R2` |
| Codex CLI Adapter | Hosted adapter 有 prompt/abort 测试，Codex app-server 代码已有 JSONL transport | Hosted 路径依赖 TUI idle/tail；缺完整 turn lifecycle 和角色级配置 | `R2/R3 + 新增`：以 app-server/headless transport 为主，Hosted adapter 仅 `R3/T` |
| Grok CLI Adapter | Hosted adapter 和 ACP profile/stdio 都有 Grok 路径 | 必须先确认真实结构化机器接口；禁止 terminal tail 完成 | `R3 + 新增`：验证接口后选择 transport，Hosted 路径只保留测试资产 |
| Pi RPC Adapter | RPC、event normalizer、usage、role materialization 和 Bridge 构件已实现 | 删除容器、用户 Extension、专属完成协议和独立 Session；接入统一 Result 与新 Profiles | `R1/R2`：transport/event 高复用，Bridge/Extension 仅测试或改造资产 |
| 合并队列和调度者角色 | Review、Artifact、Git runner 和 Scheduler authority 已有构件 | 缺 merge queue、integration worktree、merge events 和冲突 Attempt | 新增编排服务，直接组合现有构件 |
| 权限与凭证 | Policy Engine、workspace ownership、Pi policy extension、secret redaction 已实现 | MCP/Knowledge 需细化；无容器时只能保证 MAM 能力层隔离 | `R1/R2` |
| 恢复与诊断 | RecoveryCoordinator、pending queue、projection rebuild、Diagnostics 已实现 | 恢复仍依赖本地 Map/调用方布尔值；需以 Attempt、结构化结果和 Git state 对账 | `R2/R3/T`：诊断和幂等规则可复用，恢复服务重组 |
| 桌面 UI | Role、Workflow、Run、Node、Review、状态、空状态页面均存在 | 缺可视化 graph、Attempt timeline、My Role、Resources、Knowledge Base、Merge Queue；现有编辑器仅表单/源码 | `R2/R3 + 新增`：保留页面 wiring，图编辑器和历史投影是新主体 |

## 5. `src/shared/mam` 文件级复用

| 文件 | 标记 | 直接复用范围 | 迁移方法 |
| --- | --- | --- | --- |
| `domain/primitives.ts` | `R0` | schema version、Entity ID、SHA-256、ISO 时间 | 原样复制及测试 |
| `domain/artifact.ts` | `R1` | Artifact format、contract、ref、version | 增加 taskId、Attempt result/GitChange 后复制 |
| `domain/review.ts` | `R1/R2` | finding、decision、aggregation、resolution | 删除旧 runtime/session assignment；绑定明确 Attempt、Artifact hash 或 commit |
| `domain/skill-definition.ts` | `R1` | Skill source、definition、locked digest | 复制；把 runtime kind 改为 executor kind，增加 version |
| `domain/index.ts` | `R1` | 领域导出入口 | 复制后增加新领域类型 |
| `domain/role.ts` | `R2` | RoleProfile、EffectiveRoleConfig、RoleInstance、policy/budget/retry/context | 删除 device/container；拆 Executor/Provider/Model/Skill/MCP/KB binding |
| `domain/runtime-kind.ts` | `R1` | 执行器枚举位置和校验入口 | 收敛为 codex-cli、grok-cli、pi-rpc |
| `domain/task.ts` | `R2` | Attempt、TaskPackage、状态和 lineage | 删除 assignedDeviceId；增加人工 Assignment、不可变 Attempt Result、Effective Config snapshot ref/hash、previousAttemptId、非排他 execution notice 和 GitChange |
| `domain/workflow.ts` | `R2` | Definition、Node、Edge、NodeRun、WorkflowRun 和图校验入口 | 扩节点类型和有界循环；保留现有节点兼容 |
| `domain/workspace-artifact.ts` | `R1` | diff/commit/file hash schemas | 删除 PullRequestArtifact；增加 submitted/base/branch 元数据 |
| `application-api.ts` | `R2` | IPC request/result Zod 边界 | 保留 API 风格；替换 dispatch/recover，增加 profiles/resources/assignment/execution-notice/attempt-result/merge API |
| `scheduler-protocol.ts` | `R2/R3` | command/event envelope、actor、幂等 schema | 删除 assign/reclaim/lease rejection；增加人工 assignment、attempt start、execution warning、config/result snapshot 和 merge 事件 |
| `runtime-capabilities.ts` | `R2` | capability manifest 和 preflight 算法 | 改名 ExecutorCapabilities；删额外 Runtime/container，增加 endpoint/model/resource capability |
| `runtime-events.ts` | `R1` | 标准消息、状态、错误、usage 事件 | 复制后解除旧 Runtime kind/event 名绑定，改为 ExecutorEvent |
| `ui-projection.ts` | `R2` | UI snapshot、run/node/artifact/approval projection | 删除 device projection；增加 assignments、execution warnings、attempt timeline、latestAttemptId、历史 Artifact/Review、config snapshot、resources 和 merge queue |
| `testing/m4-ui-snapshot.ts` | `T/R2` | 完整 UI fixture 构造 | 复制后更新新 schema，继续服务组件测试/E2E |
| `feature.ts` | `R1` | schema/feature 常量 | 新程序默认启用，可保留版本常量并删除 feature flag |
| `health.ts` | `R2` | health DTO 形状 | 删除 Orca/jcode upstream，改成三 Executor 与 source manifest 状态 |

## 6. Scheduler、Workflow、Artifact 和 Review

| 文件/范围 | 标记 | 复用范围 | 迁移方法 |
| --- | --- | --- | --- |
| `scheduler/kernel.ts` | `R2` | 命令解析、authority、幂等、KernelEventBatch、Artifact hash 校验 | 保留 class 和 negative tests；替换 command switch 中的 device/lease case |
| `scheduler/scheduler-command-authority.ts` | `R1/R2` | actor 权限、状态转换前置校验、拒绝错误码 | 删除 device actor，增加 executor instance、role assignment 和 merge authority |
| `workflow/workflow-compiler.ts` | `R2/R3` | YAML/JSON、schema 校验、连通性、Artifact 可达性、稳定 DAG plan hash | 保留解析/校验；显式有界循环改变 plan 和 advancement，不能视为原地增加 enum |
| `workflow/human-approval-service.ts` | `R0` | UI request 到 Kernel command | 原样复制，更新 port 类型 |
| `workflow/review-loop-policy.ts` | `R0/R1` | Attempt 递增、stale review、防无限返工 | 原样复制并接通用 LoopPolicy |
| `artifacts/artifact-store-error.ts` | `R0` | 稳定错误类型 | 原样复制 |
| `artifacts/artifact-content-validator.ts` | `R0/R1` | JSON Schema、Markdown、file-set、diff、test-report 校验 | 原样复制；只增加新 Artifact validator |
| `artifacts/local-artifact-store.ts` | `R1/R2` | 内容寻址、hash、原子写、去重、ref 可复用 | 增加 state-worktree store adapter，并把当前内存 ACL 改为可从权威 projection 重建 |
| `review/review-aggregation-policy.ts` | `R0/R1` | consensus、mergeable/blocking disagreement、finding 去重、人工 gate | 原样复制并更新 event 名称 |
| `review/review-fan-out-coordinator.ts` | `R1` | Reviewer 并行启动、唯一绑定、timeout、fan-in | Runtime 命名改 Executor，逻辑不重写 |

上述目录的现有单元测试全部迁移。Workflow Compiler 的现有 DAG 测试继续作为非循环图回归，新测试只补有界循环和新增节点。

## 7. Application 层逐文件复用

| 文件 | 标记 | 复用范围和方法 |
| --- | --- | --- |
| `mam-application-service.ts` | `R2` | 保留 façade、service 组装、生命周期、snapshot subscription；删除 DeviceRegistry 装配，注入 Profile/Resource/Assignment/ExecutionNotice/Result/Merge 服务 |
| `mam-execution-coordinator.ts` | `R2` | 保留 workspace→preflight→materialize→start→events→Artifact→Review→usage→cleanup 顺序；删除 lease heartbeat，增加 config snapshot 与标准 result，Runtime 改 Executor |
| `mam-execution-host.ts` | `R2` | 保留 Workspace 分配、Skill 物化、Adapter factory；删除 getDevice/jcode/Claude/container，拆三 Adapter factory |
| `mam-run-lifecycle-service.ts` | `R1/R2` | 保留 cancel/resume/approval/diagnostic 状态推进；更新新 run/assignment/execution-warning/merge 状态 |
| `mam-artifact-submission-service.ts` | `R1` | 保留 validate/store/bridge/projection/diagnostic 提交链；增加 code/knowledge Artifact |
| `mam-review-panel-advancement.ts` | `R1/R2` | 保留 Review 聚合、分歧和返工推进；绑定 immutable commit/hash，更新 Attempt 状态 |
| `mam-workflow-advancement.ts` | `R1/R2` | 保留依赖满足后 ready/pass/approval 推进；扩新增节点和有界循环 |
| `mam-runtime-execution-input.ts` | `R2` | 保留 prompt、contract、review decision、output parsing；Effective config 改从 Registries/Local Bindings 解析 |
| `mam-policy-preflight.ts` | `R1/R2` | 保留 path/command/network/MCP preflight；增加 Skill/MCP tool/KB capability 校验 |
| `mam-execution-diagnostics.ts` | `R0/R1` | 保留 lifecycle/runtime/usage 事件记录 | 更新 Runtime→Executor 名称 |
| `mam-definition-selection.ts` | `R0` | 保留 definition 查找错误 | 原样复制 |
| `mam-approval-gate-projection.ts` | `R0/R1` | 保留从 Definition 生成 approval gate | 更新节点 schema |
| `mam-run-projection.ts` | `R2` | 保留 node/run projection 和 Git refresh；删除基于字符串猜 Runtime，使用 Profile snapshot |
| `mam-git-run-store.ts` | `R2` | 保留 Kernel→Git store orchestration；删除 assign/reclaim device，增加人工 role assignment、execution notice、attempt result 和 merge |
| `mam-git-runtime-bridge-store.ts` | `R1/R2` | 保留 Runtime completion/progress/artifact 命令桥 | 重命名 Executor Bridge，增加 resource/merge request |
| `local-mam-command-service.ts` | `R1/R2` | 保留本地 UI command port 与 Kernel authority | identity 去掉 deviceId |
| `mam-task-dispatch-service.ts` | `R3` | 只提取 run/node/role 查找、Attempt ID 和诊断 | 重构为 AttemptStartService；删除 Device、Lease 和“领取成功”语义 |
| `mam-lease-event-service.ts` | `R3/T` | 只有 execution notice 需要 freshness 时提取事件模式 | 刷新失败不能阻止或终止 Attempt，不复制 lease authority |
| `mam-execution-heartbeat.ts` | `R3/T` | 可选地提取活跃提示刷新调度 | 不续租、不注册设备、不决定执行资格 |
| `mam-recovery-application-service.ts` | `R2/R3` | 提取 restart reconciliation 和未知副作用判断 | 以 Attempt、结构化 invocation/result 和 Git authority 对账，不扫描排他 claim |
| `mam-device-projection-refresh.ts` | `X` | 无最终需求 | 不复制 |
| `health.ts` | `R2` | 保留 health builder | 读取新 source manifest 和三 Executor 状态 |

## 8. Device 目录如何处理

| 文件 | 标记 | 决策 |
| --- | --- | --- |
| `devices/device-registry.ts` | `X` | 不复制；最终模型没有 Device Registry |
| `devices/manual-dispatch.ts` | `R3/T` | 不保留 Device API；提取 user-authorized dispatch、task binding 和 Kernel batch 测试，改成 RoleAssignmentService |
| `devices/lease-manager.ts` | `R3/T` | Claim 已确认非排他；只提取 stale 时间计算、重复提示和测试模式，删除 `lease_held`、排他 acquire、本地 JSON 权威持久化 |
| `devices/recovery-coordinator.ts` | `R3/T` | 提取幂等判断、crash fixture 和 `needs_reconciliation` 规则；不复制由调用方布尔值驱动的本地 Map/JSON 服务 |

`device-recovery.test.ts` 不直接复制为设备测试，但 crash point、stale Attempt、幂等副作用和 `needs_reconciliation` 断言迁移到 Attempt recovery 测试。

## 9. State Store 逐文件复用

| 文件 | 标记 | 复用范围和方法 |
| --- | --- | --- |
| `append-only-event-store.ts` | `R2` | event path/ID 校验、replay、snapshot rebuild 可复用 | 当前逐事件写入不是批次事务，固定 temp name 不支持并发 writer；重做 transaction boundary 后接 `mam-state` |
| `github-event-reducer.ts` | `R1/R2` | replay、parent revision、并发 sibling、command/event 去重、state hash 直接复用；重命名 `git-event-reducer` |
| `github-state-projection.ts` | `R2` | immutable reducer 和 transition 校验复用；task/lease/device projection 改 assignment/execution-warning/attempt/merge |
| `github-task-event-application.ts` | `R1/R2` | Artifact、completion、approval、attempt transition helper 直接复用；扩新事件 |
| `github-reducer-error.ts` | `R0/R1` | 错误类型直接复制并改名 |
| `github-projection-cache.ts` | `R0/R1` | revision/hash cache 直接复制并改名 |
| `github-state-store.ts` | `R2/R3` | Git add/commit/push 和 real Git fixture 可复用；改独立 state worktree，并丢弃 stale commit 后从最新 projection 重跑 command |
| `github-sync-coordinator.ts` | `R2/R3` | non-fast-forward queue 和 conflict 分类可复用；command-level retry 重新实现 |
| `pending-event-queue.ts` | `R2` | pending/conflict persistence、secret scan、retry counter 可复用；补真正应用/保存 resolution batch 和消费 pending record |
| `scheduler-state-writer.ts` | `R0` | Kernel batch writer port 原样复制 |
| `local-mam-ui-projection-store.ts` | `R1/R2` | 原子 JSON、subscription、roles/definitions/runs cache 直接复用；删除 devices，增加 profiles/resources/merge |
| `local-orca-state-store.ts` | `X` | 依赖旧 Orca `OrchestrationDb`，最终 Scheduler 已有自己的状态；不复制 |

`github-state-store.real-git.test.ts`、`github-replay-completeness.test.ts` 和 pending queue 测试是跨 clone/multi-process 新方案的核心测试资产，必须复制并改为 `mam-state` 分支 fixture。

## 10. Runtime/Executor 逐文件复用

### 10.1 通用契约

| 文件 | 标记 | 决策 |
| --- | --- | --- |
| `runtimes/contracts/runtime-adapter.ts` | `R1/R2` | 生命周期、abort/dispose/usage 形状可复用；改成结构化 invocation/event/result contract，删除 containerId 和产品级 Session 语义 |
| `runtimes/contracts/scheduler-command-port.ts` | `R0/R1` | receipt/submit port 原样复制，改名可后置 |
| `runtimes/profiles/mixed-runtime-preflight.ts` | `R1/R2` | capability preflight 和 execution trace 直接复用；改三 Executor 和 Model/Profile snapshot |
| `runtimes/profiles/runtime-profile-materializer.ts` | `R2/R3` | 独立 home/runtime/config、model/baseUrl/tool deny/TOML 写入高度复用；保留 Grok，抽成通用 RoleConfigMaterializer，删除 jcode/socket 分支 |

### 10.2 Codex/Grok

| 文件 | 标记 | 决策 |
| --- | --- | --- |
| `runtimes/orca/orca-hosted-runtime-adapter.ts` | `R3/T` | 只提取 queue、abort、dispose、error fixture；idle wait、terminal tail 和 ANSI 文本不得成为 Codex/Grok 结果通道 |
| `src/main/codex/codex-app-server-session.ts` | `R2/R3` | 复用 spawn、JSONL framing、request correlation、timeout、process-tree cleanup 和 unsupported classification；补长期 invocation、notification 和 turn lifecycle |
| `src/main/codex/codex-app-server-capability-cache.ts` | `R1/R2` | 复用窄 capability cache；按 executable、version 和 config home 隔离 |
| `src/main/codex/codex-app-server-client.ts` | `R3/T` | 只提取 transport 使用模式；现有 hook trust 业务不作为 Executor Adapter 主体 |
| `runtimes/acp/acp-protocol.ts` | `R3` | 只有 Grok CLI 最终接口需要 ACP 时才复制 response/notification schema |
| `runtimes/acp/acp-stdio-transport.ts` | `R3` | 仅在 Grok 真实结构化接口验证兼容后提取；改最小环境，不能继承完整 `process.env` |
| `runtimes/acp/acp-runtime-adapter.ts` | `R3/T` | Runtime event translation、session/usage/abort contract 可作为 Grok Adapter 实现来源；不保留通用 ACP 产品入口 |

Codex/Grok Adapter 测试保留 queue、abort、stream、usage unknown 和 error normalization；idle/terminal-tail 仅保留为“不得完成 Attempt”的负向测试。Grok 的真实机器接口验证前，不能把 ACP 或 Hosted 路径计为生产实现。

### 10.3 Pi

| 文件 | 标记 | 决策 |
| --- | --- | --- |
| `pi/pi-runtime-adapter.ts` | `R0/R1` | Pi RPC 生命周期、event stream、abort/resume/usage 主体直接复制 |
| `pi/pi-event-normalizer.ts` | `R1` | event/usage normalization 和 secret redaction 复制后改 `pi` runtime kind 为 `pi-rpc` Executor kind |
| `pi/pi-rpc-log-writer.ts` | `R0` | RPC JSONL 日志原样复制 |
| `pi/pi-launch-spec.ts` | `R0/R1` | RpcClient launch contract 直接复制，去掉 container 可选字段 |
| `pi/pi-scheduler-bridge.ts` | `R2/T` | 提取 command receipt、correlation 和负向测试；Pi 改用统一 Application API 与 Attempt Result，不保留专属完成协议 |
| `pi/pi-policy-extension-source.ts` | `T/R3` | 只提取 deny-by-default 和审计测试；第一版不加载用户 Pi Extension，也不保留 Pi 专属 Bridge Extension |
| `pi/pi-role-materializer.ts` | `R2` | 独立 Attempt/config 目录、models/skills、credentials、manifest、launch spec 复用；删除 extensions 和 container 路径 |
| `pi/pi-role-materialization-files.ts` | `R3` | 保留 resource/credential exact-set 校验、arguments、minimal env、private dirs/files、owned path；删除所有 container config 函数 |
| `pi/pi-isolated-launcher-source.ts` | `R1/R2` | 若 host RPC 仍需要 isolated child launcher 则复制；删除 Docker assumptions |
| `pi/pi-container-runtime-bundle.ts` | `X` | 不复制 |

Pi contract、event、Bridge、policy、real fake-process 测试全部迁移；`pi-container-runtime.test.ts` 删除，`pi-role-materializer.test.ts` 改成 host-only 隔离测试。

## 11. Skills、MCP、Knowledge 和 Policy

| 文件/能力 | 标记 | 复用范围和方法 |
| --- | --- | --- |
| `skills/skill-package-validator.ts` | `R0/R1` | SKILL.md、大小、数量、symlink/path escape、digest、frontmatter 直接复制；统一错误码测试 |
| `skills/mam-skill-registry.ts` | `R2` | import/list/get、digest 和原子 JSON 模式可复用；重做不依赖 host/absolute path 的稳定 ID、version 与 enable/disable mutation |
| `skills/runtime-skill-materializer.ts` | `R2/R3` | symlink/path 校验和 private permission 模式可复用；Pi 不再引用源路径，Codex 不再写共享 worktree，目标改每 Attempt 的不可变隔离目录 |
| `policy/policy-engine.ts` | `R1/R2` | deny/approval/allow 优先级、normalize、path containment 直接复用；增加 knowledge kind 和 MCP 子资源 |
| `policy/sandbox-launcher.ts` | `R3` | 仅提取 host process、环境变量 allowlist、cwd/path 校验和 wait/stop；删除 Docker launch、image/network/container ID |
| `diagnostics/diagnostics-recorder.ts` | `R0/R1` | 本地记录、成本、导出、递归 secret redaction 直接复制；增加 resource query audit kind |

当前没有以下正式模块，需要新增，但应复制已有 Registry/Policy/Diagnostics 的实现模式：

```text
domain/mcp-server-profile.ts
domain/knowledge-base.ts
mcp/mcp-profile-registry.ts
mcp/role-mcp-materializer.ts
mcp/mcp-capability-gateway.ts
knowledge/knowledge-base-registry.ts
knowledge/knowledge-gateway.ts
knowledge/knowledge-query-audit.ts
```

## 12. Workspace 和 Git Artifact

| 文件 | 标记 | 决策 |
| --- | --- | --- |
| `workspace/workspace-access-controller.ts` | `R0/R1` | task/role worktree ownership、path containment、command cwd、audit denial 直接复制 |
| `workspace/orca-workspace-host.ts` | `R2` | allocate/get/terminal/remove/effective config 主体复用；删除 connectionId/SSH，改 task branch naming |
| `workspace/orca-workspace-provider.ts` | `R3` | 只复制 interface 和 LocalOrcaWorkspaceProvider；删除 SshOrcaWorkspaceProvider/resolver |
| `workspace/workspace-artifact-factory.ts` | `R2/R3` | 保留 createDiff/createCommit、file/hash/patch 和 content-addressed persist；改 NUL-delimited Git 输出、增加路径 containment，并删除 createPullRequestDryRun |

以下 Orca Git 基础设施按本地垂直切片复制：

| 当前路径 | 标记 | 复用方法 |
| --- | --- | --- |
| `src/main/git/runner.ts` | `R3` | 提取 native `gitExecFileAsync`、locale、错误/timeout/max-buffer 和 capability hooks；不复制 SSH runner |
| `src/main/git/worktree.ts` | `R3` | 提取 list/add/remove/clean 和 Git 2.25 fallback；删除 provider/SSH 路由 |
| `src/main/git/git-capability-state.ts` | `R1/R3` | 保留本地 capability cache；host key 简化为 native |
| `src/main/git/exec-error.ts`、`max-buffer-overflow.ts`、`fetch-error-classification.ts` | `R0/R1` | 直接复制 Git 错误归一化 |
| `src/main/git/checkout.ts`、`commit-object-ref.ts`、`worktree-base-ref-probe.ts` | `R0/R1` | 直接复制 branch/base/commit helpers |
| `src/main/worktree-create-base.ts`、`worktree-create-base-prefetch.ts`、`worktree-root-preparation.ts` | `R1/R2` | 复制安全创建和 base fetch，移除 hosted work-item |
| `src/main/worktree-removal-safety.ts`、`worktree-removal-authority.ts`、`worktree-orphan-gitdir-proof.ts` | `R0/R1` | 直接复制删除前安全证明 |
| `src/shared/git-capability-cache.ts`、`git-worktree-command-capabilities.ts`、`git-ref-command-capabilities.ts` | `R0/R1` | 复制 Git 2.25 capability fallback 和 cache tests |
| `src/shared/worktree-ownership.ts`、`worktree-id.ts`、`worktree-base-ref.ts` | `R1/R2` | 复制后 owner 改 task/attempt |

不应整体复制 `src/main/git/repo.ts`、`status.ts`、`runner.ts` 的全部依赖闭包。先让 MAM Workspace/Artifact 所需的窄 Git port 编译，再只加入真实调用到的 native 实现。

## 13. 结构化进程与可选终端切片

Codex、Grok 和 Pi 的正式完成通道是 JSON/JSONL、RPC 或经 Schema 校验的结果文件。`OrcaHostedRuntimeAdapter` 当前依赖 TUI idle 和 terminal tail，因此不能作为 Executor 主体，也不需要为它复制完整 `orca-runtime.ts` 或 Agent Session Host。

核心迁移只包含真实结构化 Adapter 使用到的进程垂直切片：

| 当前路径 | 标记 | 复用范围 |
| --- | --- | --- |
| `src/main/codex/codex-app-server-session.ts` | `R2/R3` | Codex JSONL spawn、framing、correlation、timeout 和 process-tree cleanup |
| `src/main/mam/runtimes/acp/acp-stdio-transport.ts` | `R3` | 仅在 Grok 机器接口验证兼容时提取 stdio RPC transport，并收紧环境变量 |
| `src/main/mam/runtimes/pi/pi-runtime-adapter.ts` | `R0/R1` | Pi RPC transport、event stream、abort 和 usage |
| `src/main/daemon/pty-subprocess.ts`、`session.ts` | `R3` | 仅在结构化 CLI 确实复用其本地 process-control 时提取；不引入 terminal screen 协议 |

PTY/TUI 是可选观察或人工接管能力，按产品 UI 的真实调用闭包另行评估：

| 当前路径 | 标记 | 复用范围 |
| --- | --- | --- |
| `src/main/runtime/rpc/methods/terminal.ts` | `R3/T` | 可选 send/read/close 展示；wait/idle 不得产生完成结果 |
| `src/main/daemon/terminal-host*.ts` | `R3/T` | 可选本地终端生命周期；不复制 claim、remote、SSH 或独立 Session 产品 |
| `src/shared/runtime-types.ts` | `R3` | 只提取可选 terminal view DTO，不进入核心领域模型 |

明确不复制 SSH、remote runtime、relay、WSL 专用、mobile terminal 和 terminal-tail completion。首期若不需要人工接管，可以完全不复制 Renderer `terminal-pane`。

## 14. Renderer 和桌面壳

### 14.1 MAM feature 文件

| 文件 | 标记 | 复用范围和方法 |
| --- | --- | --- |
| `MamWorkflowPage.tsx` | `R2` | 页面布局、selection、snapshot subscription、refresh 保留；替换 Orca store/worktree selector |
| `MamWorkflowNavigation.tsx` | `R1/R2` | Roles/Definitions/Runs 导航保留；增加 Resources/My Role/Merge Queue |
| `MamRoleEditor.tsx` | `R2` | 表单、Runtime/Provider/Model、Skill 导入选择直接扩展；改 profile selectors，增加 MCP/KB bindings |
| `MamWorkflowEditor.tsx` | `R3/T` | 只复用 save/compile/validation wiring、错误状态和高级 source fallback；节点画布、边连接、Inspector、循环和 merge 配置是首期新增 |
| `MamRunDetail.tsx` | `R2/R3` | run/node/status controls 保留；删除 device dispatch，增加 execution warning、Attempt timeline 和 merge |
| `MamNodeInspector.tsx` | `R2/R3` | Artifact、policy、review、diagnostics tab 结构保留；增加 selectedAttemptId、历史 Artifact/Review 和 config snapshot |
| `MamReviewPanel.tsx` | `R2` | approve/change/block 和 finding 展示保留；必须绑定显式 selectedAttemptId，默认最新、历史只读 |
| `MamEmptyWorkflowState.tsx` | `R0/R1` | 空状态和创建入口保留 |
| `mam-status.tsx` | `R0/R1` | badge 和状态文案保留，增加新状态 |
| `mam-workflow-simple-draft.ts` | `T/R3` | 只保留 draft round-trip 测试思路；当前仅编辑名称和单个 role_task，不能作为可视化图编辑器主体 |
| `mam-editor-defaults.ts` | `R2` | 默认 Role/Workflow 构造保留，改新 schema |
| `use-mam-workflow-editing.ts` | `R1/R2` | save/compile/create selection 状态保留，改 API |
| `use-mam-review-resolution.ts` | `R0/R1` | review resolve async 状态保留 |
| `index.ts` | `R0` | feature entry 直接复制 |

### 14.2 直接复制的 UI 基础

当前 MAM 页面实际使用以下组件，连同 `src/renderer/src/assets/main.css` 和 `docs/STYLEGUIDE.md` 直接复制：

```text
components/ui/badge.tsx
components/ui/button.tsx
components/ui/checkbox.tsx
components/ui/collapsible.tsx
components/ui/dropdown-menu.tsx
components/ui/input.tsx
components/ui/label.tsx
components/ui/select.tsx
components/ui/tabs.tsx
components/ui/tooltip.tsx
```

还可按新页面需要复制 `dialog.tsx`、`scroll-area.tsx`、`progress.tsx`、`popover.tsx` 和 `command.tsx`，不能为避免 import 修复而复制全部 Orca Renderer。

### 14.3 Diff、Markdown、Editor

| 当前路径 | 标记 | 用途 |
| --- | --- | --- |
| `components/editor/CombinedDiffViewer.tsx` 及直接子组件 | `R2/R3` | Task base/submitted commit 的 Git diff 和 Review 页面；首期不建设 Artifact-to-Artifact 双栏比较 |
| `components/editor/MarkdownPreview.tsx` 及安全 Markdown helpers | `R1/R2` | Artifact/Review/Knowledge 内容预览 |
| `components/editor/MonacoEditor.tsx` | `R2/R3` | Workflow YAML/JSON 和 Artifact source 编辑 |
| `components/diff-comments/` 中纯 diff annotation 模块 | `R3` | 结构化 review finding 定位 |
| `components/right-sidebar/SourceControl.tsx` | `T/R3` | 不复制整页；提取 Git status/file tree/commit actions供 Task workspace 使用 |

### 14.4 Electron、IPC 和 i18n

| 当前路径 | 标记 | 迁移方法 |
| --- | --- | --- |
| `src/main/ipc/mam.ts` | `R1/R2` | 复制 trusted renderer authorization、Zod parse、service call、snapshot push；替换 API 集合 |
| `src/preload/index.ts` 中 `mam` 段 | `R1/R2` | 抽到独立 `mam-preload-api.ts`，不复制完整 Orca preload |
| `src/preload/api-types.ts` 中 MAM 类型 | `R1/R2` | 复制 MAM API declaration |
| `src/main/runtime/rpc/methods/mam.ts` | `R1` | health/CLI RPC 入口保留并扩展，或新程序无 remote runtime 时并入本地 API |
| `src/renderer/src/i18n/` 基础 | `R1/R3` | 复制 provider/hooks；只保留 MAM 使用的 locale keys |
| `electron.vite.config.ts`、`config/tsconfig*.json`、`config/vitest.config.ts` | `R1/R3` | 作为新项目构建起点，删除 relay/CLI/SSH/mobile 项目引用 |
| `config/electron-builder.config.cjs` | `R3` | 首期只提取 macOS packaging；品牌、资源和额外二进制清单重建，Linux/Windows 后置 |

## 15. Test 和 Acceptance 复用

### 15.1 直接迁移

- `domain-schemas.test.ts`：保留所有旧 schema 正例，再更新新字段。
- Artifact、Review、Workflow Compiler、Scheduler authority、Policy、Workspace ownership、Git replay/pending queue 测试。
- Pi adapter/event/usage/real fake-process contract tests；Bridge/Extension 只保留可改写为统一结果协议的 fixture。
- MAM Renderer 的 Node Inspector、Workflow draft 测试。
- `src/main/runtime/rpc/methods/mam.test.ts`。
- `tests/e2e/mam-workflow-ui.spec.ts` 及 UI evidence helper。
- `tests/e2e/helpers/mam-product-runtime-provider.ts` 和 review runtime provider 作为 fake Executor。

### 15.2 改写后迁移

- `m10-end-to-end.test.ts`：两设备场景改成两个独立 clone、人工 Role Assignment、两个 Attempt 和重复执行 warning。
- `device-recovery.test.ts`：改成进程崩溃、历史 Attempt 保留和 `needs_reconciliation`。
- `mam-production-chain.spec.ts`：删除 jcode/container/设备要求，改 Codex CLI、Grok CLI、Pi 的可用组合。
- `mam-review-disagreement.spec.ts`：保留流程，修复当前级联 Runtime 依赖并使用 immutable commit/hash。
- `pi-role-materializer.test.ts`：删除 container launcher，保留独立目录、secret、skills、model/provider 快照。
- ACP tests：仅在 Grok CLI 选定 ACP stdio 作为真实接口时迁移。

### 15.3 不迁移

- `pi-container-runtime.test.ts`。
- `acceptance/container-sandbox-verification.mjs`。
- `acceptance/device-recovery-verification.mjs` 的 device registry 语义。
- jcode pinned binary 验收。
- SSH/relay/hosted work-item/PR 验收。

### 15.4 复用验收框架

以下基础设施仍可直接使用：

- `acceptance/verify-node.mjs` 和 node verification runner。
- `acceptance/criterion-evidence.mjs`、traceability manifest、final audit 的证据聚合方式。
- fake runtime/provider server 和 recorded Pi events。
- 每节点 `result.json`、日志和 artifact evidence 目录规范。

节点 ID 和需求矩阵需要按最终文档重建，不能沿用包含 device/container/jcode 的完成百分比。

## 16. 真正需要新增的代码

以下能力在当前项目中没有完整实现，不能伪装成“直接复用”：

1. `ExecutorProfileVersion`、`ProviderProfileVersion`、`ModelProfileVersion` Registries 和本机 Binding。
2. 人工 RoleAssignment、按角色列出 ready tasks、非排他 execution notice、Attempt timeline 和选择当前 Attempt。
3. Dynamic Task Plan 到待分配 Task 的正式节点和 API。
4. 独立 `mam-state` hidden worktree 和命令级 CAS retry。
5. MCP Server Profile、tool/resource/prompt allowlist 和 Capability Gateway。
6. Knowledge Base Profile、Local Binding、只读 Gateway、query audit 和 UI。
7. `git_merge` 节点、merge queue、integration worktree、冲突 Attempt、验证和 push authority。
8. My Role、Resources、Knowledge Base、Merge Queue 页面。
9. Codex CLI 的 app-server/headless 结构化 Adapter 与角色级 Provider/Model 隔离；Grok CLI 最终机器接口适配。
10. `EffectiveRoleConfigSnapshot` 和标准 `AttemptResult`：先持久化快照再启动 Executor，结果严格校验且不保存 secret。
11. 可视化 Workflow Editor：节点画布、边、Inspector、角色/任务/审核/循环/merge 配置及 Definition round-trip。
12. 8E-B UI：`latestAttemptId`、完整 Attempt timeline、历史只读 Review 和 Git code diff；不新增 Artifact 双栏比较组件。

这些新增能力仍应组合现有 Registry、Zod schema、Policy、Diagnostics、Scheduler、Git store、Workspace、Artifact 和 UI component 模式。

## 17. 推荐复制顺序

### Step 0：冻结源

1. 使用当前工作树生成路径、大小、Git status 和 SHA-256 manifest。
2. 复用 `config/scripts/mam-generate-upstream-manifest.mjs` 的 manifest 生成思路，但记录工作树内容 hash。
3. 不要求先清理 4,044 项旧仓库改动；目标仓库以 manifest 为来源事实。

### Step 1：按复用等级建立迁移批次

完整源树可以冻结为只读 source mirror，但目标生产代码不能按“只排除 4 个 X”整块复制。`R0/R1` 以整文件和直接测试迁移，`R2` 以可编译模块为单位改造，`R3` 只提取已列明符号及对应测试；条件 ACP、terminal、sandbox 和 device 混合文件在接口验证前不得进入生产依赖。

### Step 2：先冻结新 shared contracts

按最终文档冻结 Run/Attempt 双层快照、人工 Assignment、advisory execution notice、标准 Attempt Result、结构化 Executor event、Workflow loop、Resource 和 Scheduler protocol。所有后续模块只适配这套 schema。

### Step 3：恢复纯业务测试

优先恢复 Artifact、Review、Workflow Compiler、Scheduler、State replay、Skills、Policy 和 projection tests。这些测试不依赖 Electron、terminal 或真实 CLI，可快速证明核心迁移没有变成重写。

### Step 4：接 Git state 和 Workspace

复制 `mam-state` store 所需 native Git port、worktree 和 Artifact 垂直切片。先通过两个 clone 的并发事件 replay、两个 Attempt 均保留及 warning 测试，再接 UI；不再断言 `claim_conflict`。

### Step 5：接三 Executor

顺序为 Pi RPC、Codex app-server/headless、Grok verified structured interface。Pi 当前 transport 最完整，可先稳定统一 Executor/Result contract；Hosted Adapter 和 terminal host 不作为完成通道。

### Step 6：补 MCP、Knowledge 和 Merge

这些是当前项目真正缺少的产品能力。在 core migration 全绿后新增，避免把迁移问题和新功能问题混合。

### Step 7：迁移 UI 和 E2E

复制 MAM feature 与最小 UI primitives，接新 Application API。可视化 Workflow Editor、Attempt timeline、latest/historical Review 和 Merge Queue 是首期 release gate；Git diff 复用现有 viewer，terminal 只按人工接管需要条件迁移。

## 18. 禁止的迁移方式

- 不重新设计 Artifact、Review、Scheduler Kernel、Git replay、Skills Registry 或 Pi Adapter 后从空文件实现。
- 不复制整个 Orca `src/main` 或 `src/renderer` 来换取暂时编译通过。
- 不在新项目保留无调用的 Device、SSH、container、jcode 或 hosted PR compatibility layer。
- 不先做全仓库 `Orca`→`MAM`、`Runtime`→`Executor` 机械重命名。
- 不让多个并行 Agent 同时改 shared schema、package lock、Electron entry、preload 和 Application Service。
- 不以旧 acceptance `blocked` 状态否定对应实现；先判断阻塞是否来自已取消的范围或缺少外部二进制。
- 不把“文件被复制”当作“复用完成”；每个迁移单元必须带生产代码、直接测试、依赖清单和新需求差异说明。

## 19. 复用完成定义

一个当前模块只有满足以下条件，才算完成复用：

1. 目标仓库中记录源文件 path 和 source manifest hash。
2. 迁移 commit 明确标注 `R0/R1/R2/R3`。
3. 生产实现不通过相对路径或 symlink 依赖旧仓库。
4. 对应单元/contract test 已复制并通过。
5. 已删除的 device/container/jcode/SSH 分支有负向扫描或边界测试。
6. 新 schema 下的行为与最终需求矩阵一致。
7. 只有确认不需要的代码才删除；编译错误不能作为复制整个 Orca 目录的理由。

## 20. 最终判断

新程序不是“重新从零构建”。正确实施方式是：

```text
当前 MAM 中经可编译迁移单元验证的 R0/R1/R2 源资产
  + Orca native Git/worktree/structured process/UI 的最小垂直切片
  - Device Registry / SSH / Container / jcode / hosted product
  + Role Assignment / advisory execution presence / immutable Attempt snapshots
  + Profile Registries / MCP / Knowledge / Visual Workflow / Merge Queue
  = 最终 Multi-Agent Max
```

因此后续任务规划应以“迁移和重新对齐”为主，而不是以“重新实现全部需求”为主。
