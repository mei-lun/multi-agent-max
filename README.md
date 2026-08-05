# Multi-Agent Max

[简体中文](README.md) | [English](README.en.md)

Multi-Agent Max（MAM）是一款本地运行、由 Git 驱动的多 Agent 工作流桌面控制平面。它把带版本的角色、自定义工作流图、隔离的 Git worktree、不可变的 Attempt 证据、审核和确定性集成串成一条可审计的交付链路。

MAM 不是新的 Agent Runtime，也不是远程机器管理器。它负责协调结构化 Executor，并以 Git 作为共享工作流状态的权威来源。

> [!IMPORTANT]
> MAM 仍在积极开发中（`0.1.0`）。macOS 是首个正式支持的发布目标。当前应用只通过 Pi RPC 执行生产 Attempt；Codex CLI 和 Grok CLI Adapter 仍保留在仓库中，等待后续启用。

## 核心能力

- **用户自定义角色**：带版本的 Role Profile 可以组合 Executor、模型、Prompt、Skill、MCP Server、知识库、工具、权限、预算、重试策略和上下文策略。
- **可视化工作流**：创建和编辑包含角色任务、动态任务、审核、人工审批、条件、并行分支、汇合、Artifact 转换、命令、Git 合并及有界返工循环的工作流图。
- **Design Assistant**：使用已有 Model Profile 澄清需求、比较候选方案、逐部分审核生成的设计，并在用户明确确认后创建新的角色与工作流定义。草稿仅保存在本机，不会自动读取项目文件，应用设计时也不会启动 Run 或创建 Task。
- **固定执行语义**：每个可执行节点在设计时固定且只固定一个角色。Task 直接继承该角色，Run 进行期间不能改派。
- **Git 权威协作**：Append-only 事件保存在独立的 `mam-state` 分支。配置 remote 后可跨 clone 协作；纯本地仓库也支持同一台机器上的多个角色协作。
- **隔离 Attempt**：代码 Attempt 使用独立分支和 worktree，冻结 Effective Config，产出结构化结果、不可变 Artifact 和完整 lineage。
- **审核与集成**：审核结论绑定到精确的 Attempt 和 commit。Merge Queue 使用稳定排序，在 integration worktree 中重新执行验证，并记录冲突解决 lineage。
- **恢复与诊断**：从 Git 重建 projection，在重试间保留 Attempt 历史，核对未知副作用，并导出具有关联关系且不包含明文密钥的诊断信息。
- **中英文桌面界面**：可在应用顶部随时切换简体中文和英文。

## 项目定位：Graph Engineering 的一种领域实现

从架构上看，MAM 是一个 **Git-backed graph workflow orchestration platform**：以工作流图作为执行模型，以 Scheduler Kernel 作为图调度器，以 Git 事件和 Run Bundle 作为可重放的权威状态，再把具体任务交给结构化 Agent Executor。

```text
Workflow Graph
      ↓
Workflow Compiler
      ↓
Scheduler Kernel
      ↓
Task / Attempt / Artifact
      ↓
Pi RPC（当前）/ Codex CLI、Grok CLI（后续）
      ↓
Git State + Review + Merge Queue
```

它体现了 Graph Engineering 的关键特征：节点和边描述依赖关系，Scheduler 根据图计算可执行节点；条件、并行、join、审批、审核、Artifact 转换和有界返工都属于图上的执行语义；每个节点的执行结果又会成为后续节点的 Artifact 输入。

MAM 不是图数据库、GraphQL 服务或通用图数据基础设施，也不是只执行 DAG 的轻量任务队列。它是在图执行之上叠加了角色配置、Agent 调用、Attempt 历史、审核、Git 分支/worktree、合并队列和恢复机制的领域型工作流引擎。

| 层次 | MAM 中的实现 |
| --- | --- |
| 图模型 | Workflow、Node、Edge、Condition、Parallel、Join |
| 图编译 | Workflow Compiler、执行计划、循环边界校验 |
| 图调度 | Scheduler Kernel、依赖计算、状态转换、权威写入 |
| 执行后端 | Pi RPC；Codex CLI 和 Grok CLI 的结构化 Adapter（后续启用） |
| 状态持久化 | `mam-state` Git 分支、append-only events、确定性 replay |
| 结果传播 | Artifact、Review、Approval、Git Merge |
| 操作界面 | Visual Workflow Editor、Attempt Timeline、Live Activity、Merge Queue |

## 侧边栏功能

| 功能 | 说明 |
| --- | --- |
| **概览** | 连接或切换 Git 项目，集中查看活动角色、工作流、运行记录、合并项以及需要处理的权威状态问题。 |
| **设计助手** | 使用已有 Model Profile 进行本机多轮对话，逐步澄清需求、比较方案、检查工作流缺陷并分段确认设计；确认后可创建新角色与工作流，或为现有工作流生成下一版本，但不会直接启动 Run 或 Task。 |
| **角色** | 创建和管理带版本的 Role Profile，组合 Executor、模型、系统提示词、Skill、MCP、知识库、权限、预算、重试和上下文策略。 |
| **工作流** | 可视化管理带版本的执行图，配置节点、连线、Artifact 契约、角色绑定、循环上限、运行时间与预算，并从指定版本启动新的 Run。 |
| **运行记录** | 查看每个 Workflow Run 的状态、Task、Attempt 时间线、结构化结果、Git Diff、恢复操作、审批门禁和集成进度；历史 Attempt 始终保留。 |
| **实时观测** | 在一个页面观察选定 Run 的全部节点、角色消息、工具调用、命令、用量和状态变化，可筛选当前活动或需要处理的节点，并导出完整活动记录。 |
| **我的角色** | 选择本机参与的 Role，查看工作流固定给该角色的待执行 Task，启动 Attempt，并管理本机自动参与的角色与 Run。 |
| **审核** | 处理待审核成果，查看精确 Attempt 的结果、验证证据与 Git Diff，提交通过或退回意见，并处理多 Reviewer 的聚合结果与意见分歧。 |
| **合并队列** | 查看已经审核的不可变 Revision，按确定性顺序执行集成、重新运行验证，并跟踪等待、执行中、失败、冲突与历史记录。 |
| **资源** | 导入和管理带版本的 Skill、MCP Server 与 Knowledge Base Profile，查看它们被哪些角色白名单引用。 |
| **设置** | 配置 Provider、Model 和高级 Executor Profile，以及仅保存在本机的可执行文件、密钥、MCP 连接、Skill、知识库和 Git 路径绑定；也可导出诊断信息。 |

## 界面与交付演示

### 工作流管理

同一工作流可以持续创建新版本，并为每个版本固定节点、连线、角色、转换上限、运行时间和预算；用户可以直接从所选版本启动 Run。

![Multi-Agent Max 工作流管理界面](docs/readme/assets/mam-workflows.png)

### 实时观测

实时观测页面按节点汇总角色消息、工具与命令事件、Token 用量和执行状态，既能查看当前活动，也能定位需要人工处理的节点。

![Multi-Agent Max 实时观测界面](docs/readme/assets/mam-live-activity.png)

### 交付结果示例

下面的猜数字网页由演示工作流完成设计、开发、审核、审批与 Git 合并，展示 MAM 编排多角色交付后得到的最终运行结果。

![Multi-Agent Max 工作流交付的猜数字网页](docs/readme/assets/mam-delivery-example-number-game.png)

## 工作原理

```text
Role Profiles + Workflow Definition + Git Repository
                         |
                  Scheduler Kernel
                         |
          Application API / 权限策略边界
                         |
          Pi RPC Adapter（当前发布路径）
                         |
                 模型 Provider 与工具

权威事件        -> mam-state 分支 -> 确定性 Projection
代码 Attempt    -> task 分支      -> 审核 -> Merge Queue
本机数据        -> 密钥、路径、Executor 与资源绑定
```

Scheduler Kernel 是不调用模型的确定性程序。Agent 可以提交结果和证据，但只有 Kernel 能推进权威的 Task、Review 和 Merge 状态。

## 开发环境快速开始

### 环境要求

- macOS（当前发布门禁）
- Node.js 22.22 或更高版本
- pnpm 10.24.x
- Git 2.25 或更高版本

### 安装并启动

```bash
git clone https://github.com/mei-lun/multi-agent-max.git
cd multi-agent-max
pnpm install
pnpm dev
```

如需启动生产构建预览：

```bash
pnpm build
pnpm start
```

## 创建第一个工作流

1. 在 **Overview（概览）** 中选择一个本地 Git 仓库。MAM 会创建或连接独立的 `mam-state` worktree，不会移动项目当前分支。
2. 在 **Settings（设置）** 中配置角色需要的 Provider 和 Model Profile。Pi Executor Profile 与内置 Pi CLI 的本机绑定会在可用时自动创建。
3. 添加本机密钥、MCP、Skill 和知识库绑定。这些绑定不会写入共享 Git 状态。
4. 在 **Roles（角色）** 中创建 Role Profile，然后通过 **Design Assistant（设计助手）** 或 **Workflows（工作流）** 创建带版本的工作流，并为每个可执行节点固定一个角色。
5. 从 **Workflows** 启动 Run，然后在 **Runs（运行记录）**、**Live Activity（实时活动）** 和 **My Role（我的角色）** 中查看执行进度。
6. 按提示处理审核或人工审批。只有工作流包含 Git 合并节点且验证证据仍然有效时，审核通过的代码才会进入 **Merge Queue（合并队列）**。

对于还没有 commit 的仓库，只要 worktree 干净，MAM 可以在首个 Attempt 启动时创建第一个空 commit。如果存在 staged、modified 或 untracked 文件，请先自行创建初始 commit，MAM 不会隐式提交用户文件。

## 本机密钥

密钥值不会进入 Role、Workflow、Run 或 Attempt 定义。可以通过 UI 中由系统加密的本机密钥存储添加，也可以提供由本机密钥绑定 ID 转换得到的环境变量：

```text
secret.openai -> MAM_SECRET_SECRET_OPENAI
provider-key  -> MAM_SECRET_PROVIDER_KEY
```

转换规则是：将 ID 转为大写，把标点替换为下划线，再添加 `MAM_SECRET_` 前缀。Effective Config Snapshot 只记录引用和内容 Hash，绝不记录密钥值。

## 开发命令

| 命令 | 用途 |
| --- | --- |
| `pnpm dev` | 以开发模式启动 Electron 和 Renderer |
| `pnpm build` | 构建 TypeScript Core 和 Electron 应用 |
| `pnpm test` | 运行单元、集成、真实 Git 和打包脚本测试 |
| `pnpm lint` | 使用 oxlint 检查 `src` 和 `config` |
| `pnpm typecheck` | 仅执行类型检查，不生成文件 |
| `pnpm format:check` | 检查格式，不改写文件 |
| `pnpm verify` | 依次执行格式、Lint、类型、测试和生产构建检查 |
| `pnpm smoke:desktop` | 对空项目执行桌面 Smoke Test |
| `pnpm smoke:desktop:seeded` | 在桌面应用中从 Git 重建预置状态 |
| `pnpm smoke:pi` | 使用真实本机进程验证 Pi RPC Adapter |
| `pnpm probe:executors` | 生成结构化 Executor 能力探测证据 |
| `pnpm verify:final` | 重新生成最终追踪证据和验收日志 |

最终验证报告输出到 [`docs/acceptance/final-traceability.json`](docs/acceptance/final-traceability.json)。后置需求会被标记为 deferred，而不会被误报为 passed。

## 打包

请在 macOS 上构建当前支持的 macOS x64 DMG 和 ZIP：

```bash
pnpm package:mac
```

产物会写入 `release/`。打包过程复用 `node_modules/electron/dist` 中的 Electron Distribution，并会对临时的 Builder 失败最多重试三次。如果安装依赖或打包时无法访问 GitHub，可以显式选择可信镜像：

```bash
MAM_ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ pnpm package:mac
```

仓库中保留了用于可移植性工作的 Windows 打包脚本，但 Windows 和 Linux 目前不是发布门禁，也还不是正式支持目标。

## Git 与数据模型

MAM 刻意分离三类状态：

| 状态 | 位置 | 权威性 |
| --- | --- | --- |
| 冻结的 Run Bundle、Task、Attempt、正式 Artifact、Review、Approval 与 Merge 证据 | `mam-state` Git 分支 | 共享且权威 |
| 代码变更 | 独立的 task/attempt 分支与 worktree | 由权威事件引用的 Git commit |
| 可复用的 Profile 与 Workflow Catalog、可执行文件路径、凭证、本机资源连接、缓存和大型诊断 | Electron user-data 目录 | 本机数据；每个 Run 会把冻结的工作流和角色复制到 Git |

Execution Notice 只是提示，不是锁。如果两个 clone 同时启动同一 Task，两个 Attempt 都会保留，UI 会报告并发执行，而不会静默丢弃历史。

## 项目结构

```text
src/
  main/
    mam/
      application/     Application Service 与命令编排
      scheduler/       确定性状态转换与权威校验
      workflow/        Workflow 编译与执行计划
      state-store/     Git Append-only 事件与 Replay
      executors/       结构化 Executor Adapter 与进程集成
      profiles/        带版本的 Catalog 与 Effective Config 物化
      artifacts/       Artifact 校验与本机大对象存储
      review/          Review 聚合与返工规则
      gateways/        MCP 与 Knowledge 访问边界
      diagnostics/     具有关联关系的 Runtime 证据与导出
    ipc/               沙箱化 Electron IPC 边界
  preload/             暴露给 Renderer 的窄接口
  renderer/src/        React 桌面 UI 与双语文案
  shared/mam/          Zod 领域契约与 Application API Schema
config/scripts/        验证、Smoke、能力探测与打包脚本
docs/                  产品权威、迁移记录、样式指南与验收证据
```

## 范围边界

当前产品明确不包含 Device Registry、设备分配、排他 Lease、SSH 编排、容器、jcode、独立 Agent Session、Role 继承、Session Override、Executor/Model 自动 Fallback、Terminal Tail 完成语义或 Hosted Issue/PR 集成。

Codex CLI 和 Grok CLI 仍是计划中的结构化 Executor。启用前必须通过 Capability 与本机 Preflight 检查；MAM 不会静默切换到其他 Executor、Provider 或模型。

## 文档

- [最终产品设计与代码复用方案](docs/final-reuse-integration-plan.md)：当前产品权威
- [需求差异与追踪表](docs/readme/MAM_REQUIREMENTS_DELTA_2026-07-27.md)：稳定 Requirement ID 与已废弃语义
- [迁移状态](docs/MIGRATION_STATUS.md)：已实现链路与后置 Executor 工作
- [当前项目复用矩阵](docs/MAM_CURRENT_PROJECT_REUSE_MATRIX.md)：源代码迁移决策
- [UI 样式指南](docs/STYLEGUIDE.md)：必须遵循的设计 Token 与组件规则

文档发生冲突时，以最终产品设计与代码复用方案为准。

## 参与贡献

所有改动都应遵循 [`AGENTS.md`](AGENTS.md) 和上述产品权威文档。提交 Pull Request 前请运行：

```bash
pnpm verify
pnpm smoke:desktop
pnpm smoke:desktop:seeded
pnpm smoke:pi
pnpm verify:final
```

## 许可证

[MIT](LICENSE)
