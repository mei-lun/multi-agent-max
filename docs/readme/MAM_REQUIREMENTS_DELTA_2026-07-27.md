# Multi-Agent Max 需求差异与追踪表

**版本**：1.2
**日期**：2026-08-05
**状态**：Accepted  
**唯一产品基线**：[`docs/final-reuse-integration-plan.md`](../final-reuse-integration-plan.md) 2.1

## 1. 文档职责

本文档不建立第二套产品设计，只负责：

1. 记录用户已经确认的范围决策。
2. 将旧 `MAM-*`、`INV-*`、v1-v4 设计和两份裁剪计划映射为 retained、replaced、removed 或 deferred。
3. 为新验收 requirement/invariant 提供稳定 ID。

发生冲突时，以最终设计 2.2 为准。`MAM_COMPLETION_REQUIREMENTS.md` 和其他旧设计均为历史输入，不再是独立完成判据。

## 2. 已确认决策

| ID      | 决策                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DEC-001 | 最终设计 2.1 是唯一现行需求基线；旧文档必须逐项映射。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| DEC-002 | 配置 Git remote 时，remote 和 `mam-state` 是跨机器共享状态的唯一权威；无 remote 的本地 Git 项目使用本地 `mam-state` 支持多个角色协作，不建设中心调度服务。                                                                                                                                                                                                                                                                                                                                                                                                                       |
| DEC-003 | 每个可执行 Workflow 节点在设计时固定且只固定一个 Role；Task 创建时继承该角色，用户点击运行时直接使用，不再选角或改派。Claim 只提供非排他提示；Kernel 不拒绝第二个 Attempt。                                                                                                                                                                                                                                                                                                                                                                                                      |
| DEC-004 | Workflow Run 固定 Workflow 和节点绑定的 Role version catalog，Task 创建时固定自身定义及角色；Role 编辑或新增只影响新 Run。每个 Attempt 解析最新 Executor、Provider、Model、Skill、MCP 和 Knowledge Base，并冻结 Effective Config Snapshot。                                                                                                                                                                                                                                                                                                                                      |
| DEC-005 | Codex、Grok 和 Pi 的生产执行只使用结构化 CLI/API；PTY/TUI 只用于观察或人工接管。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| DEC-006 | 每个 Attempt 必须产生符合统一 Schema 的结果 JSON。Agent 填业务结果，MAM 填写并校验权威字段。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| DEC-007 | Executor 与模型可自由声明组合，但 Adapter 必须做 capability 和 local preflight；不支持时拒绝启动，不自动 fallback。                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| DEC-008 | 不支持 Role 继承、Session override、自动 fallback、独立 Agent Session 或 Pi 专属 Extension。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| DEC-009 | 首期必须交付可视化 Workflow Editor。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| DEC-010 | 采用 Artifact 策略 8E-B：永久保留 Attempt 历史，默认审核最新 Attempt，历史只读打开，代码使用 Git diff，首期不做 Artifact 专用并排比较。                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| DEC-011 | Skill、MCP 和 Knowledge Base allowlist 是 MAM 注入/Gateway 边界，不承诺无 OS sandbox 时的 Shell 级不可访问。                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| DEC-012 | Merge Queue 按不可变的 `(mergeReadyAt, taskId)` 排序。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| DEC-013 | 审核必需内容进入 Git；大型诊断日志可以只保存在本机，但必须记录 hash 和 availability。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| DEC-014 | 首期正式支持 macOS；Linux 和 Windows deferred。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| DEC-015 | 没有旧版本数据，不实现迁移兼容层。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| DEC-016 | Design Assistant 直接使用已有 Model Profile；未加密多轮对话草稿只保存在本机；助手通过单问题澄清、二至三个方案比较和至少三个设计部分的结构化建议，指出工作流缺陷、记录假设并持续改进完整替换草稿；方案选择、章节确认和缺陷提示不构成逐步门禁，用户可在认为合适时直接确认；实际解析、引用、编译错误或过期基线仍阻止创建；不自动读取项目文件、文档或 Git 历史，不启动外部 Visual Companion；人工确认可创建全新的 Role Profile 和 Workflow Definition，或为所选现有 Workflow 创建同一 ID 的下一版本；每个可执行节点固定一个 Role；不启动 Run、不创建 Task，既有 Run 保持固定原版本。 |
| DEC-017 | Workflow Run 启动后，固定 Role 且依赖满足的节点默认自动执行；`changes_requested` 按定义中的有界回退路径自动创建新 Attempt 并继续后续 Review。只有显式 `approval_gate`、无法自动解决的 Review 分歧、blocked、reconciliation 或资源/preflight 失败需要人工介入。                                                                                                                                                                                                                                                                                                                   |

## 3. 旧功能需求映射

| 旧需求             | 状态              | 新 requirement                           | 说明                                                                                           |
| ------------------ | ----------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `MAM-APP-001`      | replaced          | `MAM2-APP-001`                           | 保留桌面 Application Service；删除 Orca、Device、SSH 和 container 装配。                       |
| `MAM-APP-002`      | replaced          | `MAM2-APP-002`、`MAM2-RESULT-001`        | 使用新 Application API 和严格结构化输入输出。                                                  |
| `MAM-APP-003`      | retained/replaced | `MAM2-WORKFLOW-001`、`MAM2-EXEC-001`     | 保留 Compiler→Kernel→Git→Workspace→Executor→Artifact→Review 主链，重组旧 Runtime/Device 边界。 |
| `MAM-APP-004`      | replaced          | `MAM2-UI-001`                            | 独立 MAM 应用；首期必须有可视化 Workflow Editor 和 Attempt timeline。                          |
| `MAM-STATE-001`    | retained          | `MAM2-STATE-001`                         | Git append-only events、确定性 reducer 和可重建 projection 保留。                              |
| `MAM-STATE-002`    | retained/replaced | `MAM2-STATE-002`                         | 保留真实 Git、两 clone、并发写入和冲突；CAS 保护状态一致性，不实现排他 Claim。                 |
| `MAM-STATE-003`    | retained/replaced | `MAM2-STATE-003`                         | 保留 pending/retry/conflict；人工 resolution 必须真正应用 resolution batch。                   |
| `MAM-STATE-004`    | replaced          | `MAM2-STATE-004`                         | 不再强制 SQLite；本地 cache 可删除重建，篡改不能改变 Git 权威状态。                            |
| `MAM-DEVICE-001`   | removed/replaced  | `MAM2-ASSIGN-001`                        | 删除 Device Registry、设备派发和运行时选角，改为 Workflow 节点固定角色。                       |
| `MAM-DEVICE-002`   | removed/replaced  | `MAM2-PRESENCE-001`                      | 删除 lease/heartbeat/排他领取，改为 advisory execution notice。                                |
| `MAM-DEVICE-003`   | replaced          | `MAM2-RECOVERY-001`                      | 保留进程/Attempt 恢复和未知副作用 reconciliation，不保留 device recovery。                     |
| `MAM-RUNTIME-001`  | retained/replaced | `MAM2-EXEC-003`                          | 保留 Pi RPC transport/event/usage，删除 Pi 专属 Extension、Session 产品和专属完成协议。        |
| `MAM-RUNTIME-002`  | removed/replaced  | `MAM2-EXEC-001`                          | 通用 ACP 不再必选；Adapter 只实现目标 CLI 真实结构化接口。                                     |
| `MAM-RUNTIME-003`  | replaced          | `MAM2-EXEC-002`                          | Grok Build profile 改为 Grok CLI structured Adapter。                                          |
| `MAM-RUNTIME-004`  | removed           | -                                        | 不实现 jcode。                                                                                 |
| `MAM-RUNTIME-005`  | replaced          | `MAM2-EXEC-004`                          | Codex、Grok 和 Pi 可在同一 Workflow 混合，不保留固定 Runtime 链。                              |
| `MAM-SECURITY-001` | retained/replaced | `MAM2-RESOURCE-001`、`MAM2-SECURITY-001` | 保留 deny/allowlist、Policy、Gateway、secret 和审计，限定为应用能力边界。                      |
| `MAM-SECURITY-002` | removed           | -                                        | 删除 container/OS isolation 完成标准。                                                         |
| `MAM-OBS-001`      | retained/replaced | `MAM2-OBS-001`                           | 保留 correlation、usage、错误和脱敏；大型原始日志允许本机保存。                                |
| `MAM-E2E-001`      | replaced          | `MAM2-E2E-001`                           | 用户自定义 Role/Workflow，经历返工、新 Attempt、标准结果和 Git Artifact。                      |
| `MAM-E2E-002`      | replaced          | `MAM2-E2E-002`                           | 两 clone、固定节点角色、重复执行 warning 和 Git 收敛，不验证 Device/Lease 排他性。             |
| `MAM-E2E-003`      | retained/replaced | `MAM2-E2E-003`                           | Reviewer 分歧、人工决定、不可变审核目标和 Git rebuild 保留。                                   |

## 4. 旧 invariant 映射

| 旧 invariant | 状态                  | 新语义                                                                                            |
| ------------ | --------------------- | ------------------------------------------------------------------------------------------------- |
| `INV-001`    | retained              | 只有 Scheduler Kernel 可以生成权威事件。                                                          |
| `INV-002`    | retained/generalized  | Git events 是权威；任何本地 projection/cache 都可删除重建。                                       |
| `INV-003`    | replaced              | Executor invocation/session handle 不是 Workflow 权威状态，也不形成独立 Session 产品。            |
| `INV-004`    | retained/strengthened | 没有合法 Attempt Result、Artifact Contract 和 correlation 时不能完成 Attempt。                    |
| `INV-005`    | replaced              | Attempt 级 Effective Config、凭证引用和资源物化隔离；快照不得含 secret value。                    |
| `INV-006`    | generalized           | Executor 内部 subagent/行为不能创建正式 Workflow 节点、Assignment 或权威事件。                    |
| `INV-007`    | retained              | 用户决定不能由 Agent 或聚合器伪造。                                                               |
| `INV-008`    | retained/scoped       | MAM Bridge/Gateway 和受控 Git/Workspace 端口执行所有权校验；无 OS sandbox 时不声称 Shell 级隔离。 |
| `INV-009`    | retained              | timeout 不等于命令未执行；非幂等副作用不确定时进入 `needs_reconciliation`。                       |
| `INV-010`    | retained              | Git、Artifact、cache、日志和诊断不能包含明文凭证。                                                |

新增 invariant：

| ID         | 约束                                                                                                       |
| ---------- | ---------------------------------------------------------------------------------------------------------- |
| `INV2-011` | Run 锁定 Workflow 和 Role catalog、Task 创建时锁定自身定义；Attempt 解析并冻结当前资源，两层快照不得混用。 |
| `INV2-012` | Claim 只能提示，不能改变 Workflow 节点固定角色，也不能成为排他状态锁；运行时 `reassign_task` 必须被拒绝。  |
| `INV2-013` | 没有合法标准结果 JSON 时 Attempt 不得进入 submitted/completed。                                            |
| `INV2-014` | 后续节点必需的 Artifact 必须可从 Git 重建；本地大日志缺失不得破坏 replay。                                 |
| `INV2-015` | 不存在 Role 继承、Session override、自动 fallback、独立 Agent Session 或用户 Pi Extension。                |
| `INV2-016` | Merge Queue 只按 `(mergeReadyAt, taskId)` 排序；新 commit 必须清除旧 ready 状态。                          |
| `INV2-017` | Design 对话与提案不属于 Workflow 权威状态；确认操作不得创建 Run、Assignment、Task、Attempt 或 Review。     |

## 5. v1-v4 设计映射

### v1

- Retained：Role、Executor、Provider、Model 分离；capability preflight；Skill/MCP 白名单；权限、预算和事件归一化。
- Removed：Role 继承、Session override、fallback、独立 Session 和 Session CRUD。
- Replaced：配置在 Attempt 开始时解析并冻结；Role 本身由 Run 锁定。
- New：Knowledge Base Profile/Gateway 和标准 Attempt Result。

### v2

- Retained：用户定义 Workflow、Artifact Contract、Review、Approval、返工、parallel/join/condition。
- Replaced：首期必须提供可视化图编辑器，源码编辑只是高级入口。
- New：dynamic tasks、`git_merge`、`mergeReadyAt` 和 8E-B Artifact policy。
- Removed：自然语言或共享聊天上下文作为正式节点输出。

### v3

- Retained：Git authority、多 clone、多 Scheduler、append-only events、冲突和人工裁决。
- Replaced：设备派发和人工选角改为 Workflow 节点固定角色；lease/heartbeat 改为非排他 execution notice。
- Removed：Device Registry、device capability、device recovery 和 GitHub-specific API。

### v4

- Retained：Pi RPC、Role materialization、event/usage normalization 和策略边界。
- Replaced：Pi 使用统一 structured Adapter、Attempt Result 和 Application API。
- Removed：container、Pi 专属 Extension、Session override 和独立 Session 产品。

## 6. 两份裁剪计划映射

### Orca 功能裁剪计划

- `PRUNE-*` 从“必须继续在旧仓库删除”替换为“新程序不得 import、package 或 expose”；旧仓库不再持续裁剪。
- 原 Git/worktree、Artifact/Review、Workflow、Policy 和 Diagnostics 的保留项按复用矩阵逐项迁移。
- SSH、WSL、Device Registry、device dispatch/heartbeat、container、jcode、额外 Runtime 和旧数据迁移全部 removed。
- Executor 仅保留 Codex CLI、Grok CLI 和 Pi RPC，且必须使用结构化接口。

### Skills 裁剪计划

- Retained：显式导入、digest、Role 白名单、禁止隐式全局发现、Attempt 物化快照。
- Replaced：stable ID 不依赖 host/absolute path；只支持三个 Executor；新 Attempt 解析当前 Skill/MCP/KB 后冻结。
- Removed：Claude、jcode、额外 Agent、WSL/SSH 来源、container 物化和旧 Role Skill 数据迁移。
- New：MCP Server 和 Knowledge Base 资源级选择，以及 Knowledge Base 只读 Gateway。

## 7. 旧验收节点映射

| 旧节点/类别                                               | 状态              | 新门禁                                                                                |
| --------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------- |
| `M0-N1`、`M0-N3` Orca baseline/upstream                   | replaced          | 独立程序 source manifest、依赖闭包和 macOS build/start。                              |
| `M3-N1` SSH WorkspaceHost                                 | removed/replaced  | 首期只验证本地 macOS worktree；SSH/WSL removed。                                      |
| `M6-N2` Git concurrency                                   | retained/replaced | 两个真实 clone/进程、command-level retry、event replay 和相同 projection hash。       |
| `M6-N3` SQLite cache                                      | replaced          | cache-implementation-neutral 的删除、篡改、Git rebuild 测试。                         |
| `M7-N1..N3` Device/Lease/Recovery                         | replaced          | Workflow 固定角色、advisory execution warning、两个 Attempt 保留和 Attempt recovery。 |
| `M8-N1` 通用 ACP                                          | removed/replaced  | 每个 Executor 的真实 structured protocol contract；ACP 仅在 Grok 实际需要时测试。     |
| `M8-N2` Grok Build                                        | replaced          | Grok CLI structured smoke 和 capability preflight。                                   |
| `M8-N3` jcode                                             | removed           | 不进入新验收 manifest。                                                               |
| `M8-N4` 固定 Pi/Grok/jcode 链                             | replaced          | capability-compatible 的 Codex/Grok/Pi mixed Workflow。                               |
| `M9-N1` Policy                                            | retained/replaced | MAM allowlist、Bridge/Gateway、credential 和 audit 正负向测试。                       |
| `M9-N2` container                                         | removed/replaced  | 删除 OS/container gate；改应用边界与“不承诺 OS 隔离”验证。                            |
| `M9-N3` Observability                                     | retained          | 真实 child process/event/result/log correlation 和 secret canary。                    |
| `M10-N1` 固定研发流水线                                   | replaced          | 用户自定义 Role/Workflow，至少一次 changes requested 和新 Attempt。                   |
| `M10-N2` 两设备排他派发                                   | replaced          | 两 clone、固定节点角色、重复 warning、两个 Attempt 和 Git 收敛。                      |
| `M10-N3` Review/rebuild                                   | retained/replaced | 采用 8E-B Artifact policy，并从 Git 重建 Review/Decision。                            |
| `M10-N4` final audit                                      | retained/replaced | 只审计现行 `MAM2-*`、新语义 `INV-*` 和 `INV2-*`，同时验证所有旧 ID 已映射。           |
| Skills 的 WSL/SSH、Claude、jcode、container 和跨平台 gate | removed/deferred  | 只保留三个 Executor 的角色级 Skill；首期 macOS，Linux/Windows deferred。              |

旧命令名可以暂时保留为兼容入口，但不得继续验证已 removed 的语义。新 manifest 必须记录 replacement requirement ID，不能仅删除旧 criterion。

## 8. 新 requirement 与验收门禁

| 新 requirement      | 最低验收                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MAM2-APP-001`      | macOS 安装、typecheck、test、build、start；公开 UI/CLI 调用 Application API。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `MAM2-APP-002`      | 所有公开命令使用 Zod/JSON Schema；Renderer/CLI/Executor 不直接写 state store。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `MAM2-WORKFLOW-001` | 可视化创建节点/边、审核、显式有界循环和 merge，并与 Definition round-trip；每个可执行节点必须通过单选控件固定一个 Role；Run 启动后固定角色节点默认自动执行，审核/验收的 `changes_requested` 沿有界回退路径自动返工。                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `MAM2-UI-001`       | Design Assistant、Roles、Visual Workflow、Runs、My Role、Task timeline、Reviews、Merge Queue 和 Resources 可操作；Roles、Resources、Settings 及常用本机绑定默认使用字段表单，JSON 仅作为高级入口；Pi 默认可见，Provider endpoint、API Key 与模型使用单一简易配置流程。模型连接必须按协议从 API 拉取模型列表并选择，不显示手动模型 ID 入口；角色通过勾选选择 Skill、MCP Server 和知识库，勾选即授权资源，不配置二级允许列表或检索限制。                                                                                                                                                                                                                   |
| `MAM2-DESIGN-001`   | Design Assistant 选择已有 Model Profile 对话生成全新的完整 Role Profile 和一个 Workflow Definition，或选择活动 Workflow 作为基线生成同一 ID 的下一版本并复用现有 Role；每个可执行节点固定一个 Role；提供可编译标准模板；模型始终返回完整替换方案，并可提供问题、方案比较、设计分段和缺陷提示；这些提示不要求逐项确认，用户可直接确认当前草稿；解析、引用和编译错误经有界修复后仍失败，或基线版本已过期时必须阻止创建；未加密草稿只保存在本机；人工确认后只创建定义或定义版本，不创建 Run、Task、Attempt 或 Review，既有 Run 保持固定原 Workflow 版本。                                                                                                   |
| `MAM2-STATE-001`    | 删除 projection 后从 Git events 重建相同 hash。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `MAM2-STATE-002`    | 配置 remote 时两个真实 clone/进程并发提交合法命令并收敛；无 remote 时本地 Git 分支可由多个本地角色复用；stale command 在最新 projection 重校验。加载 unborn 项目时不创建或移动项目 `HEAD`、不提交用户文件，并初始化独立 `mam-state`。用户明确启动首个 Attempt 时，完全为空且干净的项目自动创建首个空 commit；存在 staged、modified 或 untracked 文件时返回 `project_initial_commit_required`。                                                                                                                                                                                                                                                           |
| `MAM2-STATE-003`    | pending conflict 的 resolution batch 被真实应用、持久化并消费。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `MAM2-STATE-004`    | 删除或篡改本地 cache 不改变 Git 权威状态。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `MAM2-ASSIGN-001`   | Workflow Definition 的每个可执行节点必须固定且只固定一个 Role；兼容字段 `recommendedRoleProfileIds` 和 `allowedRoleProfileIds` 必须是相同的单元素数组。Task 继承该角色，运行按钮可内部记录激活事件，但 UI/API 不得接受另一个角色；`reassign_task` 返回 `workflow_role_binding_fixed`。更换角色只能创建新 Workflow 版本和新 Run，历史 Attempt 不变。                                                                                                                                                                                                                                                                                                      |
| `MAM2-PRESENCE-001` | 两 clone 启动同一 Task 时均保留 Attempt 并显示 warning，不产生排他拒绝。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `MAM2-EXEC-001`     | Adapter 必须报告 structured-output capability；terminal idle/tail/自然语言不能完成 Attempt。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `MAM2-EXEC-002`     | Grok CLI 真实结构化接口 smoke；无接口版本在 preflight 明确失败。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `MAM2-EXEC-003`     | Pi RPC 通过统一 Result/Application API；无用户 Pi Extension 或专属完成入口。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `MAM2-EXEC-004`     | capability-compatible 的 Codex/Grok/Pi 可在同一 Run 混合执行，不自动 fallback。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `MAM2-RESULT-001`   | 每个 Attempt 产生不可变标准结果；Agent 字段和 MAM 权威字段严格校验。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `MAM2-RESOURCE-001` | 每个 Attempt 只物化 Role 固定白名单内的 Skill/MCP/KB，并记录实际版本/hash。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `MAM2-SECURITY-001` | MAM Bridge/Gateway 越权请求被拒绝和审计；文档/UI 不宣称 OS 级隔离。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `MAM2-ARTIFACT-001` | 关键 Artifact Git 可读；本地大对象有 hash/availability；历史 Attempt 永久可查。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `MAM2-REVIEW-001`   | Review 默认绑定最新 Attempt；历史只读；新 commit/Attempt 使旧 Review 失效。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `MAM2-MERGE-001`    | merge queue 按 `(mergeReadyAt, taskId)` 串行；冲突解决留完整 lineage。`approval_gate` 仅在前置节点通过后可操作。`git_merge.validations` 只接受可执行命令，在 integration worktree 合并后、push 前实际运行，不依赖 Agent 自报同名 verification；历史自然语言 validation 不得阻塞已审核 Run。                                                                                                                                                                                                                                                                                                                                                              |
| `MAM2-RECOVERY-001` | Executor 中断后权威 Attempt 不得永久停留在 running；未知非幂等副作用进入 `needs_reconciliation` 且不自动重试。用户确认核对完成后创建唯一 `recovery_planned` Attempt，新的恢复计划或其他并发 Attempt 的成功结果必须封存旧计划，人工启动必须复用其 ID 和 lineage。已恢复 Attempt 的迟到 progress/result，以及 `needs_attention` 期间其他 Executor 的迟到事件，均不得覆盖人工核对状态；历史 Attempt 保留。清理并启动同 Workflow 版本、同输入的新 Run 时，仍可验证 Git commit 和 Attempt branch 的已提交静态任务可通过记录完整来源 lineage 的权威事件恢复；已通过且绑定同一 Attempt 的 Review node可复用，Approval、动态计划及证据不可用的任务不得自动复用。 |
| `MAM2-OBS-001`      | event/result/log/diagnostics 关联且通过 secret canary；本地日志缺失不破坏 replay。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `MAM2-E2E-001`      | 自定义 Role/Workflow 在无人工逐节点点击的情况下完成一次代码任务、changes requested、新 Attempt、重新审核和 merge；显式人工门禁和异常状态除外。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `MAM2-E2E-002`      | 两 clone 使用同一节点固定角色直接运行，不出现角色选择；重复 warning、两个 Attempt 和 Git 收敛。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `MAM2-E2E-003`      | Reviewer 分歧等待人工决定，并从 Git 重建相同最终状态。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

验收框架继续复用 `acceptance/verify-node.mjs`、criterion evidence 和 traceability 聚合模式，但 manifest 必须使用上述 `MAM2-*`、`INV-001..010` 的新语义及 `INV2-*`。Linux/Windows 只记录 deferred，不得成为首期 skipped/blocked 项。

## 9. 标准结果与 Artifact 规则

- Agent 负责：状态、摘要、验证命令及结果、风险、待处理事项和产物声明。
- MAM 负责：Run、Node、Task、Attempt、Role、Executor invocation、Effective Config hash、commit、时间和内容 hash。
- stdout 可以传输 JSONL 事件，但最终必须产生一个符合最终设计 Schema 的结果对象。
- `submitted` 只是 completion request；Kernel 完成 Schema、correlation、Artifact Contract 和 GitChange 校验后才能推进。
- 正式输入输出、Task Plan、Review、Approval、GitChange 和 merge result 进入 Git。
- 大型日志、trace、截图和临时二进制可留本机；Git 记录摘要、hash、大小、producer、retention 和 availability。
- UI 默认显示最新 Attempt，可从时间线只读打开历史 Attempt；代码比较使用 Git diff，不建设 Artifact 专用并排比较页面。

## 10. 最终追踪规则

最终 `verify:final` 必须重新生成 machine-readable traceability，而不是汇总历史报告状态。每个现行 requirement/invariant 必须映射到实现、命令、criterion 和可读取 evidence；每个旧 ID 必须在本文档中有明确去向。缺失、blocked、partial、skipped、无证据或 secret canary 命中时不得报告 passed。
