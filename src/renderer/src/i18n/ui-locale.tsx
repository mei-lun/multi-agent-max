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
    [/^(\d+) Attempts$/, (count) => `${count} 次尝试`],
    [/^(\d+) attempts$/, (count) => `${count} 次尝试`],
    [/^(\d+) decisions$/, (count) => `${count} 条结论`],
    [/^(\d+) findings$/, (count) => `${count} 条发现`],
    [/^(\d+) Roles$/, (count) => `${count} 个角色`],
    [
      /^(\d+) skills · (\d+) MCP · (\d+) knowledge$/,
      (skills, mcp, knowledge) => `${skills} 个技能 · ${mcp} 个 MCP · ${knowledge} 个知识库`
    ],
    [/^(\d+)s maximum$/, (seconds) => `最多 ${seconds} 秒`],
    [/^\$(.+) budget$/, (amount) => `预算 $${amount}`],
    [/^\$(.+) run budget$/, (amount) => `运行预算 $${amount}`],
    [/^(\d+) transitions maximum$/, (count) => `最多 ${count} 次转换`],
    [/^Updated (.+)$/, (value) => `更新于 ${value}`],
    [/^Selected (.+)$/, (value) => `已选择 ${value}`],
    [/^Resolved by Attempt (.+)$/, (value) => `由尝试 ${value} 解决`],
    [/^Allowed by (\d+) Roles$/, (count) => `${count} 个角色允许使用`],
    [/^(\d+) execution warnings$/, (count) => `${count} 条并发执行警告`],
    [
      /^(\d+) Attempts? already appear active\. Starting remains allowed and records a concurrent execution warning\.$/,
      (count) => `已有 ${count} 次尝试处于活动状态。仍可开始，并会记录并发执行警告。`
    ],
    [/^Depends on (.+)$/i, (value) => `依赖 ${value}`],
    [/^Continues (.+)$/, (value) => `接续 ${value}`],
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
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === 'characterData') localizeText(record.target as Text)
      else if (record.type === 'attributes') localizeElement(record.target as Element)
      else for (const node of record.addedNodes) visit(node)
    }
  })
  observer.observe(document.body, {
    attributes: true,
    attributeFilter: ['aria-label', 'placeholder', 'title'],
    childList: true,
    characterData: true,
    subtree: true
  })
  return () => observer.disconnect()
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
