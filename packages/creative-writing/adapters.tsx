import { CreativeNavigation } from '../creative-navigation'
export const tr = (zh: string, _en: string) => zh
export const isTextGenerationModel = (model: any) => model.kind === 'text' || !model.kind
export const profileHasTextModel = (profile: any) => Boolean(profile.model)
export const reasoningEffortForProfile = (_profile: any, effort: any) => effort
export function CreativeStudioHeader(props: any) {
  return (
    <header className={props.className}>
      <strong>
        写作工作台 <small>{props.subtitle}</small>
      </strong>
      <div>{props.context}</div>
      <div>{props.actions}</div>
      <CreativeNavigation />
    </header>
  )
}
