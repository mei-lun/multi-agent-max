import { describe, expect, it } from 'vitest'
import type { CodexResourceCandidate } from '../../../../shared/mam/resource-import'
import { filterCodexCandidates, selectFilteredCandidates } from './MamCodexResourceImportDialog'

const candidates: CodexResourceCandidate[] = [
  candidate('skill.release', 'Release', 'skill', 'new'),
  candidate('skill.review', 'Review', 'skill', 'current'),
  candidate('mcp.docs', 'Docs', 'mcp', 'updated')
]

describe('Codex resource import selection', () => {
  it('filters by tab and query', () => {
    expect(filterCodexCandidates(candidates, 'skill', 'rel').map((item) => item.resourceId)).toEqual([
      'skill.release'
    ])
  })

  it('selects only importable rows in the current filter', () => {
    expect(selectFilteredCandidates(new Set(), candidates.slice(0, 2), true)).toEqual(
      new Set(['skill:skill.release'])
    )
  })
})

function candidate(
  resourceId: string,
  displayName: string,
  kind: 'skill' | 'mcp',
  importState: CodexResourceCandidate['importState']
): CodexResourceCandidate {
  return {
    key: `${kind}:${resourceId}`,
    kind,
    resourceId,
    displayName,
    source: { kind: 'user', label: 'User', path: `/tmp/${resourceId}` },
    fingerprint: 'a'.repeat(64),
    importState,
    requiredSecretNames: []
  }
}
