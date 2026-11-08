import type { HandlerRegistry } from '../../src/main/mam/creative-runtime/jobs'
import type { BinaryAssetStore } from '../../src/main/mam/creative-runtime/assets'
import {
  applyWritingGoalStep,
  buildWritingContext,
  buildWritingGoalPlanPrompt,
  buildWritingGoalStepPrompt,
  parseWritingGoalPlan,
  projectFromRecord,
  projectToRecord,
  projectToMarkdown,
  projectToYarn,
  type WritingProject,
  type WritingGoal
} from '../../vendor/levelup/baseline-6542241/src/lib/writing'

/** Uses the original Goal prompts/context/application functions; no UI lifetime dependency. */
export function createWritingBusinessServices(options: {
  generation: HandlerRegistry
  assets?: BinaryAssetStore
  hostCall?: (method: string, value: unknown) => Promise<unknown>
}) {
  const handlers: HandlerRegistry = (request) => {
    if (
      !['writing.goal.plan', 'writing.goal.execute', 'writing.project.export'].includes(
        request.operation
      )
    )
      return
    const params = request.params as Record<string, unknown>
    if (JSON.stringify(params.project).length > 16 * 1024 * 1024)
      throw Error('Writing project exceeds 16 MiB')
    let project = projectFromRecord({ payload: params.project } as Parameters<
      typeof projectFromRecord
    >[0])
    if (!project) throw Error('Unsupported writing project')
    if (request.operation === 'writing.project.export') {
      const format = params.format || 'markdown'
      if (!['markdown', 'yarn', 'json'].includes(String(format)))
        throw Error('Unsupported writing export format')
      const text =
        format === 'markdown'
          ? projectToMarkdown(project)
          : format === 'yarn'
            ? projectToYarn(project)
            : JSON.stringify(projectToRecord(project), null, 2)
      return {
        validate: () => {},
        run: async (_accepted, context) => {
          context.signal.throwIfAborted()
          if (!options.assets) throw Error('Writing export asset store unavailable')
          const bytes = Buffer.from(text, 'utf8')
          const ref = await options.assets.import(
            (async function* () {
              yield bytes
            })(),
            {
              mime: format === 'json' ? 'application/json' : 'text/plain',
              filename: `writing.${format === 'markdown' ? 'md' : format === 'yarn' ? 'yarn' : 'json'}`
            }
          )
          await context.emit('asset', ref)
          return { assets: [ref], text }
        }
      }
    }
    const goalId = String(params.goalId || ''),
      modelProfileId = String(params.modelProfileId || '')
    if (!modelProfileId || !project.goals.some((g) => g.id === goalId))
      throw Error('Goal and text model are required')
    if (request.operation === 'writing.goal.execute' && params.approved !== true)
      throw Error('Goal plan approval required')
    const contextFor = (value: WritingProject, goal: WritingGoal) => {
      const document =
        value.documents.find((d) => d.id === goal.targetDocumentId) ||
        value.documents.find((d) => d.id === value.activeDocumentId)
      return buildWritingContext(
        value,
        document,
        document?.content.length || 0,
        Array.isArray(params.selectedContextIds) ? params.selectedContextIds.map(String) : [],
        undefined,
        Array.isArray(params.selectedReferenceContextIds)
          ? params.selectedReferenceContextIds.map(String)
          : []
      )
    }
    return {
      validate: () => {},
      run: async (_accepted, context) => {
        const generate = async (prompt: string) => {
          context.signal.throwIfAborted()
          const input = {
            ...request,
            operation: 'text.generate',
            params: { modelProfileId, prompt },
            inputAssets: []
          }
          if (request.attempt) {
            if (!options.hostCall) throw Error('Goal attempt authorization unavailable')
            await options.hostCall('operation.authorize', {
              operation: input.operation,
              params: input.params,
              inputAssets: []
            })
          }
          const handler = options.generation(input)
          if (!handler) throw Error('Text generation unavailable')
          handler.validate(input)
          const result = (await handler.run(input, context)) as { text?: string }
          if (!result.text?.trim()) throw Error('Goal step returned no text')
          return result.text
        }
        let current = structuredClone(project!)
        let goal = current.goals.find((g) => g.id === goalId)!
        if (request.operation === 'writing.goal.plan') {
          const text = await generate(
            buildWritingGoalPlanPrompt({
              project: current,
              goal,
              context: contextFor(current, goal)
            })
          )
          const plan = parseWritingGoalPlan(text, goal.targetDocumentId)
          if (!plan.length) throw Error('Model returned no valid Goal plan')
          current = {
            ...current,
            goals: current.goals.map((g) =>
              g.id === goalId ? { ...g, plan, status: 'ready' } : g
            ),
            updatedAt: Date.now()
          }
        } else {
          if (!goal.plan.length) throw Error('Goal plan is empty')
          for (const planned of goal.plan) {
            context.signal.throwIfAborted()
            if (['completed', 'skipped'].includes(planned.status)) continue
            if (params.stepId && planned.id !== params.stepId) continue
            goal = current.goals.find((g) => g.id === goalId)!
            const step = goal.plan.find((s) => s.id === planned.id)!
            if (step.status === 'review' && params.automatic !== true)
              throw Error('Review and apply the current step before continuing')
            const text =
              step.status === 'review' && step.output.trim()
                ? step.output
                : await generate(
                    buildWritingGoalStepPrompt({
                      project: current,
                      goal,
                      step,
                      context: contextFor(current, goal)
                    })
                  )
            context.signal.throwIfAborted()
            if (goal.mode === 'partner' && params.automatic !== true) {
              current = {
                ...current,
                goals: current.goals.map((g) =>
                  g.id === goalId
                    ? {
                        ...g,
                        status: 'paused',
                        activeStepId: step.id,
                        plan: g.plan.map((s) =>
                          s.id === step.id
                            ? { ...s, status: 'review', output: text.slice(0, 80000) }
                            : s
                        )
                      }
                    : g
                )
              }
            } else current = applyWritingGoalStep(current, goalId, step.id, text)
            await context.emit('log', {
              type: 'writing_goal_checkpoint',
              goalId,
              stepId: step.id,
              project: projectToRecord(current)
            })
            // Partner mode deliberately returns control after one completed step.
            if (params.stepId || (goal.mode === 'partner' && params.automatic !== true)) break
          }
        }
        return {
          project: projectToRecord(current),
          goalId,
          text: current.goals.find((g) => g.id === goalId)?.runSummary || ''
        }
      }
    }
  }
  return { handlers }
}
