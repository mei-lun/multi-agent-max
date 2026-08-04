import { describe, expect, it } from 'vitest'
import {
  MamLocalSettingsSchema,
  defaultMamLocalSettings
} from '../../../../shared/mam/local-settings'
import {
  setLocalKnowledgePath,
  updateLocalKnowledgeIndexRevision
} from './MamLocalKnowledgeBindings'

describe('local knowledge repository bindings', () => {
  it('keeps independent paths for multiple repositories', () => {
    const first = setLocalKnowledgePath(
      defaultMamLocalSettings('machine.test'),
      'knowledge.requirements',
      '/knowledge/requirements'
    )
    const second = setLocalKnowledgePath(first, 'knowledge.office', '/knowledge/office')

    expect(MamLocalSettingsSchema.parse(second).knowledgeBindings).toMatchObject([
      {
        knowledgeBaseProfileId: 'knowledge.requirements',
        sourcePath: '/knowledge/requirements'
      },
      { knowledgeBaseProfileId: 'knowledge.office', sourcePath: '/knowledge/office' }
    ])
  })

  it('removes only the repository whose path is cleared', () => {
    const first = setLocalKnowledgePath(
      defaultMamLocalSettings('machine.test'),
      'knowledge.requirements',
      '/knowledge/requirements'
    )
    const second = setLocalKnowledgePath(first, 'knowledge.office', '/knowledge/office')
    const indexed = updateLocalKnowledgeIndexRevision(second, 'knowledge.office', 'revision-42')
    const remaining = setLocalKnowledgePath(indexed, 'knowledge.requirements', '')

    expect(remaining.knowledgeBindings).toEqual([
      expect.objectContaining({
        knowledgeBaseProfileId: 'knowledge.office',
        sourcePath: '/knowledge/office',
        indexRevision: 'revision-42'
      })
    ])
  })
})
