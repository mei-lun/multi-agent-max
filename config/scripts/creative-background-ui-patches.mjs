import { readFile } from 'node:fs/promises'
import path from 'node:path'

const replaceRegion = (source, start, end, replacement) => {
  const first = source.indexOf(start),
    last = source.indexOf(end, first)
  if (first < 0 || last < 0) throw Error(`Background UI patch anchor changed: ${start}`)
  return source.slice(0, first) + replacement + source.slice(last)
}
export function creativeBackgroundUiPlugin(root) {
  return {
    name: 'mam-background-business-ui',
    setup(build) {
      build.onLoad(
        { filter: /[\\/]components[\\/](ConstellationStudio|WritingStudio)\.tsx$/ },
        async (args) => {
          let source = (await readFile(args.path, 'utf8')).replace(/\r\n/g, '\n')
          const bridge = JSON.stringify(
            path.join(root, 'packages/creative-writing/background-jobs.ts').replaceAll('\\', '/')
          )
          source =
            `import {runBackground as mamRunBackground,recoverBackground as mamRecoverBackground,cancelBackground as mamCancelBackground,acknowledgeBackground as mamAcknowledgeBackground} from ${bridge};\n` +
            source
          if (args.path.endsWith('ConstellationStudio.tsx')) {
            source = replaceRegion(
              source,
              '  async function runGraph(targetIds?: string[]) {',
              '  async function executeNode(',
              `  const mamPersistGraph=async(id:string,graph:ConstellationGraph)=>{if(graphMetaRef.current.id===id){graphRef.current={nodes:graph.nodes,edges:graph.edges};setNodes(graph.nodes);setEdges(graph.edges)};if(autosaveTimerRef.current!==null){window.clearTimeout(autosaveTimerRef.current);autosaveTimerRef.current=null}await queueProjectSave(records=>{const old=records.find(item=>item.id===id);if(!old)throw Error('Graph project unavailable');return {...old,payload:{...(old.payload as any),graph},updatedAt:Date.now()}});mamAcknowledgeBackground('graph:'+id)};
  useEffect(()=>{if(!currentProjectId)return;let active=true;void mamRecoverBackground('graph:'+currentProjectId,checkpoint=>{if(active&&checkpoint.graph){setNodes(checkpoint.graph.nodes);setEdges(checkpoint.graph.edges)}}).then(async result=>{if(active&&result?.graph){await mamPersistGraph(currentProjectId,result.graph);if(active){setNodes(result.graph.nodes);setEdges(result.graph.edges)}}}).catch(reason=>{if(active)setNotice(errorText(reason))});return()=>{active=false}},[currentProjectId]);
  async function runGraph(targetIds?: string[]) {
    if(runningRef.current||overviewOpenRef.current||projectBusyRef.current||!storageReadyRef.current)return;
    runningRef.current=true;setRunning(true);setNotice(undefined);
    const projectId=currentProjectId;const epoch=++runEpochRef.current;
    try{const result=await mamRunBackground('graph:'+projectId,'constellation.graph.execute',{graph:{...graphRef.current,schemaVersion:1},targets:targetIds});if(result?.graph){await mamPersistGraph(projectId,result.graph);if(graphMetaRef.current.id!==projectId||runEpochRef.current!==epoch)return;setNodes(result.graph.nodes);setEdges(result.graph.edges);setNotice(result.waiting?.length?'候选结果已保存，请选择后继续':result.failed?.length?'部分节点需要处理':'星图执行完成')}}catch(reason){setNotice(errorText(reason))}finally{runningRef.current=false;setRunning(false)}
  }

`
            )
            source = source.replace(
              '  const stopRun = () => {',
              "  const stopRun = () => {\n    void mamCancelBackground('graph:'+currentProjectId);"
            )
          } else {
            source = replaceRegion(
              source,
              '  const commitGoalProject = (nextProject: WritingProject) => {',
              '  const requestGoalAgent = async (',
              `  const commitGoalProject = (nextProject: WritingProject) => {
    const next = projectsRef.current.map((project) => project.id === nextProject.id ? nextProject : project);
    projectsRef.current = next;
    setProjects(next);
  };

`
            )
            const recovery = `  useEffect(()=>{if(!activeProject?.id)return;let active=true;goalOperationRef.current='goal:'+activeProject.id;setGoalRun({goalId:activeGoal?.id||'',phase:'executing',message:'恢复后台目标任务',automatic:true,preview:''});void mamRecoverBackground('goal:'+activeProject.id,checkpoint=>{if(active&&checkpoint.project){const project=projectFromRecord(checkpoint.project);if(project)commitGoalProject(project)}}).then(async result=>{if(active&&result?.project){const project=projectFromRecord(result.project);if(project){commitGoalProject(project);await enqueueProjectSaves([project]);if(active)mamAcknowledgeBackground('goal:'+project.id)}}}).catch(reason=>{if(active)setError(errorText(reason))}).finally(()=>{if(active){goalOperationRef.current=undefined;setGoalRun(undefined)}});return()=>{active=false}},[activeProject?.id]);\n`
            const run = `  const mamGoalRun=async(project:WritingProject,goalId:string,operation:string,extra:any={})=>{const key='goal:'+project.id;goalOperationRef.current=key;setGoalRun({goalId,phase:operation==='writing.goal.plan'?'planning':'executing',message:'后台目标任务执行中',automatic:extra.automatic===true,preview:''});try{const result=await mamRunBackground(key,operation,{project,goalId,modelProfileId:writingRunProfile.id,selectedContextIds:[...selectedContextIds],selectedReferenceContextIds:[...selectedReferenceContextIds],...extra},checkpoint=>{if(checkpoint.project){const next=projectFromRecord(checkpoint.project);if(next)commitGoalProject(next)}});const next=result?.project?projectFromRecord(result.project):null;if(next){commitGoalProject(next);await enqueueProjectSaves([next]);mamAcknowledgeBackground(key)}return next||undefined}catch(reason){setError(errorText(reason));return undefined}finally{goalOperationRef.current=undefined;setGoalRun(undefined)}};\n`
            source = replaceRegion(
              source,
              '  const planGoalProject = async (',
              '  const executeGoalStep = async (',
              recovery +
                run +
                `  const planGoalProject=async(project:WritingProject,goalId:string,_epoch:number,_automatic:boolean)=>mamGoalRun(project,goalId,'writing.goal.plan');\n\n`
            )
            source = replaceRegion(
              source,
              '  const executeGoalStep = async (',
              '  const ensureGoalConnection = () => {',
              `  const executeGoalStep=async(project:WritingProject,goalId:string,stepId:string,_epoch:number,automatic:boolean)=>mamGoalRun(project,goalId,'writing.goal.execute',{stepId,automatic,approved:true});\n\n`
            )
            source = replaceRegion(
              source,
              '  const runGoalAutopilot = async () => {',
              '  const stopGoalRun = async () => {',
              `  const runGoalAutopilot=async()=>{if(!activeProject||!activeGoal||!ensureGoalConnection())return;if(!activeGoal.plan.length){setError('请先生成并审阅执行计划，然后再次运行。');return}await mamGoalRun(activeProject,activeGoal.id,'writing.goal.execute',{automatic:true,approved:true});setGoalRun(undefined)};\n\n`
            )
            source = source.replace(
              '  const stopGoalRun = async () => {',
              "  const stopGoalRun = async () => {\n    if(activeProject)await mamCancelBackground('goal:'+activeProject.id);"
            )
          }
          return { contents: source, loader: 'tsx' }
        }
      )
    }
  }
}
