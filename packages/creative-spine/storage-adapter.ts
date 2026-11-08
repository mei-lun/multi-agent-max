import * as original from '../../vendor/levelup/baseline-6542241/src/lib/spineStorage'
export const listSpineProjects=original.listSpineProjects
export const loadSpineProject=original.loadSpineProject
const pending=new Set<Promise<any>>()
export function saveSpineProject(project:any){const promise=original.saveSpineProject(project);pending.add(promise);promise.finally(()=>pending.delete(promise)).catch(()=>{});return promise}
export async function flushWrites(){while(pending.size)await Promise.all([...pending])}
