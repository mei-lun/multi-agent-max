import { useCallback, useEffect, useState } from 'react'
import type { CreativeRendererApi } from '../../../../shared/mam/creative-api'
import type { CreativeDelivery } from '../../../../shared/mam/creative-delivery'
import { Button } from '../../components/ui/button'
import { useUiLocale } from '../../i18n/ui-locale'

export function MamCreativeDeliveries({
  api,
  projectDirectory
}: {
  api(): CreativeRendererApi
  projectDirectory?: string | undefined
}) {
  const { locale } = useUiLocale()
  const text = (zh: string, en: string) => (locale === 'zh-CN' ? zh : en)
  const [items, setItems] = useState<CreativeDelivery[]>([])
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const refresh = useCallback(async () => setItems(await api().listDeliveries()), [api])
  useEffect(() => {
    void refresh().catch((reason: unknown) => setError(String(reason)))
  }, [refresh, projectDirectory])
  const transfer = async (item: CreativeDelivery, kind: 'exportDelivery' | 'importDelivery') => {
    setPending(true)
    setError('')
    try {
      await api()[kind]({
        workflowRunId: item.workflowRunId,
        attemptId: item.attemptId,
        contractId: item.contractId
      })
      await refresh()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setPending(false)
    }
  }
  return (
    <section
      className="space-y-3 border-t border-border pt-6"
      aria-label={text('成果交付', 'Artifact delivery')}
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-semibold">{text('成果交付', 'Artifact delivery')}</h2>
        <Button
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={() => void refresh().catch((reason: unknown) => setError(String(reason)))}
        >
          {text('刷新', 'Refresh')}
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        {text(
          'Git 保存已提交成果的清单。使用交付包把对应素材带到另一台机器，导入时按提交记录校验。',
          'Git stores submitted manifests. Delivery packages carry the matching files to another machine and are verified against the submitted claim.'
        )}
      </p>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {!items.length && (
        <p className="text-sm text-muted-foreground">
          {text(
            '当前项目尚无已提交的二进制成果。',
            'No submitted binary artifacts in the current project.'
          )}
        </p>
      )}
      {items.map((item) => (
        <div
          key={`${item.attemptId}:${item.contractId}`}
          className="flex flex-wrap items-center gap-3 rounded-md border border-border p-3"
        >
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">{item.title}</p>
            <p className="text-xs text-muted-foreground">
              {item.files} {text('个文件', 'files')} · {(item.bytes / 1048576).toFixed(1)}
              {text(' MiB · ', ' MiB · ')}
              {item.available
                ? text('本机素材完整', 'Files available')
                : text('本机缺少素材', 'Files missing')}
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            disabled={pending || !item.available}
            onClick={() => void transfer(item, 'exportDelivery')}
          >
            {text('导出交付包', 'Export package')}
          </Button>
          <Button
            size="sm"
            variant={item.available ? 'outline' : 'default'}
            disabled={pending}
            onClick={() => void transfer(item, 'importDelivery')}
          >
            {text('导入交付包', 'Import package')}
          </Button>
        </div>
      ))}
    </section>
  )
}
