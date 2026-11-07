import {createRoot} from 'react-dom/client'
import {ModelViewer} from '../../vendor/levelup/baseline-6542241/src/components/ModelViewer'
document.body.style.cssText='margin:0;width:720px;height:700px;background:#263141'
const style=document.createElement('style');style.textContent='model-viewer{display:block;width:700px;height:600px}.model-viewer-stage{width:700px;height:650px}';document.head.append(style)
createRoot(document.getElementById('root')!).render(<ModelViewer src="mam-component://package/fixture.glb" active/> )
