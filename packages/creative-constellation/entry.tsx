import {createRoot} from 'react-dom/client'
import {ConstellationStudio} from '../../vendor/levelup/baseline-6542241/src/components/ConstellationStudio'
import {agentTurnStream} from './text-bridge'
import './shell.css'
const models=await window.componentHost?.request({action:'listModels'})||[],profiles=models.filter((m:any)=>m.kind==='text').map((m:any)=>({id:m.id,name:m.label,model:m.modelId||m.id,protocol:'openai',priority:0,failoverEnabled:false}))
const configure=()=>alert('请在 MAM 设置中配置创作模型；本地工具尚未授权。')
createRoot(document.getElementById('root')!).render(<ConstellationStudio active locale="zh-CN" activeProfile={profiles[0]||{id:'unavailable',model:''}} profiles={profiles} reasoningEffort="medium" threads={[]} mediaCatalogRevision={0} onConfigureConnection={configure} onSpine={configure} onModel3d={configure} onMusic={configure} onMedia={configure} onWriting={configure} onPendingCountChange={()=>{}} onOpenConversation={configure} onRunConversation={async request=>{const invocationId=crypto.randomUUID();const result=await agentTurnStream(profiles[0], [{role:'user',content:[request.context,request.command].filter(Boolean).join('\n'),attachments:request.attachments}], 'chat',undefined,crypto.randomUUID(),()=>{});return {threadId:request.threadId||'invocation:'+invocationId,title:request.command.slice(0,60),text:result.content}}}/> )
