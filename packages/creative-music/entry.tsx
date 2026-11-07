import {createRoot} from 'react-dom/client'
import {MusicWorkbench} from '../../vendor/levelup/baseline-6542241/src/components/MusicWorkbench'
import './shell.css'
const navigate=()=>alert('请从 MAM 组件库打开其他工作台。')
createRoot(document.getElementById('root')!).render(<MusicWorkbench active onPendingCountChange={()=>{}} onMedia={navigate} onWriting={navigate} onConstellation={navigate} onSpine={navigate} onModel3d={navigate}/> )
