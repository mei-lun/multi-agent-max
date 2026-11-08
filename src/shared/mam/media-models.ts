export type MediaModel = {
  id: string
  label: string
  modelId: string
  kind: 'image' | 'speech' | 'video'
  operations: string[]
  sizes?: string[]
  qualities?: string[]
  voices?: string[]
  supportsMask?: boolean
  outputFormats?: string[]
  supportsVideoModes?: string[]
}
