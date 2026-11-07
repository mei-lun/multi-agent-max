import { useUiLocale } from '../../i18n/ui-locale'
import { useEffect, useState } from 'react'
import type { RoleProfile } from '../../../../shared/mam/domain/role'
import type { CreativeComponent, CreativeRendererApi } from '../../../../shared/mam/creative-api'
import { Checkbox } from '../../components/ui/checkbox'
import type { ModelProfile } from '../../../../shared/mam/domain/execution-profile'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '../../components/ui/select'

export function MamRoleComponentFields({
  profile,
  models,
  onChange
}: {
  profile: RoleProfile
  models: readonly ModelProfile[]
  onChange(profile: RoleProfile): void
}) {
  const { locale } = useUiLocale()
  const [components, setComponents] = useState<CreativeComponent[]>([])
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    const api = (window as typeof window & { mamCreative?: CreativeRendererApi }).mamCreative
    void api
      ?.list()
      .then((values) => {
        if (active) setComponents(values)
      })
      .catch(() => {
        if (active) setError('无法读取已安装组件 / Could not list installed components')
      })
    return () => {
      active = false
    }
  }, [])
  const available = components.filter((component) =>
    component.versions.some((version) => version.enabled)
  )
  return (
    <fieldset className="space-y-2 rounded-md border border-border p-3">
      <legend className="text-sm font-medium">
        {locale === 'zh-CN' ? '创作组件' : 'Creative components'}
      </legend>
      <p className="text-xs text-muted-foreground">
        勾选角色可以调用的已启用组件；具体操作仍受角色权限与任务预算限制。
      </p>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      {!available.length && (
        <p className="text-xs text-muted-foreground">先在“创作组件”页面安装并启用工作台。</p>
      )}
      {available.map((component) => {
        const key = `component:${component.id}`,
          selected = profile.tools.includes(key)
        const binding = profile.componentBindings?.find((item) => item.componentId === component.id)
        return (
          <div key={component.id} className="space-y-2">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={selected}
                onCheckedChange={(value) =>
                  onChange({
                    ...profile,
                    tools:
                      value === true
                        ? [...new Set([...profile.tools, key])]
                        : profile.tools.filter((tool) => tool !== key),
                    componentBindings:
                      value === true
                        ? (profile.componentBindings ?? [])
                        : (profile.componentBindings ?? []).filter(
                            (item) => item.componentId !== component.id
                          )
                  })
                }
              />
              {component.id}
            </label>
            {selected && (
              <Select
                value={binding?.modelProfileId ?? '__native__'}
                onValueChange={(modelProfileId) => {
                  const entries = (profile.componentBindings ?? []).filter(
                    (item) => item.componentId !== component.id
                  )
                  onChange({
                    ...profile,
                    componentBindings: [
                      ...entries,
                      {
                        componentId: component.id,
                        ...(modelProfileId !== '__native__' ? { modelProfileId } : {})
                      }
                    ]
                  })
                }}
              >
                <SelectTrigger aria-label={`${component.id} 模型`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__native__">
                    {locale === 'zh-CN' ? '本地处理' : 'No model'}
                  </SelectItem>
                  {models.map((model) => (
                    <SelectItem key={model.id} value={model.id}>
                      {model.displayName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        )
      })}
    </fieldset>
  )
}
