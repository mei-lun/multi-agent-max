import type { MamResolveApprovalGateInput } from '../../../../shared/mam/application-command'
import type { MamUiRunSnapshot } from '../../../../shared/mam/ui-projection'
import { Button } from '../../components/ui/button'
import { Badge } from '../../components/ui/badge'

export function MamApprovalGatePanel({
  run,
  pending,
  onResolve
}: Readonly<{
  run: MamUiRunSnapshot
  pending: boolean
  onResolve(input: MamResolveApprovalGateInput): Promise<void>
}>): React.JSX.Element | null {
  const gates = run.approvalGates ?? []
  if (gates.length === 0) return null
  return (
    <div className="space-y-2 border-b border-border bg-muted/20 px-4 py-3">
      {gates.map((gate) => (
        <div
          key={gate.id}
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card p-3"
        >
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-sm font-medium">{gate.prompt}</p>
              <Badge variant="outline">{gate.status}</Badge>
            </div>
            <p className="mt-1 font-mono text-xs text-muted-foreground">{gate.id}</p>
          </div>
          {gate.status === 'pending' ? (
            <div className="flex flex-wrap gap-2">
              {gate.options.map((option) => (
                <Button
                  key={option}
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  onClick={() =>
                    void onResolve({ workflowRunId: run.run.id, gateId: gate.id, option })
                  }
                >
                  {option}
                </Button>
              ))}
            </div>
          ) : (
            <span className="text-xs text-muted-foreground">Selected {gate.selectedOption}</span>
          )}
        </div>
      ))}
    </div>
  )
}
