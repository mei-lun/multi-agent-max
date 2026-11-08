import { createRoot } from 'react-dom/client'
import { ModelWorkbench } from '../../vendor/levelup/baseline-6542241/src/components/ModelWorkbench'
import './shell.css'
const openWorkbench = (componentId: string) => () => {
  void window.componentHost
    .request({ action: 'openComponent', componentId })
    .catch((reason: unknown) => alert(String(reason)))
}
createRoot(document.getElementById('root')!).render(
  <ModelWorkbench
    active
    onPendingCountChange={() => {}}
    onMedia={openWorkbench('creative.image')}
    onWriting={openWorkbench('creative.writing')}
    onConstellation={openWorkbench('creative.constellation')}
    onSpine={openWorkbench('creative.spine')}
    onMusic={openWorkbench('creative.music')}
  />
)
