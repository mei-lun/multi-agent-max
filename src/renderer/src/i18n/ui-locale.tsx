import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { z } from 'zod'
import { ZH_CN_UI_MESSAGES } from './zh-cn-ui-messages'

export type UiLocale = 'en' | 'zh-CN'

type UiLocaleState = Readonly<{
  locale: UiLocale
  setLocale(locale: UiLocale): void
}>

const STORAGE_KEY = 'mam.ui.locale'
const UiLocaleContext = createContext<UiLocaleState>({ locale: 'en', setLocale() {} })
const originalText = new WeakMap<Text, string>()
const renderedText = new WeakMap<Text, string>()
const originalAttributes = new WeakMap<Element, Map<string, string>>()
const renderedAttributes = new WeakMap<Element, Map<string, string>>()

export function UiLocaleProvider({ children }: Readonly<{ children: React.ReactNode }>) {
  const [locale, setLocaleState] = useState<UiLocale>(readInitialLocale)
  const value = useMemo(
    () => ({
      locale,
      setLocale(next: UiLocale) {
        setLocaleState(next)
        globalThis.localStorage?.setItem(STORAGE_KEY, next)
      }
    }),
    [locale]
  )
  useEffect(() => {
    document.documentElement.lang = locale
    z.config(locale === 'zh-CN' ? z.locales.zhCN() : z.locales.en())
  }, [locale])
  return <UiLocaleContext.Provider value={value}>{children}</UiLocaleContext.Provider>
}

export function useUiLocale(): UiLocaleState {
  return useContext(UiLocaleContext)
}

export function LocalizedUiText(): null {
  const { locale } = useUiLocale()
  useEffect(() => installUiLocalization(locale), [locale])
  return null
}

export function translateUiText(source: string, locale: UiLocale): string {
  if (locale === 'en') return source
  const exact = ZH_CN_UI_MESSAGES[source]
  if (exact) return exact
  const patterns: ReadonlyArray<readonly [RegExp, (...values: string[]) => string]> = [
    [/^(\d+) total$/, (count) => `共 ${count} 项`],
    [/^(\d+) shown · (\d+) total$/, (shown, total) => `显示 ${shown} 条 · 共 ${total} 条`],
    [/^(\d+) Attempts$/, (count) => `${count} 次尝试`],
    [/^(\d+) attempts$/, (count) => `${count} 次尝试`],
    [/^(\d+) decisions$/, (count) => `${count} 条结论`],
    [/^(\d+) findings$/, (count) => `${count} 条发现`],
    [/^(\d+) Roles$/, (count) => `${count} 个角色`],
    [/^(\d+) blocking issues$/, (count) => `${count} 个阻塞问题`],
    [
      /^(\d+) skills · (\d+) MCP · (\d+) knowledge$/,
      (skills, mcp, knowledge) => `${skills} 个技能 · ${mcp} 个 MCP · ${knowledge} 个知识库`
    ],
    [/^(\d+)s maximum$/, (seconds) => `最多 ${seconds} 秒`],
    [/^\$(.+) budget$/, (amount) => `预算 $${amount}`],
    [/^\$(.+) run budget$/, (amount) => `运行预算 $${amount}`],
    [/^(\d+) transitions maximum$/, (count) => `最多 ${count} 次转换`],
    [/^Updated (.+)$/, (value) => `更新于 ${value}`],
    [/^Ready (.+)$/, (value) => `就绪于 ${value}`],
    [/^Integrate into (.+)$/, (branch) => `集成到 ${branch}`],
    [/^Integrated into (.+)\.$/, (branch) => `已集成到 ${branch}。`],
    [/^Reviewed commit (.+) is ready\.$/, (commit) => `已审核提交 ${commit} 已就绪。`],
    [
      /^This decision released commit (.+) to the (.+) integration stage\.$/,
      (commit, branch) => `此审核结论已将提交 ${commit} 放行至 ${branch} 集成阶段。`
    ],
    [/^Merge commit (.+) completed this stage\.$/, (commit) => `合并提交 ${commit} 已完成此阶段。`],
    [
      /^A newer commit (.+) replaced this revision\.$/,
      (commit) => `较新的提交 ${commit} 已取代此版本。`
    ],
    [
      /^There are no (.+) Run records\.$/,
      (value) => `没有${translateUiText(value, 'zh-CN')}运行记录。`
    ],
    [/^Selected (.+)$/, (value) => `已选择 ${value}`],
    [/^Resolved by Attempt (.+)$/, (value) => `由尝试 ${value} 解决`],
    [/^Allowed by (\d+) Roles$/, (count) => `${count} 个角色允许使用`],
    [/^(\d+) execution warnings$/, (count) => `${count} 条并发执行警告`],
    [
      /^(\d+) Attempts? already appear active\. Starting remains allowed and records a concurrent execution warning\.$/,
      (count) => `已有 ${count} 次尝试处于活动状态。仍可开始，并会记录并发执行警告。`
    ],
    [/^Depends on (.+)$/i, (value) => `依赖 ${value}`],
    [/^(\d+) local Roles ready: (.+)$/, (count, roles) => `${count} 个本机角色已就绪：${roles}`],
    [
      /^(\d+) local Roles are still working\. Close this dialog and choose Pause to prevent new Tasks; clear the Run after the current Roles finish\.$/,
      (count) =>
        `${count} 个本机角色仍在工作。请关闭此对话框并选择“暂停”以阻止新任务；当前角色完成后即可清除此运行。`
    ],
    [/^Your decision is needed: (.+)$/, (prompt) => `需要你决定：${prompt}`],
    [
      /^Select an allowed local Role for (.+) to continue\.$/,
      (task) => `请选择可执行“${task}”的本机角色以继续。`
    ],
    [
      /^(.+) is assigned to a Role that is not active on this machine\.$/,
      (task) => `“${task}”已分配给未在本机启用的角色。`
    ],
    [
      /^Local Role is working on (.+)\. This may take several minutes\. No action is needed; the next Task will start automatically\.$/,
      (task) =>
        `本机角色正在执行“${task}”。这可能需要几分钟；你无需操作，完成后会自动开始下一个任务。`
    ],
    [
      /^(.+) could not produce an acceptable result after automatic retries\. Open it and choose Retry this Task\.$/,
      (task) => `“${task}”自动重试后仍未生成可接受的结果。请打开该任务并选择“重试此任务”。`
    ],
    [
      /^Before retrying (.+), confirm whether the Role changed anything outside its isolated workspace\.$/,
      (task) => `重试“${task}”前，请确认角色是否更改了隔离工作区以外的内容。`
    ],
    [/^Continues (.+)$/, (value) => `接续 ${value}`],
    [/^Added to (.+)$/, (branch) => `已加入 ${branch}`],
    [/^Reviewer Attempt (.+)$/, (value) => `审核尝试 ${value}`],
    [/^Subject Attempt (.+)$/, (value) => `被审核尝试 ${value}`],
    [/^Selected (.+)$/, (value) => `已选择 ${value}`],
    [
      /^Resolved as (.+) by (.+)\.$/,
      (status, user) => `由 ${user} 决定为${translateUiText(status, 'zh-CN')}。`
    ],
    [/^Attempt (.+)$/, (value) => `尝试 ${value}`],
    [/^Task (.+)$/, (value) => `任务 ${value}`],
    [/^Line (\d+)$/, (value) => `第 ${value} 行`],
    [/^Invalid branch mapping: (.+)$/, (value) => `分支映射无效：${value}`],
    [
      /^(.+) · (enabled|disabled)$/,
      (value, status) => `${value} · ${translateUiText(status, 'zh-CN')}`
    ],
    [
      /^(project-files|local-directory|git-repository|vector-store|mcp-resource) · (.+)$/,
      (kind, source) => `${translateUiText(kind, 'zh-CN')} · ${source}`
    ],
    [/^Skill · (.+)$/, (value) => `技能 · ${value}`],
    [/^Knowledge · (.+)$/, (value) => `知识库 · ${translateUiText(value, 'zh-CN')}`],
    [/^Allow (search|read)$/, (value) => `允许${value === 'search' ? '搜索' : '读取'}`],
    [/^Configured locally · fallback (.+)$/, (value) => `已在本机配置 · 备用方式 ${value}`],
    [/^New (.+) version$/, (kind) => `新建${translateProfileKind(kind)}版本`],
    [/^New (.+) Profile$/, (kind) => `新建${translateProfileKind(kind)}配置`],
    [/^Exported to (.+)$/, (path) => `已导出到 ${path}`],
    [
      /^New (role|executor|provider|model|skill|mcp|knowledge)$/,
      (kind) => `新建${translateProfileKind(kind)}`
    ]
  ]
  for (const [pattern, replace] of patterns) {
    const match = pattern.exec(source)
    if (match) return replace(...match.slice(1))
  }
  return source
}

function installUiLocalization(locale: UiLocale): () => void {
  const localizeText = (node: Text): void => {
    if (shouldSkipText(node.parentElement)) return
    const current = node.data
    const whitespace = /^(\s*)[\s\S]*?(\s*)$/.exec(current)
    const previousRendered = renderedText.get(node)
    if (
      !originalText.has(node) ||
      (previousRendered !== undefined && current !== previousRendered)
    ) {
      originalText.set(node, current.trim())
    }
    const source = originalText.get(node) ?? current.trim()
    if (!source) return
    const translated = translateUiText(source, locale)
    const next = `${whitespace?.[1] ?? ''}${translated}${whitespace?.[2] ?? ''}`
    renderedText.set(node, next)
    if (next !== current) node.data = next
  }
  const localizeElement = (element: Element): void => {
    if (shouldSkipAttributes(element)) return
    const originalsForElement = originalAttributes.get(element) ?? new Map<string, string>()
    const renderedForElement = renderedAttributes.get(element) ?? new Map<string, string>()
    for (const name of ['aria-label', 'placeholder', 'title']) {
      const current = element.getAttribute(name)
      if (!current) continue
      if (!originalsForElement.has(name) || current !== renderedForElement.get(name)) {
        originalsForElement.set(name, current)
      }
      const translated = translateUiText(originalsForElement.get(name)!, locale)
      renderedForElement.set(name, translated)
      if (translated !== current) element.setAttribute(name, translated)
    }
    originalAttributes.set(element, originalsForElement)
    renderedAttributes.set(element, renderedForElement)
  }
  const visit = (root: Node): void => {
    if (root instanceof Text) {
      localizeText(root)
      return
    }
    if (root instanceof Element) localizeElement(root)
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT)
    while (walker.nextNode()) {
      if (walker.currentNode instanceof Text) localizeText(walker.currentNode)
      else localizeElement(walker.currentNode as Element)
    }
  }
  visit(document.body)
  let localizationFrame: number | undefined
  const scheduleDocumentLocalization = (): void => {
    if (localizationFrame !== undefined) return
    localizationFrame = window.requestAnimationFrame(() => {
      localizationFrame = undefined
      visit(document.body)
    })
  }
  const observer = new MutationObserver((records) => {
    if (records.some(needsLocalization)) scheduleDocumentLocalization()
  })
  observer.observe(document.body, {
    attributes: true,
    attributeFilter: ['aria-label', 'placeholder', 'title'],
    childList: true,
    characterData: true,
    subtree: true
  })
  return () => {
    observer.disconnect()
    if (localizationFrame !== undefined) window.cancelAnimationFrame(localizationFrame)
  }
}

function needsLocalization(record: MutationRecord): boolean {
  if (record.type === 'childList') return record.addedNodes.length > 0
  if (record.type === 'characterData') {
    const textNode = record.target as Text
    return textNode.data !== renderedText.get(textNode)
  }
  if (record.type === 'attributes') {
    const element = record.target as Element
    return (
      element.getAttribute(record.attributeName!) !==
      renderedAttributes.get(element)?.get(record.attributeName!)
    )
  }
  return false
}

function shouldSkipText(element: Element | null): boolean {
  return Boolean(
    element?.closest(
      'pre, code, textarea, input, [contenteditable=true], [data-i18n-skip], .font-mono'
    )
  )
}

function shouldSkipAttributes(element: Element): boolean {
  return Boolean(element.closest('pre, code, [data-i18n-skip]'))
}

function readInitialLocale(): UiLocale {
  const stored = globalThis.localStorage?.getItem(STORAGE_KEY)
  if (stored === 'en' || stored === 'zh-CN') return stored
  return globalThis.navigator?.language?.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en'
}

function translateProfileKind(kind: string): string {
  return (
    {
      role: '角色',
      executor: '执行器',
      provider: '提供方',
      model: '模型',
      skill: '技能',
      mcp: 'MCP',
      knowledge: '知识库'
    } as Record<string, string>
  )[kind]!
}
