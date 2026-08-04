import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { MamResourcesPage } from './MamResourcesPage'
import { MamSettingsPage } from './MamSettingsPage'
import { mamUiSnapshotFixture } from './mam-renderer-snapshot-fixture'

describe('MAM Resources and Settings pages', () => {
  it('renders actionable versioned resources and machine-local configuration', () => {
    const snapshot = mamUiSnapshotFixture()
    snapshot.skills.push({
      schemaVersion: '1.0.0',
      id: 'skill.release',
      version: 1,
      name: 'Release',
      description: 'Prepare a release.',
      supportedExecutors: ['codex-cli'],
      contentDigest: 'a'.repeat(64),
      enabled: true,
      importedAt: '2026-07-28T18:00:00Z'
    })
    snapshot.executors.push({
      id: 'executor.codex',
      version: 1,
      kind: 'codex-cli',
      executableRef: 'codex',
      adapterOptions: {}
    })
    snapshot.providers.push({
      id: 'provider.openai',
      version: 1,
      protocol: 'openai-responses',
      secretRef: 'secret.openai'
    })
    const resources = renderToStaticMarkup(
      <MamResourcesPage
        snapshot={snapshot}
        pending={false}
        onSaveProfile={async () => undefined}
        onImportSkill={async () => undefined}
      />
    )
    const settings = renderToStaticMarkup(
      <MamSettingsPage
        snapshot={snapshot}
        pending={false}
        onSaveProfile={async () => undefined}
        onSaveModelConnection={async () => undefined}
        onFetchModelCatalog={async () => ({ models: [] })}
        onSaveLocalSettings={async () => undefined}
        onExportDiagnostics={async () => undefined}
      />
    )
    expect(resources).toContain('Import Skill')
    expect(resources).toContain('Skill Registry')
    expect(resources).toContain('New version')
    expect(settings).toContain('Git executable')
    expect(settings).toContain('Add model connection')
    expect(settings).toContain('Advanced profile setup')
    expect(settings).toContain('Machine-local bindings')
    expect(settings).toContain('Local executors')
    expect(settings).toContain('Local secrets')
    expect(settings).toContain('MAM_SECRET_SECRET_OPENAI')
    expect(settings).toContain('Advanced local JSON')
    expect(settings).toContain('executor.codex')
    expect(settings).toContain('Export diagnostics')
  })
})
