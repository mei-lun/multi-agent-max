import {createRoot} from 'react-dom/client'
import {SpineStudio} from '../../vendor/levelup/baseline-6542241/src/components/SpineStudio'
import './shell.css'
import {flushWrites} from './storage-adapter'
window.componentHost?.onBeforeClose?.(async()=>{const save=[...document.querySelectorAll('button')].find(button=>button.textContent?.trim()==='保存');save?.click();await new Promise(resolve=>setTimeout(resolve,0));await flushWrites();return true})
const unavailable=()=>alert('请在 MAM 设置中配置创作模型；其他工作台请从 MAM 组件库打开。')
createRoot(document.getElementById('root')!).render(<SpineStudio active locale="zh-CN" mediaCatalogRevision={0} onMedia={unavailable} onWriting={unavailable} onConstellation={unavailable} onModel3d={unavailable} onMusic={unavailable} onConfigureConnection={unavailable} onPendingCountChange={()=>{}}/> )
