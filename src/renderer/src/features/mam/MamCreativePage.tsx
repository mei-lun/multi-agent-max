import { useCallback, useEffect, useState } from 'react'
import { Download, Loader2, PackageOpen, RefreshCw } from 'lucide-react'
import type { CreativeComponent, CreativeRendererApi } from '../../../../shared/mam/creative-api'
import type { ComponentId } from '../../../../shared/mam/components'
import { Button } from '../../components/ui/button'
import { Badge } from '../../components/ui/badge'
import { useUiLocale } from '../../i18n/ui-locale'

const labels: Record<ComponentId, [string, string, string, string]> = {
  'creative.image': [
    '图片',
    'Images',
    '生成、编辑、扩图与局部重绘',
    'Generate, edit, outpaint and inpaint'
  ],
  'creative.video': [
    '视频',
    'Video',
    '文本、参考图与视频编辑',
    'Text, reference images and video editing'
  ],
  'creative.speech': [
    '语音',
    'Speech',
    '文字转语音、音色与试听',
    'Text to speech, voices and playback'
  ],
  'creative.music': ['音乐', 'Music', '音乐、歌词歌曲与音频剪辑', 'Music, songs and audio editing'],
  'creative.writing': [
    '写作',
    'Writing',
    '文稿、设定与剧情',
    'Manuscripts, worldbuilding and stories'
  ],
  'creative.spine': [
    'Spine',
    'Spine',
    '部件、骨骼、动作与工程导出',
    'Parts, rigs, animation and project export'
  ],
  'creative.model3d': ['3D', '3D', '形状、贴图与骨骼动画', 'Shape, texture and rigged animation'],
  'creative.constellation': [
    '星图',
    'Constellation',
    '创作节点、蓝图与流程',
    'Creative nodes, blueprints and workflows'
  ]
}

function api(): CreativeRendererApi {
  const bridge = (window as typeof window & { mamCreative?: CreativeRendererApi }).mamCreative
  if (!bridge)
    throw new Error('请在 MAM 桌面应用中管理组件 / Open the MAM desktop app to manage components')
  return bridge
}

export function MamCreativePage(): React.JSX.Element {
  const { locale } = useUiLocale()
  const text = (zh: string, en: string) => (locale === 'zh-CN' ? zh : en)
  const [components, setComponents] = useState<CreativeComponent[]>([])
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const perform = useCallback(async (operation: () => Promise<CreativeComponent[] | void>) => {
    setPending(true)
    setError('')
    try {
      const result = await operation()
      if (result) setComponents(result)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setPending(false)
    }
  }, [])
  useEffect(() => {
    void perform(() => api().list())
  }, [perform])
  return (
    <section
      className="mx-auto max-w-6xl space-y-6 p-6"
      aria-label={text('创作组件', 'Creative components')}
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{text('创作组件', 'Creative components')}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {text(
              '按需导入工作台组件，模型资源由各组件单独管理。',
              'Import the workbenches you need. Each component manages its model resources separately.'
            )}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() => void perform(() => api().list())}
          >
            <RefreshCw />
            {text('刷新', 'Refresh')}
          </Button>
          <Button size="sm" disabled={pending} onClick={() => void perform(() => api().install())}>
            {pending ? <Loader2 className="animate-spin" /> : <Download />}
            {text('导入组件', 'Import component')}
          </Button>
        </div>
      </header>
      {error && (
        <div
          role="alert"
          className="rounded-md border border-destructive p-3 text-sm text-destructive"
        >
          {error}
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        {text(
          '当前支持本地组件包导入；在线组件目录尚未发布。',
          'Local package import is available. An online component catalog has not been published.'
        )}
      </p>
      <div className="grid gap-4 md:grid-cols-2">
        {components.map((component) => {
          const label = labels[component.id]
          const installed =
            component.versions.find((version) => version.enabled) ?? component.versions[0]
          return (
            <article
              key={component.id}
              className="space-y-3 rounded-lg border border-border bg-card p-4 text-card-foreground"
            >
              <div className="flex items-center gap-2">
                <PackageOpen className="size-4 text-muted-foreground" />
                <h2 className="font-medium">{text(label[0], label[1])}</h2>
                {!component.versions.length && (
                  <Badge variant="secondary" className="ml-auto">
                    {text('未安装', 'Not installed')}
                  </Badge>
                )}
              </div>
              <p className="text-sm text-muted-foreground">
                {installed
                  ? installed.manifest.operations.map((operation) => operation.title).join(' · ')
                  : text(label[2], label[3])}
              </p>
              {component.versions.map((version) => (
                <div
                  key={version.manifest.version}
                  className="space-y-2 border-t border-border pt-3"
                >
                  <div className="flex flex-wrap gap-2 text-xs">
                    <span>v{version.manifest.version}</span>
                    <Badge variant="secondary">
                      {version.enabled ? text('已启用', 'Enabled') : text('已停用', 'Disabled')}
                    </Badge>
                    {version.status !== 'installed' && (
                      <span>
                        {version.status === 'unsupported'
                          ? text('当前环境不支持', 'Unsupported environment')
                          : text('需要安装资源', 'Resources required')}
                      </span>
                    )}
                  </div>
                  {version.missingResources.length > 0 && (
                    <p className="text-xs text-muted-foreground">
                      {version.missingResources.join(', ')}
                    </p>
                  )}
                  <div className="flex flex-wrap gap-2">
                    {version.enabled ? (
                      <>
                        <Button
                          size="sm"
                          disabled={pending}
                          onClick={() => void perform(() => api().open(component.id))}
                        >
                          {text('打开工作台', 'Open workbench')}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={pending}
                          onClick={() => void perform(() => api().disable(component.id))}
                        >
                          {text('停用', 'Disable')}
                        </Button>
                      </>
                    ) : (
                      <Button
                        size="sm"
                        disabled={pending || version.status !== 'installed'}
                        onClick={() =>
                          void perform(() => api().enable(component.id, version.manifest.version))
                        }
                      >
                        {text('启用', 'Enable')}
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={pending}
                      onClick={() =>
                        void perform(() => api().remove(component.id, version.manifest.version))
                      }
                    >
                      {text('卸载组件', 'Uninstall component')}
                    </Button>
                  </div>
                </div>
              ))}
            </article>
          )
        })}
      </div>
    </section>
  )
}
