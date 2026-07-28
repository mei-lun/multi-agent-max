import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ResolvedKnowledgeResource } from '../profiles/attempt-config-resolver'
import { FileKnowledgeConnector } from './file-knowledge-connector'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((path) => rm(path, { recursive: true })))
})

describe('file Knowledge connector', () => {
  it('searches mapped collections deterministically within retrieval budgets', async () => {
    const root = await testRoot()
    const guides = join(root, 'docs', 'guides')
    await mkdir(guides, { recursive: true })
    await writeFile(join(guides, 'b.md'), 'Scheduler beta\nScheduler gamma\n')
    await writeFile(join(guides, 'a.md'), 'Scheduler alpha\nNo match\n')
    const connector = new FileKnowledgeConnector(root)

    await expect(
      connector.search(knowledgeResource(root), {
        collection: 'guides',
        query: 'scheduler',
        topK: 2,
        maxContextTokens: 100
      })
    ).resolves.toEqual({
      matches: [
        { documentRef: 'a.md', line: 1, excerpt: 'Scheduler alpha' },
        { documentRef: 'b.md', line: 1, excerpt: 'Scheduler beta' }
      ],
      truncated: false,
      indexRevision: 'index.2'
    })

    const constrained = await connector.search(knowledgeResource(root), {
      collection: 'guides',
      query: 'scheduler',
      topK: 5,
      maxContextTokens: 2
    })
    expect(constrained).toMatchObject({
      matches: [{ documentRef: 'a.md', line: 1, excerpt: 'Schedule' }],
      truncated: true
    })
  })

  it('reads text with a stable digest and rejects filters, traversal and binary data', async () => {
    const root = await testRoot()
    const guides = join(root, 'docs', 'guides')
    await mkdir(guides, { recursive: true })
    await writeFile(join(guides, 'scheduler.md'), 'Scheduler contract\n')
    await writeFile(join(guides, 'binary.dat'), Buffer.from([65, 0, 66]))
    const connector = new FileKnowledgeConnector(root)
    const resource = knowledgeResource(root)

    await expect(
      connector.read(resource, { collection: 'guides', documentRef: 'scheduler.md' })
    ).resolves.toMatchObject({
      documentRef: 'scheduler.md',
      content: 'Scheduler contract\n',
      bytes: 19,
      contentHash: expect.stringMatching(/^[a-f0-9]{64}$/)
    })
    await expect(
      connector.search(resource, {
        collection: 'guides',
        query: 'scheduler',
        topK: 1,
        maxContextTokens: 20,
        filters: { audience: 'developer' }
      })
    ).rejects.toMatchObject({ code: 'knowledge_filters_unsupported' })
    await expect(
      connector.read(resource, { collection: 'guides', documentRef: '../outside.md' })
    ).rejects.toMatchObject({ code: 'knowledge_path_escape' })
    await expect(
      connector.read(resource, { collection: 'guides', documentRef: 'binary.dat' })
    ).rejects.toMatchObject({ code: 'knowledge_document_binary' })
  })

  it('degrades safely for unmapped, oversized and unsupported sources', async () => {
    const root = await testRoot()
    await mkdir(join(root, 'docs', 'guides'), { recursive: true })
    await writeFile(join(root, 'docs', 'guides', 'large.md'), '01234567890')
    const connector = new FileKnowledgeConnector(root, 10)
    const resource = knowledgeResource(root)

    await expect(
      connector.read(resource, { collection: 'guides', documentRef: 'large.md' })
    ).rejects.toMatchObject({ code: 'knowledge_document_too_large' })
    await expect(
      connector.search(resource, {
        collection: 'unknown',
        query: 'text',
        topK: 1,
        maxContextTokens: 20
      })
    ).rejects.toMatchObject({ code: 'knowledge_collection_unmapped' })
    await expect(
      connector.search(
        {
          ...resource,
          profile: { ...resource.profile, kind: 'vector-store' }
        },
        { query: 'text', topK: 1, maxContextTokens: 20 }
      )
    ).rejects.toMatchObject({ code: 'knowledge_connector_kind_unsupported' })
  })

  it.runIf(process.platform !== 'win32')(
    'rejects a document symlink that escapes its root',
    async () => {
      const root = await testRoot()
      const outside = await testRoot()
      const guides = join(root, 'docs', 'guides')
      await mkdir(guides, { recursive: true })
      await writeFile(join(outside, 'private.md'), 'private')
      await symlink(join(outside, 'private.md'), join(guides, 'escape.md'))

      await expect(
        new FileKnowledgeConnector(root).read(knowledgeResource(root), {
          collection: 'guides',
          documentRef: 'escape.md'
        })
      ).rejects.toMatchObject({ code: 'knowledge_path_escape' })
    }
  )
})

async function testRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'mam-knowledge-'))
  temporaryRoots.push(root)
  return root
}

function knowledgeResource(root: string): ResolvedKnowledgeResource {
  return {
    binding: {
      knowledgeBaseProfileId: 'knowledge.docs',
      collections: ['guides'],
      allowedOperations: ['search', 'read'],
      retrievalPolicy: { topK: 5, maxContextTokens: 1000 },
      required: true
    },
    profile: {
      id: 'knowledge.docs',
      version: 1,
      displayName: 'Docs',
      kind: 'local-directory',
      sourceRef: 'local.docs',
      indexRevision: 'index.1',
      metadata: { 'collection.guides': 'docs/guides' }
    },
    localBinding: {
      id: 'binding.knowledge.docs',
      knowledgeBaseProfileId: 'knowledge.docs',
      bindingIdentity: 'machine.local',
      sourcePath: root,
      indexRevision: 'index.2'
    },
    status: 'available'
  }
}
