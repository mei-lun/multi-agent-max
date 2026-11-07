import { useState } from 'react'
import type { ComponentTaskDescriptor } from '../../../../shared/mam/domain/component-task'
import { componentIdSchema } from '../../../../shared/mam/components'
import { Input } from '../../components/ui/input'
import { Textarea } from '../../components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '../../components/ui/select'
import { MamWorkflowLabeledField } from './MamWorkflowFieldControls'
import { useUiLocale } from '../../i18n/ui-locale'

export function MamWorkflowComponentFields({
  value,
  onChange
}: {
  value: ComponentTaskDescriptor
  onChange(value: ComponentTaskDescriptor): void
}) {
  const [error, setError] = useState('')
  const { locale } = useUiLocale()
  const tr = (zh: string, en: string) => (locale === 'zh-CN' ? zh : en)
  return (
    <div className="space-y-3 rounded-md border border-border p-3">
      <MamWorkflowLabeledField label={tr('创作组件', 'Component')}>
        <Select
          value={value.id}
          onValueChange={(id) => onChange({ ...value, id: componentIdSchema.parse(id) })}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {componentIdSchema.options.map((id) => (
              <SelectItem key={id} value={id}>
                {id}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </MamWorkflowLabeledField>
      <MamWorkflowLabeledField label={tr('组件版本', 'Component version')}>
        <Input
          value={value.version}
          onChange={(event) => onChange({ ...value, version: event.target.value })}
        />
      </MamWorkflowLabeledField>
      <MamWorkflowLabeledField label={tr('操作', 'Operation')}>
        <Input
          value={value.operation}
          onChange={(event) => onChange({ ...value, operation: event.target.value })}
        />
      </MamWorkflowLabeledField>
      <MamWorkflowLabeledField label={tr('参数', 'Parameters')}>
        <Textarea
          key={`${value.id}:${value.operation}`}
          defaultValue={JSON.stringify(value.params, null, 2)}
          onBlur={(event) => {
            try {
              const params: unknown = JSON.parse(event.target.value)
              if (!params || typeof params !== 'object' || Array.isArray(params))
                throw new Error('参数必须是 JSON 对象 / Parameters must be an object')
              onChange({ ...value, params: params as Record<string, unknown> })
              setError('')
            } catch (reason) {
              setError(reason instanceof Error ? reason.message : String(reason))
            }
          }}
        />
      </MamWorkflowLabeledField>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        {tr(
          `角色须授权 component:${value.id}，运行时使用已固定的组件版本和角色模型。`,
          `Authorize component:${value.id} for the role. Execution uses the pinned version and role model.`
        )}
      </p>
    </div>
  )
}
