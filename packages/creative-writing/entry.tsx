import {createRoot} from 'react-dom/client'
import {WritingStudio} from '../../vendor/levelup/baseline-6542241/src/components/WritingStudio'
import './shell.css'
import {flushWrites} from './bridge'
window.componentHost?.onBeforeClose?.(async()=>{window.dispatchEvent(new Event('pagehide'));await flushWrites();return true})
const models=await window.componentHost?.request({action:'listModels'})||[]
const profiles=models.filter((model:any)=>model.kind==='text').map((model:any)=>({id:model.id,name:model.label,model:model.modelId||model.id,protocol:'openai',enabled:true,failoverEnabled:false,priority:0}))
const configure=()=>alert('请在 MAM 设置 → 创作模型中配置文本模型。')
createRoot(document.getElementById('root')!).render(<WritingStudio active locale="zh-CN" activeProfile={profiles[0]||{id:'unavailable',model:''}} profiles={profiles} connectionReady={profiles.length>0} reasoningEffort="medium" modelCatalogRevision={0} onConfigureConnection={configure} onSpine={configure} onMedia={configure} onConstellation={configure} onModel3d={configure} onMusic={configure}/> )
