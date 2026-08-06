# Multi-Agent Max 重构版最终设计与代码复用方案

**版本**：2.2
**日期**：2026-08-04
**状态**：已确认的最终设计基线  
**实施方式**：新建独立程序，从当前 `multi-agent-max` 项目选择性复制代码，不再继续在当前 Orca 项目中裁剪

**需求权威**：本文档是唯一现行产品需求基线；[`MAM_REQUIREMENTS_DELTA_2026-07-27.md`](./readme/MAM_REQUIREMENTS_DELTA_2026-07-27.md) 负责把旧需求逐项映射到本文档，但不建立第二套产品定义。

## 1. 文档目的

本文档把 `design-v1.md`、`design-v2-workflow.md`、`design-v3-distributed-workflow.md`、`design-v4-pi-runtime.md` 与 2026-07-27 的需求确认收敛为一套最终方案，并回答四个问题：

1. 新程序最终是什么产品，不是什么产品。
2. 任意角色、任意工作流、跨机器执行和 Git 合并如何协作。
3. Codex CLI、Grok CLI 和 Pi 如何作为执行后端接入。
4. 当前项目哪些代码直接复制、哪些复制后改造、哪些明确不复制。

本文档取代本文件 1.0 版本、`MAM_COMPLETION_REQUIREMENTS.md` 及原始 v1-v4 文档中的冲突条款，作为后续实现与验收的唯一产品基线。旧文档只保留为需求来源和历史设计依据；所有旧 requirement 和 invariant 的去向必须在需求差异表中可追踪。

## 2. 最终产品定义

Multi-Agent Max 是一个本地运行、Git 驱动、按角色参与工作流的多 Agent 客户端和控制平面。

用户可以：

- 自由创建 Role Profile，不受产品预设角色名称限制。
- 自由创建 Workflow Definition，定义串行、并行、条件、审核、人工审批、返工、动态任务和合并步骤。
- 在 Design Assistant 中使用已有 Model Profile 通过对话设计全新的 Role Profile 和 Workflow Definition，或选择现有 Workflow Definition 生成优化后的下一版本，并在人工确认后创建这些定义。
- 在设计工作流时为每个可执行节点固定一个角色；运行时直接沿用，不再选角或改派。
- 由用户把 Task 人工分配给 Role；在任意机器克隆项目并选择角色后，程序列出该角色已获分配且可执行的任务。
- 在同一台机器同时启动多个 Agent 实例，每个实例可以使用不同角色。
- 为每个角色独立组合 Executor、Provider/Endpoint、模型、Skills、MCP、知识库、工具、权限和预算，不修改全局 CLI 配置。
- 使用 Codex CLI、Grok CLI 或 Pi RPC 执行角色任务。
- 让用户定义的调度者角色审核合并队列、处理冲突，并由确定性的 Scheduler Kernel 执行和记录 Git 操作。

产品本质不是新的 Agent Runtime，也不是远程机器管理平台。它是一个统一控制平面：

```text
Role Profiles + Workflow Definition + Git Repository
                         |
                  Scheduler Kernel
                         |
        +----------------+----------------+
        |                |                |
 Codex CLI Adapter  Grok CLI Adapter  Pi RPC Adapter
        |                |                |
    Codex CLI         Grok CLI        Pi + Model API
```

## 3. 已确认的产品边界

### 3.1 必须支持

- 用户自定义角色，而不是固定的开发者 A/B/C、架构师或审核员。
- 用户自定义工作流图，而不是固定的软件开发流水线。
- 每个可执行工作流节点必须固定一个 Role Profile；运行时生成的 Task 只能使用该角色，并产生独立 Role Instance 和 Executor Invocation。
- 用户运行 Task 时系统直接激活节点固定角色，不显示角色选择或改派入口；如需更换角色，必须创建新的 Workflow Definition 版本并用于新的 Run。
- 一台机器运行多个不同角色或同角色的多个执行实例。
- 有 Git remote 时，多台机器通过同一个 remote 参与同一个 Workflow Run；没有 remote 时，多个角色可以在同一台机器的本地 Git 上协作。
- 任务只绑定角色，不绑定机器。
- 代码任务使用独立 task branch 和 worktree。
- Artifact、Review、Attempt、人工审批、返工和完整事件追踪。
- 审核基于不可变的 Artifact 或 commit SHA。
- 调度者角色按工作流策略处理合并顺序和冲突。
- Scheduler Kernel 独占权威状态写入和受控 Git 操作权限。
- Codex CLI、Grok CLI、Pi RPC 三种结构化执行适配器，以及统一的标准结果 JSON。
- 每个 Role Profile 独立选择可使用的 Skill、MCP Server 和 Knowledge Base。
- Role Instance 不继承全局 Skills/MCP；知识库通过受控只读 Gateway 检索。
- 首期在 macOS 原生运行；实现继续保持可移植边界，Linux 和 Windows 的构建、打包和端到端验收后置。

### 3.2 明确不做

- 不实现或嵌入 jcode Runtime。
- 不实现或嵌入 Grok 内部 Runtime；只调用 Grok CLI 暴露的接口。
- 不实现 Codex Agent 循环；只调用 Codex CLI 暴露的接口。
- 不接入 Claude Code 等额外 Runtime 作为第一版范围。
- 不实现 SSH 文件、终端、Git 或远程 Runtime。
- 不实现 Docker/Podman 容器隔离。
- 不把任务分配给设备，不维护 Device Registry、设备能力、设备心跳或设备恢复。
- 不自动寻找或遥控其他机器。
- 不建设中心调度服务；跨机器协调只使用 Git remote 和 `mam-state` 权威事件。
- 不依赖 GitHub/GitLab hosted API、Issue、PR/MR、Linear 或 Jira。
- 不迁移老版本用户数据；当前没有需要兼容的旧数据。
- 不支持 Role 继承、Session 级配置覆盖或 Executor/Provider/Model 自动 fallback。
- 不创建脱离 Workflow Task 的独立 Agent Session，也不提供独立 Session CRUD 页面。
- 不加载用户 Pi Extension，也不维护 Pi 专属 Scheduler Bridge Extension；Pi 使用统一 Application API。

### 3.3 允许但不成为产品概念

- Codex CLI 或 Grok CLI 自带的权限、sandbox、MCP 或内部 invocation/session 能力可以由对应 Adapter 使用，但内部句柄不是产品权威对象，也不能创建独立 Session 产品。
- Grok CLI 内部使用何种协议属于 Adapter 实现细节，不在产品中暴露通用 ACP Runtime。
- 本机可以记录诊断信息，但机器身份不是权威工作流对象。

## 4. 核心架构原则

### 4.1 角色是策略模板，不是名称枚举

Role Profile 由用户创建，至少包含：

```ts
interface RoleProfile {
  id: string
  version: number
  displayName: string
  executorProfileId: string
  modelProfileId: string
  systemPromptRef: string
  skillBindings: RoleSkillBinding[]
  mcpBindings: RoleMcpBinding[]
  knowledgeBaseBindings: RoleKnowledgeBaseBinding[]
  tools: string[]
  permissions: PermissionPolicy
  budget: BudgetPolicy
  retry: RetryPolicy
  contextPolicy: ContextPolicy
}
```

第一版不支持 Role 继承。Role Profile 必须是完整、独立的策略定义，不包含 `parentRoleId`，也不执行父子约束合并。

“开发专家”“开发者 A”“审核员”“主调度者”都只是用户可能创建的 Role Profile 示例。产品代码、状态机、UI 和测试不得依赖这些名称或固定 ID。

### 4.2 Executor、Provider 和 Model 独立组合

产品采用四层配置，不把 Agent CLI、模型服务和角色合并成一个全局配置：

```ts
interface ExecutorProfile {
  id: string
  version: number
  kind: 'codex-cli' | 'grok-cli' | 'pi-rpc'
  executableRef: string
  adapterOptions: Record<string, unknown>
}

interface ProviderProfile {
  id: string
  version: number
  protocol:
    | 'openai-responses'
    | 'openai-completions'
    | 'anthropic-messages'
    | 'google-generative-ai'
    | 'executor-native'
  baseUrl?: string
  secretRef?: string
  headers?: Record<string, string>
}

interface ModelProfile {
  id: string
  version: number
  displayName: string
  providerProfileId: string
  remoteModelId: string
  capabilities: ModelCapabilities
  defaultInference?: InferenceOptions
}

interface RoleExecutionBinding {
  executorProfileId: string
  modelProfileId: string
  inferenceOverrides?: InferenceOptions
}
```

其中：

- Executor Profile 只描述使用哪个 Agent 客户端以及如何启动它。
- Provider Profile 描述协议、Endpoint 和本机 secret reference。
- Model Profile 描述通过某个 Provider 调用的远端模型 ID 和模型能力。
- Role Profile 选择 Executor Profile 与 Model Profile，并继续叠加角色自己的 prompt、Skills、MCP、工具、权限、预算和上下文策略。

同一个 Executor Profile 可以被多个角色复用，同一个 Model Profile 也可以被多个 Executor 使用。例如：

| 角色示例 | Executor  | Model Profile   |
| -------- | --------- | --------------- |
| A        | Codex CLI | GPT-5.6 SOL     |
| B        | Codex CLI | GPT-5.6 Lunna   |
| C        | Pi RPC    | GPT-5.6 SOL     |
| D        | Pi RPC    | GLM-5.2         |
| E        | Grok CLI  | Grok-4.5        |
| F        | Codex CLI | DeepSeek V4 Pro |

这些名称只是配置示例，不进入产品枚举或硬编码兼容表。产品按照协议和 capability 判断组合是否可运行，而不是根据模型厂商名称限制组合。

Workflow Run 创建时固定 Workflow Definition 和本 Run 可分配的 Role Profile version catalog；Role 的编辑或新增只影响新的 Workflow Run。静态和动态 Task 在创建时分别固定自身定义，后续不能原地改写。

每次启动 Attempt 时，Role Materializer 根据 Run 中固定的 Role Profile 资源白名单，解析当时最新的 Executor、Provider、Model、Skill、MCP 和 Knowledge Base Profile，并生成不可变的 Effective Role Config：

```text
Frozen RoleProfileVersion
  + Current ExecutorProfileVersion
  + Current ProviderProfileVersion
  + Current ModelProfileVersion
  + Local Secret Resolution
  + Skills / MCP / Knowledge Bases / Tools / Policy
  = EffectiveRoleConfigSnapshot
```

Role Instance 启动后，任何 Profile 编辑都不能改变当前 Attempt；新资源版本只对新的 Attempt 生效。Role Profile 本身的编辑仍只对新的 Workflow Run 生效。第一版不支持 Session 级配置覆盖，也不支持 Executor、Provider 或 Model 自动 fallback。

`RetryPolicy` 只能决定是否以同一 Role 边界和同一已解析组合创建新 Attempt；它不能静默替换 Executor、Provider 或 Model。

### 4.3 Skills、MCP 和知识库采用角色白名单

Skills、MCP Server 和 Knowledge Base 是独立注册、由 Role Profile 显式绑定的资源。默认规则是 deny-by-default：未出现在当前角色绑定中的资源不加载、不暴露、不可通过 Scheduler Bridge 调用。

```ts
interface RoleSkillBinding {
  skillId: string
}

interface RoleMcpBinding {
  serverProfileId: string
}

interface RoleKnowledgeBaseBinding {
  knowledgeBaseProfileId: string
}
```

授权粒度：

- Skill：按稳定 Skill ID 和版本授权，运行时锁定内容摘要。
- MCP：按 Server Profile 授权。角色勾选服务器后即可使用该服务器提供的 tool、resource 和 prompt，不再配置第二层允许列表。
- Knowledge Base：按 Knowledge Base Profile 授权。角色勾选后默认可搜索和读取；第一版保持只读，不允许 Agent 修改索引或源内容。
- 未选择的 Skill、MCP Server 或 Knowledge Base 不物化、不暴露，Gateway 拒绝并审计越权请求。

Role Instance 启动时必须禁用 Executor 自动发现的全局 Skills 和 MCP 配置，只物化当前角色的绑定。任意全局 `~/.codex`、`~/.grok`、Pi 或通用 Agent 配置都不能被隐式继承。

知识库定义与具体执行器解耦：

```ts
interface KnowledgeBaseProfile {
  id: string
  version: number
  displayName: string
  kind: 'project-files' | 'local-directory' | 'git-repository' | 'vector-store' | 'mcp-resource'
  sourceRef: string
  credentialRef?: string
  indexRevision?: string
  metadata?: Record<string, string>
}
```

Scheduler 通过统一的只读 Knowledge Gateway 向角色提供 `knowledge.search` 和 `knowledge.read`，而不是把向量数据库凭证或任意文件系统路径直接交给 Agent。Gateway 校验 Role Instance 和 Knowledge Base binding，应用系统统一的检索上限，并记录查询审计事件。

项目文件和 Git 仓库型知识库可以随 repository 在多台机器使用；本地目录或需要凭证的知识库由每台机器配置 Local Knowledge Binding。角色勾选的知识库在本机不可用时，该角色不能启动 Attempt，不能静默假装已加载。

每个 Attempt 记录实际解析到的 Executor、Provider、Model、Skill digest、MCP Profile version、Knowledge Base Profile version 和 index revision。资源在运行中更新，只影响新 Attempt；Run 中固定的 Role 资源选择不随之扩大。

### 4.4 工作流决定何时使用角色

Workflow Definition 是带版本的执行图。每个可执行角色节点引用且只引用一个角色；需要多个不同角色时使用多个节点。系统节点和人工节点不绑定角色。

第一版正式支持的节点类型：

| 节点类型             | 作用                                             |
| -------------------- | ------------------------------------------------ |
| `role_task`          | 生成绑定节点固定角色的普通 Task                  |
| `dynamic_tasks`      | 根据结构化任务计划创建多个固定角色 Task          |
| `review_gate`        | 生成绑定节点固定审核角色的一个或多个 Review Task |
| `approval_gate`      | 等待用户人工决定                                 |
| `human_review_gate`  | 人工审阅不可变产物、沟通返工要求并决定是否放行   |
| `condition`          | 根据结构化输出选择路径                           |
| `parallel`           | 启动多个可并行分支                               |
| `join`               | 等待指定分支汇合                                 |
| `artifact_transform` | 受控地整理或合并 Artifact                        |
| `command`            | 执行经过策略校验的本地命令                       |
| `git_merge`          | 由指定协调角色驱动，内核执行受控合并             |
| `finish`             | 完成 Workflow Run                                |

工作流允许显式返工和循环，但每条回退路径必须配置最大次数或总转换次数。无边界循环在保存时被拒绝。

`human_review_gate` 不绑定 Role。编辑器默认把受审 Artifact 的固定上游角色节点写入 `revisionTargetNodeId`；若输入来自多个生产节点则必须显式选择，不能由运行时猜测。用户选择 `changes_requested` 时意见必填，门禁先创建与原 Task 和最新不可变 Review Subject 绑定的返工沟通，原角色只能读取上下文并提问；用户确认“要求已沟通清楚”后，Scheduler 才为原 Task 创建带 lineage 的新 Attempt。`approved` 才解锁下游，达到 `maxRevisionAttempts` 后进入 blocked。

### 4.5 工作流角色与 Scheduler Kernel 必须分离

用户可以创建一个“主调度者”或任何其他名称的角色，并把它固定配置为 `role_task`、`review_gate` 或 `git_merge` 节点的角色。节点生成具体 Task 后直接沿用该绑定，不再要求用户选择角色。该角色可以：

- 分析依赖和完成时间。
- 建议下一项合并。
- 阅读提交和审核 Artifact。
- 生成冲突解决方案。
- 在允许的集成 worktree 中修改代码并提交冲突解决结果。

Scheduler Kernel 是不调用模型的确定性程序，负责：

- 计算可执行节点。
- 校验角色和 Artifact 契约。
- 记录 task execution claim 提示并检测可能的重复执行。
- 执行状态转换。
- 校验调度者角色提出的操作。
- 执行 Git fetch、branch、worktree、commit、merge 和 push。
- 写入权威事件并重建 projection。

Agent 只能提交请求和证据，不能直接把任务标记为 `approved`、`merged` 或 `completed`。

## 5. 领域模型

### 5.1 定义对象

```text
Project
  -> RoleProfileVersion[]
  -> ExecutorProfileVersion[]
  -> ProviderProfileVersion[]
  -> ModelProfileVersion[]
  -> SkillDefinitionVersion[]
  -> McpServerProfileVersion[]
  -> KnowledgeBaseProfileVersion[]
  -> WorkflowDefinitionVersion[]

WorkflowDefinitionVersion
  -> WorkflowNode[]
  -> WorkflowEdge[]
  -> ArtifactContract[]
  -> LoopPolicy[]
```

Role、Executor、Provider、Model、Skill、MCP、Knowledge Base 和 Workflow Definition 都是可复用、带版本的定义。Workflow Run 和 Attempt 保存实际使用配置的快照或内容 hash；修改定义不改变正在运行的实例。

快照分为两层：Workflow Run 固定 Workflow Definition 及其节点绑定的 Role Profile version catalog，Task 在创建时固定自身定义和节点角色；Attempt 在启动时解析该固定角色当前最新的资源 Profile，并固定 `EffectiveRoleConfigSnapshot`。Role 编辑或新增只影响新 Run，资源 Profile 编辑只影响新 Attempt。

### 5.2 运行对象

```text
WorkflowRun
  -> NodeRun[]
      -> Task[]
          -> FixedRoleBinding
          -> ExecutionClaimNotice[]
          -> Attempt[]
              -> RoleInstance
              -> ExecutorInvocation
              -> ArtifactVersion[]
              -> ReviewDecision[]
              -> GitChange?
```

关键对象职责：

- `Task`：由工作流节点固定角色并等待执行的工作单元。
- `FixedRoleBinding`：Task 从 Workflow Definition 继承的唯一 Role Profile；启动时可记录内部激活事件，但不是用户可选择的派发。
- `ExecutionClaimNotice`：某个临时 Agent 实例声明正在执行 Task 的非排他提示，不授予执行资格，也不充当并发锁。
- `Attempt`：一次不可覆盖的执行尝试。
- `RoleInstance`：Role Profile 在某个 Attempt 中的配置快照。
- `ExecutorInvocation`：某个 Attempt 内部的结构化进程/RPC 调用及 opaque handle，不是独立产品对象。
- `ArtifactVersion`：跨节点传递的正式结果。
- `GitChange`：代码任务的 base、branch 和 submitted commit。

### 5.3 固定角色绑定不包含设备，也不可改派

```ts
interface TaskRoleBinding {
  taskId: string
  roleProfileId: string
  roleProfileVersion: number
  workflowNodeId: string
  activatedAt?: string
}
```

固定角色绑定中不得出现 `deviceId`、`machineId` 或远程连接信息。每个可执行节点的
`recommendedRoleProfileIds` 与 `allowedRoleProfileIds` 兼容字段都必须只含同一个 Role ID；
它们不表示运行时候选集。Task 创建后继承该唯一角色，任何 `reassign_task` 命令都必须被
拒绝。更换节点角色只能保存新的 Workflow Definition 版本并创建新的 Run；历史 Run、
Attempt、Role Instance 和 Effective Config Snapshot 始终保持不变。

### 5.4 Execution Claim 是绑定实例的非排他提示

```ts
interface ExecutionClaimNotice {
  claimId: string
  workflowRunId: string
  taskId: string
  roleProfileId: string
  executorInstanceId: string
  attemptId: string
  announcedAt: string
  lastObservedAt?: string
  releasedAt?: string
  revision: string
}
```

Claim 只解决可见性问题：

- 当另一 Agent 已经声明执行同一 Task 时，UI 和 CLI 显示明确 warning。
- 同一机器或多台机器上的多个 Agent 可以看到当前活跃的执行提示。

Task 的执行角色只来自 Workflow 节点的固定绑定。用户点击“运行任务”时，系统使用该角色完成预检和内部激活后直接创建 Attempt。Claim 不排他、不拒绝第二个 Attempt、不产生 fencing token，也不能改变角色绑定。实现可以 best-effort 刷新 `lastObservedAt`，只用于把提示显示为 active/stale；刷新失败不能阻止、终止或接管 Attempt。如果仍发生重复执行，系统保留所有 Attempt、发出 warning，并要求用户选择后续采用的 Attempt，不能静默覆盖历史。

## 6. 角色参与和任务执行

### 6.1 启动入口

桌面 UI 和 CLI 使用同一 Application API。CLI 形式示例：

```bash
mam join --run run-20260727-001 --role role.frontend
mam join --run run-20260727-001 --role role.reviewer
mam join --run run-20260727-001 --role role.merge-coordinator
```

启动后程序执行：

1. 定位 Git repository，并检测是否配置 Git remote。
2. 有 remote 时同步 `mam-state` 权威状态分支；无 remote 时使用本地 `mam-state` 分支。
3. 验证 Workflow Run 和 Role Profile 是否存在。
4. 在本机解析该角色的 Executor Profile、CLI、模型和 secret references。
5. 计算节点固定为该角色且依赖已满足的任务。
6. Scheduler 默认选择依赖已满足且固定角色的 Task，直接使用节点绑定角色创建 Attempt，并写入非排他的 claim notice。如果已有活跃提示，记录 warning；用户可以在 UI 中人工重试或接管。
7. 创建 Attempt、Role Instance、worktree 或只读工作区。
8. 启动对应 Adapter。

如果角色同时有多个可执行任务，UI 显示任务列表；CLI 默认选择 `priority`、`readyAt`、`taskId` 排序后的第一项，也允许通过 `--task` 显式选择。

### 6.2 静态节点与动态任务的固定角色

系统支持两种任务来源，两者在进入可执行状态前都必须已经有且只有一个固定角色：

1. `role_task`、`review_gate` 和 `git_merge`：Workflow Definition 在设计时固定角色，节点 ready 后生成绑定该角色的 Task。
2. `dynamic_tasks`：规划节点固定一个角色；其结构化 Task Plan 中的每个 Task 也必须固定一个角色，Scheduler 校验后生成 Task。

兼容字段 `recommendedRoleProfileIds` 和 `allowedRoleProfileIds` 必须是包含同一个 Role ID 的单元素数组。Scheduler 在自动启动或用户人工重试时都可以记录内部 `task_assigned` 激活事件以保持事件兼容，但角色值只能从节点绑定派生，不能接受用户选择或 Agent 推荐，也不得生成 `task_reassigned`。

### 6.3 同一角色的并发

同一 Role Profile 可以由多个 Agent 实例同时执行不同 Task。产品不使用 `maxParallelClaims` 作为排他控制，也不承诺一个 Task 只有一个 Claim；固定角色绑定和执行提示共同帮助用户识别执行状态。

## 7. 工作流执行语义

### 7.1 Node Run 状态

```text
created
  -> waiting_dependencies
  -> waiting_role_activation
  -> ready
  -> running
  -> waiting_for_human_input
  -> resuming
  -> validating_output
  -> submitted
  -> in_review
  -> approved / changes_requested
  -> passed / failed / blocked / cancelled
```

不是所有节点都会经历全部状态。系统节点通常从 `ready` 直接进入 `running` 和 `passed`。

### 7.1.1 角色原生人机澄清

每个角色 Task 都具有不可移除的 `clarify_if_needed` 能力。角色应先从 Task、Artifact、代码、知识库和项目规范中查明事实；缺少会实质改变结果的信息、要求冲突、多种方案会产生明显差异或涉及不可逆影响时，必须调用统一 Application API 提交问题批次，不得猜测。默认只暂停当前 Task 及其依赖下游，无依赖并行分支继续；影响整个 Run 的问题必须显式声明 run scope。

一批最多包含五个相互独立的问题。决策问题提供二至三个方案、取舍、唯一推荐方案和理由，并允许自定义答案；纯事实问题使用自由文本，不为满足数量而伪造方案。用户可以逐项选择或采用全部推荐后批量提交。角色收到答案后可以提出下一批问题，也可以提交最终理解摘要；一旦开启沟通，只有用户确认摘要后才能恢复 Attempt，超时不能自动回答或自动继续。

用户认为理解摘要仍不准确时，可以填写补充意见要求继续澄清；角色收到补充意见后继续提问或重新提交摘要，Task 保持暂停。详细交互、状态与验收场景见 [`HUMAN_REVIEW_AND_CLARIFICATION_DESIGN.md`](./readme/HUMAN_REVIEW_AND_CLARIFICATION_DESIGN.md)。

沟通是 `Workflow Run -> Node Run -> Task -> Attempt` 下的权威记录，不建立独立 Session 产品。一个逻辑 Attempt 可以由多个 Executor Invocation segment 组成；它们共享固定 Role、Effective Config Snapshot、worktree 和消息记录。Adapter 内部 continuation/session handle 不是产品权威对象，进程无法原地继续时以新 segment 注入完整记录，不得换 Executor、Provider 或 Model。

### 7.2 Attempt 规则

- 每次执行都创建新 Attempt。
- 返工、进程崩溃后重新执行、Executor 重启后无法恢复 invocation、审核后产生新 commit，均创建新 Attempt。
- Attempt 启动前必须持久化 `EffectiveRoleConfigSnapshot` 及其 hash；快照不得包含 secret value。
- Executor 必须产生符合统一 JSON Schema 的结果对象；缺失或校验失败时 Attempt 不能进入 `submitted`。
- 已提交的 Artifact 和 commit SHA 不可修改。
- 新 Attempt 通过 `previousAttemptId` 形成 lineage。
- 工作流推进只读取当前有效 Attempt；历史 Attempt 永久可查。
- timeout 或进程退出不等于外部命令未执行。对于无法确认的非幂等副作用，Task 进入 `needs_reconciliation`，等待查询或人工处理，不自动重试。
- 用户完成人工核对并填写原因后，可以把原 Attempt 标记为 blocked 并创建唯一的 `recovery_planned` Attempt；同一 Task 的新恢复计划会封存旧计划，其他并发 Attempt 成功提交也会封存尚未启动的恢复计划。后续人工启动必须复用唯一计划的 Attempt ID 和 `previousAttemptId`，不能另建一个脱离恢复链路的 Attempt。
- Attempt 被恢复或进入 `needs_reconciliation` 后，其迟到的 Executor progress/result 必须被拒绝；Task 处于 `needs_attention` 时，其他并发 Executor 也不能用迟到事件覆盖人工核对状态。

### 7.2.1 清理 Run 与复用已完成成果

- “清理并继续”取消当前 Run 并从相同 Workflow Definition 版本和相同外部输入创建新 Run；旧 Run、Attempt、Artifact、Review 和 Git commit 保持不可变，不执行物理删除。
- 每次创建同一 Workflow 的新 Run 时，Scheduler 检查历史 Run。只有 `definitionId`、`definitionVersion`、`planHash` 和输入 Artifact 引用完全一致，且来源 Attempt 已提交、提交 commit 与 Attempt branch 仍可由当前项目 Git 解析时，才允许复用静态 `role_task` 成果。
- 复用必须写入独立的权威事件，记录来源 Run、Node、Task、Attempt 和证据 ID；UI 必须明确标记复用来源，不能把它显示成一次新的 Agent 执行。
- 来源 Task 已审核通过时，可以复用绑定同一不可变 Attempt 的已通过 Review node；Approval gate 不自动复用。动态任务计划、冲突处理和无法验证 Git 提交的结果必须重新执行。
- 复用后的 Task 恢复为 `submitted`，或把来源 `approved`/`completed` 成果恢复为可重新交付的 `approved`，不消耗新的 Agent token；后续合并等未完成节点继续按正常 Workflow 规则推进。

### 7.3 Artifact 契约

节点输入和输出通过显式 Artifact Contract 连接，不依赖跨角色共享聊天记录。

Artifact 至少记录：

```text
artifactId
artifactType
version
contentHash
workflowRunId
nodeRunId
taskId
attemptId
roleInstanceId
createdAt
contentRef
```

小型 JSON/Markdown Artifact 可以存入状态分支；代码通过 Git commit 引用；大型日志保存在本地诊断目录，只把摘要、hash 和可用位置写入事件。

每个 Attempt 生成一个不可变的标准结果对象。Agent 填写完成状态、摘要、验证结果、风险、待处理事项和产物声明；MAM 填写并校验 Run、Node、Task、Attempt、Role、Executor invocation、commit、时间和内容 hash 等权威字段。`submitted` 只是完成请求，只有 Kernel 校验结果 Schema、Artifact Contract 和 GitChange 后才能推进状态。

```ts
interface AttemptResult {
  schemaVersion: '1.0.0'
  status: 'submitted' | 'blocked'
  summary: string
  verifications: Array<{
    command: string
    status: 'passed' | 'failed' | 'not_run'
    summary?: string
  }>
  risks: string[]
  followUps: string[]
  artifacts: Array<{
    contractId: string
    type: string
    contentRef: string
    sha256: string
  }>
  system: {
    workflowRunId: string
    nodeRunId: string
    taskId: string
    attemptId: string
    roleInstanceId: string
    executorInvocationId: string
    effectiveConfigHash: string
    submittedCommit?: string
    createdAt: string
  }
}
```

正式输入输出、Task Plan、Review、Approval、GitChange 和 merge result 必须进入 Git。大型原始日志、trace、截图和临时二进制可以只保存在本机，但 Git 中必须记录摘要、hash、大小、producer、retention 和 availability；任何后续节点必需读取的内容不得只存在本机。

权威 Attempt、进入 Git 的 Artifact 及其元数据永久保留；本地诊断对象按显式 retention 清理。审核默认打开最新 Attempt，也可以从时间线只读打开旧 Attempt；代码比较使用 base/submitted commit 的 Git diff。首期不实现 Artifact 与 Artifact 的专用并排比较界面。

### 7.4 Review 语义

- Review 必须指向确定的 Attempt、Artifact hash 或 commit SHA。
- Reviewer 输出结构化 `approved`、`changes_requested` 或 `blocked`。
- 多 Reviewer 的数量、最小提交数、聚合策略和冲突处理由节点配置。
- 被审核对象产生新版本后，旧 Review 自动失效。
- 审核分歧按工作流配置进入更多 Review、人工审批或 blocked，不由模型伪造用户决定。

### 7.5 统一待我处理队列

人工审核、角色问题批次、返工沟通和 Run 级阻塞问题统一投影为 Human Attention Item。列表先显示类型、角色、Workflow/Task、问题摘要、影响范围、阻塞节点数和等待时间，点击后在独立 Dialog 内完成多轮沟通。权威排序依次为 Run 级影响、被阻塞节点数降序、创建时间升序和稳定 ID；模型只能说明阻塞原因，不能决定自身优先级。

问题、方案、推荐、回答、理解摘要、补充意见、用户确认和时间均以 append-only Git 事件保存。未提交的本地表单草稿不是权威状态。对话框关闭不会解决事项；只有用户确认沟通完成、完成审核决定或显式阻塞/取消后，事项才离开待处理队列。

## 8. Git 状态同步设计

### 8.1 三类分支

```text
develop                                  # 默认集成分支，可由项目配置覆盖
mam/task/<run-id>/<task-id>/<attempt>     # 代码任务分支
mam-state                                # 工作流权威状态分支
```

任务代码和工作流状态不能写在同一分支。每个本地克隆为 `mam-state` 创建独立隐藏 worktree，例如 `.mam-local/state-worktree`，业务 task worktree 不直接包含权威状态写目录。

项目业务分支尚无首个 commit 时，桌面端必须能够初始化独立 `mam-state`，且不得创建或移动项目业务分支的 `HEAD`，也不得提交用户已暂存文件。有 remote 时，初始化必须验证 remote 并推送状态分支；无 remote 时只创建本地状态分支。用户明确启动首个需要项目 worktree 的 Attempt 时，若项目仍完全为空且工作树干净，程序创建不包含用户文件的首个空 commit；若存在 staged、modified 或 untracked 文件，则返回 `project_initial_commit_required`，由用户决定首个 commit 内容。

### 8.2 状态目录

为最大化复用当前实现，继续使用 `.workflow/` 目录：

```text
.workflow/
  roles/<role-id>/<version>.json
  executors/<executor-id>/<version>.json
  providers/<provider-id>/<version>.json
  models/<model-id>/<version>.json
  skills/<skill-id>/<version>.json
  mcp/<server-profile-id>/<version>.json
  knowledge-bases/<knowledge-base-id>/<version>.json
  definitions/<workflow-id>/<version>.json
  project/config.json
  runs/<run-id>/
    events/<event-id>.json
    attempts/<attempt-id>/effective-config.json
    attempts/<attempt-id>/result.json
    artifacts/<artifact-id>/<version>.*
    snapshots/summary.json
```

Snapshot 是可删除并通过 events 重建的缓存。Event 是 append-only 权威记录。本机 executable path、CLI 登录、secret resolution 和本地知识库路径只能写入 `.mam-local/`，不得进入共享 Profile 或 Git。

所有 Profile version 文件不可变；当前 active version 由权威事件选择并投影。Run Role Catalog 和 Attempt Effective Config 都必须保存精确 version 与内容 hash，不能在 replay 时重新解释“latest”。

### 8.3 并发写入

每个本地 Scheduler 都可以向 `mam-state` 提交合法命令，但只有 Scheduler Kernel 可以生成事件。写入算法：

1. 有 remote 时 fetch 最新 `mam-state`；本地模式直接读取本地状态分支。
2. 重建 Workflow Run projection。
3. 根据当前 revision 校验命令。
4. 生成事件并提交到本地 state worktree。
5. 有 remote 时 push `mam-state`；本地模式保留本地提交。
6. 仅 distributed 模式在 non-fast-forward 时丢弃本次未发布状态提交，更新远端状态并重新校验同一幂等命令。
7. 同一 Task 的多个 claim notice 都可以提交和 replay；projection 产生 `concurrent_execution_warning`，但不拒绝命令。

状态事件使用稳定 `commandId` 做幂等控制。Git 冲突和业务状态冲突必须分别报告。

Kernel 一次命令产生的 Event Batch 必须作为事务单元暂存、整体校验并在一个 Git commit 中发布。Distributed 模式只有已经 push 的 commit 是共享权威；本地模式的本地状态分支提交即为权威。进程崩溃遗留的未提交文件必须由恢复流程清理，不能被 replay。non-fast-forward 后必须丢弃 stale commit，在最新 projection 上重新执行原命令，不能只 rebase 已生成的旧事件。人工 conflict resolution 必须真实应用、提交并消费 resolution batch。

### 8.4 不依赖 hosted provider

该协议只依赖标准 Git branch、worktree 和 commit；配置 remote 时额外使用 clone、fetch 和 push 作为共享媒介，不调用 GitHub/GitLab API。没有 remote 的项目保持本地协作模式。

## 9. 代码任务、审核和合并

### 9.1 代码任务工作区

只有声明 `workspaceMode: write` 的节点创建 task branch 和 worktree。只读审核节点可以使用临时 detached worktree，非代码节点不创建分支。

每次代码 Attempt 记录：

```ts
interface GitChange {
  repositoryId: string
  baseBranch: string
  baseCommit: string
  taskBranch: string
  submittedCommit?: string
  worktreeRef?: string
}
```

task branch 属于 Task/Attempt，不属于 Role。一个角色可以执行多个任务，不会共享固定角色分支。

### 9.2 提交和审核顺序

1. 执行角色完成代码和测试。
2. Scheduler 验证 worktree、输出契约和 submitted commit。
3. 有 remote 时将 task branch 推送到 remote；本地模式保留 task branch 和提交在本地。
4. Task 进入 `submitted`。
5. Review 节点审核确定的 commit SHA。
6. Review 通过后进入工作流定义的后续节点或 merge queue。

Review 通过后如果 task branch 出现新 commit，原 Review 失效并回到审核节点。

新 commit 同时清除旧的 merge-ready 状态；重新满足审核和验证条件时生成新的、对该 ready revision 不可变的 `mergeReadyAt`。

### 9.3 调度者角色和 merge queue

`git_merge` 节点配置协调角色、目标分支、排序规则、验证命令和冲突策略。例如：

```yaml
- id: integrate-approved-work
  type: git_merge
  recommendedCoordinatorRoleProfileIds:
    - role.merge-coordinator
  targetBranch: develop
  orderBy: merge_ready_at
  strategy: no_ff
  conflictPolicy: coordinator_attempt
  validations:
    - pnpm test
```

默认行为：

1. 只选择已满足该 merge node 前置条件且 Review 有效的提交。
2. 按 `mergeReadyAt`、`taskId` 稳定排序。只有当前 commit 的必需 Review、Approval 和 validation 全部有效时才设置 `mergeReadyAt`。
3. 每次只处理一个提交。
4. 更新目标分支后尝试合并。
5. 无冲突时执行 `git_merge.validations` 中的可执行命令并推送目标分支；该字段不得填写自然语言审核清单，没有可执行检查时使用空数组。
6. 有冲突时创建绑定 merge 节点固定协调角色的 conflict-resolution Task；用户点击运行后创建 Attempt。
7. 调度者角色在独立 integration worktree 解决冲突并提交。
8. Scheduler 校验结果、运行测试并完成 push。
9. 无法解决时按工作流进入返工、人工审批或 blocked。

`approval_gate` 只有在执行图中的全部前置节点通过后才进入可确认状态；UI 不得提前展示可操作按钮，Kernel 也必须拒绝尚未 ready 的审批命令。Merge Queue 发布必须捕获待运行的 post-merge 命令策略，实际命令由隔离的 integration worktree 在合并后、push 前执行，不依赖上游 Agent 自报同名 verification。历史定义中误填的自然语言 validation 作为非命令清单忽略，以避免已审核 Run 永久停滞；新的设计提案必须阻止此类定义。

调度者角色决定和解释如何解决冲突；Scheduler Kernel 控制 Git 命令、目标分支、状态写入和最终验证。

## 10. Executor Adapter 设计

### 10.1 统一接口

沿用当前 Runtime Adapter 的结构，但把产品术语收敛为 Executor Adapter：

```ts
interface ExecutorAdapter {
  readonly kind: 'codex-cli' | 'grok-cli' | 'pi-rpc'
  getCapabilities(): Promise<ExecutorCapabilities>
  validate(config: EffectiveRoleConfig): Promise<ValidationResult>
  start(config: EffectiveRoleConfig): Promise<ExecutorInstance>
  reconnect?(config: EffectiveRoleConfig, invocationRef: string): Promise<ExecutorInstance>
  send(instance: ExecutorInstance, input: ExecutorInput): AsyncIterable<ExecutorEvent>
  steer(instance: ExecutorInstance, input: ExecutorInput): Promise<void>
  abort(instance: ExecutorInstance): Promise<void>
  dispose(instance: ExecutorInstance): Promise<void>
  getUsage(instance: ExecutorInstance): Promise<ExecutorUsage>
}
```

Adapter 负责翻译协议和事件，不决定工作流状态。

正式执行通道必须是 CLI 或 API 提供的结构化机器接口，例如 JSON/JSONL、RPC 或有 Schema 的结果文件。PTY/TUI 只能用于实时观察或人工接管；终端 idle、屏幕末尾文本、自然语言中的“已完成”和单独的退出码都不能成为完成协议。没有结构化接口的 Executor 在首期不得自动执行。

### 10.2 组合兼容性和配置隔离

“自由组合”表示产品不维护 `Codex 只能使用 OpenAI 模型` 之类的厂商硬编码规则，但实际启动仍必须满足 Executor 的真实能力。每个 Adapter 必须报告：

```ts
interface ExecutorCapabilities {
  supportedProtocols: string[]
  supportsCustomEndpoint: boolean
  supportsModelOverride: boolean
  supportsPerInstanceConfig: boolean
  supportsPerInstanceCredentials: boolean
  supportsSkills: boolean
  supportedMcpTransports: string[]
  supportsKnowledgeGateway: boolean
  supportsStructuredOutput: boolean
  supportsInvocationReconnect: boolean
}
```

校验分三层：

1. Definition validation：所有 Profile 引用存在，字段和 Artifact 契约合法。
2. Capability validation：Executor 支持目标 Provider protocol、custom endpoint、model override、Skill/MCP 物化和 Knowledge Gateway 等角色要求的能力。
3. Local preflight：本机存在对应 CLI/Runtime、版本满足要求、凭证和角色已选择的知识库可解析，并能构造该组合的隔离启动配置。

配置可以作为 draft 保存，但 capability 或 local preflight 不通过时不能启动 Attempt。错误必须指出具体原因，例如 `custom_endpoint_unsupported`、`model_override_unsupported`、`secret_unavailable`，不能笼统报告 Runtime 启动失败。

为支持 A/B/F 三个角色同时使用 Codex CLI 但选择不同 Provider/Model，Adapter 不得改写用户的全局 Codex/Grok 配置。启动时按 Attempt 创建独立配置目录、环境变量和 invocation 目录，并将需要的只读登录材料或 secret reference 物化到该实例。如果某个 CLI 只能读取全局配置且不能安全隔离，Adapter 必须阻止这些不兼容组合并发运行，而不是串改全局状态。

### 10.3 Codex CLI Adapter

- 调用用户本机安装和登录的 Codex CLI。
- 使用 Codex CLI 的结构化 headless 命令或 app-server 协议，读取机器事件、turn 生命周期和最终结果。
- 为每个 Role Instance 构造独立 prompt、工作目录、Provider/Model 参数和本地配置目录。
- 支持 CLI 实际允许的 model override 和 OpenAI-compatible/custom endpoint 组合；不按模型品牌做限制。
- 可选交互模式只作为可观察和人工接管入口，接管后仍必须提交标准 Attempt Result。
- CLI 事件结束或进程退出只产生 completion candidate，仍需 Scheduler 校验标准结果、Artifact 和 GitChange。

### 10.4 Grok CLI Adapter

- 调用用户本机安装和登录的 Grok CLI。
- 只接入 Grok CLI 经验证的结构化非交互接口；如果当前版本没有机器接口，preflight 返回 `structured_interface_unavailable`，不得通过解析 TUI 文本回退。
- Grok 内部协议仅作为实现细节；产品不注册通用 Grok Runtime 或 Grok 工作流状态。
- Provider 和 Model 是否可覆盖由 Grok CLI capability 决定；原生 Grok 模型与可覆盖模型使用同一 Role binding 结构。
- Skills、MCP、权限参数只在 CLI 确实支持并通过 capability preflight 时注入。

### 10.5 Pi RPC Adapter

- 复用当前 `PiRuntimeAdapter`、事件归一化和 RPC 日志，通过统一 Executor Adapter 与标准 Attempt Result 契约接入。
- 每个 Attempt 使用独立配置目录和 invocation 目录。
- Pi 通过 Role 绑定的 Provider Profile、Model Profile 和本机 secret reference 调用模型，可同时运行不同 Provider/Model 的角色。
- 移除容器 launcher 和 container bundle，只保留 host process 模式。
- 不保留 Pi 专属 Extension、独立 Agent Session 产品或 Session override；Pi 与 Codex/Grok 通过相同 Application API 请求 Scheduler 能力。

### 10.6 本机配置解析

Role Profile 和 Workflow Definition 可以通过 Git 共享，但 secret 和登录状态只存在本机：

```text
Shared Role Profile
  -> executor / model / skill / MCP / knowledge-base bindings / capability requirements

Shared Model Profile
  -> provider profile / remote model id / model capabilities

Local Executor Binding
  -> executable path / CLI account / secretRef resolution / isolated config directory

Local Knowledge Binding
  -> local source path / database endpoint / credentialRef resolution / index availability
```

本机缺少对应 CLI、登录、secret 或角色已选择的知识库时，preflight 返回 `local_executor_unavailable` 或 `required_knowledge_base_unavailable`；任务保持已分配、待执行状态，不得写成任务失败，也不影响用户在其他机器启动执行。

## 11. 权限与安全边界

第一版不承诺 OS 级隔离。安全边界包括：

- MAM Bridge/Gateway 和 Scheduler 受控命令端口只允许当前写任务访问自己的 worktree 和显式只读输入。
- 权威 `.workflow` state worktree 不暴露给 Worker Agent。
- Worker 通过 Scheduler Bridge 提交请求，不能直接写事件。
- Executor 使用独立配置目录启动，不继承全局 Skill、MCP 或知识库配置。
- Role Profile 保留文件、命令、网络、MCP 和知识库的 allow/deny/approval 策略。
- 对未选择 MCP Server 或 Knowledge Base 的请求在 Gateway 层拒绝并记录审计事件。
- secret 通过本机 secret reference 解析，不写入 Git、Artifact、日志或 prompt dump。
- 诊断事件在落盘前进行凭证脱敏。
- 危险 Git 操作、目标分支 push 和人工审批只能由 Scheduler Kernel 的专用端口执行。
- 可以利用 Codex/Grok/Pi 自带权限机制，但不能把其可用性当作跨 Adapter 的统一安全保证。

需要从 Role schema 删除 `sandbox.mode = container`。可以保留 `executionPolicy` 表达产品层限制，但不得把它描述为容器或 OS 沙箱。

这里的“超出的不可以使用”是 MAM 能力层保证：系统不物化、不注入、不路由，并拒绝通过 MAM Bridge/Gateway 发起的越权请求。由于本方案明确不使用容器或其他 OS 级隔离，如果给 Agent unrestricted shell 权限，MAM 无法保证它不能直接读取当前操作系统用户本来就有权限读取的其他文件。若未来要求安全意义上的系统级不可访问，必须增加 CLI 原生 sandbox、独立 OS 用户或容器等更强边界；不能仅靠 Role 配置宣称已实现。

## 12. UI 与操作入口

新程序首屏就是工作流操作台，不保留 Orca 的营销页、Issue/PR、浏览器、移动端或自动化入口。

主要页面：

| 页面             | 核心能力                                                                                                              |
| ---------------- | --------------------------------------------------------------------------------------------------------------------- |
| Roles            | 创建、复制、版本化 Role Profile；独立组合 Executor、Provider、模型、Skills、MCP、知识库和策略                         |
| Design Assistant | 选择已有 Model Profile，通过本地保存的对话草稿生成、检查和人工确认全新定义，或优化现有 Workflow 的下一版本            |
| Workflows        | 编辑节点、边、Artifact、角色绑定、动态任务、循环保护和合并策略                                                        |
| Runs             | 查看图状态、ready tasks、节点固定角色、执行提示、attempts、成本和阻塞原因；使用固定角色直接运行或恢复中断执行         |
| My Role          | 选择本机参与角色，查看工作流固定给该角色的任务；启动前显示重复执行 warning，不提供 Task 角色选择或改派                |
| Task             | 查看输入、结构化执行事件、Artifact、Git diff、提交、Attempt 时间线和返工记录；默认打开最新 Attempt，历史 Attempt 只读 |
| Reviews          | 提交结构化审核结果，处理多 Reviewer 分歧                                                                              |
| 待我处理         | 按确定性优先级集中处理人工审核、角色问题批次、返工沟通和 Run 级阻塞问题；在独立 Dialog 中批量回答并确认恢复           |
| Merge Queue      | 调度者角色查看顺序、冲突、验证和 merge lineage                                                                        |
| Resources        | 管理 Skill Registry、MCP Server Profile 和 Knowledge Base Profile                                                     |
| Settings         | 管理 Executor、Provider/Endpoint、Model Profile、本机 secret/local bindings、Git 和默认目录                           |

Design Assistant 是定义设计入口，不是独立 Agent Session，也不是 Workflow 权威状态。对话草稿以未加密 JSON 保存在本机，不写入 Git；模型只能引用当前已注册的 Executor、Model、Skill、MCP Server 和 Knowledge Base。Design Assistant 必须支持多轮头脑风暴：每轮最多提出一个只涉及业务意图的必要问题；澄清充分后提供二至三个有实质差异且包含取舍的方案；按角色与职责、工作流与交接、审核/失败/验证三个以上部分给出结构化建议。方案比较、设计分段和风险提示都是可选的协作信息，不要求用户逐项确认；用户可以在认为合适时直接确认当前完整替换方案。模型不得伪造方案选择或确认；若用户主动选择方案或提出修改，助手应记录并持续更新草稿。模型还应指出当前方案的缺陷并记录显式假设；未解决的问题和缺陷应在界面中清晰提示，但不阻止人工确认。每次模型响应仍必须生成一份完整替换方案，并以一个可编译的标准 Role/Workflow 模板作为保底。Design Assistant 不自动读取项目文件、文档或 Git 历史，也不启动外部 Visual Companion 或浏览器服务。解析、引用和 Workflow 编译错误必须进入有界自动修复，耗尽后持久化错误和草稿；只有实际编译错误或基线版本已过期时阻止创建，其他提示允许用户稍后修改或恢复标准模板。新建设计创建全新的完整 Role Profile 和 Workflow Definition；优化设计必须选择当前活动 Workflow 作为基线，保留稳定 Workflow ID，并创建尚未占用的下一版本，既有版本和已固定版本的 Run 保持不变。优化设计可复用现有 Role Profile，只在方案确有需要时创建新的完整 Role Profile。模型生成的每个可执行节点必须固定一个角色。确认操作不得创建 Workflow Run、Task、Attempt、Review 或 Merge Queue 项；用户仍需在 Workflows 页面人工启动 Run，运行 Task 时系统直接使用节点固定角色。

同一程序窗口可以启动多个 Role Instance；也允许多个本地进程分别选择不同角色。

Workflows 页面本期必须提供可视化图编辑器，包括节点画布、边连接、节点 Inspector、角色/任务/审核配置、显式循环上限和 merge 节点配置，并支持 Definition round-trip。源码 YAML/JSON 编辑可以作为高级入口，但不能替代图编辑器。产品不提供脱离 Workflow Task 的独立 Agent Session 创建入口。

Roles、Resources 和 Settings 页面必须默认提供面向普通用户的字段表单，并使用当前已注册的 Executor、Provider、Model、Skill 和 Knowledge Base 作为可选择项。本机 Executor 和 secret binding 也必须通过字段与选择控件完成。内部 Profile 或本机设置 JSON 只能作为可展开的高级入口，不能成为创建或更新角色、执行器、Provider、Model、MCP、知识库或常用本机绑定的必经路径。简单表单与高级 JSON 必须使用同一套 Schema 校验并保持可逆；界面不得因简化配置而绕过资源白名单、版本快照或 secret reference 边界，secret value 仍不得写入 Profile、Git 或本机设置文件。

首期桌面端必须内置并显示 Pi RPC Executor Profile，并在可发现随应用安装的 Pi CLI 时自动建立绝对路径的本机绑定。普通用户配置模型时，默认入口必须在同一个流程中完成 API protocol、中转站或官方 endpoint、API Key 和 remote model ID；系统据此生成独立 Provider/Model Profile 和 secret reference。填写地址和 API Key 后，界面必须通过对应协议的模型列表接口拉取并选择 remote model ID，不显示手动 ID 入口。API Key 只能进入操作系统加密的本机 secret store，UI projection、Profile、Git 状态和普通本机设置均不得返回或持久化明文。Role 必须以勾选方式显式选择 Skill、MCP Server 和 Knowledge Base；勾选即授权该资源，不显示或要求配置 MCP tool/resource/prompt 允许列表、知识库 collection、search/read、topK、上下文预算或 required 等二级限制。若某个 Executor 的统一资源网关尚不可用，UI 必须明确阻止该组合，不能将仅保存成功表述为可执行。

## 13. 当前项目代码复用

复用以当前工作树冻结后的源代码为准。因为当前仓库存在大量未提交裁剪改动，实施前必须生成 source manifest，记录所复制文件的路径和 SHA-256，避免在迁移过程中继续追随变化中的工作树。

逐文件复用等级、当前验证状态、依赖边界和迁移方法见 [`MAM_CURRENT_PROJECT_REUSE_MATRIX.md`](./MAM_CURRENT_PROJECT_REUSE_MATRIX.md)。实施时以该矩阵作为文件级允许复制清单；本节只保留架构层摘要。

### 13.1 可直接或近乎直接复制

| 当前路径                                                | 复用内容                                  | 目标处理                                                                |
| ------------------------------------------------------- | ----------------------------------------- | ----------------------------------------------------------------------- |
| `src/shared/mam/domain/primitives.ts`                   | ID、时间、schema version、hash schema     | 直接复制                                                                |
| `src/shared/mam/domain/artifact.ts`                     | Artifact contract、ref、version           | `R1`：补 `taskId`、Attempt result 和 GitChange 后复制                   |
| `src/shared/mam/domain/review.ts`                       | Review decision、aggregation              | `R1/R2`：删除旧 runtime/session assignment，绑定不可变 Attempt/commit   |
| `src/shared/mam/domain/skill-definition.ts`             | Skill 定义和锁定信息                      | 直接复制                                                                |
| `src/shared/mam/runtime-events.ts`                      | 标准执行事件                              | 重命名类型后复制                                                        |
| `src/main/mam/artifacts/`                               | Artifact 校验、内容寻址和本地存储模式     | `R1/R2`：增加 state branch store，并让本地 ACL 可从权威 projection 重建 |
| `src/main/mam/review/review-aggregation-policy.ts`      | 多 Reviewer 聚合                          | 直接复制                                                                |
| `src/main/mam/review/review-fan-out-coordinator.ts`     | Reviewer 并行启动和 fan-in                | `R1/R2`：替换 Runtime assignment，并绑定显式 Attempt/commit             |
| `src/main/mam/workflow/human-approval-service.ts`       | 人工审批命令入口                          | 直接复制                                                                |
| `src/main/mam/workflow/review-loop-policy.ts`           | 审核返工次数保护                          | 直接复制并接入通用 loop policy                                          |
| `src/main/mam/scheduler/scheduler-command-authority.ts` | Kernel-only 权威写入边界                  | 直接复制并更新 actor 类型                                               |
| `src/main/mam/skills/skill-package-validator.ts`        | Skill 包路径、大小和 hash 校验            | 直接复制                                                                |
| `src/main/mam/skills/mam-skill-registry.ts`             | Skill registry 的导入、校验和原子存储模式 | `R2`：重做跨机器稳定 ID、版本和启停写接口                               |
| `src/main/mam/skills/runtime-skill-materializer.ts`     | Skill 路径校验和复制模式                  | `R2/R3`：改成每 Attempt 的不可变隔离快照                                |
| `src/main/mam/diagnostics/diagnostics-recorder.ts`      | 诊断记录和 secret 脱敏                    | 直接复制                                                                |
| `src/renderer/src/components/ui/`                       | shadcn 基础组件                           | 按实际使用组件复制                                                      |
| `src/renderer/src/assets/main.css`                      | 设计 token                                | 复制为新程序 UI 基线                                                    |

### 13.2 复制后重点改造

| 当前路径                                                               | 可复用骨架                                                          | 必须改造                                                                                                                   |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `src/shared/mam/domain/role.ts`                                        | RoleProfile、Provider/Model 引用、EffectiveRoleConfig、RoleInstance | 保留细粒度组合结构；删除 container policy 和 `deviceId`；增加 Executor Profile、execution notice/invocation 身份和配置快照 |
| `src/shared/mam/domain/workflow.ts`                                    | Workflow、NodeRun、Run schema                                       | 增加 dynamic tasks、command、artifact transform、git merge 和有界循环                                                      |
| `src/shared/mam/domain/task.ts`                                        | TaskPackage、Attempt                                                | 删除 `assignedDeviceId`；增加固定角色绑定、ExecutionClaimNotice、Effective Config/Result snapshot 和 GitChange             |
| `src/shared/mam/domain/runtime-kind.ts`                                | 执行后端枚举位置                                                    | 收敛为 `codex-cli`、`grok-cli`、`pi-rpc`                                                                                   |
| `src/shared/mam/runtime-capabilities.ts`                               | capability preflight                                                | 删除 jcode、Claude、container 和设备能力                                                                                   |
| `src/shared/mam/scheduler-protocol.ts`                                 | Command/Event envelope、幂等与 actor                                | 删除 device actor 和 lease rejection；增加固定角色激活、execution notice、Attempt result、dynamic task 和 merge events     |
| `src/main/mam/workflow/workflow-compiler.ts`                           | YAML/JSON 解析、图校验、Artifact 校验、plan hash                    | 扩展节点类型和有界循环；现实现只接受 DAG                                                                                   |
| `src/main/mam/scheduler/kernel.ts`                                     | 命令校验、权威事件生成、Artifact hash 检查                          | 删除设备派发和设备 lease；增加固定角色校验、非排他执行提示、Attempt result 和 merge authority                              |
| `src/main/mam/state-store/append-only-event-store.ts`                  | event path 校验、replay 和 snapshot rebuild                         | `R2`：补真正批次原子性和并发 writer，再挂载到独立 `mam-state` worktree                                                     |
| `src/main/mam/state-store/` 中的 `github-*` 文件                       | Git commit、projection、replay、冲突检测                            | 重命名为 provider-neutral `git-*`；改为独立状态分支和 CAS retry                                                            |
| `src/main/mam/application/` 中的 `mam-*` 文件                          | use-case 边界、projection、Artifact 提交和执行协调                  | 按新状态机组装；删除所有 device dispatch/recovery 调用                                                                     |
| `src/main/mam/runtimes/contracts/runtime-adapter.ts`                   | start/resume/send/steer/abort/usage 接口                            | 重命名 Executor；删除 containerId                                                                                          |
| `src/main/mam/runtimes/orca/orca-hosted-runtime-adapter.ts`            | queue、abort 和错误测试资产                                         | `R3/T`：不得复用 terminal idle/tail 作为 Codex/Grok 完成通道                                                               |
| `src/main/mam/runtimes/pi/`                                            | Pi RPC、事件、日志和 Role materialization                           | 保留 host 模式，删除 container、Pi 专属 Extension 和专用完成协议                                                           |
| `src/main/mam/workspace/orca-workspace-host.ts`                        | worktree、terminal、ownership 组合                                  | 重命名并只依赖 local provider                                                                                              |
| `src/main/mam/workspace/orca-workspace-provider.ts`                    | Local provider                                                      | 只复制 `LocalOrcaWorkspaceProvider`，删除 SSH provider                                                                     |
| `src/main/mam/policy/policy-engine.ts`                                 | file/command/network/MCP 策略                                       | 复制并适配新的 execution policy                                                                                            |
| `src/renderer/src/features/mam/`                                       | Roles、Workflows、Runs、Review UI                                   | 复制组件，替换 Orca store、worktree selector 和旧 API 接线                                                                 |
| `src/shared/mam/application-api.ts`、`src/shared/mam/ui-projection.ts` | IPC DTO 与 UI projection                                            | 根据新模型更新后复用                                                                                                       |

当前项目没有正式 Knowledge Base Registry 或统一检索层，需要新增：

```text
src/shared/mam/domain/knowledge-base.ts
src/shared/mam/domain/mcp-server-profile.ts
src/main/mam/knowledge/knowledge-base-registry.ts
src/main/mam/knowledge/knowledge-gateway.ts
src/main/mam/knowledge/knowledge-query-audit.ts
src/main/mam/mcp/mcp-profile-registry.ts
src/main/mam/mcp/role-mcp-materializer.ts
src/main/mam/mcp/mcp-capability-gateway.ts
```

新增模块必须复用现有 Zod schema、内容 hash、Policy Engine、Diagnostics Recorder 和角色物化模式，不另建第二套权限系统。

### 13.3 从 Orca 宿主复制的基础设施

这些模块不属于 MAM 领域，但可以避免重写底层能力。迁移时按依赖闭包复制，不整体复制 Orca：

| 当前路径                                                                     | 复用目的                                               | 边界                                                                     |
| ---------------------------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------ |
| `src/main/git/runner.ts`                                                     | 跨平台 Git 进程执行                                    | 只保留 native host                                                       |
| `src/main/git/worktree.ts`                                                   | worktree 查询和操作                                    | 保留 Git 2.25 fallback                                                   |
| `src/main/git/git-capability-state.ts`                                       | Git capability cache                                   | 删除 SSH/WSL host key                                                    |
| `src/main/` 中的 `worktree-create-*` 文件                                    | 安全创建 task worktree                                 | 删除 hosted work-item 和远程环境依赖                                     |
| `src/main/` 中的 `worktree-removal-*` 文件                                   | worktree 删除保护                                      | 只保留本地安全检查                                                       |
| `src/shared/git-capability-cache.ts`、`git-worktree-command-capabilities.ts` | Git 版本能力探测                                       | 直接复用核心逻辑                                                         |
| `src/shared/worktree-ownership.ts`                                           | worktree 所有权模型                                    | 改为 task/attempt owner                                                  |
| `src/main/codex/codex-app-server-session.ts`                                 | JSONL framing、request correlation、timeout 和进程清理 | 作为 Codex 结构化 Adapter 的主要源资产，补完整 turn/session 生命周期     |
| `src/main/codex/codex-app-server-capability-cache.ts`                        | 机器接口 capability cache                              | 按 executable、version 和 config home 隔离后复用                         |
| `src/main/daemon/` 中的 `terminal-host*` 文件                                | 可选的本地观察和人工接管                               | `R3` 条件复制，不进入结构化完成协议                                      |
| `src/main/runtime/rpc/methods/terminal.ts`                                   | 可选终端展示                                           | 仅在首期确认需要人工接管时提取本地 send/read/close；不得解析输出判定完成 |

### 13.4 UI 壳复用

新程序可以继续使用当前 Electron、React、Vite、TypeScript、Zod、Vitest、Tailwind/shadcn 技术栈，但不应复制完整 Renderer 页面树。推荐复制：

- Electron 启动、preload 和 IPC 的最小可运行骨架。
- `src/renderer/src/components/ui/` 中实际被 MAM 页面引用的组件。
- `src/renderer/src/assets/main.css` 和 `docs/STYLEGUIDE.md`。
- `src/renderer/src/features/mam/`。
- i18n 基础设施与本产品实际使用的键。

其余页面按编译错误逐个判断，不能为了减少 import 修复而复制整个 Orca 产品。

### 13.5 明确不复制

```text
src/main/mam/application/mam-device-projection-refresh.ts
src/main/mam/devices/device-registry.ts
src/main/mam/policy/sandbox-launcher.ts 中的 container 实现
src/main/mam/runtimes/acp/                 # 除非 Grok Adapter 证明需要具体传输代码
src/main/mam/runtimes/pi/pi-container-runtime-bundle.ts
src/main/mam/state-store/local-orca-state-store.ts
src/main/ssh/
src/relay/
src/mobile/
GitHub/GitLab hosted review 和 work-item 模块
Linear/Jira 模块
Orca Automations
Browser/Emulator/Mobile Companion
jcode、Claude Code 和其他额外 Agent 接入
设备身份、manual device dispatch API、device-bound recovery 语义
```

`src/main/mam/devices/lease-manager.ts` 不作为 Claim Manager 复制；Claim 已确认是非排他提示，不需要 lease、续约或 fencing。只允许以 `R3/T` 提取 stale 时间计算和重复执行测试模式。`recovery-coordinator.ts` 只提取幂等判断、未知副作用进入 `needs_reconciliation` 的规则和相应测试，不复制本地 Map/JSON 权威实现。`manual-dispatch.ts` 不复制；Task 角色由 Workflow 节点固定，运行时不得恢复设备派发、人工选角或角色改派语义。

不复制并不等于立即从当前仓库删除；新程序只建立允许复制清单，不再承担旧仓库的持续裁剪工作。

## 14. 新程序建议目录

第一阶段保留 MAM 路径和模块名，减少复制后的 import 改动：

```text
multi-agent-max-next/
  package.json
  src/
    main/
      index.ts
      mam/
        application/
        scheduler/
        workflow/
        state-store/
        artifacts/
        review/
        executors/
          contracts/
          codex-cli/
          grok-cli/
          pi-rpc/
        workspace/
        git-integration/
        policy/
        skills/
        mcp/
        knowledge/
        diagnostics/
      git/
      terminal/
      ipc/
    shared/
      mam/
    renderer/src/
      assets/main.css
      components/ui/
      features/mam/
      store/
  acceptance/
  docs/
```

先完成可运行迁移，再做 Orca 命名清理。不要在复制、改模型和重命名三个维度同时制造大范围 diff。

## 15. Application API

第一版最小命令集合：

```text
roles.list / roles.save / roles.validate
executors.listLocal / executors.preflight
providers.list / providers.save / providers.testConnection
models.list / models.save / models.probeCapabilities
bindings.validateCompatibility / bindings.materializePreview
skills.list / skills.import / skills.validate
mcpProfiles.list / mcpProfiles.save / mcpProfiles.discoverCapabilities
knowledgeBases.list / knowledgeBases.save / knowledgeBases.preflight
knowledge.search / knowledge.read
workflows.list / workflows.save / workflows.compile
designDraft.get / designDraft.selectModel / designDraft.send / designDraft.updateProposal / designDraft.apply
runs.create / runs.list / runs.get / runs.pause / runs.resume / runs.cancel
tasks.listForRole / tasks.activateFixedRole / tasks.announceExecution / tasks.releaseExecutionNotice
attempts.start / attempts.abort
attempts.selectForTask / attempts.getTimeline
artifacts.submit / artifacts.get / artifacts.listByAttempt
reviews.submit / reviews.resolveDisagreement
approvals.resolve
humanAttention.list / humanAttention.submitQuestionBatch / humanAttention.answerBatch
humanAttention.submitUnderstanding / humanAttention.confirm / humanAttention.block
mergeQueue.list / mergeQueue.executeNext / mergeQueue.retry
diagnostics.list / diagnostics.export
```

Renderer、CLI 和 Executor Bridge 都调用 Application API，不能直接操作 state store。

## 16. 实施阶段

### M0：冻结源代码基线

- 确定当前工作树中要复制的文件。
- 生成路径、Git 状态和 SHA-256 manifest。
- 创建新程序目录和最小 Electron/TypeScript 构建。
- 禁止新程序通过相对路径引用旧仓库源码。

验收：新程序可独立安装、typecheck、test 和启动。

### M1：领域模型与单进程 Scheduler

- 复制 shared MAM schemas、Artifact、Review 和 Kernel authority。
- 删除设备和容器字段。
- 将 Executor、Provider、Model 和 Role binding 拆成独立、可复用、带版本的配置对象。
- 增加 Skill、MCP 和 Knowledge Base Profile 及角色级资源选择 schema。
- 增加固定节点角色绑定、非排他 ExecutionClaimNotice、Attempt result、dynamic tasks 和 merge events。
- 扩展 Workflow Compiler。

验收：任意名称角色和复杂工作流可编译；无固定角色 ID；Executor 与 Model 可按角色组合；角色只能引用已注册的 Skill、MCP 和 Knowledge Base；所有循环有边界。

### M2：Git 权威状态、固定角色激活和执行提示

- 建立 `mam-state` hidden worktree。
- 迁移 append-only store、reducer、projection 和 CAS retry。
- 实现 `listForRole`、固定角色自动激活、execution notice、重复执行 warning 和 Attempt recovery。

验收：同一机器两个进程和两个独立 clone 的事件都可收敛；同一 Task 并发启动时两个 Attempt 都保留并显示 warning，不伪装成排他锁。

### M3：工作区与 Codex/Grok CLI

- 复制 Git/worktree/结构化进程通信最小依赖闭包；终端只按观察和接管需要条件复制。
- 实现 CodexCliAdapter、GrokCliAdapter。
- 实现 Provider/Model capability validation、独立配置目录和本机 preflight。
- 实现代码 Attempt、配置快照、branch、commit Artifact、结构化事件和标准结果 JSON。

验收：多个自定义角色可在同机使用相同 CLI、不同 Provider/Model 的隔离配置执行任务，并提交不同 task branch。

### M4：Pi RPC、Skills、MCP、知识库和 Policy

- 迁移 Pi host RPC Adapter。
- 迁移 Role materialization 和 Skills；所有 Executor 统一通过 Application API 和标准结果契约接入。
- 实现 MCP Profile Registry 和按角色选择、隔离物化。
- 实现 Knowledge Base Registry、Local Knowledge Binding 和只读 Knowledge Gateway。
- 移除 container、jcode、Claude capability。

验收：一个 Workflow Run 可混合 Codex CLI、Grok CLI 和 Pi RPC；每个角色只看到自身白名单中的 Skill、MCP 和知识库；Attempt 配置和 invocation 不串线。

### M5：Review、动态任务与返工

- 实现 Task Plan 到 dynamic tasks。
- 实现固定 Review 节点角色、多 Review Task、聚合和人工分歧处理。
- 实现 Review 对 commit/hash 的失效规则。

验收：任务由任意规划角色产生并携带设计时固定的 Role Profile，用户无需再次选角，审核失败创建新 Attempt。

### M6：调度者角色和串行合并

- 实现 `git_merge` 节点、merge queue 和稳定排序。
- 实现 integration worktree、冲突 Attempt 和验证命令。
- 保护目标分支 push authority。

验收：三个并行任务按 `mergeReadyAt`、`taskId` 逐一合并；至少一个人工制造的冲突由调度者角色处理并留下完整 lineage。

### M7：UI、恢复与最终验收

- 迁移 MAM UI 并接入新 Application API。
- 完成 Roles、可视化 Workflows、My Role、Task Attempt 时间线、Reviews、Merge Queue 页面。
- 完成崩溃恢复、projection rebuild、诊断导出和端到端测试。

验收：可视化编辑器可 round-trip 全部首期节点；审核默认最新 Attempt 并可只读打开历史 Attempt；删除本地 projection 后能从 `mam-state` 重建；在另一台机器或独立 clone 继续角色任务。

## 17. 并行开发边界与工作量

如果使用一个主 Agent 加三个 subagent，建议按稳定边界并行：

| 负责人   | 范围                                                                          |
| -------- | ----------------------------------------------------------------------------- |
| 主 Agent | 新仓库基线、shared contracts、Application API、最终集成和验收                 |
| Agent A  | Git state branch、events、固定角色激活/execution notice、projection、并发测试 |
| Agent B  | Codex/Grok/Pi 结构化 Adapters、标准结果、Role materialization                 |
| Agent C  | Renderer、可视化 Workflow、Attempt timeline、Review/Merge Queue UI            |

Workflow/Kernel schema 由主 Agent 先冻结，其他 Agent 不并行修改 shared contracts、package lock、tsconfig、Electron 启动和 preload 文件。

审计前的 `12-18`、`7-11` 和 `3-5` 天估算不再作为承诺。只有完成以下 spike 后才重新估算：Git state 命令级 CAS 与批次原子性、Codex/Grok 结构化机器接口、Attempt 级 Skill/MCP/Knowledge 不可变物化，以及可视化 Workflow Editor 的新建范围。排期必须分别统计 `R0/R1` 直接复用、`R2` 改造、`R3` 提取和新增代码，不用“复制文件数”推导工期。

## 18. 最终验收矩阵

稳定 requirement/invariant ID、旧 ID 映射、验证命令和证据路径定义在需求差异表。旧验收节点不得直接消失，必须标记为 retained、replaced 或 removed。首期完成状态只以 macOS 的 build、start、test 和 E2E 为门禁；Linux/Windows 是 deferred，不得以 skipped 或 blocked 计入首期结果。

### 18.1 角色和工作流

- 创建至少 8 个任意名称角色，产品没有固定角色名称判断。
- 同一个 Codex CLI Executor Profile 同时绑定至少三个不同 Model Profile，Role Instance 配置互不污染。
- 同一个 Model Profile 同时由 Codex CLI 和 Pi RPC 角色使用。
- Workflow Run 固定 Workflow Definition 和节点 Role version catalog，Task 创建后固定自身定义及唯一角色；Role 编辑或新增只影响新 Run。
- Provider/Endpoint、Model、Executor、Skill、MCP 和 Knowledge Base 编辑后，只有新 Attempt 使用新版本，旧 Attempt 的 Effective Config hash 不变。
- 不按 OpenAI、GLM、DeepSeek、Grok 等模型品牌硬编码 Executor 组合限制。
- 两个使用相同 Executor/Model 的角色可以绑定完全不同的 Skill、MCP 和知识库白名单。
- 修改 Skill、MCP 或 Knowledge Base Profile 后，已经运行的 Attempt 继续使用原快照，新 Attempt 使用新版本。
- 同一 Role Profile 在多个节点复用。
- 一个 Review 节点固定一个 Reviewer Role Profile；需要不同 Reviewer Role 时使用多个 Review 节点。
- 工作流包含并行、join、condition、review、approval、dynamic tasks、有界返工和 git merge。
- 可视化编辑器可以创建、连接、检查并 round-trip 上述节点及循环上限；源码编辑只是高级入口。
- Design Assistant 使用已有 Model Profile，通过可恢复的本地多轮对话进行单问题澄清、二至三个方案比较和至少三个设计部分的结构化建议，同时指出并修复工作流缺陷；方案选择、章节确认和缺陷提示服务于协作但不构成逐步门禁，用户可在认为合适时直接确认完整替换草稿；不自动读取项目文件/Git 历史，不启动外部可视化服务；实际解析、引用、编译错误或过期基线仍必须阻止创建；最终生成全新角色和工作流，或基于所选现有工作流生成同一 ID 的下一版本；每个可执行节点固定一个角色；确认后只增加定义版本且不产生 Run、Task 或 Attempt，既有 Run 继续固定原版本。
- Role 不继承；产品没有 Session override、Executor/Model fallback 或独立 Agent Session 创建入口。

### 18.2 固定角色、执行提示与多实例

- 同一机器同时运行至少 3 个角色实例。
- 同一机器同一角色可以并行执行不同任务。
- 每个可执行节点在 Workflow Definition 中固定且只固定一个 Role；Task 直接继承该角色，自动启动或人工重试时不得再次要求选择角色。
- 运行中不得把 Task 改派给其他 Role；`reassign_task` 必须返回 `workflow_role_binding_fixed`。更换角色只能创建新 Workflow Definition 版本和新 Run，历史 Attempt 不变。
- 两个独立 clone 启动同一 Task 时都可以创建独立 Attempt，但两端都显示并记录 `concurrent_execution_warning`，全部历史不得覆盖。
- 任意机器只需 clone、同步状态、选择 run 和 role，不需要预先注册设备。
- 本机缺少 Executor 时任务保持固定角色且可重试，不自动 fallback，也不写成任务失败。

### 18.3 Runtime

- Codex CLI 结构化 headless/app-server 真实进程 smoke test。
- Grok CLI 真实结构化机器接口 smoke test；没有结构化接口的版本在 preflight 明确阻止。
- Pi RPC 真实 Provider 和统一结果协议 smoke test。
- Codex CLI 使用两个不同 Provider/Model 的并发隔离 smoke test。
- Pi RPC 使用两个不同 Provider/Model 的并发隔离 smoke test。
- 不支持 custom endpoint 或 model override 的 CLI 在 preflight 阶段返回明确兼容性错误。
- abort、resume、事件流、错误、usage unknown/partial/full 均能归一化。
- 每个 Executor 最终都产生合法的标准 Attempt Result；字段 correlation 或 Artifact hash 不匹配时拒绝提交。
- CLI idle、进程退出、终端尾部文本和模型自称完成都不能绕过 Scheduler 校验。
- Pi 不加载用户 Pi Extension，不使用专属完成协议；不兼容组合不自动切换 Executor、Provider 或 Model。

### 18.4 角色资源权限

- Executor 全局目录中存在未授权 Skill 时，Role Instance 不加载该 Skill。
- Role 只加载显式绑定且内容 digest 匹配的 Skill；unexpected Skill 使物化失败。
- Role 可以使用已选择 MCP Server 提供的 tool、resource 和 prompt，不能调用未选择的 MCP Server。
- 对未选择 MCP Server 或 Knowledge Base 的调用返回明确拒绝并生成审计事件。
- Role 只能查询已选择的 Knowledge Base；Gateway 统一限制单次结果数和上下文 Token。
- 已选择知识库在本机不可用时不能启动 Attempt。
- Knowledge Base 查询只读，Agent 不能通过 Gateway 修改源内容或索引。
- Attempt 记录实际 Skill digest、MCP Profile version 和 Knowledge Base index revision。
- Effective Config Snapshot 不包含 secret value，且旧 Attempt 的资源快照在 Profile 更新后保持不变。

### 18.5 Git 和合并

- 每个写任务使用独立 branch/worktree。
- submitted commit 不可变；新 commit 使 Review 失效。
- `mam-state` 与 task/develop 分支相互独立。
- 两个 clone 并发追加不同事件后可以完整 replay。
- 同一 Task 的重复 execution notice 和 Attempt 都可 replay，并产生 warning；过期 revision 和冲突状态不会静默覆盖。
- 正式输入输出及后续节点依赖的 Artifact 可从 Git 重建；本地大型日志缺失时显示 unavailable，不破坏 replay。
- merge queue 按 `(mergeReadyAt, taskId)` 串行执行；新 commit 清除旧 ready 状态。
- 调度者角色可以解决冲突，但不能绕过目标分支和验证策略。
- Task/Review UI 默认显示最新 Attempt，并可从时间线只读查看历史 Attempt；代码比较使用 Git diff，不要求 Artifact 双栏比较入口。

### 18.6 安全与恢复

- Worker 无法直接写 `.workflow` 权威状态。
- 通过 MAM Bridge/Gateway 发起的非当前 Task worktree 写入被拒绝；无 OS sandbox 时不把该限制描述为 Shell 级强隔离。
- 日志、Artifact 和 events 不包含明文 secret。
- 未授权资源不能通过 MAM Bridge/Gateway 使用；无 OS sandbox 时不宣称阻止 Agent 读取操作系统用户本来可读的任意文件。
- 删除 snapshot 和本地 UI cache 后可从 events 重建一致状态。
- 进程崩溃后创建新 Attempt，历史 Attempt 保留；无法判断非幂等副作用是否发生时进入 `needs_reconciliation`，不得自动重试。
- 人工核对完成后创建的 `recovery_planned` Attempt 必须能被实际启动并保留正确 lineage；Executor 报错不能让权威状态永久停留在 running。
- 清理并重启同版本、同输入的 Workflow 时，已提交且 Git 证据仍可验证的静态任务和对应已通过审核可由权威复用事件恢复；来源 lineage 必须可追踪，Approval gate 和不安全成果不得自动复用。
- 产品构建和测试不依赖 Docker、SSH、jcode、Claude、Linear/Jira 或 hosted provider API。
- macOS 的安装、构建、启动和核心 E2E 全部通过；Linux/Windows 仅记录后续兼容工作，不属于首期通过条件。

## 19. 与旧计划的关系

- `MAM_COMPLETION_REQUIREMENTS.md`：已被本文档和需求差异表取代，只保留为旧实现验收历史，不再是独立完成判据。
- `MAM_ORCA_FEATURE_PRUNING_PLAN.md`：保留为已执行裁剪工作的历史记录，不再作为后续产品实施路线。
- `MAM_SKILLS_CUT_PLAN.md`：继续作为 Skills 文件识别和迁移来源，但最终 Runtime 目标仅为 Codex CLI、Grok CLI 和 Pi RPC。
- `design-v1.md`：保留 Role Profile、Executor/Provider/Model 分离和资源隔离原则；删除 Role 继承、Session override、fallback 和独立 Session 产品。
- `design-v2-workflow.md`：继续提供任意工作流、Artifact、Review、审批和返工原则。
- `design-v3-distributed-workflow.md`：只保留 Git 共享状态、多本地 Scheduler 和冲突检测思想；删除设备派发、Device Registry、设备 heartbeat、排他 lease 和人工选角，改为工作流固定角色与非排他执行提示。
- `design-v4-pi-runtime.md`：只保留 Pi RPC、Role materialization、事件和 usage 归一化；删除容器、Pi 专属 Extension、Session override 和多 Runtime 扩张目标。
- 本文档中的决定与旧文档冲突时，以本文档为准。

## 20. 最终决策摘要

1. 新建独立程序，选择性复制当前项目，不再继续大规模裁剪 Orca。
2. Role Profile 和 Workflow Definition 都由用户自由定义，任何具体角色名称都只是示例。
3. 每个可执行工作流节点固定一个角色，不绑定设备；机器只是临时运行 Agent 的位置。
4. 运行 Task 时直接使用节点固定角色，不提供运行时选角或改派；Execution Claim 只显示非排他的重复执行提示。
5. 调度者是用户可配置的工作流角色；Scheduler Kernel 是确定性基础设施。
6. 代码、审核、合并只是可配置工作流节点，不是固定流程。
7. 共享状态使用独立 `mam-state` Git 分支和 append-only events。
8. 代码任务使用 task/attempt 分支，不使用固定角色分支。
9. 第一版仅支持 Codex CLI、Grok CLI 和 Pi RPC，三者必须通过结构化 CLI/API 和统一结果 JSON 接入；Executor、Provider/Endpoint 与 Model Profile 可以按角色自由组合，不限制模型厂商品牌。
10. SSH、容器、jcode、额外 Runtime、hosted work-item 和设备调度不进入新程序。
11. 当前 MAM 领域、工作流、Artifact、Review、Pi、Skills、UI 代码优先复制；设备和容器代码明确排除。
12. 每个角色分别配置 Skill、MCP 和知识库白名单；未授权资源不物化、不注入，也不能通过 MAM Bridge/Gateway 调用。
13. 知识库通过统一只读 Gateway 使用，支持项目文件、本地目录、Git 仓库、向量库和 MCP Resource 等 Profile。
14. 当前没有旧版本数据，实施不包含迁移兼容层。
15. Workflow Run 固定 Workflow 和节点绑定的 Role version catalog，Task 创建后固定定义及角色；每个 Attempt 解析最新资源并冻结 Effective Config，Role 编辑或新增只影响新 Run。
16. 首期包含可视化 Workflow Editor 和 Attempt 历史时间线；审核默认最新 Attempt，代码使用 Git diff，不做 Artifact 专用并排比较。
17. 不支持 Role 继承、Session override、自动 fallback、独立 Agent Session 或 Pi 专属 Extension。
18. 首期正式支持 macOS；Linux 和 Windows 后置。
