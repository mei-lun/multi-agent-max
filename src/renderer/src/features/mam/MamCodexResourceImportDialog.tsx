import { Download, Loader2, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import type {
  CodexResourceCandidate,
  MamImportCodexResourcesInput
} from '../../../../shared/mam/resource-import'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { Checkbox } from '../../components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '../../components/ui/dialog'
import { Input } from '../../components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs'

export function MamCodexResourceImportDialog({
  disabled,
  onList,
  onImport
}: Readonly<{
  disabled: boolean
  onList(): Promise<readonly CodexResourceCandidate[]>
  onImport(input: MamImportCodexResourcesInput): Promise<void>
}>): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [kind, setKind] = useState<'skill' | 'mcp'>('skill')
  const [query, setQuery] = useState('')
  const [candidates, setCandidates] = useState<readonly CodexResourceCandidate[]>([])
  const [selected, setSelected] = useState(new Set<string>())
  const [secrets, setSecrets] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()
  const filtered = useMemo(
    () => filterCodexCandidates(candidates, kind, query),
    [candidates, kind, query]
  )
  const selectedCandidates = candidates.filter((candidate) => selected.has(candidate.key))
  const requiredSecrets = [...new Set(selectedCandidates.flatMap((item) => item.requiredSecretNames))]
  const canSubmit =
    selected.size > 0 && requiredSecrets.every((name) => Boolean(secrets[name]?.trim()))

  const changeOpen = (next: boolean): void => {
    setOpen(next)
    if (!next) return
    setLoading(true)
    setError(undefined)
    setSelected(new Set())
    setSecrets({})
    void onList()
      .then(setCandidates)
      .catch((cause) => setError(errorMessage(cause)))
      .finally(() => setLoading(false))
  }
  const submit = async (): Promise<void> => {
    setLoading(true)
    setError(undefined)
    try {
      await onImport({ candidateKeys: [...selected], missingSecrets: secrets })
      setOpen(false)
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setLoading(false)
    }
  }
  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger asChild>
        <Button size="xs" disabled={disabled}>
          <Download /> Import from Codex
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100dvh-2rem)] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import Codex resources</DialogTitle>
          <DialogDescription>
            Select local Codex Skills and MCP servers. Nothing is selected by default.
          </DialogDescription>
        </DialogHeader>
        <Tabs value={kind} onValueChange={(value) => setKind(value as 'skill' | 'mcp')}>
          <TabsList>
            <TabsTrigger value="skill">Skills</TabsTrigger>
            <TabsTrigger value="mcp">MCP</TabsTrigger>
          </TabsList>
          {(['skill', 'mcp'] as const).map((tab) => (
            <TabsContent key={tab} value={tab}>
              <CandidatePicker
                candidates={filtered}
                query={query}
                selected={selected}
                loading={loading}
                onQuery={setQuery}
                onSelected={setSelected}
              />
            </TabsContent>
          ))}
        </Tabs>
        {requiredSecrets.length > 0 && (
          <fieldset className="space-y-3 border-t border-border pt-4">
            <legend className="text-sm font-medium">Required MCP values</legend>
            {requiredSecrets.map((name) => (
              <label key={name} className="block space-y-1 text-xs">
                <span className="font-mono">{name}</span>
                <Input
                  type="password"
                  value={secrets[name] ?? ''}
                  onChange={(event) => setSecrets({ ...secrets, [name]: event.target.value })}
                />
              </label>
            ))}
          </fieldset>
        )}
        {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button disabled={loading || !canSubmit} onClick={() => void submit()}>
            {loading && <Loader2 className="animate-spin" />}
            {`Import selected (${selected.size})`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function CandidatePicker({
  candidates,
  query,
  selected,
  loading,
  onQuery,
  onSelected
}: Readonly<{
  candidates: readonly CodexResourceCandidate[]
  query: string
  selected: ReadonlySet<string>
  loading: boolean
  onQuery(value: string): void
  onSelected(value: Set<string>): void
}>): React.JSX.Element {
  const selectable = candidates.filter(isImportable)
  const allSelected = selectable.length > 0 && selectable.every((item) => selected.has(item.key))
  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
        <Input className="pl-8" value={query} placeholder="Search resources" onChange={(event) => onQuery(event.target.value)} />
      </div>
      <label className="flex items-center gap-2 text-xs font-medium">
        <Checkbox
          checked={allSelected}
          disabled={selectable.length === 0}
          onCheckedChange={(checked) =>
            onSelected(selectFilteredCandidates(selected, candidates, checked === true))
          }
        />
        Select filtered resources
      </label>
      <div className="max-h-72 divide-y divide-border overflow-y-auto rounded-md border border-border scrollbar-sleek">
        {loading ? (
          <p className="p-4 text-xs text-muted-foreground">Scanning local Codex resources…</p>
        ) : candidates.length === 0 ? (
          <p className="p-4 text-xs text-muted-foreground">No matching resources</p>
        ) : candidates.map((candidate) => (
          <label key={candidate.key} className="flex items-start gap-3 p-3">
            <Checkbox
              checked={selected.has(candidate.key)}
              disabled={!isImportable(candidate)}
              onCheckedChange={(checked) => {
                const next = new Set(selected)
                if (checked === true) next.add(candidate.key)
                else next.delete(candidate.key)
                onSelected(next)
              }}
            />
            <span className="min-w-0 flex-1">
              <span className="flex items-center justify-between gap-2 text-xs font-medium">
                <span className="truncate">{candidate.displayName}</span>
                <Badge variant="outline">{candidateStatus(candidate.importState)}</Badge>
              </span>
              <span className="mt-1 block truncate font-mono text-[11px] text-muted-foreground">{candidate.resourceId}</span>
              <span className="mt-1 block truncate text-[11px] text-muted-foreground">{candidate.source.label} · {candidate.source.path}</span>
            </span>
          </label>
        ))}
      </div>
    </div>
  )
}

export function filterCodexCandidates(
  candidates: readonly CodexResourceCandidate[],
  kind: 'skill' | 'mcp',
  query: string
): CodexResourceCandidate[] {
  const normalized = query.trim().toLocaleLowerCase()
  return candidates.filter((candidate) =>
    candidate.kind === kind && (!normalized || `${candidate.displayName} ${candidate.resourceId} ${candidate.source.label}`.toLocaleLowerCase().includes(normalized))
  )
}

export function selectFilteredCandidates(
  selected: ReadonlySet<string>,
  candidates: readonly CodexResourceCandidate[],
  checked: boolean
): Set<string> {
  const next = new Set(selected)
  for (const candidate of candidates.filter(isImportable)) {
    if (checked) next.add(candidate.key)
    else next.delete(candidate.key)
  }
  return next
}

function isImportable(candidate: CodexResourceCandidate): boolean {
  return candidate.importState === 'new' || candidate.importState === 'updated'
}

function candidateStatus(status: CodexResourceCandidate['importState']): string {
  return { new: 'New', updated: 'Updated', current: 'Current', unavailable: 'Unavailable' }[status]
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
