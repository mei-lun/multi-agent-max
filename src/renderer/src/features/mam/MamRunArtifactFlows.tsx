import type { WorkflowDefinition } from '../../../../shared/mam/domain/workflow'
import type { MamUiRunSnapshot } from '../../../../shared/mam/ui-projection'
import { boundArtifactFlows } from './mam-workflow-bound-artifact-flows'

export function MamRunArtifactFlows({
  run,
  definition
}: Readonly<{ run: MamUiRunSnapshot; definition: WorkflowDefinition }>): React.JSX.Element | null {
  const flows = boundArtifactFlows(run, definition)
  if (flows.length === 0) return null
  return (
    <section className="border-b border-border px-4 py-4" aria-label="运行产物绑定">
      <h3 className="text-sm font-semibold">运行产物绑定</h3>
      <p className="mt-1 text-xs text-muted-foreground">
        仅列出固定输入引用与当前正式交付的匹配；匹配不证明执行器实际读取了内容。
      </p>
      <div className="mt-3 space-y-1">
        {flows.map((flow) => (
          <div
            key={flow.id}
            className="flex flex-wrap items-center gap-2 rounded border border-border px-2 py-1.5 text-xs"
          >
            <span className="font-mono">{flow.artifactId}</span>
            <span className="text-muted-foreground">
              {flow.status === 'bound'
                ? `${flow.producerNodeId} → ${flow.consumerNodeId} · 引用匹配`
                : flow.status === 'unresolved'
                  ? `${flow.consumerNodeId} · 多来源未确定`
                  : `${flow.consumerNodeId} · 外部或未识别来源`}
            </span>
            {flow.sourceAttemptId && (
              <span className="ml-auto truncate font-mono text-muted-foreground">
                {flow.sourceAttemptId}
              </span>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}
