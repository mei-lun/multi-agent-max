import { describe, expect, it } from 'vitest'
import { translateUiText } from './ui-locale'

describe('UI localization', () => {
  it('translates primary surfaces and workflow controls to Simplified Chinese', () => {
    expect(translateUiText('Workflow overview', 'zh-CN')).toBe('工作流概览')
    expect(translateUiText('Merge Queue', 'zh-CN')).toBe('合并队列')
    expect(translateUiText('Role selection', 'zh-CN')).toBe('角色选择')
    expect(translateUiText('Save version', 'zh-CN')).toBe('保存版本')
  })

  it('translates dynamic counts while retaining authority identifiers', () => {
    expect(translateUiText('3 Attempts', 'zh-CN')).toBe('3 次尝试')
    expect(translateUiText('Allowed by 2 Roles', 'zh-CN')).toBe('2 个角色允许使用')
    expect(translateUiText('run.2026-07-28', 'zh-CN')).toBe('run.2026-07-28')
  })

  it('translates dynamic workflow and resource labels without changing technical values', () => {
    expect(
      translateUiText(
        '2 Attempts already appear active. Starting remains allowed and records a concurrent execution warning.',
        'zh-CN'
      )
    ).toBe('已有 2 次尝试处于活动状态。仍可开始，并会记录并发执行警告。')
    expect(translateUiText('codex-cli · enabled', 'zh-CN')).toBe('codex-cli · 已启用')
    expect(translateUiText('project-files · /repo', 'zh-CN')).toBe('项目文件 · /repo')
    expect(translateUiText('depends on task.build', 'zh-CN')).toBe('依赖 task.build')
  })

  it('keeps English unchanged', () => {
    expect(translateUiText('Workflow overview', 'en')).toBe('Workflow overview')
  })
})
