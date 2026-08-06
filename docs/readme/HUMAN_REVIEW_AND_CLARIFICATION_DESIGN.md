# 人工审核与角色澄清产品设计

**版本**：1.0  
**日期**：2026-08-06  
**状态**：Accepted  
**上位基线**：[`final-reuse-integration-plan.md`](../final-reuse-integration-plan.md) 2.2  
**追踪条目**：`DEC-018`、`DEC-019`、`MAM2-HUMAN-001`、`MAM2-HUMAN-002`

## 1. 目标

把“角色执行中的不确定问题”和“产物提交后的人工审核”收敛为同一套 Human Attention 机制。用户只负责回答问题、确认理解和填写审核意见，不直接修改文档或代码；产物始终由绑定的角色节点修改。

## 2. 产品原则

1. 任务明确时角色自动执行；只有会实质改变结果且无法从现有上下文查明的问题才请求用户输入。
2. 人机澄清是每个角色 Task 的原生能力，不是可删除的 Skill。
3. 一次问题批次最多五个相互独立的问题。决策问题必须提供二至三个方案、取舍、唯一推荐和推荐理由；事实问题使用自由文本。
4. 用户批量回答后，角色可以继续提出下一批问题，也可以提交理解摘要。用户可以确认摘要，或填写补充意见要求角色继续澄清。
5. 未获得用户明确确认时，角色不得继续实际修改；不能用超时、默认值或模型自行判断代替确认。
6. 默认只暂停当前 Task 和依赖它的下游；独立并行分支继续。Run 级暂停必须由问题显式声明。
7. 所有问题、回答、摘要、补充意见、确认和审核决定均写入 append-only Git 事件。

## 3. 人工审核门禁

`human_review_gate` 位于产物节点之后，不绑定 Role。编辑器在连接门禁时查找最近的上游 `role_task`，写入 `revisionTargetNodeId`，并创建带 `changes_requested` 条件和 `maxTraversals` 的有界返工边；存在多个候选生产节点时由用户显式选择。

门禁始终审核最新不可变 Review Subject，包括 Attempt、结果 hash、Artifact hashes 和可选 commit：

- `approved`：门禁通过，工作流进入下游。
- `changes_requested`：审核意见必填；原 Task 进入返工，保持固定 Role，并创建带 `previousAttemptId` 的新 Attempt。
- `blocked`：审核意见必填；门禁和相关分支进入阻塞态。
- 达到 `maxRevisionAttempts`：新的修改请求归一化为 `blocked`，不得继续无界返工。

返工角色启动后必须先读取审核意见并完成澄清流程。只有用户确认角色的最终理解后，角色才能修改产物并再次提交到同一人工审核门禁。

## 4. 统一“待我处理”入口

列表同时包含角色问题、返工沟通和人工审核。每个条目显示类型、角色、Workflow/Task、摘要、影响范围、阻塞 Task 数和等待时间；点击后打开独立 Dialog，关闭 Dialog 不会解决事项。

排序键固定为：影响范围（Run、Branch、Task）、阻塞 Task 数降序、创建时间升序、稳定 ID。角色不能给自己的问题设置优先级。

问题 Dialog 支持：

- 查看完整批次与历史回答；
- 逐项选择方案或填写自定义答案；
- 一键采用本批全部推荐方案；
- 批量提交所有答案；
- 确认角色理解并恢复执行；
- 填写补充意见，要求角色继续提问或重新提交理解摘要。

审核 Dialog 只提供审核意见文本框和 `通过`、`要求修改`、`阻塞` 三个决定，不提供文档或代码编辑器。

## 5. 状态模型

Human Attention Item 状态：

```text
awaiting_human_answers
  -> agent_reviewing_answers
  -> awaiting_human_answers        # 角色继续追问
  -> ready_for_confirmation
  -> agent_reviewing_answers        # 用户要求继续澄清
  -> ready_for_confirmation
  -> resolved                       # 用户确认
```

角色请求输入时，Task 进入 `waiting_for_human_input`；只有 `human_understanding_confirmed` 才恢复 `running`。一个 Task 同时只能有一个未解决的 Human Attention Item，一个 Item 可以包含多个问题批次和多个理解修订回合。

## 6. 权威命令与事件

Executor 命令：`request_human_input`、`submit_human_understanding`。  
User 命令：`answer_human_questions`、`revise_human_understanding`、`confirm_human_understanding`、`resolve_human_review`。

对应事件：`human_input_requested`、`human_questions_answered`、`human_understanding_submitted`、`human_understanding_revision_requested`、`human_understanding_confirmed`、`human_review_resolved`。

命令必须绑定 Workflow Run、Task、当前 Attempt 和 actor authority。旧 Attempt 的问题、摘要或审核决定必须被拒绝，不能改变最新 Task 状态。

## 7. 验收场景

1. 一个角色在单批提出三个决策问题和两个事实问题，用户采用部分推荐并批量提交，状态可从 Git 事件完整重建。
2. 角色提交理解摘要，用户填写补充意见；角色收到该意见后继续提问或重新总结，Task 仍未恢复执行。
3. 用户确认理解后，同一 Task 恢复；独立并行分支在整个等待期间持续运行。
4. 用户对最新产物要求修改，只填写问题点；系统把意见交给固定上游角色，澄清确认后创建新 Attempt，修改后回到原门禁。
5. 旧 Attempt 的审核决定不能放行新 Attempt；达到返工上限后门禁进入 blocked。
6. 人工审核节点未到达时不出现在“待我处理”列表，到达后按统一确定性顺序显示。
