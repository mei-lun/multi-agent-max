import { CreativeNavigation } from '../creative-navigation'
export function CreativeStudioHeader(props: any) {
  return (
    <header className={props.className}>
      <strong>
        3D工作台 <small>{props.subtitle}</small>
      </strong>
      <div>{props.context}</div>
      <div>{props.actions}</div>
      <CreativeNavigation />
    </header>
  )
}
