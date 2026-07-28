import { useEffect, useState } from 'react'
import type { z } from 'zod'
import { Button } from '../../components/ui/button'
import { Textarea } from '../../components/ui/textarea'
import { MamWorkflowLabeledField } from './MamWorkflowFieldControls'

export function MamWorkflowAdvancedSource<T>({
  value,
  schema,
  label,
  description,
  validateIdentity,
  onChange
}: Readonly<{
  value: T
  schema: z.ZodType<T>
  label: string
  description: string
  validateIdentity?(value: T): void
  onChange(value: T): void
}>): React.JSX.Element {
  const [source, setSource] = useState(JSON.stringify(value, null, 2))
  const [error, setError] = useState<string>()
  useEffect(() => {
    setSource(JSON.stringify(value, null, 2))
    setError(undefined)
  }, [value])
  const apply = (): void => {
    try {
      const parsed = schema.parse(JSON.parse(source))
      validateIdentity?.(parsed)
      onChange(parsed)
      setError(undefined)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }
  return (
    <details className="rounded-md border border-border p-3">
      <summary className="cursor-pointer text-xs font-medium">Advanced JSON</summary>
      <div className="mt-3 space-y-2">
        <MamWorkflowLabeledField label={label} description={description}>
          <Textarea
            className="min-h-52 font-mono"
            value={source}
            aria-invalid={Boolean(error)}
            onChange={(event) => setSource(event.target.value)}
          />
        </MamWorkflowLabeledField>
        {error && <p className="text-xs text-destructive">{error}</p>}
        <Button size="sm" onClick={apply}>
          Apply JSON
        </Button>
      </div>
    </details>
  )
}
