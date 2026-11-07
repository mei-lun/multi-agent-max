import {createRoot} from 'react-dom/client'
import {ModelWorkbench} from '../../vendor/levelup/baseline-6542241/src/components/ModelWorkbench'
import './shell.css'
const navigate=()=>alert('请从 MAM 组件库打开其他工作台。')
createRoot(document.getElementById('root')!).render(<ModelWorkbench active onPendingCountChange={()=>{}} onMedia={navigate} onWriting={navigate} onConstellation={navigate} onSpine={navigate} onMusic={navigate}/> )
