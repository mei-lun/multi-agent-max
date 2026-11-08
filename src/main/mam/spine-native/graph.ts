import type { z } from 'zod'
import type { spineSettingsSchema } from '../../../shared/mam/spine-native'
export function spineGraph(id: string, c: z.infer<typeof spineSettingsSchema>) {
  const model = (name: string) => ({
    model: name,
    quant_mode: c.quant,
    cache_tag_embeds: true,
    group_offload: c.groupOffload,
    auto_download: false
  })
  return {
    '1': { class_type: 'LoadImage', inputs: { image: `levelup_spine_input_${id}.png` } },
    '2': { class_type: 'SeeThrough_LoadLayerDiffModel', inputs: model(c.layerModel) },
    '3': {
      class_type: 'SeeThrough_GenerateLayers',
      inputs: {
        image: ['1', 0],
        layerdiff_model: ['2', 0],
        seed: c.seed,
        resolution: c.resolution,
        num_inference_steps: c.steps
      }
    },
    '4': { class_type: 'SeeThrough_LoadDepthModel', inputs: model(c.depthModel) },
    '5': {
      class_type: 'SeeThrough_GenerateDepth',
      inputs: {
        layers: ['3', 0],
        depth_model: ['4', 0],
        seed: c.seed,
        resolution_depth: c.resolution
      }
    },
    '6': {
      class_type: 'SeeThrough_PostProcess',
      inputs: { layers_depth: ['5', 0], tblr_split: true, use_lama: false }
    },
    '7': { class_type: 'LevelUpSpineExport', inputs: { parts: ['6', 0], job_id: id } }
  }
}
