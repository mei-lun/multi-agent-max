import { createRoot } from 'react-dom/client'
import { SpineStudio } from '../../vendor/levelup/baseline-6542241/src/components/SpineStudio'
import './shell.css'
import { flushWrites } from './storage-adapter'
window.componentHost?.onBeforeClose?.(async () => {
  const save = [...document.querySelectorAll('button')].find(
    (button) => button.textContent?.trim() === '保存'
  )
  save?.click()
  await new Promise((resolve) => setTimeout(resolve, 0))
  await flushWrites()
  return true
})
const unavailable = () => alert('请在 MAM 设置中配置创作模型；其他工作台请从 MAM 组件库打开。')
const openWorkbench = (componentId: string) => () => {
  void window.componentHost
    .request({ action: 'openComponent', componentId })
    .catch((reason: unknown) => alert(String(reason)))
}
createRoot(document.getElementById('root')!).render(
  <SpineStudio
    active
    locale="zh-CN"
    mediaCatalogRevision={0}
    onMedia={openWorkbench('creative.image')}
    onWriting={openWorkbench('creative.writing')}
    onConstellation={openWorkbench('creative.constellation')}
    onModel3d={openWorkbench('creative.model3d')}
    onMusic={openWorkbench('creative.music')}
    onConfigureConnection={unavailable}
    onPendingCountChange={() => {}}
  />
)
