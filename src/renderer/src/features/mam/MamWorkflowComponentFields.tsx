import { useEffect, useState } from 'react'
import type { CreativeDraft } from '../../../../shared/mam/creative-draft'
import type { CreativeRendererApi, CreativeComponent } from '../../../../shared/mam/creative-api'
import { Button } from '../../components/ui/button'
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
  const [drafts, setDrafts] = useState<CreativeDraft[]>([])
  const [loading, setLoading] = useState(false)
  const [catalog, setCatalog] = useState<CreativeComponent[]>([])
  useEffect(() => {
    const api = (window as typeof window & { mamCreative?: CreativeRendererApi }).mamCreative
    void api
      ?.list()
      .then(setCatalog)
      .catch((reason: unknown) => setError(String(reason)))
  }, [])
  const selectedPackage = catalog
    .find((item) => item.id === value.id)
    ?.versions.find((item) => item.manifest.version === value.version)?.manifest
  const { locale } = useUiLocale()
  const tr = (zh: string, en: string) => (locale === 'zh-CN' ? zh : en)
  return (
    <div className="space-y-3 rounded-md border border-border p-3">
      <MamWorkflowLabeledField
        label={tr('工作台交付草稿（可选）', 'Workbench delivery draft (optional)')}
      >
        <Button
          variant="outline"
          size="sm"
          disabled={loading}
          onClick={() => {
            setLoading(true)
            const api = (window as typeof window & { mamCreative: CreativeRendererApi }).mamCreative
            void api
              .listDrafts()
              .then(setDrafts)
              .catch((reason: unknown) => setError(String(reason)))
              .finally(() => setLoading(false))
          }}
        >
          {tr('加载当前项目草稿', 'Load project drafts')}
        </Button>
        <Select
          value={value.draft?.sha256 ?? 'generate'}
          onValueChange={(hash) => {
            if (hash === 'generate') {
              const { draft: _draft, ...generated } = value
              onChange(generated)
            } else {
              const selected = drafts.find((draft) => draft.sha256 === hash)
              if (selected) {
                const manifest = catalog
                  .find((item) => item.id === selected.componentId)
                  ?.versions.find(
                    (item) => item.manifest.version === selected.componentVersion
                  )?.manifest
                if (!manifest) {
                  setError(
                    tr('先安装草稿对应版本的组件。', 'Install the draft’s component version first.')
                  )
                  return
                }
                onChange({
                  ...value,
                  id: selected.componentId,
                  version: selected.componentVersion,
                  hostApiVersion: manifest.hostApiVersion,
                  operation: selected.operation,
                  draft: { sha256: hash },
                  params: {}
                })
              }
            }
          }}
        >
          <SelectTrigger>
            <SelectValue placeholder={value.draft?.sha256} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="generate">{tr('执行生成操作', 'Run generation')}</SelectItem>
            {drafts.map((draft) => (
              <SelectItem key={draft.sha256} value={draft.sha256}>
                {draft.operation} · {draft.jobId.slice(0, 8)} · {draft.sha256.slice(0, 8)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {value.draft && (
          <p className="break-all text-xs text-muted-foreground">
            {tr(
              '提交已保存成果；仍须角色授权并通过工作流审核。',
              'Submit saved results with role authorization and normal workflow review.'
            )}{' '}
            {value.draft.sha256}
          </p>
        )}
      </MamWorkflowLabeledField>
      <MamWorkflowLabeledField label={tr('创作组件', 'Component')}>
        <Select
          value={value.id}
          onValueChange={(id) => {
            const installed = catalog
              .find((item) => item.id === id)
              ?.versions.find((item) => item.enabled && item.status === 'installed')?.manifest
            const { draft: _draft, ...base } = value
            onChange({
              ...base,
              id: componentIdSchema.parse(id),
              ...(installed
                ? {
                    version: installed.version,
                    hostApiVersion: installed.hostApiVersion,
                    operation: installed.operations[0]!.id
                  }
                : {})
            })
          }}
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
          onChange={(event) => {
            const manifest = catalog
              .find((item) => item.id === value.id)
              ?.versions.find((item) => item.manifest.version === event.target.value)?.manifest
            onChange({
              ...value,
              version: event.target.value,
              ...(manifest ? { hostApiVersion: manifest.hostApiVersion } : {})
            })
          }}
        />
      </MamWorkflowLabeledField>
      <MamWorkflowLabeledField label={tr('操作', 'Operation')}>
        {selectedPackage ? (
          <Select
            value={value.operation}
            onValueChange={(operation) => onChange({ ...value, operation })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {selectedPackage.operations.map((operation) => (
                <SelectItem key={operation.id} value={operation.id}>
                  {operation.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <Input
            value={value.operation}
            onChange={(event) => onChange({ ...value, operation: event.target.value })}
          />
        )}
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
