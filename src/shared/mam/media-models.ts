export type MediaModel = {
  id: string
  label: string
  modelId: string
  kind: 'image' | 'speech'
  operations: string[]
  sizes?: string[]
  qualities?: string[]
  voices?: string[]
  supportsMask?: boolean
  outputFormats?: string[]
}
