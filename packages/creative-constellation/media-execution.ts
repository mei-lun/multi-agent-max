const request=(action:string,params={})=>window.componentHost.request({action,...params})
const pending=new Map<string,{jobId:string,kind:string,params:any}>(),completed=new Map<string,any>(),urls=new Map<string,string>(),listeners=new Set<(asset:any)=>void>()
try { for(const [id,entry] of JSON.parse(localStorage.getItem('mam.constellation.media-jobs')||'[]'))pending.set(id,entry) } catch {}
const persist=()=>localStorage.setItem('mam.constellation.media-jobs',JSON.stringify([...pending]))
const inFlight=new Map<string,Promise<any>>()
export const cachedMediaUrl=(asset:any)=>urls.get(asset.id)||''
export const subscribeMedia=(listener:(asset:any)=>void)=>{listeners.add(listener);return()=>{listeners.delete(listener)}}
const canonical=(ref:any)=>{const {id,sha256,bytes,mime,filename}=ref;return {id,sha256,bytes,mime,filename}}
async function readJob(jobId:string){const jobs=await request('listJobs');const job=jobs.find((job:any)=>job.id===jobId);if(!job)throw Error('宿主任务不存在');return job}
export async function refreshExecution(id:string){if(inFlight.has(id))return inFlight.get(id);const task=refreshActual(id);inFlight.set(id,task);try{return await task}finally{inFlight.delete(id)}}
async function refreshActual(id:string){if(completed.has(id))return completed.get(id);const entry=pending.get(id);if(!entry)throw Error('媒体任务未找到');const job=await readJob(entry.jobId),events=await request('events',{jobId:entry.jobId,afterSequence:0});const result=events.findLast((event:any)=>event.type==='succeeded')?.data
 if(result){const ref=result.assets?.[0];if(!ref)throw Error('任务未返回媒体资产');urls.set(id,await request('previewAsset',{ref:canonical(ref)}));const asset={...ref,id,assetRef:canonical(ref),kind:entry.kind,status:'completed',filePath:ref.id,prompt:entry.params.prompt,model:entry.params.model,createdAt:Date.now()};completed.set(id,asset);pending.delete(id);listeners.forEach(listener=>listener(asset));return asset}
 if(['failed','cancelled','reconciliation-required'].includes(job.state)){const asset={id,kind:entry.kind,status:'failed',error:'媒体任务停止，请检查宿主历史',createdAt:Date.now()};pending.delete(id);completed.set(id,asset);listeners.forEach(listener=>listener(asset));return asset}
 return {id,kind:entry.kind,status:'pending',prompt:entry.params.prompt,createdAt:Date.now()}
}
export async function submitExecution(input:any,resolveRef:(id:string)=>any){const models=await request('listModels'),kind=input.kind==='audio'?'speech':input.kind,model=models.find((model:any)=>model.id===input.profileId&&model.kind===kind);if(!model)throw Error('当前模型不可用，请在MAM设置配置。');const refs=(input.referenceAttachmentIds||[]).map(resolveRef);if(input.maskAttachmentId)refs.push(resolveRef(input.maskAttachmentId));let operation=kind==='speech'?'speech.generate':kind==='video'?(input.videoMode==='video'?'video.edit':'video.generate'):refs.length?'image.edit':'image.generate';if(!model.operations.includes(operation))throw Error('模型不支持当前工作流')
 let params:any={modelProfileId:model.id,prompt:input.prompt}
 if(kind==='video')params={...params,mode:input.videoMode||'text',...(input.seconds?{duration:Number(input.seconds)}:{}),...(input.videoResolution?{resolution:input.videoResolution}:{}),...(input.videoAspectRatio?{aspectRatio:input.videoAspectRatio}:{})}
 else {for(const key of ['voice','outputFormat','size','quality'])if(input[key]&&input[key]!=='auto')params[key]=input[key];if(kind==='image'){params.count=input.count||1;if(input.maskAttachmentId)params.maskAssetId=input.maskAttachmentId}}
 const jobId=await request('submit',{operation,idempotencyKey:crypto.randomUUID(),params,inputAssets:refs.map(canonical)}),id=`host-${jobId}`;pending.set(id,{jobId,kind:input.kind,params:structuredClone(input)});persist();return {assets:[await refreshExecution(id)],errors:[]}
}
setInterval(()=>{for(const id of pending.keys())refreshExecution(id).catch(()=>{})},1500)
