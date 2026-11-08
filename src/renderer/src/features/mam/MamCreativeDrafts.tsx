import { useEffect, useState } from 'react'
import type { CreativeRendererApi } from '../../../../shared/mam/creative-api'
import type { CreativeDraftJob } from '../../../../shared/mam/creative-draft'
import { Button } from '../../components/ui/button'
import { useUiLocale } from '../../i18n/ui-locale'

export function MamCreativeDrafts({
  api,
  projectDirectory
}: {
  api(): CreativeRendererApi
  projectDirectory?: string | undefined
}) {
  const { locale } = useUiLocale()
  const tr = (zh: string, en: string) => (locale === 'zh-CN' ? zh : en)
  const [jobs, setJobs] = useState<CreativeDraftJob[]>([])
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const perform = async (jobId?: string) => {
    setPending(true)
    setError('')
    try {
      if (jobId) {
        await api().createDraft(jobId)
        setMessage(
          tr(
            '草稿已保存。请在工作流的组件任务中选择此草稿，并按正常流程启动与审核。',
            'Draft saved. Select it in a workflow component task, then start and review the task normally.'
          )
        )
      }
      setJobs(await api().listDraftJobs())
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setPending(false)
    }
  }
  useEffect(() => {
    setJobs([])
    setMessage('')
  }, [projectDirectory])
  return (
    <section className="space-y-3 border-t border-border pt-4">
      <h2 className="font-medium">{tr('工作台成果交付', 'Workbench delivery drafts')}</h2>
      <p className="text-sm text-muted-foreground">
        {tr(
          '刷新当前项目的已完成作业，保存其文本和素材为不可变草稿，再交给组件任务审核。',
          'Refresh completed jobs in this project, save their text and assets as immutable drafts, then submit through a component task for review.'
        )}
      </p>
      <Button
        variant="outline"
        size="sm"
        disabled={pending || !projectDirectory}
        onClick={() => void perform()}
      >
        {tr('刷新成果', 'Refresh results')}
      </Button>
      {jobs.map((job) => (
        <div key={job.id} className="space-y-2 rounded-md border border-border p-3">
          <p className="text-sm">
            {job.componentId} · {job.operation} · {job.assetCount} {tr('素材', 'assets')}
          </p>
          <p className="break-all text-xs text-muted-foreground">
            {job.id} · {job.textPreview}
          </p>
          <Button size="sm" disabled={pending} onClick={() => void perform(job.id)}>
            {tr('保存交付草稿', 'Save delivery draft')}
          </Button>
        </div>
      ))}
      {message && (
        <p role="status" className="text-sm text-muted-foreground">
          {message}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </section>
  )
}
