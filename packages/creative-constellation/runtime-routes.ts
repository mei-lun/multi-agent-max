// Lifted from immutable ConstellationStudio routing; MAM patch adapter.
import {
  mediaKindForConstellationNode,
  type ConstellationNode
} from '../../vendor/levelup/baseline-6542241/src/lib/constellation'
import { mediaModelSupportsExplicitImageMask } from '../../vendor/levelup/baseline-6542241/src/lib/mediaCapabilities'
import type {
  MediaCatalog,
  ProviderModelInfo,
  ProviderProfile
} from '../../vendor/levelup/baseline-6542241/src/lib/types'
const tr = (zh: string, _en: string) => zh
export function resolveMediaRoute(
  node: ConstellationNode,
  catalog: MediaCatalog,
  requiresMask = false
) {
  const kind = mediaKindForConstellationNode(node.data.kind)
  if (!kind) throw new Error(tr('节点不是媒体能力', 'This is not a media ability node'))
  const selected = node.data.modelRoute
  const selectedModel = selected
    ? catalog.models.find(
        (model) =>
          model.kind === kind &&
          model.profileId === selected.profileId &&
          model.id === selected.model &&
          model.protocol === selected.protocol
      )
    : undefined
  if (selected && selectedModel) {
    if (requiresMask && !mediaModelSupportsExplicitImageMask(selectedModel)) {
      throw new Error(
        tr(
          `模型“${selectedModel.id}”不支持 PNG 蒙版编辑，请改为自动选择或选择支持 OpenAI Images Edit 的图像模型`,
          `Model “${selectedModel.id}” does not support PNG mask editing. Choose automatic routing or an image model with OpenAI Images Edit support`
        )
      )
    }
    return selected
  }
  const candidates = catalog.models.filter(
    (model) => model.kind === kind && (!requiresMask || mediaModelSupportsExplicitImageMask(model))
  )
  const fallback = candidates[0]
  if (!fallback && requiresMask && catalog.models.some((model) => model.kind === kind)) {
    throw new Error(
      tr(
        '当前没有支持 PNG 蒙版编辑的图像模型，请先配置支持 OpenAI Images Edit 的模型',
        'No configured image model supports PNG mask editing. Configure a model with OpenAI Images Edit support'
      )
    )
  }
  if (!fallback)
    throw new Error(
      tr(
        `没有可用的${kind === 'image' ? '图像' : kind === 'video' ? '视频' : '语音'}模型`,
        `No ${kind} model is available`
      )
    )
  return {
    profileId: fallback.profileId,
    profileName: fallback.profileName,
    model: fallback.id,
    protocol: fallback.protocol
  }
}

export function resolveWritingRoute(
  node: ConstellationNode,
  models: ProviderModelInfo[],
  activeProfile: ProviderProfile
) {
  const selected = node.data.modelRoute
  if (
    selected &&
    models.some(
      (model) =>
        model.profileId === selected.profileId &&
        model.id === selected.model &&
        model.protocol === selected.protocol
    )
  )
    return selected
  const fallback =
    models.find(
      (model) => model.profileId === activeProfile.id && model.id === activeProfile.model
    ) ??
    models.find((model) => model.profileId === activeProfile.id) ??
    models[0]
  if (!fallback)
    return {
      profileId: activeProfile.id,
      profileName: activeProfile.name,
      model: activeProfile.model,
      protocol: activeProfile.protocol
    }
  return {
    profileId: fallback.profileId,
    profileName: fallback.profileName,
    model: fallback.id,
    protocol: fallback.protocol
  }
}
