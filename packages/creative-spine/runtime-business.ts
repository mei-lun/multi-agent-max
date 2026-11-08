import {
  validateSpineProject,
  generateSpineClip,
  compileSpineProject,
  type SpineMotionPreset,
  type SpineMotionStudy,
  type SpinePoseFrame
} from '../../vendor/levelup/baseline-6542241/src/lib/spine'
import {
  captureSpinePose,
  fitSpinePose
} from '../../vendor/levelup/baseline-6542241/src/lib/spineMotion'

export type SpineRender = (request: {
  operation: 'spine.image.normalize' | 'spine.export'
  source?: string
  project?: ReturnType<typeof validateSpineProject>
}) => Promise<unknown>

export const spineBusinessOperations = [
  'spine.project.normalize',
  'spine.pose.capture',
  'spine.pose.fit',
  'spine.animation.generate',
  'spine.project.compile',
  'spine.image.normalize',
  'spine.export'
] as const

export function createSpineBusiness(render?: SpineRender) {
  return async (operation: string, params: Record<string, unknown>) => {
    if (!spineBusinessOperations.includes(operation as (typeof spineBusinessOperations)[number]))
      throw new Error('Unsupported Spine business operation')
    if (operation === 'spine.image.normalize') {
      if (!render) throw new Error('Spine image renderer unavailable')
      if (
        typeof params.source !== 'string' ||
        !/^data:image\/(png|jpeg|webp);base64,/.test(params.source)
      )
        throw new Error('Spine normalization requires an embedded image')
      return render({ operation, source: params.source })
    }
    const project = validateSpineProject(structuredClone(params.project))
    if (operation === 'spine.project.normalize') return project
    if (operation === 'spine.project.compile') return compileSpineProject(project)
    if (operation === 'spine.export') {
      if (!render) throw new Error('Spine archive renderer unavailable')
      return render({ operation, project })
    }
    if (operation === 'spine.animation.generate') {
      if (!['idle', 'wave', 'walk', 'breathe', 'spring', 'ripple'].includes(String(params.preset)))
        throw new Error('Invalid Spine motion preset')
      const clip = generateSpineClip(
        project.parts,
        params.preset as SpineMotionPreset,
        typeof params.name === 'string' ? params.name : undefined
      )
      return {
        project: validateSpineProject({ ...project, clips: [...project.clips, clip] }),
        clip
      }
    }
    const clip = project.clips.find((item) => item.id === params.clipId)
    if (!clip) throw new Error('Spine animation not found')
    if (operation === 'spine.pose.capture') {
      if (typeof params.time !== 'number' || !Number.isFinite(params.time))
        throw new Error('Invalid pose time')
      return captureSpinePose(
        clip,
        project.parts,
        params.time,
        typeof params.name === 'string' ? params.name : undefined
      )
    }
    if (!params.frame || typeof params.frame !== 'object')
      throw new Error('Missing Spine pose frame')
    return fitSpinePose(
      project,
      { clipId: clip.id } as SpineMotionStudy,
      params.frame as SpinePoseFrame
    )
  }
}
