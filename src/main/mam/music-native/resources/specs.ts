import type { MusicEngine, MusicResourceSpec } from '../../../../shared/mam/music-native'
export const musicResourceSpecs: Record<MusicEngine, MusicResourceSpec> = {
  musicgen: {
    schemaVersion: 1,
    resourceVersion: '2026.10.1',
    releaseTag: 'music-workbench-resources',
    repository: 'TippingGame/LevelUpAgent',
    target: 'windows-x64-cu128',
    modelRevision: '4c8334b02c6ec4e8664a91979669a501ec497792'
  },
  acestep: {
    schemaVersion: 1,
    resourceVersion: '2026.10.11-acestep',
    releaseTag: 'music-workbench-resources',
    repository: 'TippingGame/LevelUpAgent',
    target: 'windows-x64-cu128',
    modelRevision: '19671f406d603126926c1b7e2adc169acbcade22',
    sourceRevision: 'ca1e85fe9430179831e6bc6be790c332190a3866'
  },
  yue2: {
    schemaVersion: 1,
    resourceVersion: '2026.10.11-yue2-int8',
    releaseTag: 'music-workbench-resources',
    repository: 'TippingGame/LevelUpAgent',
    target: 'windows-x64-cu130',
    modelRevision: '2f76ca75e6ee094169de899cc7fc99d6887e2196',
    sourceRevision: '830232b856045ca2892833212d7771078a13edd5'
  }
}
export const musicComponentNames: Record<MusicEngine, string[]> = {
  musicgen: ['runtime', 'musicgen-small'],
  acestep: ['runtime', 'acestep-models'],
  yue2: ['runtime', 'yue2-models']
}
export function resourceUrl(spec: MusicResourceSpec, name: string) {
  return `https://github.com/${spec.repository}/releases/download/${spec.releaseTag}/${name}`
}
export function manifestName(spec: MusicResourceSpec) {
  return `music-workbench-${spec.resourceVersion}-${spec.target}.json`
}
