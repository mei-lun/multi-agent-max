import type { MamRendererApi } from '../../shared/mam/application-api'

export function getMamRendererApi(): MamRendererApi {
  return (window as typeof window & Readonly<{ mam: MamRendererApi }>).mam
}
