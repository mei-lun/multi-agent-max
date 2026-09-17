# 任务领取、本地执行草稿与正式交付设计

## 状态

- 日期：2026-09-17
- 范围：分布式任务执行权、可恢复的本地模型执行、正式 Attempt 发布、确定性 Review 聚合以及多角色并行工作
- 设计时产品版本：0.1.12
- 状态：方向已确认，等待书面规格评审
- 运行时影响：本文档本身不实现运行时改动
- 产品权威影响：本设计会有意修改现行的非排他 Claim 和交付前 Attempt 语义；在运行时实现被声明完成前，必须先更新产品权威文档

## 问题

MAM 当前会在本地 Executor 产生有效结果之前，向 `mam-state` 发布 `execution_announced` 和 `attempt_started`。因此，即使没有产生任何有用结果，Provider 超时、进程失败和本地输出校验重试也会变成权威 Attempt。

2026-09-17 实际发生的故障链证明了三个相互关联的缺陷：

1. Pi 通过 `openai-responses` 调用已配置的 Provider 时，连续四次返回 `Request timed out.`。每次请求约 10.6 秒，输入和输出 token 均为零。初次请求失败后，Pi 又自动重试了三次。
2. MAM 将耗尽的 Provider 重试转换为 `execution_interrupted`，持久化恢复状态并创建替代 Attempt。但这只是本地模型传输失败，并不是一次已经交付的任务修订。
3. 后续成功交付收到一个合法的 `changes_requested` Review。应用层统计了所有已知 Attempt，包括只发生过超时的 Attempt，然后应用返工次数上限并提出 `blocked`。Scheduler 独立重新计算原始 Review 聚合后得到 `changes_requested`，以 `Review aggregation is not deterministic` 拒绝不一致结果，最终导致 Run 没有聚合结果。

同一状态结构还可能让下游选择错误的 Attempt，因为多个路径使用 `knownAttemptIds.at(-1)`、`knownAttemptIds.length`，或者在 `selectedAttemptId` 不可用时回退到历史记录。这些操作混淆了执行历史与下游可以消费的唯一权威交付。

## 目标

- 记录分布式任务执行权，但不发布本地 Executor 内部状态或失败的本地尝试。
- 在不改变 Workflow 固定 Role 绑定的前提下，使 Claim 对具体 Task 排他。
- 原领取者不可用时，允许显式、可审计的强制接管。
- Provider 超时恢复继续使用同一个本地执行草稿、Pi session、worktree 和预分配 Attempt 身份。
- 仅在结果、Artifact 和 Git commit 全部通过校验后发布正式 Attempt。
- 下游输入只依赖一个显式的当前交付，绝不依赖历史顺序。
- 只有 Review 正式要求的返工才计入返工次数上限。
- 应用层与 Scheduler 权威校验使用同一个确定性 Review 聚合实现。
- 支持多个开发 Task 和多个审核 Task 跨机器并行执行。
- 支持不同 Reviewer Role 审核同一份不可变交付，并确定性地聚合意见。
- 保留审计和 Git 重放所需的正式交付、Review、审批与合并证据。

## 非目标

- 不建设 Device Registry、设备能力、机器心跳、Claim 自动过期、SSH 或远程进程控制。
- 不把 Task 分配给机器，也不改变 Workflow Definition 固定的 Role。
- 不把同一 Task 的两个领取者并发运行当作协作机制。
- 超时后不自动切换 Executor、Provider 或 Model。
- 不保证第三方网关一定遵守 MAM 的客户端超时；网关仍可能更早返回自身超时。
- 不重写现有 Git 历史以删除旧事件。
- 不在机器之间共享进行中的 Pi 对话。
- 不把强制接管用作合并两个本地半成品工作区的手段。

## 术语

### Task Claim

共享的权威记录，授予一个领取者执行一个 Task 的权利。它标识 Task、Task 已固定的 Role、领取实例和单调递增的 generation。它不包含 Attempt ID、Role Instance ID、Executor Invocation ID、Pi session handle、worktree 路径或模型进度。

### Local Execution Draft

取得 Claim 后在本机创建的可恢复执行记录。它拥有预分配的 Attempt ID、冻结的 Effective Role Config、本地 worktree、Pi session、本地资源物化、请求预算统计和脱敏诊断。它不是 Workflow 权威状态，也不会从 `mam-state` 重放。

### Formal Delivery

在当前有效 Claim generation 下，原子发布已经校验的 Attempt Result、Artifact 证据、Effective Config 快照和已提交 commit。Formal Delivery 会创建权威 Attempt；失败或放弃的 Local Execution Draft 不会创建 Attempt。

### Formal Revision

在 Review 或人工审核返回 `changes_requested` 后创建的 Formal Delivery。Formal Revision 是不可变的共享证据，与 Provider 重试、进程恢复、校验重试或本地 Draft 重置不同。

## 不变量

1. 一个具体 Task 最多只有一个 active Claim。
2. Claim 永远不能改变 Workflow Definition 固定的 Role。
3. 一个 Local Execution Draft 的所有继续操作始终使用同一个预分配 Attempt ID。
4. Formal Delivery 成功之前，没有任何 Attempt 成为权威状态。
5. 交付命令仅在 Claim ID 和 generation 都等于当前 active Claim 时有效。
6. 下游节点只能消费 Task 显式指定的 `currentDeliveryAttemptId` 及其对应的已校验交付状态。
7. 历史数组永远不能用于选择当前业务状态。
8. Provider 重试与 Local Draft 恢复永远不增加正式返工次数。
9. 每个 Review decision 都绑定一个不可变 Review Subject。
10. Review 聚合结果与决策完成顺序无关，并且只由一个共享纯函数计算。
11. 强制接管会隔离旧领取者，但不会远程终止旧进程。
12. 接管发生后，过期领取者不能发布进度、Review decision、Artifact 或 Delivery。

## 共享状态模型

### Task Claim

共享投影为每个 Task 增加一个可选的 active Claim：

```ts
interface TaskClaim {
  claimId: string
  taskId: string
  roleProfileId: string
  roleProfileVersion: number
  claimantInstanceId: string
  generation: number
  status: 'active' | 'released' | 'completed' | 'taken_over'
  claimedAt: string
  releasedAt?: string
  completedAt?: string
  takenOverAt?: string
  takeoverReason?: string
}
```

`claimantInstanceId` 是安装或进程范围的标识，用于 fencing 和界面展示。它不是 Device Registry 条目，不携带能力、地址或远程控制元数据。

### Task Delivery Projection

Task 投影将交付历史与当前权威状态分开：

```ts
interface TaskDeliveryProjection {
  currentDeliveryAttemptId?: string
  deliveredAttemptIds: string[]
  revisionNumber: number
}
```

`deliveredAttemptIds` 只包含 Formal Delivery。它可以显示在历史视图中，但不能作为 `currentDeliveryAttemptId` 的回退来源。

### Formal Attempt

Formal Attempt 由交付事件创建，包含重放所需的不可变标识和证据：

```ts
interface DeliveredAttempt {
  attemptId: string
  taskId: string
  previousDeliveredAttemptId?: string
  lineageKind: 'initial' | 'revision' | 'recovery'
  revisionNumber: number
  roleInstanceId: string
  executorInvocationId: string
  effectiveConfigSnapshotId: string
  effectiveConfigHash: string
  result: AttemptResult
  submittedCommit?: string
  deliveredAt: string
}
```

只有 `lineageKind: 'revision'` 会增加 Review 返工次数。`recovery` 仅用于真正中断的已发布工作流边界，不代表 Review 要求的返工。

## 命令与事件协议

新 Run 协议不再使用交付前的 `announce_execution`、`start_attempt`、进度和普通恢复事件。新 Run 使用以下共享命令：

- `claim_task`
- `release_task_claim`
- `force_takeover_task`
- `record_task_delivery`

对应事件为：

- `task_claimed`
- `task_claim_released`
- `task_claim_taken_over`
- `task_delivery_recorded`

`record_task_delivery` 必须包含 active `claimId` 和 `generation`。Scheduler 重建最新投影，验证 Claim 仍然有效并归调用方所有，校验 Attempt Result 与 Artifact hash，然后生成一个事件批次：记录 Formal Attempt、更新 `currentDeliveryAttemptId` 并完成 Claim。

状态 CAS 重试必须基于最新远端投影重新执行 Claim 权威校验。已经按旧 generation 接受的交付事件不得 rebase 到新的 Claim generation 上。

## Claim 生命周期

### 领取

用户或自动协调器为 ready Task 请求 Claim。Scheduler 验证：

- Run 和 Task 仍可执行；
- Task 已有 Workflow 固定的 Role assignment；
- 不存在 active Claim；
- 不存在已经满足相同 Task 状态的完成交付；
- 领取实例被配置为参与该固定 Role。

如果已有 active Claim，命令以 `task_already_claimed` 失败，并返回可安全展示的 Claim 元数据。

### 释放

active 领取者可以在交付前显式释放。释放不会创建 Attempt，并使 Task 重新可领取。本地 Draft 清理是独立的本机操作，在共享释放被接受后执行。

### 强制接管

强制接管是需要确认且必须填写原因的显式用户命令。它以原子方式把旧 Claim 标记为 `taken_over`，并创建一个 generation 加一的新 active Claim。

系统不会远程控制旧机器。旧机器下次同步或尝试交付时，其过期 generation 会以 `stale_claim` 被拒绝。它的 Local Draft 不再可交付，只能导出供人工检查或在本地丢弃。

Claim 不自动过期，从而避免短暂断网或笔记本休眠导致执行权被静默转移。

### 离线行为

分布式模式要求先与远端同步，才能领取、释放、接管或交付 Claim。取得 Claim 后，领取者可以在暂时离线时继续本地 Draft。Formal Delivery 前必须 fetch 并验证当前 generation；离线期间发生的接管会使原交付失效。

本地协作模式对本地 `mam-state` 分支应用同一套 Claim 规则。

## 本地执行草稿

### 持久化清单

每个 Draft 在 MAM 用户数据目录下保存一个私有本地清单。清单只包含引用和 hash，不包含 secret value：

- Workflow Run、Task、Claim ID 和 Claim generation；
- 预分配的 Attempt、Role Instance 和 Executor Invocation ID；
- Effective Config snapshot ID 和 hash；
- Executor kind 和 invocation 目录；
- Pi session 文件或 ID；
- worktree 路径、分支和 base commit；
- 执行状态和已消耗的活动运行时长；
- 最近一次脱敏错误类别和时间。

Draft 状态包括：

- `preparing`
- `running`
- `waiting_for_resume`
- `validating`
- `ready_to_deliver`
- `delivered`
- `discarded`
- `stale_claim`

这些都是本地状态，不进入共享 Workflow 投影。

### Provider 超时策略

Pi 隔离环境的 `settings.json` 为本次 invocation 设置专用 Provider 超时。初始自动策略为：

```text
requestTimeoutMs = clamp(remainingAttemptBudgetMs / 4, 60_000, 300_000)
```

如果剩余活动预算不足以保留五秒结算时间，MAM 在本地以 `attempt_budget_insufficient` 拒绝发起请求，避免启动一个不可能在预算内完成的调用。

Pi 配置使用：

- `retry.provider.timeoutMs = requestTimeoutMs`
- `retry.provider.maxRetries = 0`
- `retry.enabled = true`
- `retry.maxRetries = 1`

这样允许一次用户可见的 agent-level retry，并防止隐藏的 Provider SDK 重试成倍增加成本。Local Draft 记录请求次数和耗时，但不存储凭证或完整 prompt。

配置的超时是客户端上限。如果网关更早返回 `Request timed out.`，MAM 将其分类为上游超时，并同样把 Draft 转为 `waiting_for_resume`。

### 继续

Pi 仍存活时，继续操作通过 active RPC session 发送后续指令。应用或 Pi 进程重启后，MAM 使用相同 invocation 物化内容和持久化 session 文件启动新的本地 Pi 进程，再发送继续指令，要求 Agent 检查现有 worktree 状态并继续工作，而不是重复已经完成的工作。

继续操作保留 Draft 的预分配 Attempt ID、冻结配置、worktree 和 Claim generation。等待用户操作的时间不计入活动运行预算。

### 重置与丢弃

`从头开始本地执行` 会放弃当前 Draft，删除其 worktree、session、资源物化和未发布分支，然后在同一个 active Claim 下创建新 Draft。由于两个 Draft 都未交付，共享状态中不会创建 Attempt。

`丢弃并释放` 会清理本地数据并释放 Claim。脱敏诊断日志继续遵循现有的 24 小时保留规则。

### 未知副作用

Provider 超时本身不代表存在未知外部副作用。如果 MAM 无法确定非幂等 Application API、MCP 操作或外部命令是否完成，Draft 在本地进入 blocked，用户必须先显式核对，才能继续、重置、释放或强制接管。共享 Task 可以显示通用 `needs_attention` 标记，但不得发布 Draft 的 Attempt 或 Invocation 标识。

## 正式交付

交付流程如下：

1. 根据最新共享投影在本地校验 Claim generation。
2. 收集或解析标准结果。
3. 校验每个 Artifact contract 和权威字段。
4. 使用预分配 Attempt ID 提交 Draft worktree。
5. 分布式模式下推送不可变任务分支或 delivery ref。
6. 通过 Git CAS coordinator 提交 `record_task_delivery`。
7. Scheduler Kernel 再次校验 Claim generation。
8. 原子记录 Formal Attempt、Delivery 和 Claim 完成状态。
9. 按保留策略删除本地 worktree 和 invocation 物化目录。

如果步骤 6 或 7 因 Claim 过期而拒绝，但 task ref 已经推送，该 ref 不被 `mam-state` 引用，也不是 Formal Delivery。MAM 将其记录为孤立 ref 并尽力清理。已安装 Git 与远端支持时，实现应使用原子多 ref push，但正确性不能依赖这项可选能力。

## 下游消费

所有消费者必须使用统一、显式的 delivery resolver。Resolver 要求：

- 存在 `currentDeliveryAttemptId`；
- 存在对应的 delivered Attempt；
- 满足边要求的状态，例如 submitted、reviewed、approved 或 merged；
- Artifact hash 与 commit ancestry 证据完全匹配；
- 当前交付 revision 尚未在活动消费语义中被替代。

系统不得回退到最后一个历史 ID。当前交付缺失或不唯一是阻塞状态，而不是可以猜测的选择问题。

新的 Formal Revision 成为当前版本时：

- 上一个交付保留为不可变历史证据；
- 旧 Review validity 变为 superseded；
- 旧 Review panel 和待处理 reviewer Claim 变为 stale；
- 旧 merge readiness 被替代；
- 下游输入缓存失效；
- 基于旧 lineage 创建但尚未交付的下游 Draft 无法交付，并收到 `stale_input_lineage`。

共享投影保留正式历史 revision，因为 Review decision 和审计证据会绑定它们。本地失败、Provider 重试、校验重试和已放弃 Draft 都不是正式 revision，也永远不会出现在该历史中。

## Review 模型

### Reviewer 执行

每个 Review Task 使用与生产 Task 相同的 Claim 和 Local Draft 生命周期。本地 Reviewer 执行失败不会创建共享 Review Attempt 或 decision；成功的 Reviewer Delivery 会原子记录 Formal Attempt 和 Review Decision。

每个 decision 绑定以下不可变 Review Subject：

```text
producerTaskId
+ producerDeliveryAttemptId
+ resultHash
+ artifactHashes
+ submittedCommit（如有）
```

### 确定性聚合

应用发布器与 Scheduler 权威校验共用一个纯函数 `ReviewAggregationCalculator`。它的输入包括：

- 冻结的聚合策略；
- 完整、精确的 Review Subject；
- 有效 Review Decision；
- 生产者的正式 revision number；
- `maxRevisionAttempts`；
- 命令显式提供的 `createdAt`。

Calculator 按稳定 Review Slot ID 和 Decision ID 规范化决策。Findings 按稳定签名去重和排序。权威层比较规范值或 hash，不再分别构造依赖插入顺序的 JSON 后比较。

只有 `lineageKind: 'revision'` 增加 revision number。基础设施失败、Provider 超时、Local Draft 重置、强制接管和恢复继续均不计数。

### 多 Reviewer Role

每个可执行 Review Gate 仍只绑定一个 Reviewer Role。同一个 Role 可以通过多个稳定 slot 提交多个决策。

不同 Reviewer Role 使用不同 Review Gate 节点，并由新的非执行系统节点 `review_aggregate` 聚合：

```text
Producer Delivery
  -> Review Gate A / 安全审核角色 --
  -> Review Gate B / 质量审核角色 ----> Review Aggregate
  -> Review Gate C / 产品审核角色 --
```

`review_aggregate` 冻结以下内容：

- 上游 Review Gate ID；
- 每个 Gate 所需的决策数；
- 总 quorum；
- 分歧处理策略；
- 当前交付作为 Review Subject 的唯一生产节点；
- revision target 节点和正式返工次数上限。

所有 Review Task 都可以独立领取，并可在不同机器上并发执行。完成顺序不能影响结果。混合的阻塞状态进入现有人工分歧决定流程。生产者产生新交付后，旧 Subject 的全部待处理 Review Task 和 Claim 都失效。

## 多开发角色

排他 Claim 只作用于 Task ID，不会降低不同 Task 之间的并行度。

- 不同子功能使用不同静态或动态 Task，可以并发领取。
- 同一个 Role Profile 可以在不同 Task 上运行多个实例。
- 不同 Role Profile 使用不同 Workflow 节点或 dynamic-task 分支。
- 每个写任务保持自己的 branch 和 worktree。
- `git_merge` 串行执行集成并记录冲突解决 lineage。
- 同一需求的两个候选实现必须是两个独立 Task，随后通过显式选择、Review、transform 或 merge 节点决定采用结果。

两个执行者不得共享同一个 Task ID。强制接管用于替换不可用的领取者并隔离其输出，不是并行工作机制。

## 人工交互

Task 尚未完成时，任务内澄清属于 Local Execution Draft。共享 Claim 继续表示 Task 已被领取，但不发布 Draft 对话或临时 Attempt 身份。

Formal Delivery 时，结构化结果可以包含足以解释重大实现决策的简明决策摘要。正式 approval gate、human Review decision 和 disagreement resolution 继续作为 Git 权威事件，因为它们控制 Workflow 状态转换。

这会有意修改“每条任务内澄清消息和答案立即写入 Git”的现行需求。产品权威文档必须区分本地执行对话与正式人工 Workflow 决策。

## 旧 Run 兼容

不重写现有 Git 历史。带版本的 legacy projection adapter 应用以下规则：

1. 具有合法 `attempt_result_submitted` 事件的旧 Attempt 是 Formal Delivery 候选。
2. 没有 submitted result 的旧 Attempt 仅属于旧执行诊断，不能参与当前选择或正式 revision 计数。
3. 如果现有合法 `selectedAttemptId` 指向 submitted result，则优先采用它。
4. 如果没有 selected 值且只有一个合法 submitted delivery，则该交付成为当前交付。
5. 如果存在多个 submitted 候选且没有权威选择，Task 进入 `needs_attention`。
6. 旧 execution notice 不转换为新 active Claim；继续未完成的旧 Task 必须取得新 Claim。
7. 现有合法 Review decision 继续绑定其不可变 submitted Subject。
8. 缺失的 aggregation 只能通过新的共享 Calculator 重新计算并发布。

对于本次实际故障 Run，两个只有超时的生产者 Attempt 不计入 revision，已提交的生产者 Attempt 保持当前交付，已记录的 Review 保留，缺失的 aggregation 重新计算为 `changes_requested`，而不是 `blocked`。

## UI 改动

Task 界面展示：

- available、claimed、本地等待、delivered、等待 Review、approved、blocked 和 completed 状态；
- 领取者 Role 和可安全显示的 claimant instance；
- `领取任务`、`释放` 和 `强制接管` 操作；
- 要求填写原因的强制接管确认框；
- 可恢复本地 Draft 的 `继续上次进度`、`从头开始本地执行` 和 `丢弃并释放`；
- 另一台机器已经接管时的 stale Claim 说明；
- Attempt 时间线默认只显示正式交付 revision；
- 本地诊断在独立执行活动视图中显示。

Workflow Editor 增加 `review_aggregate`，展示其成员 Review Gate 和 quorum，并阻止聚合不共享同一生产者交付 lineage 的 Review Gate。

## 可观测性与安全

本地诊断记录：

- 请求开始和结束时间；
- 实际使用的 timeout；
- 重试层和序号；
- 是否收到响应 header、token 或工具事件；
- 能够识别时记录规范化超时来源；
- Claim ID 和 generation；
- 本地 Draft ID 和预分配 Attempt ID。

日志不包含 secret value 或完整 prompt。现有 secret canary 与 24 小时保留规则继续适用。

Claim fencing 是工作流一致性控制，不是操作系统安全边界。与当前架构相同，直接拥有 Git 写权限的用户不在 Application API 信任模型内。

## 产品权威变更

实施需要协调修改现行产品权威：

- `DEC-010`：保留正式 delivered Attempt 历史，不保留失败的本地 Execution Draft 历史。
- `MAM2-STATE-002`：保留 Git CAS 收敛，同时校验排他 Claim generation。
- `MAM2-PRESENCE-001`：以一个 active Claim 和显式强制接管取代并发的非排他执行。
- `INV2-012`：Claim 不能改变固定 Role，但它是 Task 排他执行权。
- `MAM2-RESULT-001`：正式 Attempt 和 Result 仅在校验完成后一起发布。
- `MAM2-REVIEW-001`：Review 绑定当前正式交付；新的正式交付使旧的活动 Review 状态失效。
- `MAM2-RECOVERY-001`：区分本地 Draft 继续和已发布工作流边界之后的恢复。
- `MAM2-HUMAN-001`：区分本地任务澄清与正式写入 Git 的人工 Workflow 决策。
- `MAM2-E2E-002`：以 Claim 冲突、强制接管和过期交付拒绝取代双 Attempt warning 验收。
- 要求保留重复 Attempt 的 Runtime 与验收章节必须一致更新。
- 节点目录与编辑器需求必须增加 `review_aggregate`。

以下需求继续保留：Workflow 固定 Role 绑定、仅 Scheduler 可写权威状态、正式 Result 与 Artifact 不可变、不自动 Provider fallback、非幂等副作用不确定时显式 reconciliation、正式状态可从 Git 重放，以及独立任务 branch/worktree。

## 实施顺序

由于每个阶段都会独立改变运行时行为，应通过不同 patch 版本交付：

1. 更新产品权威，增加共享的确定性 Review aggregation calculator，并修复本次 legacy aggregation 路径。
2. 增加 Task Claim 命令、generation fencing、释放、强制接管、投影和 UI。
3. 增加持久化 Local Execution Draft、Pi session 继续、Provider 超时配置、本地等待状态、重置和清理。
4. 用原子 Formal Delivery 替换交付前 Attempt 发布，并把所有下游 resolver 迁移到 `currentDeliveryAttemptId`。
5. 增加 `review_aggregate`、多角色 Review fan-out、生产者 revision 失效处理和编辑器支持。
6. 增加旧事件重放兼容、双 clone 验收覆盖、traceability 证据和 macOS 发布门禁验证。

实施过程中不能在生产路径中临时混用新的排他 Claim 与旧的重复 Attempt 选择语义。Feature flag 或 Schema gate 必须确保每个 Run 只使用一种完整一致的协议版本。

## 验证

必须覆盖以下测试：

- Provider 响应超过 60 秒时，不会因隐式 10 秒客户端超时而失败。
- 上游在 10 秒返回超时时，只暂停一个 Local Draft，Git 中不创建 Attempt。
- 继续操作复用 Attempt ID、Pi session、冻结配置和 worktree。
- 应用重启后可以从持久化 session 恢复同一个本地 Draft。
- 本地失败一百次后成功，只产生一个 Formal Attempt。
- 重置会删除本地 Draft 资源，且不产生共享 Attempt。
- 两个 clone 不能正常领取同一个 Task。
- 强制接管会递增 generation 并隔离旧领取者。
- 过期领取者不能发布 Delivery 或 Review decision。
- 相同或不同 Role 可以并发领取和执行不同 Task。
- 多个 Reviewer Role 可以并发审核同一个 Subject。
- Review 完成顺序不改变 aggregation hash 或结果。
- Provider 失败不消耗正式 revision 预算。
- 生产者 Formal Revision 会使旧活动 Review 与下游 lineage 失效。
- 没有唯一合格当前交付时，下游 resolver 必须拒绝继续。
- 本次实际 legacy Run 重放后只有一个生产者 Formal Delivery，并生成合法 `changes_requested` aggregation。
- 删除 projection 后重建得到相同 state hash。
- 日志和导出的诊断通过 secret canary。
- macOS typecheck、测试、构建、真实 Pi smoke、桌面 smoke 和双 clone Git 验收全部通过。

## 风险与限制

- 必须使用固定版本 Pi `0.81.1` 的真实进程验证 session 继续。Pi 已支持持久化 session，但 MAM 当前尚未从已有 session 启动 invocation。
- 网关主动控制的超时无法通过本地 SDK 配置延长。
- task ref push 与 `mam-state` Delivery 之间发生崩溃时，可能留下未引用的远端 ref；它绝不能成为权威交付，并需要尽力清理。
- 领取者消失后，排他 Claim 可能无限期保持 active；显式强制接管是设计规定的恢复机制。
- 即使旧事件被排除在活动投影语义之外，它们仍然保留在 Git 历史中。
- 不支持跨机器继续未完成的 Local Draft。强制接管会在同一个 Task 下启动新的本地 Draft，而不会继承上一台机器私有的 Pi session。

## 预计范围

预计实现会影响约 30-45 个实现文件和 20-30 个测试文件，覆盖 shared Schema、Scheduler authority、Git projection/replay、Attempt 执行、Pi invocation 物化、Task handoff、Review、Workflow 编译、Renderer 状态和验收证据。

这是一次高影响状态协议变更。主要成本不在超时配置本身，而在于删除每一个隐式的历史 Attempt 选择器，并证明 Claim fencing、Formal Delivery、Review 失效、merge readiness 和旧事件重放在并发 Git 更新下保持一致。
