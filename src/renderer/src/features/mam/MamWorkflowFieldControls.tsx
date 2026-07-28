import type { ReactNode } from 'react'
import { Input } from '../../components/ui/input'
import { Textarea } from '../../components/ui/textarea'

export function MamWorkflowLabeledField({
  label,
  description,
  children
}: Readonly<{
  label: string
  description?: string
  children: ReactNode
}>): React.JSX.Element {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium">{label}</span>
      {description && <span className="block text-xs text-muted-foreground">{description}</span>}
      {children}
    </label>
  )
}

export function MamWorkflowNumberField({
  label,
  value,
  minimum = 0,
  step = '1',
  onChange
}: Readonly<{
  label: string
  value: number
  minimum?: number
  step?: string
  onChange(value: number): void
}>): React.JSX.Element {
  return (
    <MamWorkflowLabeledField label={label}>
      <Input
        type="number"
        min={minimum}
        step={step}
        value={value}
        onChange={(event) => onChange(event.target.valueAsNumber)}
      />
    </MamWorkflowLabeledField>
  )
}

export function MamWorkflowStringListField({
  label,
  description,
  values,
  onChange
}: Readonly<{
  label: string
  description?: string
  values: readonly string[]
  onChange(values: string[]): void
}>): React.JSX.Element {
  return (
    <MamWorkflowLabeledField label={label} {...(description ? { description } : {})}>
      <Textarea
        className="min-h-20 font-mono"
        value={values.join('\n')}
        onChange={(event) => onChange(parseLines(event.target.value))}
      />
    </MamWorkflowLabeledField>
  )
}

export function parseLines(value: string): string[] {
  return value
    .split(/\r?\n/u)
    .map((item) => item.trim())
    .filter(Boolean)
}
