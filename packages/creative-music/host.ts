const request=(action:string,params={})=>window.componentHost?.request({action,...params})
export const isDesktop=()=>Boolean(window.componentHost)
export const tr=(zh:string,_en:string)=>zh
export function convertFileSrc(value:string){return value}
export async function invoke(command:string,args:any={}){
 if(!window.componentHost)throw Error('请在 MAM 中打开音乐工作台。')
 const action=command==='music_request'?args.action:command.replace(/^music_/,'')
 const params=command==='music_request'?args.request:args
 const mapping:Record<string,string>={manifest:'resources.manifest',install:'resources.install',remove_resources:'resources.remove',import_reference:'reference',artifact:'export',cancel_install:'resources.cancel'}
 if(action==='artifact'||action==='export')delete params.destination
 const inputAssets=[]
 if(action==='install'&&params.offlineDirectory){delete params.offlineDirectory;mapping.install='resources.offline'}else if(action==='install')delete params.offlineDirectory
 if(action==='import_reference'){const ref=assets.get(params.path);if(!ref)throw Error('音频选择已失效');inputAssets.push(ref);delete params.path}
 const jobId=await request('submit',{operation:`music.${mapping[action]||action}`,idempotencyKey:crypto.randomUUID(),params:params||{},inputAssets});let sequence=0
 if(action==='install')installJob=jobId
 for(;;){const events=await request('events',{jobId,afterSequence:sequence});for(const event of events){sequence=Math.max(sequence,event.sequence);if(action==='generate'&&event.type==='log'&&event.data?.type==='native_music_job')return {id:event.data.id,status:'queued',params:structuredClone(params),progress:0,phase:'queued',created_at:new Date().toISOString(),favorite:false,archived:false};if(event.type==='succeeded'){if(action==='artifact'||action==='export'){const ref=event.data.assetRef||event.data.assets?.[0]||event.data;return action==='artifact'?request('previewAsset',{ref}):request('exportAsset',{ref})}return event.data}if(['failed','cancelled','reconciliation-required'].includes(event.type))throw Error(event.data?.message||'音乐服务任务停止')}await new Promise(r=>setTimeout(r,300))}
}
const assets=new Map<string,any>()
let installJob:string|undefined
export async function open(options:any){if(options.directory)return 'native-offline-dialog';const ref=await request('importAsset');if(!ref)return null;assets.set(ref.id,ref);return ref.id}
export async function save(){return 'mam-export-dialog'}
export async function listen(){return ()=>{}}
