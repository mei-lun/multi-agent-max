import type * as React from 'react'
import { Input } from '../../components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '../../components/ui/select'
import { MamWorkflowLabeledField } from './MamWorkflowFieldControls'

export function MamProfileTextField({
  label,
  value,
  description,
  placeholder,
  type,
  mono,
  onChange
}: Readonly<{
  label: string
  value: string
  description?: string
  placeholder?: string
  type?: React.HTMLInputTypeAttribute
  mono?: boolean
  onChange(value: string): void
}>): React.JSX.Element {
  return (
    <MamWorkflowLabeledField label={label} {...(description ? { description } : {})}>
      <Input
        type={type}
        className={mono ? 'font-mono' : undefined}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </MamWorkflowLabeledField>
  )
}

export function MamProfileNumberField({
  label,
  value,
  min,
  step,
  onChange
}: Readonly<{
  label: string
  value: number
  min?: number
  step?: number
  onChange(value: number): void
}>): React.JSX.Element {
  return (
    <MamWorkflowLabeledField label={label}>
      <Input
        type="number"
        value={value}
        min={min}
        step={step}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </MamWorkflowLabeledField>
  )
}

export function MamProfileSelectField({
  label,
  value,
  description,
  options,
  onChange
}: Readonly<{
  label: string
  value: string
  description?: string
  options: readonly Readonly<{ value: string; label: string }>[]
  onChange(value: string): void
}>): React.JSX.Element {
  return (
    <MamWorkflowLabeledField label={label} {...(description ? { description } : {})}>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </MamWorkflowLabeledField>
  )
}

export function MamProfileCheckbox({
  label,
  description,
  checked,
  disabled,
  onChange
}: Readonly<{
  label: string
  description?: string
  checked: boolean
  disabled?: boolean
  onChange(checked: boolean): void
}>): React.JSX.Element {
  return (
    <label
      data-disabled={disabled ? 'true' : 'false'}
      className="flex items-start gap-2 rounded-md border border-border px-3 py-2 text-xs data-[disabled=true]:cursor-not-allowed data-[disabled=true]:opacity-60"
    >
      <input
        type="checkbox"
        className="mt-0.5 size-3.5 shrink-0 accent-primary"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="min-w-0">
        <span className="block font-medium">{label}</span>
        {description && (
          <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
            {description}
          </span>
        )}
      </span>
    </label>
  )
}

export function toggleProfileId(values: readonly string[], id: string, enabled: boolean): string[] {
  if (enabled) return values.includes(id) ? [...values] : [...values, id]
  return values.filter((candidate) => candidate !== id)
}
