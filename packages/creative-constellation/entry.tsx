import { createRoot } from 'react-dom/client'
import { ConstellationStudio } from '../../vendor/levelup/baseline-6542241/src/components/ConstellationStudio'
import { resolveAttachmentRef } from './media-bridge'
import './shell.css'
const models = (await window.componentHost?.request({ action: 'listModels' })) || [],
  profiles = models
    .filter((m: any) => m.kind === 'text')
    .map((m: any) => ({
      id: m.id,
      name: m.label,
      model: m.modelId || m.id,
      protocol: 'openai',
      priority: 0,
      failoverEnabled: false
    }))
const configure = () => alert('请在 MAM 设置中配置创作模型；本地工具尚未授权。')
const awaitThreads = await window.componentHost.request({ action: 'listConversations' })
createRoot(document.getElementById('root')!).render(
  <ConstellationStudio
    active
    locale="zh-CN"
    activeProfile={profiles[0] || { id: 'unavailable', model: '' }}
    profiles={profiles}
    reasoningEffort="medium"
    threads={awaitThreads}
    mediaCatalogRevision={0}
    onConfigureConnection={configure}
    onSpine={() =>
      window.componentHost.request({ action: 'openComponent', componentId: 'creative.spine' })
    }
    onModel3d={() =>
      window.componentHost.request({ action: 'openComponent', componentId: 'creative.model3d' })
    }
    onMusic={() =>
      window.componentHost.request({ action: 'openComponent', componentId: 'creative.music' })
    }
    onMedia={() =>
      window.componentHost.request({ action: 'openComponent', componentId: 'creative.image' })
    }
    onWriting={() =>
      window.componentHost.request({ action: 'openComponent', componentId: 'creative.writing' })
    }
    onPendingCountChange={() => {}}
    onOpenConversation={async (id) => {
      const conversation = await window.componentHost.request({
        action: 'getConversation',
        conversationId: id
      })
      alert(
        conversation.turns
          .map((turn: any) => turn.role + ' [' + turn.jobId + ']\n' + turn.text)
          .join('\n\n')
      )
    }}
    onRunConversation={async (input) => {
      const result = await window.componentHost.request({
        action: 'runConversation',
        invocationId: crypto.randomUUID(),
        conversationId: input.threadId,
        modelProfileId: profiles[0]?.id,
        command: input.command,
        context: input.context,
        inputAssets: (input.attachments || []).map(resolveAttachmentRef)
      })
      input.onThreadReady?.({ id: result.conversationId, title: result.title })
      return { threadId: result.conversationId, title: result.title, text: result.text }
    }}
  />
)
