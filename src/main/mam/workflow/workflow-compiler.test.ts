import { describe, expect, it } from 'vitest'
import { compileWorkflow, parseWorkflowDefinition } from './workflow-compiler'

const hash = 'e'.repeat(64)

describe('workflow compiler', () => {
  it('parses YAML and JSON into the same deterministic plan', () => {
    const definition = workflowDefinition()
    const yaml = `
schemaVersion: 1.0.0
id: workflow.simple
name: Simple
version: 1
nodes:
  - id: implement
    type: role_task
    recommendedRoleProfileIds: [role.developer]
    allowedRoleProfileIds: [role.developer]
    instruction: Implement.
    workspaceMode: write
    inputs: []
    outputs:
      - schemaVersion: 1.0.0
        artifactType: source.diff
        format: diff
        required: true
        maxBytes: 1000000
  - id: finish
    type: finish
    inputs:
      - artifactId: source.diff
        version: 1
        contentHash: ${hash}
edges:
  - from: implement
    to: finish
maxTransitions: 10
maxRunCostUsd: 20
maxRunDurationSeconds: 3600
`
    const yamlPlan = compileWorkflow(parseWorkflowDefinition(yaml))
    const jsonPlan = compileWorkflow(parseWorkflowDefinition(JSON.stringify(definition)))
    expect(yamlPlan.planHash).toBe(jsonPlan.planHash)
    expect(yamlPlan.nodes.map((node) => node.id)).toEqual(['implement', 'finish'])
  })

  it('compiles an explicit bounded back edge outside the base topological order', () => {
    const definition = workflowDefinition()
    const looped = {
      ...definition,
      nodes: [definition.nodes[0], reviewNode(), definition.nodes[1]],
      edges: [
        { from: 'implement', to: 'review' },
        { from: 'review', to: 'finish' },
        { from: 'review', to: 'implement', maxTraversals: 2 }
      ],
      maxTransitions: 20
    }
    const plan = compileWorkflow(looped)
    expect(plan.nodes.map((node) => node.id)).toEqual(['implement', 'review', 'finish'])
    expect(plan.edges).toContainEqual({ from: 'review', to: 'implement', maxTraversals: 2 })
  })

  it('rejects unbounded cycles and bounded edges that point forward', () => {
    const definition = workflowDefinition()
    expect(() =>
      compileWorkflow({
        ...definition,
        edges: [...definition.edges, { from: 'finish', to: 'implement' }]
      })
    ).toThrow(expect.objectContaining({ code: 'definition_schema_error' }))

    expect(() =>
      compileWorkflow({
        ...definition,
        nodes: [definition.nodes[0], reviewNode(), definition.nodes[1]],
        edges: [
          { from: 'implement', to: 'review' },
          { from: 'review', to: 'finish' },
          { from: 'implement', to: 'finish', maxTraversals: 2 }
        ]
      })
    ).toThrow(expect.objectContaining({ code: 'invalid_loop_edge' }))
  })

  it('requires exact external Artifact inputs', () => {
    const definition = workflowDefinition()
    const external = { artifactId: 'requirements.input', version: 1, contentHash: hash }
    const withExternal = {
      ...definition,
      nodes: definition.nodes.map((node) =>
        node.id === 'implement' ? { ...node, inputs: [external] } : node
      )
    }
    expect(() => compileWorkflow(withExternal)).toThrow(
      expect.objectContaining({ code: 'unsatisfied_artifact_input' })
    )
    expect(compileWorkflow(withExternal, [external]).inputArtifacts).toEqual([external])
  })

  it('round-trips every first-release visual node type into a compiled plan', () => {
    const definition = allNodeWorkflowDefinition()
    const plan = compileWorkflow(definition)
    expect(new Set(plan.nodes.map((node) => node.type))).toEqual(
      new Set([
        'role_task',
        'dynamic_tasks',
        'review_gate',
        'approval_gate',
        'condition',
        'parallel',
        'join',
        'artifact_transform',
        'command',
        'git_merge',
        'finish'
      ])
    )
    expect(plan.edges).toHaveLength(definition.edges.length)
    for (const edge of definition.edges) expect(plan.edges).toContainEqual(edge)
  })
})

function workflowDefinition() {
  return {
    schemaVersion: '1.0.0',
    id: 'workflow.simple',
    name: 'Simple',
    version: 1,
    nodes: [
      {
        id: 'implement',
        type: 'role_task',
        recommendedRoleProfileIds: ['role.developer'],
        allowedRoleProfileIds: ['role.developer'],
        instruction: 'Implement.',
        workspaceMode: 'write',
        inputs: [],
        outputs: [artifactContract('source.diff', 'diff')]
      },
      {
        id: 'finish',
        type: 'finish',
        inputs: [{ artifactId: 'source.diff', version: 1, contentHash: hash }]
      }
    ],
    edges: [{ from: 'implement', to: 'finish' }],
    maxTransitions: 10,
    maxRunCostUsd: 20,
    maxRunDurationSeconds: 3600
  }
}

function reviewNode() {
  return {
    id: 'review',
    type: 'review_gate',
    recommendedRoleProfileIds: ['role.reviewer'],
    allowedRoleProfileIds: ['role.reviewer'],
    inputs: [{ artifactId: 'source.diff', version: 1, contentHash: hash }],
    reportContract: artifactContract('review.report', 'markdown', {
      requiredSections: ['summary']
    }),
    minimumDecisions: 1,
    maxRevisionAttempts: 2
  }
}

function artifactContract(
  artifactType: string,
  format: 'diff' | 'markdown',
  extra: Record<string, unknown> = {}
) {
  return {
    schemaVersion: '1.0.0',
    artifactType,
    format,
    required: true,
    maxBytes: 1_000_000,
    ...extra
  }
}

function allNodeWorkflowDefinition() {
  const roles = {
    recommendedRoleProfileIds: ['role.builder'],
    allowedRoleProfileIds: ['role.builder']
  }
  const sourceInput = { artifactId: 'source.diff', version: 1, contentHash: hash }
  return {
    schemaVersion: '1.0.0',
    id: 'workflow.all-nodes',
    name: 'All first-release nodes',
    version: 1,
    nodes: [
      {
        id: 'implement',
        type: 'role_task',
        ...roles,
        instruction: 'Implement.',
        workspaceMode: 'write',
        inputs: [],
        outputs: [artifactContract('source.diff', 'diff')]
      },
      {
        id: 'plan',
        type: 'dynamic_tasks',
        ...roles,
        planContract: artifactContract('task.plan', 'diff'),
        maxTasks: 20
      },
      {
        id: 'approval',
        type: 'approval_gate',
        prompt: 'Continue?',
        options: ['Continue', 'Stop']
      },
      { id: 'condition', type: 'condition', expression: 'approved', branches: { yes: 'fan-out' } },
      { id: 'fan-out', type: 'parallel', branches: ['command', 'transform'] },
      {
        id: 'command',
        type: 'command',
        executable: 'git',
        arguments: ['status'],
        workingDirectory: '.',
        outputs: []
      },
      {
        id: 'transform',
        type: 'artifact_transform',
        inputs: [sourceInput],
        outputs: [artifactContract('transformed.diff', 'diff')],
        transform: 'normalize'
      },
      { id: 'join', type: 'join', waitFor: ['command', 'transform'] },
      {
        id: 'review',
        type: 'review_gate',
        ...roles,
        inputs: [sourceInput],
        reportContract: artifactContract('review.report', 'markdown', {
          requiredSections: ['summary']
        }),
        minimumDecisions: 1,
        maxRevisionAttempts: 3
      },
      {
        id: 'merge',
        type: 'git_merge',
        ...roles,
        targetBranch: 'main',
        orderBy: 'merge_ready_at',
        strategy: 'no_ff',
        conflictPolicy: 'coordinator_attempt',
        validations: ['pnpm test']
      },
      { id: 'finish', type: 'finish', inputs: [] }
    ],
    edges: [
      { from: 'implement', to: 'plan' },
      { from: 'plan', to: 'approval' },
      { from: 'approval', to: 'condition' },
      { from: 'condition', to: 'fan-out' },
      { from: 'fan-out', to: 'command' },
      { from: 'fan-out', to: 'transform' },
      { from: 'command', to: 'join' },
      { from: 'transform', to: 'join' },
      { from: 'join', to: 'review' },
      { from: 'review', to: 'merge' },
      { from: 'merge', to: 'finish' }
    ],
    maxTransitions: 50,
    maxRunCostUsd: 20,
    maxRunDurationSeconds: 3600
  }
}
