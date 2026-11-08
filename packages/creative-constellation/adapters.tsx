import { CreativeNavigation } from '../creative-navigation'
export const tr = (zh: string, _en: string) => zh
export const isTextGenerationModel = (model: any) => model.kind === 'text'
export const profileHasTextModel = (profile: any) => Boolean(profile.model)
export const reasoningEffortForProfile = (_profile: any, value: any) => value
export function CreativeStudioHeader(props: any) {
  return (
    <header className={props.className}>
      <strong>
        创作星图 <small>{props.subtitle}</small>
      </strong>
      <div>{props.context}</div>
      <div>{props.actions}</div>
      <CreativeNavigation />
    </header>
  )
}
export function getCurrentWindow() {
  return {
    onResized: async () => () => {},
    onMoved: async () => () => {},
    scaleFactor: async () => 1,
    onCloseRequested: async (handler: any) => {
      if (!window.componentHost?.onBeforeClose) throw Error('MAM关闭保存接口不可用')
      return window.componentHost.onBeforeClose(async () => {
        let allowed = true
        const result = await handler({
          preventDefault() {
            allowed = false
          }
        })
        return allowed && result !== false
      })
    }
  }
}
