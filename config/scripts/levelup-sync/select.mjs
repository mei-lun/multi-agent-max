import fs from 'node:fs'
const groups = {
  MediaStudio: ['src/components/Media', 'src/lib/media', 'src-tauri/src/media'],
  MusicWorkbench: [
    'src/components/Music',
    'src/lib/music',
    'src-tauri/src/music_',
    'modules/music',
    'packaging/music'
  ],
  ModelWorkbench: [
    'src/components/Model',
    'src/lib/modelWorkbench',
    'src-tauri/src/model_',
    'modules/model',
    'packaging/model',
    'public/model-viewer'
  ],
  SpineStudio: ['src/components/Spine', 'src/lib/spine', 'src-tauri/src/spine', 'modules/spine'],
  WritingStudio: ['src/components/Writing', 'src/lib/writing'],
  ConstellationStudio: ['src/components/Constellation', 'src/lib/constellation'],
  ModelViewer: [],
  CreativeStudioHeader: ['src/components/CreativeStudioHeader']
}
fs.writeFileSync(
  'migration/levelup/selection.json',
  JSON.stringify(
    {
      schema: 1,
      workbenches: ['media', 'music', 'model', 'spine', 'writing', 'constellation'],
      components: Object.keys(groups),
      rules: [
        { prefix: 'LICENSE', component: 'licenses', target: 'audit', strategy: 'verbatim' },
        ...Object.entries(groups).flatMap(([component, paths]) =>
          paths.map((prefix) => ({
            prefix,
            component,
            target: 'audit; explicit MAM adapter required',
            strategy: 'verbatim provenance',
            knownDependencies: ['See dependencyGaps; Rust/Python runtime requires manual review']
          }))
        ),
        ...['spine', 'model', 'music', 'writing', 'media'].map((x) => ({
          prefix: `scripts/test-${x}`,
          component: x,
          target: 'audit tests',
          strategy: 'verbatim'
        }))
      ]
    },
    null,
    2
  )
)
