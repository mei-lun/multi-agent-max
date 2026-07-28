import type { MergeQueueEntry } from '../../../../shared/mam/domain/merge-queue'
import { Badge } from '../../components/ui/badge'

export function MamMergeStatusBadge({
  status
}: Readonly<{ status: MergeQueueEntry['status'] }>): React.JSX.Element {
  if (status === 'merged') return <Badge variant="success">Merged</Badge>
  if (status === 'failed') return <Badge variant="destructive">Failed</Badge>
  if (status === 'conflict') return <Badge variant="destructive">Conflict</Badge>
  if (status === 'merging') return <Badge>Integrating</Badge>
  if (status === 'superseded') return <Badge variant="outline">Superseded</Badge>
  return <Badge variant="secondary">Queued</Badge>
}
