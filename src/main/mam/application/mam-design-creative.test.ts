import { test, expect } from 'vitest'
import { materializeMamDesignProposal } from './mam-design-proposal-materializer'
test('creative design materializes pinned component node and binary delivery contracts', () => {
  const result = materializeMamDesignProposal(
    {
      roles: [
        {
          key: 'artist',
          displayName: 'Artist',
          instructions: 'Generate approved image',
          tools: ['component:creative.image'],
          componentBindings: [
            { componentId: 'creative.image', allowedOperations: ['image.generate'] }
          ]
        }
      ],
      workflow: {
        key: 'creative',
        name: 'Creative',
        nodes: [
          {
            key: 'generate',
            type: 'component_task',
            recommendedRoleKeys: ['artist'],
            allowedRoleKeys: ['artist'],
            instruction: 'Generate',
            workspaceMode: 'write',
            inputArtifactKeys: [],
            outputs: [{ key: 'image', format: 'asset-bundle' }],
            component: {
              id: 'creative.image',
              version: '1.0.0',
              hostApiVersion: '1.0.0',
              operation: 'image.generate',
              params: { prompt: 'image' }
            }
          },
          { key: 'finish', type: 'finish' }
        ],
        edges: [{ from: 'generate', to: 'finish' }]
      }
    },
    (_kind, id) => id,
    { executorProfileId: 'executor.test', modelProfileId: 'model.test' }
  )
  expect(result.workflow.nodes[0]).toMatchObject({
    type: 'component_task',
    component: { version: '1.0.0' },
    outputs: [{ format: 'asset-bundle' }]
  })
  expect(result.roles[0]?.componentBindings?.[0]?.allowedOperations).toEqual(['image.generate'])
})
