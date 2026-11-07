const request=(action:string,params={})=>window.componentHost?.request({action,...params})
export const isDesktop=()=>Boolean(window.componentHost)
export const tr=(zh:string,_en:string)=>zh
export const convertFileSrc=(value:string)=>value
const selected=new Map<string,any>()
export async function open(options:any){if(options.directory)return 'native-offline-dialog';const ref=await request('importAsset');if(!ref)return null;selected.set(ref.id,ref);return ref.id}
export async function save(){return 'native-export-dialog'}
export async function invoke(command:string,args:any={}){
 if(!window.componentHost)throw Error('请在 MAM 中打开3D工作台。')
 let action=command.replace(/^model3d_/,''),params=structuredClone(args),inputAssets=[]
 if(action==='import'){const ref=selected.get(params.source);if(!ref)throw Error('参考图片已失效');inputAssets=[ref];params={}}
 if(action==='reference'){if(params.image===null){delete params.image;params.reset=true}else{const blob=await(await fetch(params.image)).blob();if(blob.size>32*1024*1024)throw Error('参考图过大');inputAssets=[await request('storeImage',{bytes:[...new Uint8Array(await blob.arrayBuffer())],filename:'model-reference.png'})];delete params.image}}
 if(action==='manifest')action='resources.manifest'
 if(action==='start'){const original=params;params=original.request||{};action=original.action;if(action==='generate')action='start';else {action=`resources.${action}`;if(params.offlineDirectory){action='resources.offline';delete params.offlineDirectory}}}
 if(['artifact','export'].includes(action))delete params.destination
 const jobId=await request('submit',{operation:`model3d.${action}`,idempotencyKey:crypto.randomUUID(),params,inputAssets});let sequence=0
 for(;;){const events=await request('events',{jobId,afterSequence:sequence});for(const event of events){sequence=Math.max(sequence,event.sequence);if(event.type==='succeeded'){if(['artifact','export'].includes(action))return request(action==='artifact'?'previewAsset':'exportAsset',{ref:event.data.assetRef});return event.data}if(['failed','cancelled','reconciliation-required'].includes(event.type))throw Error(event.data?.message||'3D任务停止')}await new Promise(r=>setTimeout(r,300))}
}
