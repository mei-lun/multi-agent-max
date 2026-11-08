import { createRoot } from 'react-dom/client'
import { MusicWorkbench } from '../../vendor/levelup/baseline-6542241/src/components/MusicWorkbench'
import './shell.css'
const openWorkbench = (componentId: string) => () => {
  void window.componentHost
    .request({ action: 'openComponent', componentId })
    .catch((reason: unknown) => alert(String(reason)))
}
createRoot(document.getElementById('root')!).render(
  <MusicWorkbench
    active
    onPendingCountChange={() => {}}
    onMedia={openWorkbench('creative.image')}
    onWriting={openWorkbench('creative.writing')}
    onConstellation={openWorkbench('creative.constellation')}
    onSpine={openWorkbench('creative.spine')}
    onModel3d={openWorkbench('creative.model3d')}
  />
)
