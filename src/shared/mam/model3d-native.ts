import { z } from 'zod'
export const model3dId = z.string().regex(/^[a-f0-9]{32}$/)
export const model3dSettings = z
  .object({
    joints: z
      .record(
        z.string(),
        z.tuple([z.number().min(-2).max(2), z.number().min(-2).max(2), z.number().min(-2).max(2)])
      )
      .refine((value) => {
        const keys = [
          'hips',
          'spine',
          'chest',
          'neck',
          'head',
          'headTip',
          ...['L', 'R'].flatMap((side) =>
            ['shoulder', 'elbow', 'wrist', 'hand', 'hip', 'knee', 'ankle', 'toe'].map(
              (name) => name + side
            )
          )
        ]
        return Object.keys(value).length === keys.length && keys.every((key) => key in value)
      })
      .optional(),
    clips: z
      .array(z.enum(['Idle', 'Walk', 'Wave']))
      .min(1)
      .max(3)
      .optional(),
    steps: z.number().int().min(10).max(60).optional(),
    seed: z.number().int().min(0).max(2147483647).optional(),
    triangles: z.number().int().min(5000).max(100000).optional(),
    textureSize: z.union([z.literal(1024), z.literal(2048)]).optional(),
    viewSize: z.literal(512).optional(),
    preset: z.enum(['draft', 'standard']).optional(),
    memoryMode: z.enum(['model', 'sequential']).optional(),
    prompt: z.string().max(2000).optional(),
    background: z.enum(['alpha', 'white']).optional(),
    cleanup: z.enum(['preserve', 'largest']).optional()
  })
  .strict()
export const model3dStart = z
  .object({
    projectId: model3dId,
    stage: z.enum(['shape', 'texture', 'rig']),
    settings: model3dSettings.optional()
  })
  .strict()
export const model3dResourceSpec = {
  schemaVersion: 2,
  resourceVersion: '2026.10.15',
  releaseTag: 'model-workbench-resources',
  target: 'windows-x64-cu118',
  cuda: '11.8'
} as const
const digest = z.string().regex(/^[a-f0-9]{64}$/)
export const model3dManifest = z.object({
  schemaVersion: z.literal(2),
  resourceVersion: z.literal('2026.10.15'),
  releaseTag: z.literal('model-workbench-resources'),
  target: z.literal('windows-x64-cu118'),
  cuda: z.literal('11.8'),
  components: z.record(
    z.string(),
    z.object({
      unpackedBytes: z
        .number()
        .int()
        .positive()
        .max(80 * 1024 ** 3),
      sha256: digest,
      license: z.string().min(1),
      sources: z.array(z.string()).min(1),
      parts: z
        .array(
          z.object({
            name: z.string(),
            bytes: z.number().int().positive().max(1999999999),
            sha256: digest
          })
        )
        .min(1)
        .max(100)
    })
  )
})
