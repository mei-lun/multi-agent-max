import { Plus, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { ArtifactContract, ArtifactRef } from '../../../../shared/mam/domain/artifact'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '../../components/ui/select'
import { Textarea } from '../../components/ui/textarea'
import {
  MamWorkflowLabeledField,
  MamWorkflowNumberField,
  MamWorkflowStringListField
} from './MamWorkflowFieldControls'

const artifactFormats: ArtifactContract['format'][] = [
  'json-schema',
  'markdown',
  'file-set',
  'diff',
  'test-report'
]

export function MamWorkflowArtifactContractList({
  label,
  contracts,
  minimum = 0,
  onChange
}: Readonly<{
  label: string
  contracts: readonly ArtifactContract[]
  minimum?: number
  onChange(contracts: ArtifactContract[]): void
}>): React.JSX.Element {
  return (
    <fieldset className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <legend className="text-xs font-medium">{label}</legend>
        <Button
          variant="outline"
          size="xs"
          onClick={() => onChange([...contracts, createArtifactContract(contracts.length)])}
        >
          <Plus /> Add contract
        </Button>
      </div>
      {contracts.length === 0 && (
        <p className="rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
          No Artifact contracts configured.
        </p>
      )}
      {contracts.map((contract, index) => (
        <ArtifactContractFields
          key={`${contract.artifactType}:${String(index)}`}
          contract={contract}
          removable={contracts.length > minimum}
          onChange={(next) => onChange(replaceAt(contracts, index, next))}
          onRemove={() => onChange(contracts.filter((_, candidate) => candidate !== index))}
        />
      ))}
    </fieldset>
  )
}

export function MamWorkflowArtifactRefList({
  label,
  references,
  minimum = 0,
  onChange
}: Readonly<{
  label: string
  references: readonly ArtifactRef[]
  minimum?: number
  onChange(references: ArtifactRef[]): void
}>): React.JSX.Element {
  return (
    <fieldset className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <legend className="text-xs font-medium">{label}</legend>
        <Button
          variant="outline"
          size="xs"
          onClick={() => onChange([...references, createArtifactRef(references.length)])}
        >
          <Plus /> Add reference
        </Button>
      </div>
      {references.length === 0 && (
        <p className="rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
          No Artifact references configured.
        </p>
      )}
      {references.map((reference, index) => (
        <div
          key={`${reference.artifactId}:${String(index)}`}
          className="space-y-2 rounded-md border border-border p-3"
        >
          <div className="flex justify-end">
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Remove Artifact reference"
              disabled={references.length <= minimum}
              onClick={() => onChange(references.filter((_, candidate) => candidate !== index))}
            >
              <Trash2 />
            </Button>
          </div>
          <MamWorkflowLabeledField label="Artifact ID">
            <Input
              value={reference.artifactId}
              onChange={(event) =>
                onChange(
                  replaceAt(references, index, { ...reference, artifactId: event.target.value })
                )
              }
            />
          </MamWorkflowLabeledField>
          <MamWorkflowNumberField
            label="Version"
            minimum={1}
            value={reference.version}
            onChange={(version) =>
              onChange(replaceAt(references, index, { ...reference, version }))
            }
          />
          <MamWorkflowLabeledField label="Content hash">
            <Input
              className="font-mono"
              value={reference.contentHash}
              onChange={(event) =>
                onChange(
                  replaceAt(references, index, { ...reference, contentHash: event.target.value })
                )
              }
            />
          </MamWorkflowLabeledField>
        </div>
      ))}
    </fieldset>
  )
}

function ArtifactContractFields({
  contract,
  removable,
  onChange,
  onRemove
}: Readonly<{
  contract: ArtifactContract
  removable: boolean
  onChange(contract: ArtifactContract): void
  onRemove(): void
}>): React.JSX.Element {
  return (
    <div className="space-y-2 rounded-md border border-border p-3">
      <div className="flex justify-end">
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Remove Artifact contract"
          disabled={!removable}
          onClick={onRemove}
        >
          <Trash2 />
        </Button>
      </div>
      <MamWorkflowLabeledField label="Artifact type">
        <Input
          value={contract.artifactType}
          onChange={(event) => onChange({ ...contract, artifactType: event.target.value })}
        />
      </MamWorkflowLabeledField>
      <MamWorkflowLabeledField label="Format">
        <Select
          value={contract.format}
          onValueChange={(value) =>
            onChange(changeArtifactFormat(contract, value as ArtifactContract['format']))
          }
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {artifactFormats.map((format) => (
              <SelectItem key={format} value={format}>
                {format}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </MamWorkflowLabeledField>
      <div className="grid grid-cols-2 gap-2">
        <MamWorkflowNumberField
          label="Max bytes"
          minimum={1}
          value={contract.maxBytes}
          onChange={(maxBytes) => onChange({ ...contract, maxBytes })}
        />
        <label className="flex items-end gap-2 pb-2 text-xs font-medium">
          <input
            className="size-3.5 accent-primary"
            type="checkbox"
            checked={contract.required}
            onChange={(event) => onChange({ ...contract, required: event.target.checked })}
          />
          Required
        </label>
      </div>
      <ArtifactFormatFields contract={contract} onChange={onChange} />
    </div>
  )
}

function ArtifactFormatFields({
  contract,
  onChange
}: Readonly<{
  contract: ArtifactContract
  onChange(contract: ArtifactContract): void
}>): React.JSX.Element | null {
  if (contract.format === 'json-schema') {
    return (
      <JsonSchemaField
        value={contract.jsonSchema ?? {}}
        onChange={(jsonSchema) => onChange({ ...contract, jsonSchema })}
      />
    )
  }
  if (contract.format === 'markdown') {
    return (
      <MamWorkflowStringListField
        label="Required sections"
        values={contract.requiredSections ?? []}
        onChange={(requiredSections) => onChange({ ...contract, requiredSections })}
      />
    )
  }
  if (contract.format === 'file-set') {
    return (
      <MamWorkflowStringListField
        label="Allowed globs"
        values={contract.allowedGlobs ?? []}
        onChange={(allowedGlobs) => onChange({ ...contract, allowedGlobs })}
      />
    )
  }
  return null
}

function JsonSchemaField({
  value,
  onChange
}: Readonly<{
  value: Record<string, unknown>
  onChange(value: Record<string, unknown>): void
}>): React.JSX.Element {
  const [source, setSource] = useState(JSON.stringify(value, null, 2))
  const [error, setError] = useState<string>()
  useEffect(() => {
    setSource(JSON.stringify(value, null, 2))
    setError(undefined)
  }, [value])
  const apply = (): void => {
    try {
      const parsed: unknown = JSON.parse(source)
      if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object')
        throw new Error('JSON Schema must be an object.')
      onChange(parsed as Record<string, unknown>)
      setError(undefined)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }
  return (
    <MamWorkflowLabeledField label="JSON Schema">
      <Textarea
        className="min-h-28 font-mono"
        value={source}
        aria-invalid={Boolean(error)}
        onChange={(event) => setSource(event.target.value)}
        onBlur={apply}
      />
      {error && <span className="block text-xs text-destructive">{error}</span>}
    </MamWorkflowLabeledField>
  )
}

function changeArtifactFormat(
  contract: ArtifactContract,
  format: ArtifactContract['format']
): ArtifactContract {
  const base = {
    schemaVersion: contract.schemaVersion,
    artifactType: contract.artifactType,
    format,
    required: contract.required,
    maxBytes: contract.maxBytes
  }
  if (format === 'json-schema')
    return { ...base, format, jsonSchema: contract.jsonSchema ?? { type: 'object' } }
  if (format === 'markdown')
    return { ...base, format, requiredSections: contract.requiredSections ?? ['summary'] }
  if (format === 'file-set')
    return { ...base, format, allowedGlobs: contract.allowedGlobs ?? ['**/*'] }
  return { ...base, format }
}

function createArtifactContract(index: number): ArtifactContract {
  return {
    schemaVersion: '1.0.0',
    artifactType: `artifact.output-${String(index + 1)}`,
    format: 'json-schema',
    required: true,
    maxBytes: 1_000_000,
    jsonSchema: { type: 'object' }
  }
}

function createArtifactRef(index: number): ArtifactRef {
  return {
    artifactId: `artifact.input-${String(index + 1)}`,
    version: 1,
    contentHash: '0'.repeat(64)
  }
}

function replaceAt<T>(values: readonly T[], index: number, value: T): T[] {
  return values.map((candidate, candidateIndex) => (candidateIndex === index ? value : candidate))
}
