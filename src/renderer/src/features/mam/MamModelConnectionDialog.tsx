import { Loader2, Plus, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import type { MamSaveModelConnectionInput } from '../../../../shared/mam/application-command'
import type {
  MamFetchModelCatalogInput,
  MamModelCatalogItem,
  MamModelCatalogResult
} from '../../../../shared/mam/model-catalog'
import { Button } from '../../components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '../../components/ui/dialog'
import { MamProfileSelectField, MamProfileTextField } from './MamProfileFieldControls'

const protocolOptions = [
  { value: 'openai-completions', label: 'OpenAI compatible (most relay services)' },
  { value: 'openai-responses', label: 'OpenAI Responses' },
  { value: 'anthropic-messages', label: 'Anthropic Messages' },
  { value: 'google-generative-ai', label: 'Google Generative AI' }
] as const

type ConnectionDraft = Readonly<{
  displayName: string
  protocol: MamSaveModelConnectionInput['protocol']
  baseUrl: string
  apiKey: string
  remoteModelId: string
}>

const emptyDraft: ConnectionDraft = {
  displayName: '',
  protocol: 'openai-completions',
  baseUrl: '',
  apiKey: '',
  remoteModelId: ''
}

export function MamModelConnectionDialog({
  pending,
  onSave,
  onFetchModels
}: Readonly<{
  pending: boolean
  onSave(input: MamSaveModelConnectionInput): Promise<void>
  onFetchModels(input: MamFetchModelCatalogInput): Promise<MamModelCatalogResult>
}>): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(emptyDraft)
  const [models, setModels] = useState<readonly MamModelCatalogItem[]>([])
  const [fetching, setFetching] = useState(false)
  const [catalogError, setCatalogError] = useState<string>()
  const canSave = Boolean(
    draft.displayName.trim() && models.some((model) => model.id === draft.remoteModelId)
  )
  const resetCatalog = (): void => {
    setModels([])
    setCatalogError(undefined)
  }
  const fetchModels = async (): Promise<void> => {
    setFetching(true)
    setCatalogError(undefined)
    try {
      const result = await onFetchModels({
        protocol: draft.protocol,
        ...(draft.baseUrl.trim() ? { baseUrl: draft.baseUrl.trim() } : {}),
        ...(draft.apiKey.trim() ? { apiKey: draft.apiKey.trim() } : {})
      })
      setModels(result.models)
      const first = result.models[0]
      if (!first) {
        setCatalogError('The API returned no selectable models. Check the API address and key.')
        return
      }
      setDraft((current) => {
        const selected = result.models.some((model) => model.id === current.remoteModelId)
          ? current.remoteModelId
          : first.id
        return {
          ...current,
          remoteModelId: selected,
          displayName: current.displayName || first.displayName || selected
        }
      })
    } catch (cause) {
      setCatalogError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setFetching(false)
    }
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus /> Add model connection
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add model connection</DialogTitle>
          <DialogDescription>
            Configure a relay or official model API once. Roles can then select this model directly.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <MamProfileSelectField
            label="API format"
            value={draft.protocol}
            options={protocolOptions}
            onChange={(protocol) => {
              resetCatalog()
              setDraft({
                ...draft,
                protocol: protocol as MamSaveModelConnectionInput['protocol'],
                remoteModelId: ''
              })
            }}
          />
          <MamProfileTextField
            label="API address"
            description="Use the relay service address. Leave empty to use the provider default."
            value={draft.baseUrl}
            placeholder="https://relay.example.com/v1"
            mono
            onChange={(baseUrl) => {
              resetCatalog()
              setDraft({ ...draft, baseUrl, remoteModelId: '' })
            }}
          />
          <MamProfileTextField
            label="API key"
            description="Encrypted by the operating system and kept only on this Mac."
            value={draft.apiKey}
            placeholder="Paste the key provided by your relay service"
            type="password"
            mono
            onChange={(apiKey) => {
              resetCatalog()
              setDraft({ ...draft, apiKey, remoteModelId: '' })
            }}
          />
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              variant="outline"
              disabled={fetching}
              onClick={() => void fetchModels()}
            >
              {fetching ? <Loader2 className="animate-spin" /> : <RefreshCw />}
              {fetching ? 'Fetching models…' : 'Fetch models'}
            </Button>
            {models.length > 0 && (
              <span className="text-xs text-muted-foreground">Model list loaded.</span>
            )}
          </div>
          {catalogError && <p className="text-sm text-destructive">{catalogError}</p>}
          {models.length > 0 && (
            <MamProfileSelectField
              label="Model"
              description="Choose a model returned by this API."
              value={draft.remoteModelId}
              options={models.map((model) => ({
                value: model.id,
                label:
                  model.displayName && model.displayName !== model.id
                    ? `${model.displayName} · ${model.id}`
                    : model.id
              }))}
              onChange={(remoteModelId) => setDraft({ ...draft, remoteModelId })}
            />
          )}
          {models.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Fetch the model list before saving this connection.
            </p>
          )}
          <MamProfileTextField
            label="Name shown to roles"
            description="Filled from the selected model; you can rename it."
            value={draft.displayName}
            placeholder="For example: My coding model"
            onChange={(displayName) => setDraft({ ...draft, displayName })}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            disabled={pending || !canSave}
            onClick={async () => {
              try {
                await onSave({
                  displayName: draft.displayName.trim(),
                  protocol: draft.protocol,
                  ...(draft.baseUrl.trim() ? { baseUrl: draft.baseUrl.trim() } : {}),
                  ...(draft.apiKey.trim() ? { apiKey: draft.apiKey.trim() } : {}),
                  remoteModelId: draft.remoteModelId.trim()
                })
              } catch {
                return
              }
              setDraft(emptyDraft)
              setModels([])
              setCatalogError(undefined)
              setOpen(false)
            }}
          >
            Save connection
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
