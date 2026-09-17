# 任务领取、本地执行草稿与正式交付实施计划

> **面向执行 Agent：** 必须使用 `executing-plans` 技能逐项实施本计划。每项任务均使用复选框跟踪，完成一个可独立验证的任务后再进入下一项。

**目标：** 将交付前的本地模型执行从 Git 权威 Attempt 中分离，引入 Task 级排他 Claim、可恢复 Local Execution Draft、原子 Formal Delivery、唯一当前交付解析和确定性多角色 Review 聚合。

**架构：** `mam-state` 只记录 Task Claim、正式交付及其后续 Review/Merge 状态；本地 Draft 保存 Pi session、worktree、冻结配置和失败重试。Scheduler 使用 Claim generation 隔离被接管的执行者，并在一个事件批次中发布正式 Attempt 与 Delivery。所有下游通过 `currentDeliveryAttemptId` 读取唯一输入，Review 聚合由应用层与 Kernel 共用同一纯函数。

**技术栈：** TypeScript 6、Electron、React 19、Zod 4、Vitest 4、Git 2.25+、Pi RPC 0.81.1。

**规格：** `docs/superpowers/specs/2026-09-17-claim-local-draft-delivery-design.md`

**执行状态（2026-09-17）：** 任务 1-5 的运行时实现、多轮代码复审修复与核心回归已完成，当前开发版本为 0.1.19；任务 6 的全量测试、typecheck、lint、build 和 `git diff --check` 已执行。Node 22 全量 Vitest 为 154 个文件中 151 个通过、479 项通过、1 项跳过，5 项失败均为实施前 Windows 基线。`verify:final` 因 Windows 上 `spawnSync pnpm.cmd EINVAL` 无法运行 acceptance 命令，新的两 clone/macOS evidence 尚未完成，因此发布验收保持阻塞。

## 全局约束

- 产品语义最终必须同步到 `docs/final-reuse-integration-plan.md` 与 `docs/readme/MAM_REQUIREMENTS_DELTA_2026-07-27.md`。
- 每个可执行 Workflow 节点仍然固定且只固定一个 Role；Claim 不能改派 Role。
- 不增加 Device Registry、设备心跳、SSH、容器或 Executor/Provider/Model fallback。
- macOS 是首发门禁；路径处理必须使用 Node path API，并保持 Windows/Linux 可移植边界。
- Git 命令兼容 Git 2.25；原子 push 等新能力必须运行时探测，不能成为正确性前提。
- 不得将 secret value、完整 prompt 或本地 Pi 对话写入 Git、日志或共享投影。
- 不得关闭或提高文件 max-lines 规则；新增职责使用明确的小模块承载。
- 当前工作区已有未提交的 0.1.12 设计助手改动；实施不得覆盖或回退这些改动。
- 每个改变运行时行为的独立阶段都必须递增 patch 版本、创建对应版本档案并更新 `docs/versions/README.md`。
- 新协议通过 Run 中冻结的 `executionProtocolVersion` 启用；旧 Run 使用 legacy adapter，禁止同一 Run 混用新旧协议。

---

## 文件结构

新增模块按职责拆分：

- `src/shared/mam/domain/task-claim.ts`：Task Claim、generation 和共享状态 Schema。
- `src/shared/mam/domain/task-delivery.ts`：正式交付、lineage kind 和交付投影 Schema。
- `src/main/mam/scheduler/task-claim-command-authority.ts`：领取、释放、接管和 fencing 校验。
- `src/main/mam/state-store/task-claim-event-application.ts`：Claim 事件投影。
- `src/main/mam/application/task-claim-command-service.ts`：Application API 用例编排。
- `src/main/mam/application/local-execution-draft-store.ts`：本地 Draft 原子持久化和恢复。
- `src/main/mam/application/local-execution-draft-cleanup.ts`：worktree、session、资源与临时 ref 清理。
- `src/main/mam/application/task-delivery-command-service.ts`：交付前校验与原子发布编排。
- `src/main/mam/application/current-task-delivery.ts`：唯一当前交付解析器。
- `src/main/mam/review/review-aggregation-calculator.ts`：共享确定性 Review 聚合纯函数。
- `src/main/mam/review/review-revision-counter.ts`：仅统计正式 revision lineage。
- `src/main/mam/state-store/legacy-attempt-delivery-adapter.ts`：旧事件到正式交付投影的兼容映射。
- `src/renderer/src/features/mam/MamTaskClaimDialog.tsx`：领取冲突、释放和强制接管交互。
- `src/renderer/src/features/mam/MamLocalExecutionDraftActions.tsx`：继续、重置、丢弃操作。
- `src/shared/mam/domain/review-aggregate.ts`：多 Review Gate 聚合节点 Schema。
- `src/main/mam/review/review-aggregate-node-service.ts`：跨 Gate 确定性汇总。

---

### 任务 1：更新产品权威并修复确定性 Review 聚合

**版本：** `0.1.13`

**文件：**
- 修改：`docs/final-reuse-integration-plan.md`
- 修改：`docs/readme/MAM_REQUIREMENTS_DELTA_2026-07-27.md`
- 新建：`src/main/mam/review/review-aggregation-calculator.ts`
- 新建：`src/main/mam/review/review-aggregation-calculator.test.ts`
- 新建：`src/main/mam/review/review-revision-counter.ts`
- 新建：`src/main/mam/review/review-revision-counter.test.ts`
- 修改：`src/main/mam/review/review-aggregation-policy.ts`
- 修改：`src/main/mam/application/review-aggregation-publisher.ts`
- 修改：`src/main/mam/scheduler/review-command-authority.ts`
- 修改：`src/main/mam/application/mam-review-disagreement-command.ts`
- 测试：`src/main/mam/application/mam-review-command-service.test.ts`
- 新建：`docs/versions/0.1.13.md`
- 修改：`package.json`
- 修改：`docs/versions/README.md`

**接口：**
- 产出：`calculateReviewAggregation(input: ReviewAggregationCalculationInput): ReviewAggregation`
- 产出：`countFormalRevisions(input: { attemptId: string; attempts: Readonly<Record<string, AttemptProjection>> }): number`
- 后续任务依赖这两个接口，不再读取 `knownAttemptIds.length`。

- [ ] **步骤 1：为本次故障写失败测试**

```ts
it('does not count timeout-only attempts as review revisions', () => {
  expect(countFormalRevisions({
    attemptId: 'attempt.delivered',
    attempts: {
      'attempt.timeout-1': attempt({ status: 'needs_reconciliation' }),
      'attempt.timeout-2': attempt({ status: 'blocked' }),
      'attempt.delivered': attempt({ status: 'submitted', lineageKind: 'initial' })
    }
  })).toBe(0)
})

it('produces the same canonical aggregation for every decision order', () => {
  expect(calculateReviewAggregation(input([decisionB, decisionA])))
    .toEqual(calculateReviewAggregation(input([decisionA, decisionB])))
})
```

- [ ] **步骤 2：运行聚合测试并确认失败**

运行：

```powershell
rtk corepack pnpm vitest run src/main/mam/review/review-aggregation-calculator.test.ts src/main/mam/review/review-revision-counter.test.ts
```

预期：因新模块不存在而失败。

- [ ] **步骤 3：实现共享聚合器和正式 revision 计数器**

```ts
export type ReviewAggregationCalculationInput = Readonly<{
  decisions: readonly ReviewDecision[]
  createdAt: string
  formalRevisionNumber: number
  maxRevisionAttempts: number
}>

export function calculateReviewAggregation(
  input: ReviewAggregationCalculationInput
): ReviewAggregation
```

决策按 `reviewerTaskId`、`id` 排序，finding 按 `category/filePath/line/summary/id` 排序。聚合器内部统一应用 revision 上限；Publisher 与 Kernel 不得再自行改写 `proposedStatus`。

- [ ] **步骤 4：替换应用层与 Kernel 的重复计算路径**

`review-aggregation-publisher.ts` 和 `review-command-authority.ts` 都调用 `calculateReviewAggregation`。权威比较使用 canonical object；错误信息保留 `review_aggregation_mismatch`，诊断增加具体不一致字段但不泄露 finding 正文。

- [ ] **步骤 5：更新权威文档**

按已批准规格修改 `DEC-010`、`MAM2-PRESENCE-001`、`INV2-012`、`MAM2-RESULT-001`、`MAM2-REVIEW-001`、`MAM2-RECOVERY-001`、`MAM2-HUMAN-001` 和 `MAM2-E2E-002`。明确新协议对新 Run 生效，旧 Run 通过 adapter 重放。

- [ ] **步骤 6：验证本次实际 Run 的聚合语义**

新增 fixture：两个无 Result 的 timeout Attempt、一个 submitted Attempt、一个 `changes_requested` Review。预期 aggregation 为 `changes_requested`，formal revision number 为 0。

- [ ] **步骤 7：运行定向测试与静态检查**

```powershell
rtk corepack pnpm vitest run src/main/mam/review src/main/mam/application/mam-review-command-service.test.ts src/main/mam/scheduler/kernel.test.ts
rtk corepack pnpm typecheck
rtk corepack pnpm lint
```

- [ ] **步骤 8：更新 0.1.13 版本档案并提交阶段变更**

提交范围仅包含本任务文件；如果工作区既有改动导致无法隔离提交，记录阻塞并保留未提交 diff，不得混入用户改动。

---

### 任务 2：增加排他 Task Claim 与强制接管

**版本：** `0.1.14`

**文件：**
- 新建：`src/shared/mam/domain/task-claim.ts`
- 修改：`src/shared/mam/scheduler-protocol.ts`
- 修改：`src/shared/mam/application-command.ts`
- 修改：`src/shared/mam/application-api.ts`
- 新建：`src/main/mam/scheduler/task-claim-command-authority.ts`
- 新建：`src/main/mam/scheduler/task-claim-command-authority.test.ts`
- 新建：`src/main/mam/state-store/task-claim-event-application.ts`
- 新建：`src/main/mam/state-store/task-claim-event-application.test.ts`
- 修改：`src/main/mam/state-store/git-state-projection.ts`
- 修改：`src/main/mam/state-store/git-event-application.ts`
- 新建：`src/main/mam/application/task-claim-command-service.ts`
- 新建：`src/main/mam/application/task-claim-command-service.real-git.test.ts`
- 修改：`src/main/mam/application/mam-ui-command-service.ts`
- 修改：`src/main/ipc/mam-ipc.ts`
- 修改：`src/preload/index.ts`
- 新建：`src/renderer/src/features/mam/MamTaskClaimDialog.tsx`
- 修改：相关 Task 操作组件与 i18n 消息
- 新建：`docs/versions/0.1.14.md`
- 修改：`package.json`、`docs/versions/README.md`

**接口：**
- 产出：`TaskClaimSchema`、`MamClaimTaskInputSchema`、`MamForceTakeoverTaskInputSchema`
- 产出：`assertTaskClaimAuthority(...)`
- 产出：`TaskClaimCommandService.claim/release/forceTakeover`

- [ ] **步骤 1：写 Claim 状态机失败测试**

覆盖首次领取、重复领取拒绝、同 Role 强制接管、错误 Role 拒绝、generation 递增、旧 Claim 变 `taken_over`、释放后重新领取。

- [ ] **步骤 2：运行测试并确认缺少协议**

```powershell
rtk corepack pnpm vitest run src/main/mam/scheduler/task-claim-command-authority.test.ts src/main/mam/state-store/task-claim-event-application.test.ts
```

- [ ] **步骤 3：增加 Claim Schema 与命令事件**

```ts
type TaskClaimCommand =
  | { type: 'claim_task'; claimId: string; claimantInstanceId: string }
  | { type: 'release_task_claim'; claimId: string; generation: number }
  | { type: 'force_takeover_task'; claimId: string; claimantInstanceId: string; expectedGeneration: number; reason: string }
```

事件必须携带 generation，Task 投影必须显式保存 active Claim 和 Claim 历史摘要。

- [ ] **步骤 4：实现 Kernel fencing**

所有后续会改变 Task 的新协议命令都接受 `{ claimId, generation }`。旧 generation 返回 `stale_claim`；错误 Role 返回 `workflow_role_binding_fixed`。

- [ ] **步骤 5：实现 Application API 与 UI**

正常启动先 Claim；已有 Claim 时显示领取者和时间。强制接管对话框要求非空原因和二次确认。不得提供改派 Role 控件。

- [ ] **步骤 6：增加双 clone 真实 Git 测试**

两个 repository 实例从同一 revision 领取同一 Task，CAS 后只能有一个 active Claim；另一方收到 `task_already_claimed`。接管后旧 generation 的模拟交付收到 `stale_claim`。

- [ ] **步骤 7：运行定向与全量核心测试**

```powershell
rtk corepack pnpm vitest run src/main/mam/scheduler src/main/mam/state-store src/main/mam/application/task-claim-command-service.real-git.test.ts
rtk corepack pnpm typecheck
rtk corepack pnpm lint
```

- [ ] **步骤 8：更新 0.1.14 版本档案并提交阶段变更**

---

### 任务 3：增加可恢复 Local Execution Draft 与 Provider 超时策略

**版本：** `0.1.15`

**文件：**
- 新建：`src/shared/mam/local-execution-draft.ts`
- 新建：`src/main/mam/application/local-execution-draft-store.ts`
- 新建：`src/main/mam/application/local-execution-draft-store.test.ts`
- 新建：`src/main/mam/application/local-execution-draft-cleanup.ts`
- 新建：`src/main/mam/application/local-execution-draft-cleanup.test.ts`
- 修改：`src/main/mam/application/mam-attempt-execution-service.ts`
- 修改：`src/main/mam/application/mam-attempt-background-runner.ts`
- 修改：`src/main/mam/application/local-task-execution-registry.ts`
- 修改：`src/main/mam/executors/pi-rpc-invocation.ts`
- 修改：`src/main/mam/executors/pi-rpc-launch-configuration.ts`
- 修改：`src/main/mam/executors/pi-rpc-adapter.ts`
- 修改：对应 Pi 测试与真实进程 smoke
- 新建：`src/renderer/src/features/mam/MamLocalExecutionDraftActions.tsx`
- 修改：`src/renderer/src/features/mam/MamAttemptRecoveryDialog.tsx`
- 新建：`docs/versions/0.1.15.md`
- 修改：`package.json`、`docs/versions/README.md`

**接口：**
- 产出：`LocalExecutionDraftStore.create/get/update/listRecoverable/discard`
- 产出：`providerRequestTimeoutMs(remainingBudgetMs: number): number`
- 产出：`PiRpcAdapter.resume(input: ResumePiRpcInput): Promise<PiRpcExecutionResult>`

- [ ] **步骤 1：写 Draft 持久化和 timeout 失败测试**

```ts
expect(providerRequestTimeoutMs(1_800_000)).toBe(300_000)
expect(providerRequestTimeoutMs(240_000)).toBe(60_000)
expect(store.get(draft.id)?.state).toBe('waiting_for_resume')
```

同时测试原子写、损坏文件隔离、secret canary、等待时间不计预算和 Draft ID/Attempt ID 稳定。

- [ ] **步骤 2：实现本地 Draft Store**

文件写入使用临时文件加 rename，权限保持 `0o600`，目录 `0o700`。清单只保存 hash、ID 和本机路径引用。

- [ ] **步骤 3：物化 Pi 隔离 settings**

在 invocation 的私有 `agent/settings.json` 写入：

```json
{
  "retry": {
    "enabled": true,
    "maxRetries": 1,
    "provider": {
      "timeoutMs": 60000,
      "maxRetries": 0,
      "maxRetryDelayMs": 60000
    }
  }
}
```

实际 `timeoutMs` 由剩余预算计算，示例值只用于 Schema 测试。

- [ ] **步骤 4：把 Provider timeout 转为本地暂停**

`executor_timeout` 且没有未知非幂等副作用时，将 Draft 更新为 `waiting_for_resume`，保留 Pi session、worktree 和资源，不调用旧 `recordAttemptInterruption`。

- [ ] **步骤 5：实现继续和重启恢复**

活动进程使用同一 RPC client 继续；进程丢失时使用 Draft 记录的 session 文件启动新的 Pi RPC 进程。继续指令要求检查 worktree 现状并只完成剩余工作。

- [ ] **步骤 6：实现本地重置与丢弃清理**

清理目标必须由 Draft manifest 中经过根目录约束校验的绝对路径解析；删除 worktree 使用 Git worktree remove，其他私有目录使用精确路径。不得对 workspace root 执行递归删除。

- [ ] **步骤 7：UI 接入继续、从头开始、丢弃并释放**

普通 Provider timeout 不再显示 `Execution interrupted`，而显示“模型请求超时，进度已保留”。

- [ ] **步骤 8：运行 Pi 与 Draft 测试**

```powershell
rtk corepack pnpm vitest run src/main/mam/executors/pi-rpc-adapter.test.ts src/main/mam/executors/pi-rpc-real-process.test.ts src/main/mam/application/local-execution-draft-store.test.ts src/main/mam/application/local-execution-draft-cleanup.test.ts
rtk corepack pnpm typecheck
```

- [ ] **步骤 9：更新 0.1.15 版本档案并提交阶段变更**

---

### 任务 4：以原子 Formal Delivery 替换交付前 Attempt

**版本：** `0.1.16`

**文件：**
- 新建：`src/shared/mam/domain/task-delivery.ts`
- 修改：`src/shared/mam/domain/task.ts`
- 修改：`src/shared/mam/scheduler-protocol.ts`
- 新建：`src/main/mam/application/task-delivery-command-service.ts`
- 新建：`src/main/mam/application/task-delivery-command-service.real-git.test.ts`
- 新建：`src/main/mam/application/current-task-delivery.ts`
- 新建：`src/main/mam/application/current-task-delivery.test.ts`
- 修改：`src/main/mam/application/mam-attempt-background-runner.ts`
- 修改：`src/main/mam/application/attempt-worktree-manager.ts`
- 修改：`src/main/mam/state-store/git-state-projection.ts`
- 修改：`src/main/mam/state-store/git-event-application.ts`
- 修改：`src/main/mam/scheduler/scheduler-command-authority.ts`
- 修改：所有使用 `knownAttemptIds.at(-1)`、`knownAttemptIds.length` 或 `selectedAttemptId ??` 的生产代码
- 新建：`src/main/mam/state-store/legacy-attempt-delivery-adapter.ts`
- 新建：`src/main/mam/state-store/legacy-attempt-delivery-adapter.test.ts`
- 新建：`docs/versions/0.1.16.md`
- 修改：`package.json`、`docs/versions/README.md`

**接口：**
- 产出：`TaskDeliverySchema`、`DeliveredAttemptSchema`
- 产出：`resolveCurrentTaskDelivery(projection, taskId): CurrentTaskDelivery`
- 产出：`record_task_delivery` 命令与 `task_delivery_recorded` 事件

- [ ] **步骤 1：写“100 次本地失败只有一次交付”的失败测试**

测试 Draft 状态变化不写 Git event；最终成功只产生一个 `task_delivery_recorded`，其中包含一个正式 Attempt。

- [ ] **步骤 2：写下游 fail-closed 测试**

无 current delivery、current ID 指向不存在 Attempt、交付未达到所需状态、多个 legacy submitted 候选均必须失败，不得取数组末尾。

- [ ] **步骤 3：实现 Delivery Schema 和原子事件**

```ts
type RecordTaskDeliveryCommand = Readonly<{
  type: 'record_task_delivery'
  taskId: string
  claimId: string
  generation: number
  delivery: DeliveredAttempt
}>
```

Kernel 同一批次完成 Attempt 创建、`currentDeliveryAttemptId` 更新和 Claim 完成。

- [ ] **步骤 4：删除启动时的共享 Attempt 发布**

新协议 Run 不调用 `publishAttemptStart`；`announce_execution`、`start_attempt` 和 progress 仅由 legacy Run 使用。Effective Config 在 Draft 本地冻结，交付时才写共享快照。

- [ ] **步骤 5：迁移全部下游选择器**

以下路径必须改用 `resolveCurrentTaskDelivery`：Artifact handoff、Review route、Review panel、merge readiness、merge queue、condition、dynamic task plan、workflow projection、result reuse、human attention 与 UI snapshot。

- [ ] **步骤 6：实现旧事件 adapter**

有合法 Result 的旧 Attempt 映射为 delivered candidate；无 Result 的旧 Attempt 排除。合法 `selectedAttemptId` 优先；唯一 candidate 自动选中；多 candidate 无选择时进入 `needs_attention`。

- [ ] **步骤 7：验证 stale lineage**

生产者新 Formal Revision 发布后，基于旧 delivery 创建的下游 Draft 交付必须返回 `stale_input_lineage`。

- [ ] **步骤 8：运行状态、交接、Review 和 merge 测试**

```powershell
rtk corepack pnpm vitest run src/main/mam/state-store src/main/mam/application/attempt-handoff-context.test.ts src/main/mam/application/merge-queue-service.test.ts src/main/mam/review
rtk corepack pnpm typecheck
rtk corepack pnpm lint
```

- [ ] **步骤 9：更新 0.1.16 版本档案并提交阶段变更**

---

### 任务 5：增加多角色 `review_aggregate` 系统节点

**版本：** `0.1.17`

**文件：**
- 新建：`src/shared/mam/domain/review-aggregate.ts`
- 修改：`src/shared/mam/domain/workflow.ts`
- 修改：`src/main/mam/workflow/workflow-compiler.ts`
- 修改：`src/main/mam/workflow/workflow-compiler.test.ts`
- 新建：`src/main/mam/review/review-aggregate-node-service.ts`
- 新建：`src/main/mam/review/review-aggregate-node-service.test.ts`
- 修改：`src/main/mam/application/deterministic-node-advancement.ts`
- 修改：`src/main/mam/application/system-node-advancement.ts`
- 修改：`src/main/mam/application/mam-design-proposal-materializer.ts`
- 修改：`src/main/mam/application/mam-design-system-prompt.ts`
- 修改：`src/renderer/src/features/mam/mam-workflow-canvas-model.ts`
- 修改：Workflow Editor 节点面板、Inspector 和 i18n 文件
- 新建：`docs/versions/0.1.17.md`
- 修改：`package.json`、`docs/versions/README.md`

**接口：**
- 产出：`ReviewAggregateNodeSchema`
- 产出：`aggregateReviewGates(input: ReviewAggregateInput): ReviewAggregation`

- [ ] **步骤 1：写 Workflow Schema 和编译失败测试**

覆盖三个不同 Reviewer Role 的 Review Gate 汇入一个 aggregate、不同 producer 拒绝、重复 member 拒绝、quorum 越界拒绝、aggregate 绑定 Role 拒绝。

- [ ] **步骤 2：实现 `review_aggregate` Schema 与编译校验**

节点冻结 member Review Gate ID、per-gate decisions、total quorum、disagreement policy、producer node、revision target 和 max revisions。

- [ ] **步骤 3：实现跨 Gate 确定性聚合**

只读取绑定同一 Review Subject 的 current Review Delivery。按 member node ordinal、slot ID、decision ID 排序；完成顺序不得影响结果 hash。

- [ ] **步骤 4：实现生产者新 revision 的失效传播**

旧 Subject 的未完成 Review Claim 变 stale，已完成 Review 只读保留，aggregate 清空并等待新 Subject 的 Review。

- [ ] **步骤 5：更新 Workflow Editor 与 Design Assistant**

编辑器提供成员 Review Gate、quorum 和分歧策略表单；Design Assistant 在存在不同 Reviewer Role 时生成多个 Review Gate 加一个 `review_aggregate`。

- [ ] **步骤 6：验证多角色并行审核**

三个 Review Task 在不同完成顺序下产生相同 aggregation；一个 `approved` 与一个 `changes_requested` 进入人工分歧流程。

- [ ] **步骤 7：运行 Workflow、Review 和 Renderer 测试**

```powershell
rtk corepack pnpm vitest run src/main/mam/workflow src/main/mam/review src/renderer/src/features/mam
rtk corepack pnpm typecheck
rtk corepack pnpm lint
```

- [ ] **步骤 8：更新 0.1.17 版本档案并提交阶段变更**

---

### 任务 6：完成端到端迁移、验收和文档收口

**版本：** `0.1.18`

**文件：**
- 修改：`src/main/mam/application/mam-attempt-execution-service.real-git.test.ts`
- 修改：`src/main/mam/state-store/git-state-repository.real-git.test.ts`
- 修改：`src/main/desktop-seeded-project.smoke.ts`
- 修改：`docs/acceptance/final-traceability.json`
- 修改：验收 evidence 与生成脚本
- 修改：`README.md`、`README.en.md`
- 修改：`docs/final-reuse-integration-plan.md`
- 修改：`docs/readme/MAM_REQUIREMENTS_DELTA_2026-07-27.md`
- 新建：`docs/versions/0.1.18.md`
- 修改：`package.json`、`docs/versions/README.md`

**接口：**
- 消费：任务 1-5 的所有稳定接口。
- 产出：完整的 MAM2 traceability 和新协议端到端证据。

- [ ] **步骤 1：增加新协议 E2E**

覆盖：双 clone Claim 冲突与接管、旧领取者迟到交付拒绝、100 次本地失败一次交付、应用重启继续、多开发 Task 并行、多 Reviewer Role 并行、返工 revision、Review、merge 和 finish。

- [ ] **步骤 2：验证 legacy Run 重放**

使用本次故障事件形状作为 fixture，确保两个 timeout Attempt 不进入正式交付或 revision 计数，已有 Review 被复用并补出确定性 aggregation。

- [ ] **步骤 3：验证投影可重建和 secret canary**

删除本地 snapshot/cache 后从 Git events 重建相同 state hash；Draft、RPC 和诊断导出均不得包含 secret canary。

- [ ] **步骤 4：更新 README、权威文档和验收追踪**

删除所有“同一 Task 双 Attempt 并发保留”的现行描述，明确 Task 级排他 Claim、强制接管、本地 Draft、正式交付和多角色 Review aggregate。

- [ ] **步骤 5：运行完整验证**

```powershell
rtk corepack pnpm format:check
rtk corepack pnpm lint
rtk corepack pnpm typecheck
rtk corepack pnpm test
rtk corepack pnpm build
rtk corepack pnpm smoke:pi
rtk corepack pnpm smoke:desktop:seeded
rtk corepack pnpm verify:final
rtk git diff --check
```

Windows 上已知 POSIX mode 和 Git fixture 基线失败必须与新回归分开报告；macOS 发布门禁必须在可用环境中重新执行。

- [ ] **步骤 6：更新 0.1.18 版本档案并完成最终代码审查**

使用 `requesting-code-review` 技能检查需求覆盖、竞态、迟到事件、清理边界、Schema 兼容和测试缺口。不得在版本档案或 traceability 缺失时声明完成。
