export const tr=(zh:string,_en:string)=>zh
export const isTextGenerationModel=(model:any)=>model.kind==='text'
export function CreativeStudioHeader(props:any){return <header className={props.className}><strong>骨骼动画工作台 <small>{props.subtitle}</small></strong><div>{props.context}</div><div>{props.actions}</div></header>}
