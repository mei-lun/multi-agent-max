import { lstat, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { MusicEngine, MusicResourceSpec } from '../../../../shared/mam/music-native'
const safe = (path: string) =>
  !!path &&
  !path.includes('\\') &&
  !path.includes(':') &&
  !path.startsWith('/') &&
  !path.split('/').some((part) => part === '.' || part === '..' || !part)
export async function verifyMusicReadiness(
  directory: string,
  engine: MusicEngine,
  spec: MusicResourceSpec,
  names: string[]
) {
  const required: Record<string, string[]> = {
    runtime: [
      'python.exe',
      'ready.json',
      'Lib/site-packages/torch/__init__.py',
      ...(engine === 'yue2' ? ['comfy-source/comfy/text_encoders/yue2.py'] : [])
    ],
    'musicgen-small': ['model.safetensors', 'manifest.json', 'config.json'],
    'acestep-models': [
      'manifest.json',
      'acestep-v15-turbo/model.safetensors',
      'acestep-v15-turbo/config.json',
      'Qwen3-Embedding-0.6B/model.safetensors',
      'vae/diffusion_pytorch_model.safetensors'
    ],
    'yue2-models': [
      'manifest.json',
      'checkpoints/yue2_3b_int8_convrot.safetensors',
      'audio_encoders/sheetsage2_bf16.safetensors',
      'hdemucs_high_trained.pt'
    ]
  }
  for (const name of names) {
    const root = join(directory, name)
    for (const file of required[name] ?? []) {
      const stat = await lstat(join(root, file))
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Incomplete music resource')
    }
    if (name === 'runtime') {
      const ready = JSON.parse(await readFile(join(root, 'ready.json'), 'utf8'))
      if (
        !ready ||
        typeof ready !== 'object' ||
        (engine !== 'musicgen' &&
          (ready.engine !== engine || ready.sourceRevision !== spec.sourceRevision))
      )
        throw new Error('Runtime revision mismatch')
    } else {
      const model = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8')) as {
        revision?: string
        files?: { file: string; bytes: number }[]
      }
      if (
        model.revision !== spec.modelRevision ||
        !model.files?.length ||
        model.files.length > 2048
      )
        throw new Error('Model revision mismatch')
      for (const file of model.files) {
        if (!safe(file.file) || !Number.isSafeInteger(file.bytes) || file.bytes < 0)
          throw new Error('Unsafe model resource path')
        const stat = await lstat(join(root, file.file))
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== file.bytes)
          throw new Error('Model resource size mismatch')
      }
    }
  }
}
