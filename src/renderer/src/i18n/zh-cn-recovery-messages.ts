export const ZH_CN_RECOVERY_MESSAGES: Readonly<Record<string, string>> = {
  'Create a Role Profile or start a Run with a frozen Role catalog.':
    '请创建角色配置，或启动包含冻结角色目录的运行。',
  'Recover every active Attempt before changing this Role.': '请先恢复所有活动尝试，再更换此角色。',
  'Confirm every pending reconciliation before changing this Role.':
    '请先完成所有待核对事项，再更换此角色。',
  'The Role can change only before the next Attempt starts.': '只能在下一次尝试开始前更换角色。',
  'No other allowed Role version is available in this Run. Start a new Workflow Run to use newer Role versions.':
    '此运行中没有其他允许的角色版本。如需使用较新的角色版本，请启动新的工作流运行。',
  'Change Role': '更换角色',
  'Change Task Role': '更换任务角色',
  'This affects future Attempts only. Existing Attempt history and Effective Config snapshots remain unchanged.':
    '此操作只影响后续尝试；已有尝试历史和有效配置快照保持不变。',
  'Current:': '当前：',
  'Assigned to': '已分配给',
  'Role from this Run': '此运行中的角色',
  '· Recommended': '· 推荐',
  'Confirm reconciliation': '确认核对完成',
  'Confirm only after checking external state and making replay safe. The original Attempt remains in history.':
    '仅在检查外部状态并确认可以安全重放后继续。原尝试会保留在历史记录中。',
  'Reconciliation note': '核对说明',
  'Describe what was checked and why replay is now safe.':
    '说明已检查的内容，以及现在可以安全重放的原因。',
  'Confirm and create replacement': '确认并创建替代尝试',
  'Create a replacement': '创建替代尝试',
  'Block this Attempt and plan a replacement only when replay is safe.':
    '仅在确认可以安全重放时阻塞此尝试，并规划替代尝试。',
  'Create replacement Attempt': '创建替代尝试',
  'Retry this Task': '重试此任务',
  'Confirm before retry': '重试前确认',
  'Retry this Task?': '要重试此任务吗？',
  'Is it safe to retry this Task?': '现在可以安全重试此任务吗？',
  'The Role finished, but MAM could not accept a complete result after automatic retries. You do not need to inspect internal data formats.':
    '角色已经完成工作，但自动重试后 MAM 仍无法接收完整结果。你无需检查内部数据格式。',
  'Confirm whether the Role changed anything outside its isolated workspace. Retry only when that external state is safe.':
    '请确认角色是否更改了隔离工作区以外的内容；只有外部状态安全时才重试。',
  'Keep paused': '继续暂停',
  'Retry now': '立即重试',
  'I checked — retry safely': '已检查，可以安全重试',
  'MAM needs your confirmation': 'MAM 需要你确认',
  'MAM needs a new result': 'MAM 需要重新获取结果',
  'What you need to do:': '你需要做什么：',
  'The Role finished, but MAM could not accept a complete result.':
    '角色已经完成工作，但 MAM 无法接收完整结果。',
  'Choose Retry this Task. MAM will create a fresh Attempt and keep the old record.':
    '请选择“重试此任务”。MAM 会创建新的尝试，并保留原记录。',
  'Choose Retry this Task. You do not need to edit the internal result format.':
    '请选择“重试此任务”。你无需编辑内部结果格式。',
  'The Role finished, but MAM could not assemble all required work into the result.':
    '角色已经完成工作，但 MAM 无法将所需成果完整汇总到结果中。',
  'Choose Retry this Task. You do not need to define or repair Artifact contracts.':
    '请选择“重试此任务”。你无需定义或修复内部产物契约。',
  'The Role stopped before MAM received a complete result.': 'MAM 收到完整结果前，角色执行已停止。',
  'Open this Task and confirm whether it is safe to retry.':
    '请打开此任务，并确认现在是否可以安全重试。',
  'The Role did not produce the required result. MAM kept its workspace for recovery.':
    '角色未生成所需结果；MAM 已保留其工作区以便恢复。',
  'Configure this Role’s Executor on this machine before starting it.':
    '请先在本机配置此角色的执行器，再开始运行。',
  'Choose an available local Executor for this Role, then start the collaboration again.':
    '请为此角色选择可用的本机执行器，然后重新开始协作。',
  'Enable this Role’s local Executor, then start the collaboration again.':
    '请启用此角色的本机执行器，然后重新开始协作。',
  'Add the model credential required by this Role on this machine, then try again.':
    '请在本机添加此角色所需的模型凭证，然后重试。',
  'The reviewer could not make a valid decision. MAM will retry when it is safe.':
    '审核角色未能给出有效结论；在安全的情况下，MAM 会自动重试。',
  'Some local Roles are still working. Wait for them to finish, then clear this Run.':
    '部分本机角色仍在工作；请等待完成后再清除此运行。',
  'This Run uses a Role version that is no longer available. Clear and restart the Run.':
    '此运行使用的角色版本已不可用；请清除并重新开始。',
  'This Run’s saved Role version no longer matches. Clear and restart the Run.':
    '此运行保存的角色版本已不匹配；请清除并重新开始。',
  'A Workflow Role is no longer active. Restore that Role or update the Workflow.':
    '工作流中的一个角色已停用；请恢复该角色或更新工作流。',
  'Select an allowed local Role for this Task, then try again.':
    '请为此任务选择允许的本机角色，然后重试。',
  'The configured local Executor was not found. Choose its installed executable.':
    '找不到已配置的本机执行器；请选择其已安装的可执行文件。',
  'The installed Executor version cannot run this Role. Update it or choose another Executor.':
    '已安装的执行器版本无法运行此角色；请更新执行器或选择其他执行器。',
  'MAM could not continue this action. Open the affected Task to see what is needed.':
    'MAM 无法继续此操作；请打开受影响的任务查看需要处理的内容。'
}
