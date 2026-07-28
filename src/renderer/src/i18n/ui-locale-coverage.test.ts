import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { translateUiText } from './ui-locale'

const RENDERER_ROOT = join(process.cwd(), 'src', 'renderer', 'src')
const TRANSLATED_ATTRIBUTES = new Set([
  'actionLabel',
  'aria-label',
  'description',
  'empty',
  'heading',
  'label',
  'placeholder',
  'title'
])
const INTENTIONAL_ENGLISH = new Set(['English', 'JSON Schema', 'Multi-Agent Max', 'v'])

describe('Simplified Chinese UI coverage', () => {
  it('translates every static user-facing Renderer phrase', () => {
    expect(rendererFiles().flatMap(untranslatedPhrases)).toEqual([])
  })
})

function rendererFiles(): string[] {
  const files: string[] = []
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory() && entry.name !== 'ui') visit(path)
      else if (path.endsWith('.tsx') && !path.endsWith('.test.tsx')) files.push(path)
    }
  }
  visit(RENDERER_ROOT)
  return files
}

function untranslatedPhrases(file: string): string[] {
  const sourceFile = ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  )
  const missing: string[] = []
  const check = (text: string, node: ts.Node): void => {
    const phrase = text.replace(/\s+/g, ' ').trim()
    if (!/[A-Za-z]/.test(phrase) || INTENTIONAL_ENGLISH.has(phrase)) return
    if (translateUiText(phrase, 'zh-CN') === phrase) {
      const line = sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1
      missing.push(`${file}:${line}: ${phrase}`)
    }
  }
  const inspect = (node: ts.Node): void => {
    if (ts.isJsxText(node)) check(node.text, node)
    if (
      ts.isJsxAttribute(node) &&
      ts.isIdentifier(node.name) &&
      TRANSLATED_ATTRIBUTES.has(node.name.text)
    ) {
      const value = staticAttributeValue(node)
      if (value) check(value, node)
    }
    if (ts.isJsxExpression(node) && isStaticString(node.expression)) {
      check(node.expression.text, node)
    }
    ts.forEachChild(node, inspect)
  }
  inspect(sourceFile)
  return missing
}

function staticAttributeValue(node: ts.JsxAttribute): string | undefined {
  const initializer = node.initializer
  if (!initializer) return undefined
  if (ts.isStringLiteral(initializer)) return initializer.text
  const expression = ts.isJsxExpression(initializer) ? initializer.expression : undefined
  return isStaticString(expression) ? expression.text : undefined
}

function isStaticString(
  expression: ts.Expression | undefined
): expression is ts.StringLiteral | ts.NoSubstitutionTemplateLiteral {
  return Boolean(
    expression && (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression))
  )
}
