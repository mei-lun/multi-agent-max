import { Badge } from '../../components/ui/badge'

export function MamStateBadge({ status }: Readonly<{ status: string }>): React.JSX.Element {
  const normalized = status.replaceAll('_', ' ')
  if (['completed', 'submitted', 'approved', 'passed', 'consensus'].includes(status)) {
    return <Badge variant="success">{normalized}</Badge>
  }
  if (
    ['blocked', 'failed', 'changes_requested', 'needs_attention', 'needs_reconciliation'].includes(
      status
    )
  ) {
    return <Badge variant="destructive">{normalized}</Badge>
  }
  if (['cancelled', 'superseded'].includes(status)) {
    return <Badge variant="outline">{normalized}</Badge>
  }
  return <Badge variant="secondary">{normalized}</Badge>
}
