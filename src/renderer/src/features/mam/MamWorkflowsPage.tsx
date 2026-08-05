import { ArrowRight, Download, Network, Pencil, Upload } from 'lucide-react'
import { useState } from 'react'
import type {
  MamCreateWorkflowRunInput,
  MamDeleteWorkflowInput,
  MamSaveLocalSettingsInput,
  MamSaveWorkflowInput
} from '../../../../shared/mam/application-command'
import type { WorkflowDefinition } from '../../../../shared/mam/domain/workflow'
import type { MamUiSnapshot } from '../../../../shared/mam/ui-projection'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { MamWorkflowEditor } from './MamWorkflowEditor'
import { MamNewWorkflowDialog } from './MamNewWorkflowDialog'
import { MamStartWorkflowRunDialog } from './MamStartWorkflowRunDialog'
import { MamDeleteWorkflowDialog } from './MamDeleteWorkflowDialog'

export function MamWorkflowsPage({
  snapshot,
  pending,
  onSaveWorkflow,
  onCreateWorkflowRun,
  onSaveLocalSettings,
  onImportWorkflowPackage,
  onExportWorkflowPackage,
  onDeleteWorkflow,
  openNewWorkflow = false
}: Readonly<{
  snapshot: MamUiSnapshot
  pending: boolean
  onSaveWorkflow(input: MamSaveWorkflowInput): Promise<void>
  onCreateWorkflowRun(input: MamCreateWorkflowRunInput): Promise<MamUiSnapshot>
  onSaveLocalSettings(input: MamSaveLocalSettingsInput): Promise<void>
  onImportWorkflowPackage?(): Promise<void>
  onExportWorkflowPackage?(input: {
    definitionId: string
    definitionVersion: number
  }): Promise<string | undefined>
  onDeleteWorkflow?(input: MamDeleteWorkflowInput): Promise<void>
  openNewWorkflow?: boolean
}>): React.JSX.Element {
  const workflows = snapshot.workflows
  const [editing, setEditing] = useState<WorkflowDefinition>()
  const [newWorkflowOpen, setNewWorkflowOpen] = useState(openNewWorkflow)
  if (editing) {
    return (
      <MamWorkflowEditor
        workflow={editing}
        roles={snapshot.roles}
        pending={pending}
        onClose={() => setEditing(undefined)}
        onSave={async (input) => {
          await onSaveWorkflow(input)
          setEditing(undefined)
        }}
      />
    )
  }
  return (
    <section
      aria-labelledby="workflows-title"
      className="mx-auto flex min-h-full w-full max-w-5xl flex-col p-6"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 id="workflows-title" className="text-xl font-semibold">
            Workflows
          </h1>
          <p className="text-sm text-muted-foreground">
            Active versioned graphs and their bounded execution policies.
          </p>
        </div>
        <MamNewWorkflowDialog
          existingIds={workflows.map((workflow) => workflow.id)}
          roles={snapshot.roles}
          open={newWorkflowOpen}
          onOpenChange={setNewWorkflowOpen}
          onCreate={setEditing}
        />
      </div>

      <div className="mt-6">
        {workflows.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-10 text-center">
            <Network className="mx-auto mb-3 size-7 text-muted-foreground" />
            <p className="text-sm font-medium">No active Workflow Definitions</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Create a Definition to open the visual graph editor.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {workflows.map((workflow) => (
              <article
                key={workflow.id}
                className="overflow-hidden rounded-xl border border-border"
              >
                <header className="flex items-start justify-between gap-4 bg-card px-4 py-3">
                  <div className="min-w-0">
                    <h2 className="truncate text-sm font-semibold">{workflow.name}</h2>
                    <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
                      {workflow.id}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">v{workflow.version}</Badge>
                    <MamStartWorkflowRunDialog
                      workflow={workflow}
                      existingRunIds={snapshot.runs.map((run) => run.run.id)}
                      localSettings={snapshot.localSettings}
                      disabled={pending || !snapshot.projectBinding}
                      onCreate={onCreateWorkflowRun}
                      onSaveLocalSettings={onSaveLocalSettings}
                    />
                    <Button
                      variant="outline"
                      size="xs"
                      onClick={() => setEditing({ ...workflow, version: workflow.version + 1 })}
                    >
                      <Pencil /> Edit new version
                    </Button>
                    {onExportWorkflowPackage && (
                      <Button
                        variant="outline"
                        size="xs"
                        disabled={pending}
                        onClick={() =>
                          void onExportWorkflowPackage({
                            definitionId: workflow.id,
                            definitionVersion: workflow.version
                          })
                        }
                      >
                        <Download /> Export package
                      </Button>
                    )}
                    {onDeleteWorkflow && (
                      <MamDeleteWorkflowDialog
                        workflow={workflow}
                        snapshot={snapshot}
                        pending={pending}
                        onDelete={onDeleteWorkflow}
                      />
                    )}
                  </div>
                </header>

                <div className="grid border-t border-border lg:grid-cols-[1fr_17rem]">
                  <div className="space-y-2 p-4">
                    <p className="text-xs font-medium text-muted-foreground">Nodes</p>
                    <div className="flex flex-wrap gap-2">
                      {workflow.nodes.map((node) => (
                        <div
                          key={node.id}
                          className="rounded-lg border border-border bg-card px-3 py-2"
                        >
                          <p className="text-xs font-medium">{node.id}</p>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {node.type.replaceAll('_', ' ')}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-2 border-t border-border p-4 lg:border-t-0 lg:border-l">
                    <p className="text-xs font-medium text-muted-foreground">Edges</p>
                    {workflow.edges.length === 0 ? (
                      <p className="text-xs text-muted-foreground">No transitions</p>
                    ) : (
                      workflow.edges.map((edge, index) => (
                        <div
                          key={`${edge.from}:${edge.to}:${index}`}
                          className="flex items-center gap-2 font-mono text-xs"
                        >
                          <span className="min-w-0 truncate">{edge.from}</span>
                          <ArrowRight className="size-3 shrink-0 text-muted-foreground" />
                          <span className="min-w-0 truncate">{edge.to}</span>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                <footer className="flex flex-wrap gap-x-4 gap-y-1 border-t border-border bg-card px-4 py-2 text-xs text-muted-foreground">
                  <span>{workflow.maxTransitions} transitions maximum</span>
                  <span>{workflow.maxRunDurationSeconds}s maximum</span>
                  <span>${workflow.maxRunCostUsd.toFixed(2)} run budget</span>
                </footer>
              </article>
            ))}
          </div>
        )}
      </div>

      {onImportWorkflowPackage && (
        <div className="mt-auto flex justify-end pt-6">
          <Button
            variant="outline"
            size="xs"
            disabled={pending}
            onClick={() => void onImportWorkflowPackage()}
          >
            <Upload /> Import package
          </Button>
        </div>
      )}
    </section>
  )
}
